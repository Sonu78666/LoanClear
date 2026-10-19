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
// Comma-separated list, so production and local dev can both be allowed at
// once without toggling this env var back and forth before every deploy.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:5500')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Railway (and most PaaS hosts) sit behind a reverse proxy — trust its
// X-Forwarded-For so req.ip and the rate limiters see the real client IP.
app.set('trust proxy', 1);

// --- Security layers, in order ---

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (no Origin header, e.g. curl/health checks).
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));
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

    const createCompletion = (msgs) =>
      groq.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        max_tokens: MAX_TOKENS_PER_REPLY,
        reasoning_effort: 'medium',
        tools: loanTools,
        messages: msgs,
      });

    // The model occasionally emits a malformed tool call (e.g. missing fields on a
    // second/follow-up call within the same turn); Groq rejects that generation
    // outright rather than passing it through. One retry resolves it in practice
    // without failing the whole request.
    const createCompletionWithRetry = async (msgs) => {
      try {
        return await createCompletion(msgs);
      } catch (e) {
        logger.warn('completion_retry', { sessionId, message: e.message });
        return createCompletion(msgs);
      }
    };

    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    let completion = await createCompletionWithRetry(messages);

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
      completion = await createCompletionWithRetry(messages);
      responseMessage = completion.choices?.[0]?.message;
    }

    let reply = responseMessage?.content?.trim() || '';

    // Occasionally the model's final turn comes back with no text content at
    // all (it used its whole token budget on internal reasoning). One retry
    // of the same final call usually produces real text.
    if (!reply) {
      logger.warn('empty_reply_retry', { sessionId });
      completion = await createCompletionWithRetry(messages);
      reply = completion.choices?.[0]?.message?.content?.trim() || '';
    }

    if (!reply) {
      logger.error('server_error', { ip, sessionId, reason: 'empty reply after retry' });
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

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
  if (err.message === 'Not allowed by CORS') {
    logger.warn('cors_rejected', { origin: req.headers.origin, path: req.path });
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  logger.error('server_error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  logger.info(`LoanNiti backend listening on port ${PORT}`);
});
