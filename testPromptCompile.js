const fs = require('fs');
const path = require('path');
const { compilePrompt } = require('./promptCompiler');
const { generate } = require('./aiAdapters/groq');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

function validateQuestions(data) {
  if (!Array.isArray(data.questions)) throw new Error('questions must be an array');
  for (const q of data.questions) {
    if (typeof q.id !== 'number') throw new Error(`question id must be a number, got ${JSON.stringify(q.id)}`);
    if (typeof q.question !== 'string' || !q.question.trim()) throw new Error(`question text missing for id ${q.id}`);
  }
}

async function testPromptCompile(domain, unitIds) {
  console.log(`[testPromptCompile] domain="${domain}" unitIds=[${unitIds.join(',')}]`);

  const template = fs.readFileSync(path.join(PROMPTS_DIR, 'test.md'), 'utf8');
  const prompt = compilePrompt(template, { domain, unitIds });
  console.log(`[testPromptCompile] compiled prompt length: ${prompt.length} chars`);

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(`[testPromptCompile] attempt ${attempt + 1}`);
    const p = attempt === 0 ? prompt
      : `${prompt}\n\nYour previous response failed validation: ${lastError}\nReturn valid JSON only, matching the exact shape specified.`;
    try {
      const raw = await generate(p, { json: true });
      console.log(`[testPromptCompile] raw response length: ${raw.length} chars`);
      const parsed = JSON.parse(raw);
      validateQuestions(parsed);
      console.log(`[testPromptCompile] success — ${parsed.questions.length} questions`);
      return parsed;
    } catch (e) {
      console.error(`[testPromptCompile] attempt ${attempt + 1} failed:`, e.message);
      lastError = e.message;
      if (attempt === 1) throw new Error(`AI response invalid after retry: ${lastError}`);
    }
  }
}

module.exports = { testPromptCompile };
