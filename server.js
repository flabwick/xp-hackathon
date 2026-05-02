require('dotenv').config();
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');

const { compilePrompt } = require('./promptCompiler');
const { generate, chat, chatStream } = require('./aiClient');
const { testPromptCompile } = require('./testPromptCompile');
const { addCourseFromPDF } = require('./addCourse');
const { isProduction, envKeyAvailableToUI } = require('./byok');
const answersRouter = require('./answers/router');
const { UserPaths, DATA_DIR } = require('./userPaths');

const { UserRepository } = require('./auth/UserRepository');
const { VerificationService } = require('./auth/VerificationService');
const { EmailService } = require('./auth/EmailService');
const { AuthService } = require('./auth/AuthService');
const { buildAuthRouter } = require('./auth/routes');
const { buildRequireAuth } = require('./auth/middleware');
const { buildPageRouter } = require('./routes');

// ─── BOOTSTRAP AUTH SUBSYSTEM ─────────────────────────────────────────────────
// UserRepository has zero auth-config dependency, so it boots before the
// JWT_SECRET precondition check (used by ensureDevAccount).
const userRepo = new UserRepository(path.join(DATA_DIR, 'users.json'));
const verificationService = new VerificationService(path.join(DATA_DIR, 'verifications.json'));
const emailService = new EmailService(process.env);

// In-memory PDF uploads, capped to keep memory and OpenAI prompt budget sane.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 6969;

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use('/api/answers', answersRouter);

// Build auth-dependent middleware/routers (requires JWT_SECRET; deferred until startup check passes).
let authService, requireAuthApi, requireAuthPage;

function wireAuthDependentRoutes() {
  authService = new AuthService({
    userRepository: userRepo,
    verificationService,
    emailService,
    jwtSecret: process.env.JWT_SECRET,
  });
  requireAuthApi = buildRequireAuth(authService, { apiMode: true });
  requireAuthPage = buildRequireAuth(authService, { apiMode: false });

  app.use('/api/auth', buildAuthRouter(authService));

  // Public endpoints (no user data) — keep accessible without auth.
  app.get('/api/server-info', (req, res) => {
    res.json({ ip: getLocalIP(), port: PORT });
  });
  app.get('/api/config', (req, res) => {
    res.json({
      appName: 'StudyXP',
      provider: process.env.AI_PROVIDER || 'groq',
      production: isProduction(),
      hasGroqKey:   envKeyAvailableToUI('GROQ_API_KEY'),
      hasOpenAIKey: envKeyAvailableToUI('OPENAI_API_KEY'),
    });
  });

  // Page routes (must come before express.static so / serves auth/domains, not index.html)
  app.use(buildPageRouter(authService, requireAuthPage));

  // Static assets.
  const distDir = path.join(__dirname, 'dist');
  if (fs.existsSync(distDir)) app.use(express.static(distDir));
  app.use(express.static(path.join(__dirname, 'public')));

  // ─── Per-user data routes (all gated by requireAuthApi) ─────────────────────
  installDataRoutes();
}

// ─── SYNC STORAGE HELPERS ───────────────────────────────────────────────────────
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

const userPaths = (req) => new UserPaths(req.user.id);

