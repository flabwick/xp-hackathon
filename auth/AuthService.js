const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRES_IN = '7d';

function genUserId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class AuthService {
  constructor({ userRepository, verificationService, emailService, jwtSecret }) {
    if (!userRepository || !verificationService || !emailService) {
      throw new Error('AuthService requires userRepository, verificationService, emailService');
    }
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('AuthService requires jwtSecret >= 32 chars');
    }
    this.users = userRepository;
    this.verifications = verificationService;
    this.email = emailService;
    this.jwtSecret = jwtSecret;
  }

  // Step 1: email submitted. Returns { status: 'needs-verification' | 'needs-password' }.
  // 'needs-password' means the email is already a fully-registered account → show login.
  // 'needs-verification' covers both new emails and partially-registered accounts (verified but no password, or unverified).
  async beginRegistration(email) {
    const norm = String(email).trim().toLowerCase();
    const existing = this.users.findByEmail(norm);

    if (existing && existing.verified && existing.passwordHash) {
      return { status: 'needs-password' };
    }

    // Mint a code and send it. If no user record yet, create a stub so the
    // verify step has something to flip to verified=true.
    if (!existing) {
      this.users.create({
        id: genUserId(),
        email: norm,
        passwordHash: '',
        verified: false,
        createdAt: new Date().toISOString(),
      });
    }
    const code = this.verifications.generateCode(norm);
    await this.email.sendVerificationCode(norm, code);
    return { status: 'needs-verification' };
  }

  // Step 2: validate the 6-digit code. Marks the user verified on success.
  verifyCode(email, code) {
    const norm = String(email).trim().toLowerCase();
    const ok = this.verifications.validateCode(norm, code);
    if (!ok) return false;
    try {
      this.users.setVerifiedByEmail(norm);
    } catch {
      // If somehow no user record, treat as failure.
      return false;
    }
    return true;
  }

  // Step 3: set a password on a verified-but-passwordless account.
  // Throws on replay (already has password) or missing/unverified.
  async completeRegistration(email, password) {
    const norm = String(email).trim().toLowerCase();
    const user = this.users.findByEmail(norm);
    if (!user || !user.verified) {
      const e = new Error('invalid request');
      e.code = 'INVALID';
      throw e;
    }
    // Hash OUTSIDE the read-modify-write window.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let updated;
    this.users.update(user.id, (rec) => {
      // Replay guard inside the sync block — can't race two concurrent calls.
      if (rec.passwordHash) {
        const e = new Error('invalid request');
        e.code = 'INVALID';
        throw e;
      }
      if (!rec.verified) {
        const e = new Error('invalid request');
        e.code = 'INVALID';
        throw e;
      }
      rec.passwordHash = passwordHash;
      updated = rec;
    });
    return this.issueToken(updated);
  }

  async login(email, password) {
    const norm = String(email).trim().toLowerCase();
    const user = this.users.findByEmail(norm);
    if (!user || !user.passwordHash || !user.verified) {
      const e = new Error('invalid credentials');
      e.code = 'INVALID';
      throw e;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const e = new Error('invalid credentials');
      e.code = 'INVALID';
      throw e;
    }
    return this.issueToken(user);
  }

  issueToken(user) {
    return jwt.sign({ sub: user.id, email: user.email }, this.jwtSecret, {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  verifyToken(token) {
    try {
      const payload = jwt.verify(token, this.jwtSecret);
      return { id: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }
}

module.exports = { AuthService, genUserId };
