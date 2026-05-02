/**
 * addCourse.js
 *
 * Given a PDF buffer + a course name + an OpenAI API key, extract a curriculum
 * tree in the canonical `data/units/<domain>.json` shape and (optionally) write
 * it to disk together with empty progress/history/deadlines scaffolding.
 *
 * Why OpenAI here: this is a heavy structured-extraction job that benefits from
 * gpt-4o-mini's larger context + reliable JSON mode. The standard study/test
 * pipeline still uses Groq (configurable via AI_PROVIDER).
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { OpenAI } = require('openai');
const { resolveKey } = require('./byok');
const { UserPaths } = require('./userPaths');

// PDF-extracted text gets truncated to keep the prompt under a sane token
// budget. ~200k chars ≈ 50k tokens, well within gpt-4o-mini's 128k window.
const MAX_PDF_CHARS = 200_000;

// Same exact shape as the existing data/units/<domain>.json files.
function buildExtractionPrompt(courseName, pdfText) {
  return `You are an expert curriculum designer. Below is the raw text of a textbook for the course "${courseName}".

Extract a curriculum tree as JSON with this EXACT shape:

{
  "meta": {
    "bt": ["BroadTopic1", "BroadTopic2", ...],
    "cl": ["ClusterName1", "ClusterName2", ...]
  },
  "tree": [
    {
      "bt": 0,
      "clusters": [
        { "cl": 0, "units": [
            {"id": 0, "n": "Unit Name", "t": "f", "nt": "1-2 sentence scope note describing what this unit covers and excludes.", "l": []},
            {"id": 1, "n": "...", "t": "c", "nt": "...", "l": [[0, "h"]]}
        ]}
      ]
    }
  ]
}

RULES (must follow exactly):
- Produce 5–8 broad topics ("bt").
- Each broad topic has 2–4 clusters; clusters live in the global "cl" index array.
- Each cluster has 2–4 units.
- Unit "id" values start at 0 and increase sequentially across the WHOLE tree (no gaps, no duplicates).
- "t" is "f" for foundational/intro units (typically the first 1–2 in each topic) and "c" for content units that build on others.
- "l" is the prerequisite list: an array of [prereq_unit_id, "h"] for hard prereqs or [prereq_unit_id, "s"] for soft prereqs. Foundational units may have an empty "l".
- "nt" is a 1–2 sentence scope note ("Covers X, Y, Z; excludes A, B.") that describes what the unit covers.
- Topic and cluster names should be concise (3–7 words).
- Unit names should be specific and descriptive (5–12 words).

Return ONLY the JSON object, no commentary, no markdown fences.

--- TEXTBOOK CONTENT (${pdfText.length} chars) ---
${pdfText}`;
}

/**
 * Extract a unit tree from a PDF buffer using OpenAI.
 * @param {Buffer} pdfBuffer
 * @param {string} courseName
 * @param {string} apiKey - OpenAI API key (per-request override; falls back to env)
 * @returns {Promise<object>} the parsed { meta, tree } object
 */
async function extractUnitsFromPDF(pdfBuffer, courseName, apiKey) {
  // Same BYOK contract as the AI adapters: user-supplied wins; env fallback
  // only available in local dev (NODE_ENV !== 'production' && no RAILWAY_ENVIRONMENT).
  const resolvedKey = resolveKey(apiKey, 'OPENAI_API_KEY', 'OpenAI');

  // 1. PDF → text (pdf-parse@2 API: stateful PDFParse class, must call destroy)
  let text = '';
  let numPages = 0;
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    text = (result.text || '').trim();
    numPages = result.total || result.numpages || result.pages?.length || 0;
  } catch (e) {
    await parser.destroy().catch(() => {});
    const err = new Error(`Failed to parse PDF: ${e.message}`);
    err.status = 400;
    throw err;
  }
  await parser.destroy().catch(() => {});

  if (text.length < 200) {
    const err = new Error(`PDF text extraction yielded only ${text.length} chars — the file may be image-only or scanned. Try a text-based PDF (or run OCR first).`);
    err.status = 400;
    throw err;
  }
  const truncated = text.length > MAX_PDF_CHARS ? text.slice(0, MAX_PDF_CHARS) : text;

  // 2. Text + course name → structured JSON tree
  const client = new OpenAI({ apiKey: resolvedKey });
  let raw;
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: buildExtractionPrompt(courseName, truncated) }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });
    raw = completion.choices[0].message.content;
  } catch (e) {
    const err = new Error(`OpenAI request failed: ${e.message}`);
    err.status = e.status || 502;
    throw err;
  }

  // 3. Parse + validate
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`OpenAI returned non-JSON response: ${e.message}`);
  }

  validateUnitsShape(parsed);
  return { units: parsed, pdfPages: numPages, pdfChars: text.length };
}

