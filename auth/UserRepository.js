const fs = require('fs');
const path = require('path');

class UserRepository {
  constructor(usersFilePath) {
    if (!usersFilePath) throw new Error('UserRepository requires usersFilePath');
    this.filePath = usersFilePath;
    const dir = path.dirname(usersFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ users: [] }, null, 2), 'utf8');
    }
  }

  _readSync() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return { users: [] };
    }
  }

  _writeSync(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  count() {
    return this._readSync().users.length;
  }

  list() {
    return this._readSync().users;
  }

  findByEmail(email) {
    const norm = String(email || '').trim().toLowerCase();
    return this._readSync().users.find(u => u.email === norm) || null;
  }

  findById(id) {
    return this._readSync().users.find(u => u.id === id) || null;
  }

  // Create a user only if no record exists for the email. Returns the user.
  // Synchronous read-modify-write — no async gap, so concurrent requests serialize.
  create(user) {
    const data = this._readSync();
    const norm = String(user.email).trim().toLowerCase();
    if (data.users.some(u => u.email === norm)) {
      const e = new Error('user already exists');
      e.code = 'EXISTS';
      throw e;
    }
    const record = {
      id: user.id,
      email: norm,
      passwordHash: user.passwordHash || '',
      verified: !!user.verified,
      createdAt: user.createdAt || new Date().toISOString(),
    };
    data.users.push(record);
    this._writeSync(data);
    return record;
  }

  // Atomically mutate a user record. The mutator receives the record, may
  // mutate in place, and may throw to abort the write. The whole cycle is
  // synchronous so two concurrent callers serialize via the event loop.
  update(id, mutator) {
    const data = this._readSync();
    const idx = data.users.findIndex(u => u.id === id);
    if (idx === -1) {
      const e = new Error('user not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    mutator(data.users[idx]);
    this._writeSync(data);
    return data.users[idx];
  }

  // Mark a user verified by email (used during signup verification).
  setVerifiedByEmail(email) {
    const data = this._readSync();
    const norm = String(email).trim().toLowerCase();
    const idx = data.users.findIndex(u => u.email === norm);
    if (idx === -1) {
      // Create a stub record so we have somewhere to land the verified flag.
      // Caller (AuthService) decides id; we don't generate one here.
      const e = new Error('user not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    data.users[idx].verified = true;
    this._writeSync(data);
    return data.users[idx];
  }
}

module.exports = { UserRepository };
