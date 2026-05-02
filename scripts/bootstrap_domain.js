/**
 * scripts/bootstrap_domain.js
 *
 * For every file in `data/units/<domain>.json` that does NOT yet have a
 * matching `data/progress/<domain>.json` (or history / deadlines), generate
 * the empty scaffolding files in the shape `server.js` expects.
 *
 * Idempotent: existing files are never overwritten.
 *
 * Run:   node scripts/bootstrap_domain.js
 */

const fs = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const UNITS_DIR     = path.join(ROOT, 'data', 'units');
const PROGRESS_DIR  = path.join(ROOT, 'data', 'progress');
const DEADLINES_DIR = path.join(ROOT, 'data', 'deadlines');

[PROGRESS_DIR, DEADLINES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const writeIfMissing = (file, payload) => {
  if (fs.existsSync(file)) {
    console.log(`  · skip (exists)  ${path.relative(ROOT, file)}`);
    return false;
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`  ✓ wrote          ${path.relative(ROOT, file)}`);
  return true;
};

/** Build a progress tree that mirrors the unit tree, with empty `logs[]`. */
function buildProgressTree(unitData) {
  return {
    tree: (unitData.tree || []).map(bt => ({
      bt: bt.bt,
      clusters: (bt.clusters || []).map(cl => ({
        cl: cl.cl,
        units: (cl.units || []).map(u => ({ id: u.id, logs: [] })),
      })),
    })),
  };
}

/** Build an empty deadlines file (server returns 404 if file is absent — this avoids that). */
function buildDeadlinesScaffold(unitData) {
  return {
    meta: unitData.meta || { bt: [], cl: [] },
    deadlines: {},
  };
}

const unitFiles = fs.readdirSync(UNITS_DIR).filter(f => f.endsWith('.json'));

if (unitFiles.length === 0) {
  console.log('No unit files found in data/units/.');
  process.exit(0);
}

console.log(`Scanning ${unitFiles.length} unit file(s)…\n`);

let createdAny = false;

for (const file of unitFiles) {
  const domain = path.basename(file, '.json');
  console.log(`▸ ${domain}`);

  let unitData;
  try {
    unitData = JSON.parse(fs.readFileSync(path.join(UNITS_DIR, file), 'utf8'));
  } catch (e) {
    console.error(`  ✗ failed to parse ${file}: ${e.message}`);
    continue;
  }

  const progressFile  = path.join(PROGRESS_DIR,  `${domain}.json`);
  const historyFile   = path.join(PROGRESS_DIR,  `${domain}-history.json`);
  const deadlinesFile = path.join(DEADLINES_DIR, `${domain}.json`);

  const a = writeIfMissing(progressFile,  buildProgressTree(unitData));
  const b = writeIfMissing(historyFile,   []);
  const c = writeIfMissing(deadlinesFile, buildDeadlinesScaffold(unitData));

  if (a || b || c) createdAny = true;
}

console.log(createdAny ? '\nDone.' : '\nAll domains already bootstrapped — nothing to do.');
