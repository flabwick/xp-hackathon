const Groq = require('groq-sdk');
const { resolveKey } = require('../byok');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Per-request user key wins. In production the env-var fallback is disabled
 * (BYOK enforced); in local dev GROQ_API_KEY in .env is honoured.
 */
function resolveApiKey(options) {
  return resolveKey(options && options.apiKey, 'GROQ_API_KEY', 'Groq');
}

async function generate(prompt, options = {}) {
  const client = new Groq({ apiKey: resolveApiKey(options) });

  try {
    const completion = await client.chat.completions.create({
      model: options.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      ...(options.json && { response_format: { type: 'json_object' } }),
    });
    return completion.choices[0].message.content;
  } catch (err) {
    throw new Error(`[Groq] ${err.message}`);
  }
}

async function* chatStream(systemPrompt, messages, options = {}) {
  const client = new Groq({ apiKey: resolveApiKey(options) });

  const stream = await client.chat.completions.create({
    model: options.model || DEFAULT_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) yield text;
  }
}

async function chat(systemPrompt, messages, options = {}) {
  const client = new Groq({ apiKey: resolveApiKey(options) });

  try {
    const completion = await client.chat.completions.create({
      model: options.model || DEFAULT_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    });
    return completion.choices[0].message.content;
  } catch (err) {
    throw new Error(`[Groq] ${err.message}`);
  }
}

module.exports = { generate, chat, chatStream };
