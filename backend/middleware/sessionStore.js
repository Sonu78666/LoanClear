const { v4: uuidv4 } = require('uuid');

const sessions = new Map(); // sessionId -> { messageCount, createdAt, lastSeen, history: [{role, content}] }

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function getOrCreateSession(sessionId) {
  let id = sessionId;
  let session = id ? sessions.get(id) : undefined;

  if (!session) {
    id = sessionId || uuidv4();
    session = {
      messageCount: 0,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      history: [],
    };
    sessions.set(id, session);
  }

  return { id, session };
}

function appendToHistory(session, role, content) {
  session.history.push({ role, content });
  session.lastSeen = Date.now();
}

function prunedHistory(session, maxMessages = 8) {
  return session.history.slice(-maxMessages);
}

// Clean up sessions older than 2 hours, checked hourly.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastSeen > TWO_HOURS_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

module.exports = { sessions, getOrCreateSession, appendToHistory, prunedHistory };
