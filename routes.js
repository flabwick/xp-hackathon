const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const pub = (file) => path.join(__dirname, 'public', file);

// ── Domain picker (new home page) ───────────────────────────────────────────
router.get('/', (req, res) => {
  res.sendFile(pub('domains.html'));
});

// ── Domain-specific study page (existing index.html, domain pre-selected) ──
router.get('/unit/:domain', (req, res) => {
  const domain = req.params.domain.replace(/[^a-zA-Z0-9_-]/g, '');
  const html = fs.readFileSync(pub('index.html'), 'utf8');
  // <base href="/"> fixes relative asset paths (index.css, app.js) when served from /unit/:domain
  const injected = html
    .replace('<head>', '<head>\n  <base href="/">')
    .replace('</body>', `<script>window.__domain = '${domain}';</script>\n</body>`);
  res.type('text/html').send(injected);
});

// ── Test & teach ─────────────────────────────────────────────────────────────
router.get('/test', (req, res) => res.sendFile(pub('test.html')));
router.get('/teach', (req, res) => res.sendFile(pub('teach.html')));

// ── Utility pages ─────────────────────────────────────────────────────────────
router.get('/mobile-upload', (req, res) => res.sendFile(pub('mobile-upload.html')));
router.get('/mapping', (req, res) => res.sendFile(pub('mapping.html')));
router.get('/markdown-ui', (req, res) => res.sendFile(pub('markdown-ui.html')));

module.exports = router;
