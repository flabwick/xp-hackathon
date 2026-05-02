const COOKIE_NAME = 'studyxp_auth';

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function buildRequireAuth(authService, opts = {}) {
  const apiMode = !!opts.apiMode;
  return function requireAuth(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME];
    const user = token ? authService.verifyToken(token) : null;
    if (!user) {
      if (apiMode || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      return res.redirect('/');
    }
    req.user = user;
    next();
  };
}

module.exports = { COOKIE_NAME, setAuthCookie, clearAuthCookie, buildRequireAuth };
