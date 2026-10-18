require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Groq = require('groq-sdk');

const logger = require('./logger');
const { checkInjection, checkOffTopic } = require('./middleware/injectionCheck');
const { dailyLimiter, getDailyRemaining } = require('./middleware/dailyLimiter');
const { getOrCreateSession, appendToHistory, prunedHistory } = require('./middleware/sessionStore');
const { buildSystemPrompt } = require('./systemPrompt');
const { loanTools, runLoanScenarioTool } = require('./loanTool');

const app = express();

const PORT = process.env.PORT || 3001;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX_PER_WINDOW) || 5;
const DAILY_LIMIT_PER_IP = Number(process.env.DAILY_LIMIT_PER_IP) || 30;
const MAX_MESSAGES_PER_SESSION = Number(process.env.MAX_MESSAGES_PER_SESSION) || 10;
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS) || 400;
const MAX_TOKENS_PER_REPLY = Number(process.env.MAX_TOKENS_PER_REPLY) || 600;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5500';

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Railway (and most PaaS hosts) sit behind a reverse proxy — trust its
// X-Forwarded-For so req.ip and the rate limiters see the real client IP.
app.set('trust proxy', 1);

// --- Security layers, in order ---

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '10kb' }));

const perMinuteLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('rate_limit_hit', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many requests, slow down.', retryAfter: 60 });
  },
});

// --- Routes ---

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const chatValidators = [
  body('message').isString().isLength({ min: 1, max: MAX_INPUT_CHARS }),
  body('loanContext').isObject(),
  body('loanContext.amount').isFloat({ min: 100000, max: 100000000 }),
  body('loanContext.rate').isFloat({ min: 1, max: 30 }),
  body('loanContext.tenure').isFloat({ min: 1, max: 30 }),
  body('loanContext.emi').isFloat({ min: 1 }),
  body('loanContext.totalInterest').isFloat({ min: 0 }),
  body('loanContext.loanType').isIn(['floating', 'fixed']),
  body('language').optional().isIn(['hinglish', 'english', 'hindi']),
];

app.post('/api/chat', perMinuteLimiter, dailyLimiter(DAILY_LIMIT_PER_IP), chatValidators, async (req, res) => {
  const ip = req.ip;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid request.', details: errors.array() });
  }

  const { message, loanContext, language } = req.body;
  const sessionIdHeader = req.header('X-Session-ID');

  if (checkInjection(message)) {
    logger.warn('injection_attempt', { ip, sessionId: sessionIdHeader, snippet: message.slice(0, 100) });
    return res.status(400).json({ error: 'Message blocked.', blocked: true });
  }

  if (checkOffTopic(message)) {
    logger.info('off_topic_attempt', { ip, sessionId: sessionIdHeader, snippet: message.slice(0, 100) });
    // Let the system prompt steer the model's response; do not block here.
  }

  const { id: sessionId, session } = getOrCreateSession(sessionIdHeader);

  if (session.messageCount >= MAX_MESSAGES_PER_SESSION) {
    return res.status(429).json({
      error: 'Session message limit reached.',
      sessionLimitReached: true,
      sessionId,
    });
  }

  if (!groq) {
    logger.error('server_error', { ip, sessionId, reason: 'missing GROQ_API_KEY' });
    return res.status(500).json({ error: 'AI service is not configured.' });
  }

  try {
    appendToHistory(session, 'user', message);
    session.messageCount += 1;

    const systemPrompt = buildSystemPrompt(loanContext, language);
    const history = prunedHistory(session, 8);

    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    let completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      max_tokens: MAX_TOKENS_PER_REPLY,
      reasoning_effort: 'medium',
      tools: loanTools,
      messages,
    });

    let responseMessage = completion.choices?.[0]?.message;
    let toolRounds = 0;

    while (responseMessage?.tool_calls?.length && toolRounds < 3) {
      messages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        let result;
        try {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          result = runLoanScenarioTool(loanContext, args);
        } catch (e) {
          result = { error: 'Calculation failed.' };
        }
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }

      toolRounds += 1;
      completion = await groq.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        max_tokens: MAX_TOKENS_PER_REPLY,
        reasoning_effort: 'medium',
        tools: loanTools,
        messages,
      });
      responseMessage = completion.choices?.[0]?.message;
    }

    const reply = responseMessage?.content?.trim() || '';
    appendToHistory(session, 'assistant', reply);

    const dailyRemaining = getDailyRemaining(ip, DAILY_LIMIT_PER_IP);
    const messagesRemaining = Math.max(0, MAX_MESSAGES_PER_SESSION - session.messageCount);

    logger.info('chat_success', {
      ip,
      sessionId,
      msgCount: session.messageCount,
      inputTokens: completion.usage?.prompt_tokens,
      dailyRemaining,
    });

    res.json({ reply, sessionId, messagesRemaining, dailyRemaining });
  } catch (err) {
    if (err?.status) {
      logger.error('anthropic_error', { ip, sessionId, status: err.status, message: err.message });
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }
    logger.error('server_error', { ip, sessionId, message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// --- 404 and error handlers ---

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((err, req, res, next) => {
  logger.error('server_error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  logger.info(`LoanClear backend listening on port ${PORT}`);
});
