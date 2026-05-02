async function generate(prompt, options = {}) {
  throw new Error('OpenAI adapter not configured — set AI_PROVIDER=gemini or implement this adapter');
}

module.exports = { generate };
