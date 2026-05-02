const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const multer = require('multer');
const { compilePrompt } = require('./promptCompiler');
const { generate } = require('./aiClient');
const { testPromptCompile } = require('./testPromptCompile');
const app = express();
const PORT = 6969;

app.use(express.json({ limit: '10mb' }));

// In production, serve the Vite build output
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  app.use(express.static('public'));
  app.get('/mapping', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mapping.html'));
  });
  app.get('/markdown-ui', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'markdown-ui.html'));
  });
  app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
  });
}

// Serve study menu (per-course via ?course=<id>)
app.get('/study', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'study.html'));
});

// ─── SYNC STORAGE HELPERS ───────────────────────────────────────────────────────
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');

const UNITS_DIR = path.join(__dirname, 'data/units');
const DEADLINES_DIR = path.join(__dirname, 'data/deadlines');
const PROGRESS_DIR = path.join(__dirname, 'data/progress');
const BACKUPS_BASE_DIR = path.join(__dirname, 'data/backups');
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const COURSES_PATH = path.join(__dirname, 'data/courses.json');
const COURSES_DATA_DIR = path.join(__dirname, 'data/courses');
const CHAPTER_SPLITTER_SCRIPT = path.join(__dirname, 'scripts/Seperate_By_Chapter_Final.py');

// ─── COURSE HELPERS ──────────────────────────────────────────────────────────────
const readCourses = () => readJSON(COURSES_PATH);
const writeCourses = (d) => writeJSON(COURSES_PATH, d);
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const genCourseId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function uniqueDomainSlug(base, existing) {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function scaffoldDomainFiles(domain) {
  const unitsP = path.join(UNITS_DIR, `${domain}.json`);
  const progP = path.join(PROGRESS_DIR, `${domain}.json`);
  const deadP = path.join(DEADLINES_DIR, `${domain}.json`);
  if (!fs.existsSync(unitsP)) writeJSON(unitsP, { meta: { bt: [], cl: [] }, tree: [] });
  if (!fs.existsSync(progP)) writeJSON(progP, { tree: [] });
  if (!fs.existsSync(deadP)) writeJSON(deadP, { meta: { bt: [], cl: [] }, deadlines: {} });
}

function findCourseById(id) {
  const data = readCourses();
  const idx = data.courses.findIndex(c => c.id === id);
  if (idx === -1) return null;
  return { data, course: data.courses[idx], idx };
}

const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Only PDF uploads are accepted'));
  }
});

