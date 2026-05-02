const Groq = require('groq-sdk');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

async function generate(prompt, options = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY environment variable');
  }

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

module.exports = { generate };