function validateUnitsShape(data) {
  if (!data || typeof data !== 'object') throw new Error('top-level must be an object');
  if (!data.meta || !Array.isArray(data.meta.bt) || !Array.isArray(data.meta.cl))
    throw new Error('meta.bt and meta.cl must be arrays');
  if (!Array.isArray(data.tree)) throw new Error('tree must be an array');

  let unitCount = 0;
  for (const bt of data.tree) {
    if (typeof bt.bt !== 'number') throw new Error('tree[].bt must be a number index');
    if (!Array.isArray(bt.clusters)) throw new Error('tree[].clusters must be an array');
    for (const cl of bt.clusters) {
      if (typeof cl.cl !== 'number') throw new Error('cluster.cl must be a number index');
      if (!Array.isArray(cl.units)) throw new Error('cluster.units must be an array');
      for (const u of cl.units) {
        if (typeof u.id !== 'number') throw new Error('unit.id must be a number');
        if (typeof u.n !== 'string' || !u.n.trim()) throw new Error('unit.n must be non-empty string');
        unitCount++;
      }
    }
  }
  if (unitCount === 0) throw new Error('extracted tree contains zero units');
}

/** Slugify a course name into a domain id usable as a filename. */
function slugify(name) {
  return String(name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || `course-${Date.now().toString(36)}`;
}

/** Pick a slug that doesn't collide with an existing user-scoped <slug>.json. */
function pickUniqueSlug(name, paths) {
  const base = slugify(name);
  if (!fs.existsSync(paths.unitsFile(base))) return base;
  let n = 2;
  while (fs.existsSync(paths.unitsFile(`${base}-${n}`))) n++;
  return `${base}-${n}`;
}

/** Build empty progress + deadlines files mirroring the units tree, in user namespace. */
function bootstrapDomainFiles(slug, units, paths) {
  paths.ensureDirs();
  const progress = {
    tree: units.tree.map(bt => ({
      bt: bt.bt,
      clusters: bt.clusters.map(cl => ({
        cl: cl.cl,
        units: cl.units.map(u => ({ id: u.id, logs: [] })),
      })),
    })),
  };
  fs.writeFileSync(paths.progressFile(slug),  JSON.stringify(progress, null, 2));
  fs.writeFileSync(paths.historyFile(slug),   JSON.stringify([], null, 2));
  fs.writeFileSync(paths.deadlinesFile(slug), JSON.stringify({ meta: units.meta, deadlines: {} }, null, 2));
}

/**
 * Full one-shot pipeline: PDF buffer → write per-user units file + scaffold.
 * @param {Buffer} pdfBuffer
 * @param {string} courseName
 * @param {string} userId    REQUIRED — the authenticated user's id (req.user.id).
 * @param {string} [apiKey]  OpenAI BYOK key.
 * @returns {Promise<{ slug, unitCount, pdfPages, pdfChars }>}
 */
async function addCourseFromPDF(pdfBuffer, courseName, userId, apiKey) {
  if (!userId) throw new Error('addCourseFromPDF: userId is required');
  const paths = new UserPaths(userId);
  paths.ensureDirs();

  const { units, pdfPages, pdfChars } = await extractUnitsFromPDF(pdfBuffer, courseName, apiKey);
  const slug = pickUniqueSlug(courseName, paths);

  fs.writeFileSync(paths.unitsFile(slug), JSON.stringify(units, null, 2));
  bootstrapDomainFiles(slug, units, paths);

  const unitCount = units.tree.reduce(
    (a, bt) => a + bt.clusters.reduce((b, cl) => b + cl.units.length, 0), 0);

  return { slug, unitCount, pdfPages, pdfChars };
}

module.exports = { addCourseFromPDF, extractUnitsFromPDF, bootstrapDomainFiles, pickUniqueSlug };
