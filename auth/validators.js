// Pragmatic email regex — not RFC-perfect but rejects obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 320
    && EMAIL_RE.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && password.length <= 200;
}

function isValidCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

module.exports = { isValidEmail, isValidPassword, isValidCode };