// SYNC boot migration. Must stay sync — server.js uses sync fs throughout, and
// app.listen below depends on courses.json existing before any request hits.
function bootstrapCourses() {
  if (fs.existsSync(COURSES_PATH)) return;
  const courses = [];
  if (fs.existsSync(UNITS_DIR)) {
    for (const file of fs.readdirSync(UNITS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const domain = file.replace(/\.json$/, '');
      courses.push({
        id: genCourseId(),
        name: domain.charAt(0).toUpperCase() + domain.slice(1),
        domain,
        createdAt: new Date().toISOString(),
        textbookPath: null,
        chaptersDir: null
      });
    }
  }
  writeCourses({ courses });
}

// ─── PROGRESS HELPERS ────────────────────────────────────────────────────────────
const progressPath = (domain) => path.join(PROGRESS_DIR, `${domain}.json`);
const historyPath = (domain) => path.join(PROGRESS_DIR, `${domain}-history.json`);

const backupProgress = (domain) => {
  try {
    const domainBackupDir = path.join(BACKUPS_BASE_DIR, domain);
    if (!fs.existsSync(domainBackupDir)) fs.mkdirSync(domainBackupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pPath = progressPath(domain);
    const hPath = historyPath(domain);

    if (fs.existsSync(pPath)) {
      fs.copyFileSync(pPath, path.join(domainBackupDir, `progress-${timestamp}.json`));
    }
    if (fs.existsSync(hPath)) {
      fs.copyFileSync(hPath, path.join(domainBackupDir, `history-${timestamp}.json`));
    }
  } catch (e) {
    console.error(`Backup failed for domain ${domain}:`, e);
  }
};

const findUnitInProgress = (progressData, unitId) => {
  for (const bt of progressData.tree) {
    for (const cl of bt.clusters) {
      for (const u of cl.units) {
        if (u.id === unitId) return u;
      }
    }
  }
  return null;
};

// ─── XP CALCULATION ──────────────────────────────────────────────────────────────
const BANDS = [
  { lv: 'I', base: 15, cum: 0, expDV: 15 },
  { lv: 'II', base: 40, cum: 150, expDV: 30 },
  { lv: 'III', base: 90, cum: 600, expDV: 50 },
  { lv: 'IV', base: 160, cum: 1500, expDV: 70 },
  { lv: 'V', base: 300, cum: 2400, expDV: 85 }
];

const getBandInfo = (cum) => {
  // Band I: 0-149, II: 150-599, III: 600-1499, IV: 1500-2399, V: 2400+
  if (cum >= 2400) return BANDS.find(b => b.lv === 'V');
  if (cum >= 1500) return BANDS.find(b => b.lv === 'IV');
  if (cum >= 600) return BANDS.find(b => b.lv === 'III');
  if (cum >= 150) return BANDS.find(b => b.lv === 'II');
  return BANDS.find(b => b.lv === 'I');
};

// Calculate XP for all units in a progress file
function calculateXPFromProgress(progressData) {
  const result = {};

  if (!progressData || !progressData.tree) return result;

  for (const bt of progressData.tree) {
    for (const cl of bt.clusters) {
      for (const u of cl.units) {
        const logs = u.logs || [];
        let cumulativeXP = 0;
        const progressLogs = [];

        // Walk through logs sequentially to calculate band progression
        for (const log of logs) {
          if (log.xpGain !== undefined && log.dv !== undefined && log.bm !== undefined) {
            cumulativeXP += log.xpGain;
            progressLogs.push(log);
          } else if (log.dv !== undefined && log.bm !== undefined) {
            // Old format log entry with session data
            // Recalculate XP from dv and bm
            const bandInfo = getBandInfo(cumulativeXP);
            const perfRatio = log.dv / bandInfo.expDV;
            const bm = Math.min(2.0, Math.max(-0.5, 2 * perfRatio - 0.8));
            const xpGain = Math.max(0, Math.round(bandInfo.base * bm));
            cumulativeXP += xpGain;
            progressLogs.push({
              date: log.timestamp || log.date,
              dv: log.dv,
              bm: log.bm,
              delta: xpGain,
              note: log.notes || log.note,
              sessionId: log.sessionId
            });
          }
        }

        result[u.id] = {
          cumulativeXP,
          currentBand: getBandInfo(cumulativeXP).lv,
          progressLogs
        };
      }
    }
  }

  return result;
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────────

// ─── COURSES ─────────────────────────────────────────────────────────────────────
app.get('/api/courses', (req, res) => {
  try {
    if (!fs.existsSync(COURSES_PATH)) return res.json({ courses: [] });
    res.json(readCourses());
  } catch (e) { res.status(500).json({ error: 'Failed to read courses' }); }
});

app.post('/api/courses', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const data = fs.existsSync(COURSES_PATH) ? readCourses() : { courses: [] };
  const existingDomains = new Set(data.courses.map(c => c.domain));
  const baseSlug = slugify(name) || 'course';
  const domain = uniqueDomainSlug(baseSlug, existingDomains);
  const course = {
    id: genCourseId(),
    name: name.trim(),
    domain,
    createdAt: new Date().toISOString(),
    textbookPath: null,
    chaptersDir: null
  };
  data.courses.push(course);
  try {
    scaffoldDomainFiles(domain);
    writeCourses(data);
    res.json({ success: true, course });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create course', details: e.message });
  }
});

app.post('/api/courses/:courseId/upload-textbook', (req, res) => {
  upload.single('pdf')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: 'Upload rejected', details: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }
    const found = findCourseById(req.params.courseId);
    if (!found) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ error: 'Course not found' });
    }
    const { data, idx } = found;
    const course = data.courses[idx];
    const absChaptersDir = path.join(COURSES_DATA_DIR, course.id, 'chapters');
    fs.mkdirSync(absChaptersDir, { recursive: true });
    const relChaptersDir = path.relative(__dirname, absChaptersDir);

    let stdoutBuf = '';
    let stderrBuf = '';
    const proc = spawn('python3', [CHAPTER_SPLITTER_SCRIPT, req.file.path, '--output-dir', absChaptersDir]);
    proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    proc.on('error', (err) => {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: 'Failed to launch python3 — is it installed?', details: err.message });
    });
    proc.on('close', (code) => {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      if (code === 0) {
        const chapterCount = fs.readdirSync(absChaptersDir).filter(f => f.endsWith('.txt')).length;
        data.courses[idx].chaptersDir = relChaptersDir;
        writeCourses(data);
        res.json({ success: true, chaptersDir: relChaptersDir, chapterCount });
      } else {
        const details = (stdoutBuf + stderrBuf).trim().slice(-4000);
        res.status(500).json({ error: 'Chapter extraction failed', details });
      }
    });
  });
});

