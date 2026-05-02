const Groq = require('groq-sdk');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/** Resolve the API key: per-request override > env. Throws if neither is set. */
function resolveApiKey(options) {
  const key = (options && options.apiKey) || process.env.GROQ_API_KEY;
  if (!key) {
    const err = new Error('Missing Groq API key. Set GROQ_API_KEY in the environment, or supply one via the in-app "API Key" button (sent as the X-Groq-Api-Key header).');
    err.status = 401;
    throw err;
  }
  return key;
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
