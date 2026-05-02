const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const pub = (file) => path.join(__dirname, 'public', file);

// ── Home: courses list
router.get('/', (req, res) => res.sendFile(pub('index.html')));

// ── Per-domain study page: injects window.__domain so study.html pre-selects it
router.get('/unit/:domain', (req, res) => {
  const domain = req.params.domain.replace(/[^a-zA-Z0-9_-]/g, '');
  const html = fs.readFileSync(pub('study.html'), 'utf8');
  const injected = html
    .replace('<head>', '<head>\n  <base href="/">')
    .replace('</body>', `<script>window.__domain = '${domain}';</script>\n</body>`);
  res.type('text/html').send(injected);
});

// ── Static unit detail page (single-unit view)
router.get('/unit', (req, res) => res.sendFile(pub('unit.html')));

// ── Test & teach
router.get('/test', (req, res) => res.sendFile(pub('test.html')));
router.get('/teach', (req, res) => res.sendFile(pub('teach.html')));

// ── Utility pages
router.get('/mobile-upload', (req, res) => res.sendFile(pub('mobile-upload.html')));
router.get('/mapping', (req, res) => res.sendFile(pub('mapping.html')));
router.get('/markdown-ui', (req, res) => res.sendFile(pub('markdown-ui.html')));

module.exports = router;
