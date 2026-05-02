require('dotenv').config({ override: true });

const ADAPTERS = {
  gemini: './aiAdapters/gemini',
  groq:   './aiAdapters/groq',
  openai: './aiAdapters/openai',
};

const provider = process.env.AI_PROVIDER || 'gemini';

if (!ADAPTERS[provider]) {
  throw new Error(`Unknown AI provider: "${provider}". Valid options: ${Object.keys(ADAPTERS).join(', ')}`);
}

const { generate } = require(ADAPTERS[provider]);

module.exports = { generate };
