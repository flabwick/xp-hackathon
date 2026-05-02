// In-memory session store for mobile upload sessions.
// Sessions expire after 30 minutes and are cleaned up every 5 minutes.

const TTL_MS = 30 * 60 * 1000;

/** @type {Map<string, { status: string, ocrResults: Array, createdAt: number }>} */
const sessions = new Map();

function createSession(token) {
  sessions.set(token, { status: 'waiting', ocrResults: [], createdAt: Date.now() });
}

function getSession(token) {
  return sessions.get(token) || null;
}

function updateSession(token, data) {
  const existing = sessions.get(token);
  if (!existing) return false;
  sessions.set(token, { ...existing, ...data });
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [token, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(token);
  }
}, 5 * 60 * 1000);

module.exports = { createSession, getSession, updateSession };
