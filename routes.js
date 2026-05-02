const express = require('express');
const fs = require('fs');
const path = require('path');
const { COOKIE_NAME } = require('./auth/middleware');

const pub = (file) => path.join(__dirname, 'public', file);

function buildPageRouter(authService, requireAuth) {
  const router = express.Router();

  // Home: serve auth page if no valid session, else the domain picker.
  router.get('/', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    const user = token ? authService.verifyToken(token) : null;
    if (!user) return res.sendFile(pub('auth.html'));
    res.sendFile(pub('domains.html'));
  });

  // Domain-specific study page (existing index.html, domain pre-selected)
  router.get('/unit/:domain', requireAuth, (req, res) => {
    const domain = req.params.domain.replace(/[^a-zA-Z0-9_-]/g, '');
    const html = fs.readFileSync(pub('index.html'), 'utf8');
    const injected = html
      .replace('<head>', '<head>\n  <base href="/">')
      .replace('</body>', `<script>window.__domain = '${domain}';</script>\n</body>`);
    res.type('text/html').send(injected);
  });

  router.get('/test', requireAuth, (req, res) => res.sendFile(pub('test.html')));
  router.get('/teach', requireAuth, (req, res) => res.sendFile(pub('teach.html')));
  router.get('/mobile-upload', requireAuth, (req, res) => res.sendFile(pub('mobile-upload.html')));
  router.get('/mapping', requireAuth, (req, res) => res.sendFile(pub('mapping.html')));
  router.get('/markdown-ui', requireAuth, (req, res) => res.sendFile(pub('markdown-ui.html')));

  return router;
}

module.exports = { buildPageRouter };
