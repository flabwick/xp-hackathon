/**
 * addContext.js — PDF → data/units/<domain>.json
 *
 * Mounts at /api/add-context.
 *
 * POST /api/add-context
 *   multipart/form-data fields:
 *     pdf     — the PDF file (required)
 *     domain  — target domain slug, e.g. "optimization" (required)
 *
 * Pipeline:
 *   1. Receive PDF via multer → OS tmp file
 *   2. Run Scripts/Seperate_By_Chapter_Final.py to split into chapter .txt files
 *   3. Assemble a units JSON from those .txt files
 *   4. Write to data/units/<domain>.json
 *   5. Clean up tmp files
 *
 * Response (200): { success: true, domain, unitCount, path }
 * Response (4xx/5xx): { error, details? }
 */

const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();

const UNITS_DIR = path.join(__dirname, 'data/units');
const CHAPTER_SPLITTER = path.join(__dirname, 'Scripts/Seperate_By_Chapter_Final.py');

const pdfUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Only PDF uploads are accepted'));
  }
});

function chaptersToUnitsJson(domain, chaptersDir) {
  const files = fs.readdirSync(chaptersDir)
    .filter(f => f.endsWith('.txt'))
    .sort();

  const units = files.map((file, i) => {
    const raw = fs.readFileSync(path.join(chaptersDir, file), 'utf8').trim();
    const name = file
      .replace(/\.txt$/, '')
      .replace(/^\d+[-_\s]*/, '')
      .trim() || `Chapter ${i + 1}`;
    return {
      id: `${domain}_${i + 1}`,
      n: name,
      t: 'c',
      nt: raw.slice(0, 500),
      l: []
    };
  });

  return {
    meta: {
      bt: [{ n: 'Content' }],
      cl: [{ n: domain }]
    },
    tree: [{
      bt: 0,
      clusters: [{ cl: 0, units }]
    }]
  };
}

router.post('/', (req, res) => {
  pdfUpload.single('pdf')(req, res, (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: 'Upload rejected', details: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

    const domain = (req.body.domain || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!domain) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ error: 'domain field required' });
    }

    const tmpChaptersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-chapters-'));
    let stdoutBuf = '', stderrBuf = '';

    const proc = spawn('python3', [CHAPTER_SPLITTER, req.file.path, '--output-dir', tmpChaptersDir]);
    proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('error', err => {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: 'Failed to launch python3', details: err.message });
    });

    proc.on('close', code => {
      try { fs.unlinkSync(req.file.path); } catch (_) {}

      if (code !== 0) {
        return res.status(500).json({
          error: 'Chapter extraction failed',
          details: (stdoutBuf + stderrBuf).trim().slice(-4000)
        });
      }

      let unitsJson;
      try {
        unitsJson = chaptersToUnitsJson(domain, tmpChaptersDir);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to build units JSON', details: e.message });
      } finally {
        try {
          for (const f of fs.readdirSync(tmpChaptersDir)) fs.unlinkSync(path.join(tmpChaptersDir, f));
          fs.rmdirSync(tmpChaptersDir);
        } catch (_) {}
      }

      const outPath = path.join(UNITS_DIR, `${domain}.json`);
      try {
        fs.mkdirSync(UNITS_DIR, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(unitsJson, null, 2), 'utf8');
      } catch (e) {
        return res.status(500).json({ error: 'Failed to write units file', details: e.message });
      }

      const unitCount = unitsJson.tree[0].clusters[0].units.length;
      res.json({ success: true, domain, unitCount, path: outPath });
    });
  });
});

module.exports = router;