app.get('/api/domains', (req, res) => {
  try {
    const files = fs.readdirSync(UNITS_DIR).filter(f => f.endsWith('.json'));
    res.json(files.map(f => f.replace('.json', '')));
  } catch (e) { res.status(500).json({ error: 'Failed to list domains' }); }
});

app.get('/api/units/:domain', (req, res) => {
  const p = path.join(UNITS_DIR, `${req.params.domain}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Domain not found' });
  const data = readJSON(p);

  if (!data.meta || !data.tree || !Array.isArray(data.meta.bt) || !Array.isArray(data.meta.cl)) {
    return res.status(400).json({ error: 'Invalid unit format - missing meta.bt or meta.cl arrays' });
  }

  res.json(data);
});

app.get('/api/deadlines/:domain', (req, res) => {
  const p = path.join(DEADLINES_DIR, `${req.params.domain}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Deadline file not found' });
  const data = readJSON(p);
  res.json(data);
});

app.get('/api/progress/:domain', (req, res) => {
  const p = progressPath(req.params.domain);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Progress file not found' });
  const data = readJSON(p);
  res.json(data);
});

app.post('/api/progress/:domain', (req, res) => {
  const domain = req.params.domain;
  const p = progressPath(domain);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Progress file not found' });

  const { unitId, notes } = req.body;
  if (unitId === undefined) return res.status(400).json({ error: 'unitId required' });
  if (!notes || typeof notes !== 'string') return res.status(400).json({ error: 'notes string required' });

  backupProgress(domain);
  const data = readJSON(p);
  const unit = findUnitInProgress(data, unitId);
  if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found in progress` });

  const entry = { timestamp: new Date().toISOString(), notes };
  unit.logs.push(entry);
  writeJSON(p, data);
  res.json({ success: true, unitId, entry });
});

// COMPILE PROMPT (resolves all placeholders)
app.post('/api/prompt/:type/compile', (req, res) => {
  const type = req.params.type.replace(/[^a-zA-Z0-9_-]/g, '');
  const p = path.join(PROMPTS_DIR, `${type}.md`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Prompt not found' });

  try {
    const template = fs.readFileSync(p, 'utf8');
    const { domain, unitIds, entries } = req.body;
    const compiled = compilePrompt(template, { domain, unitIds, entries });
    res.type('text/markdown').send(compiled);
  } catch (e) {
    res.status(500).json({ error: 'Failed to compile prompt', details: e.message });
  }
});

app.get('/api/prompt/:type', (req, res) => {
  const type = req.params.type.replace(/[^a-zA-Z0-9_-]/g, '');
  const p = path.join(PROMPTS_DIR, `${type}.md`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Prompt not found' });
  res.type('text/markdown').send(fs.readFileSync(p, 'utf8'));
});

// ─── XP ENDPOINTS (domain-based, calculated from progress) ───────────────────────

app.get('/api/xp', (req, res) => {
  // Accept optional domain query param
  const domain = req.query.domain;
  let xpState = {};
  let history = [];

  if (domain) {
    const pPath = progressPath(domain);
    if (fs.existsSync(pPath)) {
      xpState = calculateXPFromProgress(readJSON(pPath));
    }
    const hPath = historyPath(domain);
    if (fs.existsSync(hPath)) {
      history = readJSON(hPath);
    }
  }

  xpState._history = history;
  res.json(xpState);
});

// ─── XP INJECTION HELPER ─────────────────────────────────────────────────────────

function processXPInjections(domain, injArray) {
  const pPath = progressPath(domain);
  if (!fs.existsSync(pPath)) throw Object.assign(new Error('Progress file not found'), { status: 404 });

  backupProgress(domain);
  const progressData = readJSON(pPath);
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const results = [];

  for (const inj of injArray) {
    if (inj.unitId === undefined || inj.difficultyScore == null || inj.performanceRatio == null) continue;
    if (inj.difficultyScore < 20 || inj.difficultyScore > 100) continue;
    if (inj.performanceRatio < 0 || inj.performanceRatio > 1.0) continue;

    const unit = findUnitInProgress(progressData, inj.unitId);
    if (!unit) continue;

    let cumulativeXP = 0;
    for (const log of (unit.logs || [])) {
      if (log.xpGain !== undefined) cumulativeXP += log.xpGain;
    }
    const currentBand = getBandInfo(cumulativeXP).lv;

    const dv = Math.min(100, inj.difficultyScore * inj.performanceRatio);
    const bandInfo = BANDS.find(b => b.lv === currentBand);
    const perfRatio = dv / bandInfo.expDV;
    const bm = Math.min(2.0, Math.max(-0.5, 2 * perfRatio - 0.8));
    const foundationMult = inj.isFoundation ? 0.3 : 1.0;
    const xpGain = Math.max(0, Math.round(bandInfo.base * bm * foundationMult));

    const oldCum = cumulativeXP;
    const oldBand = currentBand;
    cumulativeXP += xpGain;
    const newBandInfo = getBandInfo(cumulativeXP);

    unit.logs.push({
      timestamp: new Date().toISOString(),
      dv: Math.round(dv * 100) / 100,
      bm: Math.round(bm * 100) / 100,
      xpGain,
      notes: inj.notes,
      sessionId
    });

    results.push({
      unitId: inj.unitId,
      oldBand,
      newBand: newBandInfo.lv,
      oldCum,
      newCum: cumulativeXP,
      dv: Math.round(dv * 100) / 100,
      bm: Math.round(bm * 100) / 100,
      delta: xpGain,
      bandShifted: oldBand !== newBandInfo.lv,
      sessionId
    });
  }

  const hPath = historyPath(domain);
  const history = fs.existsSync(hPath) ? readJSON(hPath) : [];
  history.push({ sessionId, timestamp: new Date().toISOString(), injections: injArray, results });
  writeJSON(pPath, progressData);
  writeJSON(hPath, history);

  return { success: true, sessionId, results };
}

// POST XP injection - writes to progress file and history
app.post('/api/xp', (req, res) => {
  const { injections, domain } = req.body;
  const injArray = Array.isArray(injections) ? injections : req.body;
  if (!Array.isArray(injArray)) return res.status(400).json({ error: 'Invalid payload' });
  if (!domain) return res.status(400).json({ error: 'domain required' });

  try {
    const xpResult = processXPInjections(domain, injArray);
    res.json(xpResult);
  } catch (e) {
    console.error('XP save error:', e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// UNDO a specific session
app.delete('/api/xp/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const domain = req.query.domain;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const pPath = progressPath(domain);
  if (!fs.existsSync(pPath)) return res.status(404).json({ error: 'Progress file not found' });

  backupProgress(domain);
  const hPath = historyPath(domain);
  if (!fs.existsSync(hPath)) return res.status(404).json({ error: 'No history found' });

  let progressData = readJSON(pPath);
  let history = readJSON(hPath);

  const sessionIdx = history.findIndex(s => s.sessionId === sessionId);
  if (sessionIdx === -1) return res.status(404).json({ error: 'Session not found' });

  const session = history[sessionIdx];
  const undoResults = [];

  // Remove logs with this sessionId from all units
  for (const bt of progressData.tree) {
    for (const cl of bt.clusters) {
      for (const u of cl.units) {
        if (u.logs) {
          const before = u.logs.length;
          u.logs = u.logs.filter(l => l.sessionId !== sessionId);
          // If logs were removed, calculate new totals for this unit
          if (u.logs.length < before) {
            let newCum = 0;
            for (const log of u.logs) {
              if (log.xpGain !== undefined) newCum += log.xpGain;
            }
            undoResults.push({
              unitId: u.id,
              removedXP: before - u.logs.length,
              newCum,
              newBand: getBandInfo(newCum).lv
            });
          }
        }
      }
    }
  }

  // Remove session from history
  history.splice(sessionIdx, 1);

  try {
    writeJSON(pPath, progressData);
    writeJSON(hPath, history);
    res.json({ success: true, undone: undoResults });
  } catch (e) {
    console.error('Undo XP save error:', e);
    res.status(500).json({ error: 'Failed to save after undo' });
  }
});

// CLEAR ALL XP HISTORY
app.delete('/api/xp', (req, res) => {
  const domain = req.query.domain;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const pPath = progressPath(domain);
  if (!fs.existsSync(pPath)) return res.status(404).json({ error: 'Progress file not found' });

  backupProgress(domain);
  let progressData = readJSON(pPath);

  // Clear all logs from all units
  for (const bt of progressData.tree) {
    for (const cl of bt.clusters) {
      for (const u of cl.units) {
        u.logs = [];
      }
    }
  }

  // Clear history
  const hPath = historyPath(domain);
  if (fs.existsSync(hPath)) {
    writeJSON(hPath, []);
  }

  try {
    writeJSON(pPath, progressData);
    res.json({ success: true });
  } catch (e) {
    console.error('Clear XP save error:', e);
    res.status(500).json({ error: 'Failed to clear XP' });
  }
});

// ─── TEST ENDPOINTS ───────────────────────────────────────────────────────────────

const VALID_STATES = new Set(['Mastered', 'Pass', 'Partial', 'Incorrect']);

function validateGenerateShape(data) {
  if (!Array.isArray(data.questions) || data.questions.length !== 10)
    throw new Error(`expected questions array of length 10, got ${JSON.stringify(data.questions?.length)}`);
  for (const q of data.questions) {
    if (!Number.isInteger(q.id)) throw new Error(`question id must be int, got ${JSON.stringify(q.id)}`);
    if (typeof q.question !== 'string' || !q.question.trim()) throw new Error(`question text missing for id ${q.id}`);
  }
}

function validateMarkShape(data) {
  if (!Array.isArray(data.results)) throw new Error('results must be an array');
  for (const r of data.results) {
    if (!Number.isInteger(r.id)) throw new Error(`result id must be int, got ${JSON.stringify(r.id)}`);
    if (!VALID_STATES.has(r.state)) throw new Error(`invalid state "${r.state}" for id ${r.id}`);
    if (typeof r.feedback !== 'string' || !r.feedback.trim()) throw new Error(`feedback missing for id ${r.id}`);
  }
  if (!Array.isArray(data.xpInjections)) throw new Error('xpInjections must be an array');
  for (const x of data.xpInjections) {
    if (x.difficultyScore < 20 || x.difficultyScore > 100) throw new Error(`difficultyScore out of range for unitId ${x.unitId}`);
    if (x.performanceRatio < 0 || x.performanceRatio > 1) throw new Error(`performanceRatio out of range for unitId ${x.unitId}`);
  }
}

async function generateJSONWithRetry(prompt, options, validate) {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt
      : `${prompt}\n\nYour previous response failed validation: ${lastError}\nReturn valid JSON only, matching the exact shape specified.`;
    try {
      const raw = await generate(p, options);
      const parsed = JSON.parse(raw);
      validate(parsed);
      return parsed;
    } catch (e) {
      lastError = e.message;
      if (attempt === 1) throw new Error(`AI response invalid after retry: ${lastError}`);
    }
  }
}

app.post('/api/test/generate', async (req, res) => {
  const { domain, unitIds } = req.body;
  if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
    return res.status(400).json({ error: 'domain and unitIds[] required' });

  try {
    const template = fs.readFileSync(path.join(PROMPTS_DIR, 'test.md'), 'utf8');
    const prompt = compilePrompt(template, { domain, unitIds });
    const { questions } = await generateJSONWithRetry(prompt, { json: true }, validateGenerateShape);
    res.json({ questions });
  } catch (err) {
    console.error('test/generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/test/mark', async (req, res) => {
  const { domain, unitIds, questions, answers } = req.body;
  if (!domain || !Array.isArray(unitIds) || !Array.isArray(questions) || !Array.isArray(answers))
    return res.status(400).json({ error: 'domain, unitIds, questions[], answers[] required' });

  try {
    const template = fs.readFileSync(path.join(PROMPTS_DIR, 'test-mark.md'), 'utf8');
    const base = compilePrompt(template, { domain, unitIds });
    const answerMap = Object.fromEntries(answers.map(a => [a.id, a.answer]));
    const qa = questions.map(q =>
      `Q${q.id}: ${q.question}\nA${q.id}: ${answerMap[q.id] ?? '(no answer)'}`
    ).join('\n\n');
    const prompt = `${base}\n\n---\n\n${qa}`;

    const { results, xpInjections } = await generateJSONWithRetry(prompt, { json: true }, validateMarkShape);
    const xpResult = processXPInjections(domain, xpInjections);
    res.json({ results, xpResult });
  } catch (err) {
    console.error('test/mark error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/test/compile-and-generate', async (req, res) => {
  const { domain, unitIds } = req.body;
  if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
    return res.status(400).json({ error: 'domain and unitIds[] required' });

  try {
    const { questions } = await testPromptCompile(domain, unitIds);
    res.json({ questions });
  } catch (err) {
    console.error('test/compile-and-generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

bootstrapCourses();
app.listen(PORT, () => console.log(`🚀 Study App running at http://localhost:${PORT}`));
