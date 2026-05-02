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

async function chat(systemPrompt, messages, options = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY environment variable');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: options.model || DEFAULT_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
    },
  });

  // Gemini uses role 'model' (not 'assistant') and history excludes the final user message
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1].content;

  try {
    const session = model.startChat({ history });
    const result = await session.sendMessage(lastMessage);
    return result.response.text();
  } catch (err) {
    throw new Error(`[Gemini] ${err.message}`);
  }
}

async function* chatStream(systemPrompt, messages, options = {}) {
  const reply = await chat(systemPrompt, messages, options);
  yield reply;
}

module.exports = { generate, chat, chatStream };
