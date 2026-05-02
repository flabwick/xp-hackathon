/**
 * byok.js — Bring-Your-Own-Key gating
 *
 * In local development, the AI adapters happily fall back to whatever key is
 * in `.env`. In production (deployed on Railway / any PaaS), we explicitly
 * refuse that fallback — so even if someone accidentally adds a server-side
 * env key, every visitor MUST supply their own key via the in-app modal.
 *
 * Production is detected by either:
 *   - NODE_ENV === 'production' (set automatically by Nixpacks on Railway)
 *   - RAILWAY_ENVIRONMENT being defined (set automatically by Railway)
 *
 * Anything else is treated as local dev.
 */

function isProduction() {
  return process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
}

/**
 * Resolve which API key to use for an AI request.
 *
 * @param {string|undefined} userKey  - per-request key from request header
 * @param {string} envVarName         - e.g. 'GROQ_API_KEY' or 'OPENAI_API_KEY'
 * @param {string} providerLabel      - e.g. 'Groq' or 'OpenAI'
 * @returns {string} the resolved key
 * @throws {Error} with .status=401 if no key can be resolved
 */
function resolveKey(userKey, envVarName, providerLabel) {
  if (userKey) return userKey;

  if (isProduction()) {
    const err = new Error(
      `Please add your ${providerLabel} API key first. Go to the home page and click the 🔑 API Keys button — the hosted demo never uses a server-side key, every visitor brings their own.`
    );
    err.status = 401;
    throw err;
  }

  const envKey = process.env[envVarName];
  if (envKey) return envKey;

  const err = new Error(
    `Missing ${providerLabel} API key. Set ${envVarName} in your local .env, or supply one via the in-app "🔑 API Keys" modal.`
  );
  err.status = 401;
  throw err;
}

/**
 * Used by /api/config so the UI can decide whether to nudge the visitor.
 * In production we always report `false` — visitors MUST bring a key.
 */
function envKeyAvailableToUI(envVarName) {
  if (isProduction()) return false;
  return !!process.env[envVarName];
}

module.exports = { isProduction, resolveKey, envKeyAvailableToUI };
