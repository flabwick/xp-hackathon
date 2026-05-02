const fs = require('fs');
const path = require('path');

const TEN_MINUTES_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

class VerificationService {
  constructor(filePath) {
    if (!filePath) throw new Error('VerificationService requires filePath');
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  _readSync() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeSync(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  _normEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  // Mint a fresh 6-digit code; overwrites any existing record for the email.
  generateCode(email) {
    const norm = this._normEmail(email);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const data = this._readSync();
    data[norm] = {
      code,
      expiresAt: Date.now() + TEN_MINUTES_MS,
      attempts: 0,
    };
    this._writeSync(data);
    return code;
  }

  // Returns true on match (and consumes the record); false on any failure.
  // Increments attempts on miss; deletes the record after MAX_ATTEMPTS.
  validateCode(email, submitted) {
    const norm = this._normEmail(email);
    const data = this._readSync();
    const rec = data[norm];
    if (!rec) return false;
    if (Date.now() > rec.expiresAt) {
      delete data[norm];
      this._writeSync(data);
      return false;
    }
    if (String(submitted) !== String(rec.code)) {
      rec.attempts = (rec.attempts || 0) + 1;
      if (rec.attempts >= MAX_ATTEMPTS) {
        delete data[norm];
      } else {
        data[norm] = rec;
      }
      this._writeSync(data);
      return false;
    }
    // Success: single-use.
    delete data[norm];
    this._writeSync(data);
    return true;
  }
}

module.exports = { VerificationService };
