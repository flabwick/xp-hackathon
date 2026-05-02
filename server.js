const express = require('express');
const fs = require('fs');
const path = require('path');
const { compilePrompt } = require('./promptCompiler');
const app = express();
const PORT = 6969;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Serve mapping page
app.get('/mapping', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mapping.html'));
});

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

// Future PDF assets will live at data/courses/<courseId>/chapters/ — reserved path, not created until that feature lands.

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

// POST XP injection - writes to progress file and history
app.post('/api/xp', (req, res) => {
  const { injections, domain } = req.body;
  const injArray = Array.isArray(injections) ? injections : req.body;
  if (!Array.isArray(injArray)) return res.status(400).json({ error: 'Invalid payload' });
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const pPath = progressPath(domain);
  if (!fs.existsSync(pPath)) return res.status(404).json({ error: 'Progress file not found' });

  backupProgress(domain);
  let progressData = readJSON(pPath);
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const results = [];

  for (const inj of injArray) {
    if (inj.unitId === undefined || inj.difficultyScore == null || inj.performanceRatio == null) continue;
    if (inj.difficultyScore < 20 || inj.difficultyScore > 100) continue;
    if (inj.performanceRatio < 0 || inj.performanceRatio > 1.0) continue;

    // Calculate current XP for this unit from existing logs
    const unit = findUnitInProgress(progressData, inj.unitId);
    if (!unit) continue;

    // Calculate cumulative XP and current band from existing logs
    let cumulativeXP = 0;
    let currentBand = 'I';
    for (const log of (unit.logs || [])) {
      if (log.xpGain !== undefined) cumulativeXP += log.xpGain;
    }
    currentBand = getBandInfo(cumulativeXP).lv;

    // Calculate new XP
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
    const bandShifted = oldBand !== newBandInfo.lv;

    // Write log entry to progress file
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
      bandShifted,
      sessionId
    });
  }

  // Save to history file
  const hPath = historyPath(domain);
  const history = fs.existsSync(hPath) ? readJSON(hPath) : [];
  history.push({
    sessionId,
    timestamp: new Date().toISOString(),
    injections: injArray,
    results
  });

  try {
    writeJSON(pPath, progressData);
    writeJSON(hPath, history);
    res.json({ success: true, results });
  } catch (e) {
    console.error('XP save error:', e);
    res.status(500).json({ error: 'XP save failed', details: e.message });
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

bootstrapCourses();
app.listen(PORT, () => console.log(`🚀 Study App running at http://localhost:${PORT}`));
