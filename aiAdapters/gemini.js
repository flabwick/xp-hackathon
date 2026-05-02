const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-2.0-flash';

async function generate(prompt, options = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: options.model || DEFAULT_MODEL,
    generationConfig: {
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
      ...(options.json && { responseMimeType: 'application/json' }),
    },
  });

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    throw new Error(`[Gemini] ${err.message}`);
  }
}

module.exports = { generate };