// ─── PROGRESS HELPERS ────────────────────────────────────────────────────────────
const backupProgress = (paths, domain) => {
  try {
    const domainBackupDir = paths.backupsDir(domain);
    if (!fs.existsSync(domainBackupDir)) fs.mkdirSync(domainBackupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pPath = paths.progressFile(domain);
    const hPath = paths.historyFile(domain);

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
  if (cum >= 2400) return BANDS.find(b => b.lv === 'V');
  if (cum >= 1500) return BANDS.find(b => b.lv === 'IV');
  if (cum >= 600) return BANDS.find(b => b.lv === 'III');
  if (cum >= 150) return BANDS.find(b => b.lv === 'II');
  return BANDS.find(b => b.lv === 'I');
};

function calculateXPFromProgress(progressData) {
  const result = {};
  if (!progressData || !progressData.tree) return result;

  for (const bt of progressData.tree) {
    for (const cl of bt.clusters) {
      for (const u of cl.units) {
        const logs = u.logs || [];
        let cumulativeXP = 0;
        const progressLogs = [];
        for (const log of logs) {
          if (log.xpGain !== undefined && log.dv !== undefined && log.bm !== undefined) {
            cumulativeXP += log.xpGain;
            progressLogs.push(log);
          } else if (log.dv !== undefined && log.bm !== undefined) {
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

// ─── XP INJECTION HELPER (per-user) ─────────────────────────────────────────────
function processXPInjections(paths, domain, injArray) {
  const pPath = paths.progressFile(domain);
  if (!fs.existsSync(pPath)) throw Object.assign(new Error('Progress file not found'), { status: 404 });

  backupProgress(paths, domain);
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

  const hPath = paths.historyFile(domain);
  const history = fs.existsSync(hPath) ? readJSON(hPath) : [];
  history.push({ sessionId, timestamp: new Date().toISOString(), injections: injArray, results });
  writeJSON(pPath, progressData);
  writeJSON(hPath, history);

  return { success: true, sessionId, results };
}

// ─── DATA ROUTES (all per-user, all auth-gated) ────────────────────────────────
function installDataRoutes() {

  app.get('/api/domains', requireAuthApi, (req, res) => {
    try {
      const paths = userPaths(req);
      paths.ensureDirs();
      const files = fs.readdirSync(paths.unitsDir).filter(f => f.endsWith('.json'));
      res.json(files.map(f => f.replace('.json', '')));
    } catch (e) {
      console.error('list domains error:', e);
      res.status(500).json({ error: 'Failed to list domains' });
    }
  });

  app.post('/api/add-course', requireAuthApi, pdfUpload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'PDF file required (form field "pdf").' });
      if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
        return res.status(400).json({ error: 'Uploaded file must be a PDF.' });
      }
      const courseName = (req.body.courseName || '').trim();
      if (!courseName) return res.status(400).json({ error: 'courseName required.' });

      const apiKey = req.headers['x-openai-api-key'] || undefined;
      const result = await addCourseFromPDF(req.file.buffer, courseName, req.user.id, apiKey);

      res.json({
        success: true,
        domain: result.slug,
        courseName,
        unitCount: result.unitCount,
        pdfPages: result.pdfPages,
        pdfChars: result.pdfChars,
      });
    } catch (err) {
      console.error('add-course error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.delete('/api/domains/:domain', requireAuthApi, (req, res) => {
    const domain = req.params.domain.replace(/[^a-zA-Z0-9_-]/g, '');
    const paths = userPaths(req);
    const targets = [
      paths.unitsFile(domain),
      paths.progressFile(domain),
      paths.historyFile(domain),
      paths.deadlinesFile(domain),
    ];
    if (!fs.existsSync(targets[0])) return res.status(404).json({ error: 'Domain not found' });
    targets.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    res.json({ success: true });
  });

  app.get('/api/units/:domain', requireAuthApi, (req, res) => {
    const p = userPaths(req).unitsFile(req.params.domain);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Domain not found' });
    const data = readJSON(p);
    if (!data.meta || !data.tree || !Array.isArray(data.meta.bt) || !Array.isArray(data.meta.cl)) {
      return res.status(400).json({ error: 'Invalid unit format - missing meta.bt or meta.cl arrays' });
    }
    res.json(data);
  });

  app.get('/api/deadlines/:domain', requireAuthApi, (req, res) => {
    const p = userPaths(req).deadlinesFile(req.params.domain);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Deadline file not found' });
    res.json(readJSON(p));
  });

  app.get('/api/progress/:domain', requireAuthApi, (req, res) => {
    const p = userPaths(req).progressFile(req.params.domain);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Progress file not found' });
    res.json(readJSON(p));
  });

  app.post('/api/progress/:domain', requireAuthApi, (req, res) => {
    const paths = userPaths(req);
    const domain = req.params.domain;
    const p = paths.progressFile(domain);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Progress file not found' });

    const { unitId, notes } = req.body;
    if (unitId === undefined) return res.status(400).json({ error: 'unitId required' });
    if (!notes || typeof notes !== 'string') return res.status(400).json({ error: 'notes string required' });

    backupProgress(paths, domain);
    const data = readJSON(p);
    const unit = findUnitInProgress(data, unitId);
    if (!unit) return res.status(404).json({ error: `Unit ${unitId} not found in progress` });

    const entry = { timestamp: new Date().toISOString(), notes };
    unit.logs.push(entry);
    writeJSON(p, data);
    res.json({ success: true, unitId, entry });
  });

  app.post('/api/prompt/:type/compile', requireAuthApi, (req, res) => {
    const type = req.params.type.replace(/[^a-zA-Z0-9_-]/g, '');
    const p = path.join(PROMPTS_DIR, `${type}.md`);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Prompt not found' });
    try {
      const template = fs.readFileSync(p, 'utf8');
      const { domain, unitIds, entries } = req.body;
      const compiled = compilePrompt(template, { domain, unitIds, entries, userId: req.user.id });
      res.type('text/markdown').send(compiled);
    } catch (e) {
      res.status(500).json({ error: 'Failed to compile prompt', details: e.message });
    }
  });

  app.get('/api/prompt/:type', requireAuthApi, (req, res) => {
    const type = req.params.type.replace(/[^a-zA-Z0-9_-]/g, '');
    const p = path.join(PROMPTS_DIR, `${type}.md`);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Prompt not found' });
    res.type('text/markdown').send(fs.readFileSync(p, 'utf8'));
  });

  app.get('/api/xp', requireAuthApi, (req, res) => {
    const domain = req.query.domain;
    const paths = userPaths(req);
    let xpState = {};
    let history = [];
    if (domain) {
      const pPath = paths.progressFile(domain);
      if (fs.existsSync(pPath)) xpState = calculateXPFromProgress(readJSON(pPath));
      const hPath = paths.historyFile(domain);
      if (fs.existsSync(hPath)) history = readJSON(hPath);
    }
    xpState._history = history;
    res.json(xpState);
  });

  app.post('/api/xp', requireAuthApi, (req, res) => {
    const { injections, domain } = req.body;
    const injArray = Array.isArray(injections) ? injections : req.body;
    if (!Array.isArray(injArray)) return res.status(400).json({ error: 'Invalid payload' });
    if (!domain) return res.status(400).json({ error: 'domain required' });
    try {
      const xpResult = processXPInjections(userPaths(req), domain, injArray);
      res.json(xpResult);
    } catch (e) {
      console.error('XP save error:', e);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.delete('/api/xp/:sessionId', requireAuthApi, (req, res) => {
    const sessionId = req.params.sessionId;
    const domain = req.query.domain;
    if (!domain) return res.status(400).json({ error: 'domain required' });
    const paths = userPaths(req);

    const pPath = paths.progressFile(domain);
    if (!fs.existsSync(pPath)) return res.status(404).json({ error: 'Progress file not found' });

    backupProgress(paths, domain);
    const hPath = paths.historyFile(domain);
    if (!fs.existsSync(hPath)) return res.status(404).json({ error: 'No history found' });

    let progressData = readJSON(pPath);
    let history = readJSON(hPath);

    const sessionIdx = history.findIndex(s => s.sessionId === sessionId);
    if (sessionIdx === -1) return res.status(404).json({ error: 'Session not found' });

    const undoResults = [];
    for (const bt of progressData.tree) {
      for (const cl of bt.clusters) {
        for (const u of cl.units) {
          if (u.logs) {
            const before = u.logs.length;
            u.logs = u.logs.filter(l => l.sessionId !== sessionId);
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

  app.delete('/api/xp', requireAuthApi, (req, res) => {
    const domain = req.query.domain;
    if (!domain) return res.status(400).json({ error: 'domain required' });
    const paths = userPaths(req);

    const pPath = paths.progressFile(domain);
    if (!fs.existsSync(pPath)) return res.status(404).json({ error: 'Progress file not found' });

    backupProgress(paths, domain);
    let progressData = readJSON(pPath);
    for (const bt of progressData.tree) {
      for (const cl of bt.clusters) {
        for (const u of cl.units) { u.logs = []; }
      }
    }
    const hPath = paths.historyFile(domain);
    if (fs.existsSync(hPath)) writeJSON(hPath, []);

    try {
      writeJSON(pPath, progressData);
      res.json({ success: true });
    } catch (e) {
      console.error('Clear XP save error:', e);
      res.status(500).json({ error: 'Failed to clear XP' });
    }
  });

  // ─── TEST/TEACH (stateless AI; auth-gated to keep BYOK enforcement consistent) ──
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
        if (e.status === 401) throw e;
        lastError = e.message;
        if (attempt === 1) {
          const wrapped = new Error(`AI response invalid after retry: ${lastError}`);
          wrapped.status = e.status;
          throw wrapped;
        }
      }
    }
  }

  const userGroqKey = (req) => req.headers['x-groq-api-key'] || undefined;

  app.post('/api/test/generate', requireAuthApi, async (req, res) => {
    const { domain, unitIds } = req.body;
    if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
      return res.status(400).json({ error: 'domain and unitIds[] required' });
    try {
      const template = fs.readFileSync(path.join(PROMPTS_DIR, 'test.md'), 'utf8');
      const prompt = compilePrompt(template, { domain, unitIds, userId: req.user.id });
      const { questions } = await generateJSONWithRetry(prompt, { json: true, apiKey: userGroqKey(req) }, validateGenerateShape);
      res.json({ questions });
    } catch (err) {
      console.error('test/generate error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/test/mark', requireAuthApi, async (req, res) => {
    const { domain, unitIds, questions, answers } = req.body;
    if (!domain || !Array.isArray(unitIds) || !Array.isArray(questions) || !Array.isArray(answers))
      return res.status(400).json({ error: 'domain, unitIds, questions[], answers[] required' });
    try {
      const template = fs.readFileSync(path.join(PROMPTS_DIR, 'test-mark.md'), 'utf8');
      const base = compilePrompt(template, { domain, unitIds, userId: req.user.id });
      const answerMap = Object.fromEntries(answers.map(a => [a.id, a.answer]));
      const qa = questions.map(q =>
        `Q${q.id}: ${q.question}\nA${q.id}: ${answerMap[q.id] ?? '(no answer)'}`
      ).join('\n\n');
      const prompt = `${base}\n\n---\n\n${qa}`;
      const { results, xpInjections } = await generateJSONWithRetry(prompt, { json: true, apiKey: userGroqKey(req) }, validateMarkShape);
      const xpResult = processXPInjections(userPaths(req), domain, xpInjections);
      res.json({ results, xpResult });
    } catch (err) {
      console.error('test/mark error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/test/compile-and-generate', requireAuthApi, async (req, res) => {
    const { domain, unitIds } = req.body;
    if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
      return res.status(400).json({ error: 'domain and unitIds[] required' });
    try {
      const { questions } = await testPromptCompile(domain, unitIds, { apiKey: userGroqKey(req), userId: req.user.id });
      res.json({ questions });
    } catch (err) {
      console.error('test/compile-and-generate error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/teach', requireAuthApi, async (req, res) => {
    const { domain, unitIds, messages } = req.body;
    if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
      return res.status(400).json({ error: 'domain and unitIds[] required' });
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'messages[] required' });
    if (messages[messages.length - 1]?.role !== 'user')
      return res.status(400).json({ error: 'last message must have role "user"' });
    try {
      const template = fs.readFileSync(path.join(__dirname, 'prompts', 'chat.md'), 'utf8');
      const systemPrompt = compilePrompt(template, { domain, unitIds, userId: req.user.id });
      const reply = await chat(systemPrompt, messages, { apiKey: userGroqKey(req) });
      res.json({ role: 'assistant', reply });
    } catch (err) {
      console.error('teach error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/teach/stream', requireAuthApi, async (req, res) => {
    const { domain, unitIds, messages } = req.body;
    if (!domain || !Array.isArray(unitIds) || unitIds.length === 0)
      return res.status(400).json({ error: 'domain and unitIds[] required' });
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'messages[] required' });
    if (messages[messages.length - 1]?.role !== 'user')
      return res.status(400).json({ error: 'last message must have role "user"' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      const template = fs.readFileSync(path.join(__dirname, 'prompts', 'chat.md'), 'utf8');
      const systemPrompt = compilePrompt(template, { domain, unitIds, userId: req.user.id });
      for await (const chunk of chatStream(systemPrompt, messages, { apiKey: userGroqKey(req) })) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error('teach/stream error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  });
}

// ─── DEV SEED ACCOUNT + DATA MIGRATION ─────────────────────────────────────────
async function ensureDevAccount() {
  if (userRepo.count() > 0) return;

  const passwordHash = await bcrypt.hash('devpassword', 12);
  userRepo.create({
    id: 'dev',
    email: 'dev@dev.local',
    passwordHash,
    verified: true,
    createdAt: new Date().toISOString(),
  });

  // Migrate any pre-existing legacy global data into the dev user namespace.
  const devPaths = new UserPaths('dev');
  devPaths.ensureDirs();

  const moves = [
    { src: path.join(DATA_DIR, 'units'),     dst: devPaths.unitsDir },
    { src: path.join(DATA_DIR, 'progress'),  dst: devPaths.progressDir },
    { src: path.join(DATA_DIR, 'deadlines'), dst: devPaths.deadlinesDir },
    { src: path.join(DATA_DIR, 'backups'),   dst: devPaths.backupsRootDir },
  ];
  for (const { src, dst } of moves) {
    if (!fs.existsSync(src)) continue;
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      const from = path.join(src, entry);
      const to = path.join(dst, entry);
      try {
        fs.renameSync(from, to);
      } catch (e) {
        console.warn(`[seed] could not move ${from} → ${to}: ${e.message}`);
      }
    }
  }

  console.log('────────────────────────────────────────────────────');
  console.log('[seed] Created dev account: dev@dev.local / devpassword');
  console.log('[seed] Existing data migrated under data/users/dev/');
  console.log('────────────────────────────────────────────────────');
}

// ─── STARTUP ────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('[fatal] JWT_SECRET must be set and >= 32 chars. Copy .env.example to .env and fill in the required values before starting.');
    process.exit(1);
  }
  await ensureDevAccount();
  wireAuthDependentRoutes();
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 StudyXP running on port ${PORT}`));
})().catch((err) => {
  console.error('startup failed', err);
  process.exit(1);
});
