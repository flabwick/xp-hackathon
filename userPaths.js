const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');

class UserPaths {
  constructor(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new Error('UserPaths requires a userId string');
    }
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) throw new Error('UserPaths: userId resolved to empty after sanitization');
    this.userId = safe;
    this.root = path.join(DATA_DIR, 'users', this.userId);
    this.unitsDir = path.join(this.root, 'units');
    this.progressDir = path.join(this.root, 'progress');
    this.deadlinesDir = path.join(this.root, 'deadlines');
    this.backupsRootDir = path.join(this.root, 'backups');
  }

  ensureDirs() {
    for (const d of [this.unitsDir, this.progressDir, this.deadlinesDir, this.backupsRootDir]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  unitsFile(domain)     { return path.join(this.unitsDir, `${domain}.json`); }
  progressFile(domain)  { return path.join(this.progressDir, `${domain}.json`); }
  historyFile(domain)   { return path.join(this.progressDir, `${domain}-history.json`); }
  deadlinesFile(domain) { return path.join(this.deadlinesDir, `${domain}.json`); }
  backupsDir(domain)    { return path.join(this.backupsRootDir, domain); }
}

module.exports = { UserPaths, DATA_DIR };
