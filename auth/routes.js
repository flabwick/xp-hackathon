const express = require('express');
const rateLimit = require('express-rate-limit');
const { isValidEmail, isValidPassword, isValidCode } = require('./validators');
const { setAuthCookie, clearAuthCookie } = require('./middleware');

function buildAuthRouter(authService) {
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
  });

  router.post('/register', limiter, async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid request' });
      const result = await authService.beginRegistration(email);
      res.json(result);
    } catch (err) {
      console.error('register error:', err);
      res.status(400).json({ error: 'invalid request' });
    }
  });

  router.post('/verify', limiter, (req, res) => {
    try {
      const { email, code } = req.body || {};
      if (!isValidEmail(email) || !isValidCode(code)) {
        return res.status(400).json({ error: 'invalid request' });
      }
      const ok = authService.verifyCode(email, code);
      if (!ok) return res.status(400).json({ error: 'invalid request' });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'invalid request' });
    }
  });

  router.post('/complete-registration', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!isValidEmail(email) || !isValidPassword(password)) {
        return res.status(400).json({ error: 'invalid request' });
      }
      const token = await authService.completeRegistration(email, password);
      setAuthCookie(res, token);
      res.json({ ok: true });
    } catch (err) {
      if (err.code !== 'INVALID') console.error('complete-registration error:', err);
      res.status(400).json({ error: 'invalid request' });
    }
  });

  router.post('/login', limiter, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!isValidEmail(email) || !isValidPassword(password)) {
        return res.status(401).json({ error: 'invalid credentials' });
      }
      const token = await authService.login(email, password);
      setAuthCookie(res, token);
      res.json({ ok: true });
    } catch (err) {
      if (err.code !== 'INVALID') console.error('login error:', err);
      res.status(401).json({ error: 'invalid credentials' });
    }
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildAuthRouter };
