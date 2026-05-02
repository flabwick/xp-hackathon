const express = require('express');
const multer = require('multer');
const { createSession, getSession, updateSession } = require('./sessions');
const { ocrBuffer } = require('./ocr');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 }
});

// POST /api/answers/session — create a new upload session, returns token
router.post('/session', (req, res) => {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  createSession(token);
  res.json({ token });
});

// GET /api/answers/session/:token — poll for OCR results
router.get('/session/:token', (req, res) => {
  const session = getSession(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  res.json(session);
});

// POST /api/answers/upload/:token — mobile uploads images here
// Runs OCR on each image and stores results in session
router.post('/upload/:token', upload.array('images', 20), async (req, res) => {
  const session = getSession(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded' });
  }

  updateSession(req.params.token, { status: 'processing' });

  try {
    const ocrResults = [];
    for (const file of req.files) {
      const text = await ocrBuffer(file.buffer);
      ocrResults.push({
        filename: file.originalname,
        mimetype: file.mimetype,
        text,
        size: file.size
      });
    }
    updateSession(req.params.token, { status: 'complete', ocrResults });
    res.json({ success: true, count: ocrResults.length });
  } catch (err) {
    updateSession(req.params.token, { status: 'error', error: err.message });
    res.status(500).json({ error: 'OCR processing failed: ' + err.message });
  }
});

module.exports = router;
