document.addEventListener('DOMContentLoaded', () => {
  // ─── STATE ──────────────────────────────────────────────────────────────────────
  const state = {
    domain: null,
    units: [],
    treeRoots: [],
    xpData: {},
    deadlines: {},
    progress: {},
    selectedUnits: new Set(),
    mode: 'select',
    promptMode: 'test'
  };

  // ─── TOAST ──────────────────────────────────────────────────────────────────────
  let toastTimeout = null;
  function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ─── DOM REFS ───────────────────────────────────────────────────────────────────
  const el = {
    treeContainer: document.getElementById('tree-container'),
    priorityList: document.getElementById('priority-list'),
    priorityControls: document.getElementById('priority-controls'),
    priorityCount: document.getElementById('priority-count'),
    priorityVal: document.getElementById('priority-val'),
    promptMode: document.getElementById('prompt-mode'),
    xpInput: document.getElementById('xp-input'),
    modal: document.getElementById('xp-modal'),
    modalStats: document.getElementById('modal-stats'),
    addContextBtn: document.getElementById('add-context'),
    pdfFileInput: document.getElementById('pdf-file-input'),
    addContextModal: document.getElementById('add-context-modal'),
    acChoose: document.getElementById('ac-choose'),
    acProgress: document.getElementById('ac-progress'),
    acResult: document.getElementById('ac-result'),
    modeToggle: document.getElementById('mode-toggle'),
    modePriority: document.getElementById('mode-priority')
  };

  // ─── INIT ───────────────────────────────────────────────────────────────────────
  const courseId = new URLSearchParams(window.location.search).get('course');
  if (!courseId) { window.location = '/'; return; }
  fetch('/api/courses').then(r => r.json()).then(({ courses }) => {
    const course = (courses || []).find(c => c.id === courseId);
    if (!course) { window.location = '/'; return; }
    if (course.chaptersDir) {
      el.addContextBtn.textContent = '📚 ADD CONTEXT ✓';
      el.addContextBtn.style.color = 'var(--success)';
    }
    loadDomain(course.domain);
  });

  // ─── DOMAIN LOADER ──────────────────────────────────────────────────────────────
  async function loadDomain(domain) {
    state.domain = domain;
    el.treeContainer.innerHTML = '<div class="placeholder">Loading...</div>';
    el.priorityList.innerHTML = '<div class="placeholder">Loading...</div>';

    const [unitsRes, deadlinesRes, progressRes, xpRes] = await Promise.all([
      fetch(`/api/units/${domain}`),
      fetch(`/api/deadlines/${domain}`),
      fetch(`/api/progress/${domain}`).catch(() => ({ ok: false })),
      fetch(`/api/xp?domain=${domain}`).catch(() => ({ ok: false }))
    ]);

    const data = await unitsRes.json();
    state.deadlines = await deadlinesRes.json();

    if (progressRes.ok) {
      const progressData = await progressRes.json();
      state.progress = {};
      progressData.tree.forEach(bt => bt.clusters.forEach(cl => cl.units.forEach(u => {
        state.progress[u.id] = u.logs || [];
      })));
    }

    if (xpRes.ok) {
      state.xpData = await xpRes.json();
    }

    parseTree(data);
    renderTree();
    updatePriority();
  }

  // ─── TREE PARSER ────────────────────────────────────────────────────────────────
  function parseTree(data) {
    state.units = [];
    state.treeRoots = [];

    const dependents = {};

    data.tree.forEach(btNode => {
      const btName = data.meta.bt[btNode.bt];
      state.treeRoots.push({ type: 'bt', name: btName, children: [] });
      const btEl = state.treeRoots[state.treeRoots.length - 1];

      btNode.clusters.forEach(clNode => {
        const clName = data.meta.cl[clNode.cl];
        btEl.children.push({ type: 'cl', name: clName, children: [] });
        const clEl = btEl.children[btEl.children.length - 1];

        clNode.units.forEach(u => {
          const unit = {
            id: u.id,
            name: u.n,
            bt: btName,
            cl: clName,
            isFoundation: u.t === 'f',
            links: u.l || [],
            incoming: 0
          };

          state.units.push(unit);
          clEl.children.push(unit);

          unit.links.forEach(([target]) => {
            if (!dependents[target]) dependents[target] = 0;
            dependents[target]++;
          });
        });
      });
    });

    state.units.forEach(u => {
      u.dependents = dependents[u.id] || 0;
    });
  }

  // ─── RENDER TREE ────────────────────────────────────────────────────────────────
  const BAND_COLORS = {
    I: 'var(--band-i)',
    II: 'var(--band-ii)',
    III: 'var(--band-iii)',
    IV: 'var(--band-iv)',
    V: 'var(--band-v)'
  };

  function renderTree() {
    el.treeContainer.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'unit-tree';

    const createNode = (item) => {
      const li = document.createElement('li');

      if (item.type === 'bt' || item.type === 'cl') {
        const det = document.createElement('details');
        det.open = true;
        det.className = item.type === 'bt' ? 'branch-details' : 'cluster-details';

        const sum = document.createElement('summary');
        const averages = calculateClusterAverages(item.children);

        sum.innerHTML = `
          <div class="cluster-header">
            <span class="cluster-name">${item.name}</span>
            <div class="cluster-scores">
              <span class="score-badge">Avg ${Math.round(averages.avgXP)} XP</span>
            </div>
            <div class="cluster-actions">
              <button class="btn-small" data-type="${item.type}" data-name="${item.name}" data-action="select">All</button>
              <button class="btn-small" data-type="${item.type}" data-name="${item.name}" data-action="deselect">None</button>
            </div>
          </div>
        `;

        sum.querySelectorAll('.btn-small').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            selectAllInGroup(item.type, item.name, btn.dataset.action === 'select');
          });
        });

        det.appendChild(sum);
        const childUl = document.createElement('ul');
        childUl.className = 'unit-tree';
        item.children.forEach(ch => childUl.appendChild(createNode(ch)));
        det.appendChild(childUl);
        li.appendChild(det);

      } else {
        // Unit row
        const xpInfo = getXPScore(item.id);
        const urgencyInfo = getUrgencyScore(item);

        const div = document.createElement('div');
        div.className = `unit-row${item.isFoundation ? ' foundation' : ''}`;
        div.style.borderLeftColor = BAND_COLORS[xpInfo.band] || BAND_COLORS.I;

        const urgencyClass = urgencyInfo.score >= 0.8 ? 'urgency-critical'
          : urgencyInfo.score >= 0.6 ? 'urgency-high'
          : urgencyInfo.score >= 0.3 ? 'urgency-medium'
          : '';

        const urgencyBadge = urgencyClass
          ? `<span class="score-badge ${urgencyClass}">${urgencyInfo.display}</span>`
          : '';

        div.innerHTML = `
          <input type="checkbox" id="u-${item.id}" ${state.selectedUnits.has(item.id) ? 'checked' : ''}>
          <a href="${ROUTES.UNIT}?domain=${state.domain}&id=${item.id}" class="unit-name-link" title="${item.bt} › ${item.cl}">${item.name}</a>
          <div class="unit-scores">
            <span class="score-badge band-${xpInfo.band}">${xpInfo.band}</span>
            <span class="score-badge xp">${xpInfo.xp} XP</span>
            ${urgencyBadge}
          </div>
          <a href="${ROUTES.UNIT}?domain=${state.domain}&id=${item.id}" class="unit-arrow">→</a>
        `;

        div.querySelector('input').addEventListener('change', e => {
          if (e.target.checked) state.selectedUnits.add(item.id);
          else state.selectedUnits.delete(item.id);
        });

        li.appendChild(div);
      }
      return li;
    };

    state.treeRoots.forEach(r => ul.appendChild(createNode(r)));
    el.treeContainer.appendChild(ul);
  }

  // ─── SCORING HELPERS ────────────────────────────────────────────────────────────
  function getXPScore(unitId) {
    const xp = state.xpData[unitId];
    if (!xp) return { band: 'I', xp: 0, score: 0 };
    return { band: xp.currentBand, xp: xp.cumulativeXP, score: xp.cumulativeXP / 100 };
  }

  function getUrgencyScore(unit) {
    const deadlineInfo = state.deadlines.deadlines?.[unit.id];
    if (!deadlineInfo?.deadline) return { score: 0, days: Infinity, display: 'No deadline' };

    const daysUntilDeadline = (new Date(deadlineInfo.deadline) - Date.now()) / (1000 * 60 * 60 * 24);
    let urgencyScore = 0;
    let display = '';

    if (daysUntilDeadline < 0) { urgencyScore = 1.0; display = 'Overdue'; }
    else if (daysUntilDeadline <= 7) { urgencyScore = 0.9; display = `${Math.floor(daysUntilDeadline)}d`; }
    else if (daysUntilDeadline <= 14) { urgencyScore = 0.7; display = `${Math.floor(daysUntilDeadline)}d`; }
    else if (daysUntilDeadline <= 30) { urgencyScore = 0.5; display = `${Math.floor(daysUntilDeadline)}d`; }
    else { urgencyScore = 0.1; display = `${Math.floor(daysUntilDeadline)}d`; }

    urgencyScore *= (deadlineInfo.priority || 1.0);
    return { score: urgencyScore, days: daysUntilDeadline, display };
  }

  function calculateClusterAverages(children) {
    const units = children.filter(c => !c.type);
    if (!units.length) return { avgXP: 0 };
    const avgXP = units.reduce((sum, u) => sum + getXPScore(u.id).xp, 0) / units.length;
    return { avgXP };
  }

  function selectAllInGroup(groupType, groupName, select) {
    if (groupType === 'bt') {
      const btNode = state.treeRoots.find(r => r.name === groupName);
      if (!btNode) return;
      btNode.children.forEach(cl => cl.children.forEach(u => {
        select ? state.selectedUnits.add(u.id) : state.selectedUnits.delete(u.id);
        const cb = document.getElementById(`u-${u.id}`);
        if (cb) cb.checked = select;
      }));
    } else {
      state.treeRoots.forEach(bt => {
        const clNode = bt.children.find(cl => cl.name === groupName);
        if (!clNode) return;
        clNode.children.forEach(u => {
          select ? state.selectedUnits.add(u.id) : state.selectedUnits.delete(u.id);
          const cb = document.getElementById(`u-${u.id}`);
          if (cb) cb.checked = select;
        });
      });
    }
    renderTree();
  }

  // ─── PRIORITY ───────────────────────────────────────────────────────────────────
  function getTopPriorityUnits(count) {
    if (!state.units.length) return [];

    const pool = state.units;
    const N = pool.length;
    const maxDep = Math.max(...pool.map(u => u.dependents), 1);
    const maxLinks = Math.max(...pool.map(u => u.links.length), 1);
    const now = Date.now();

    const withUrgency = pool.map(u => {
      const info = state.deadlines.deadlines?.[u.id];
      let urgencyScore = 0;
      let daysUntilDeadline = Infinity;

      if (info?.deadline) {
        daysUntilDeadline = (new Date(info.deadline) - now) / (1000 * 60 * 60 * 24);
        if (daysUntilDeadline < 0) urgencyScore = 1.0;
        else if (daysUntilDeadline <= 7) urgencyScore = 0.9;
        else if (daysUntilDeadline <= 14) urgencyScore = 0.7;
        else if (daysUntilDeadline <= 30) urgencyScore = 0.5;
        else urgencyScore = 0.1;
        urgencyScore *= (info.priority || 1.0);
      }

      return { ...u, urgencyScore, daysUntilDeadline };
    });

    const sortedByUrgency = [...withUrgency].sort((a, b) => b.urgencyScore - a.urgencyScore);
    const urgencyMap = new Map(sortedByUrgency.map((u, i) => [u.id, i + 1]));

    const scored = withUrgency.map(u => {
      const rank = urgencyMap.get(u.id);
      const U = Math.max(0, (N - rank) / Math.max(1, N - 1));
      const B = u.dependents / maxDep;
      const L = u.links.length / maxLinks;

      let R = 1.0;
      const hardReqs = u.links.filter(([, t]) => t === 'h').map(([id]) => id);
      if (hardReqs.length > 0) {
        const allStable = hardReqs.every(rid => (state.xpData[rid]?.currentBand || 'I') !== 'I');
        if (!allStable) R = 0.3;
      } else {
        const softReqs = u.links.filter(([, t]) => t === 's').map(([id]) => id);
        if (softReqs.length > 0 && !softReqs.every(rid => (state.xpData[rid]?.currentBand || 'I') !== 'I')) {
          R = 0.7;
        }
      }

      return { id: u.id, score: (0.6 * U + 0.25 * B + 0.15 * L) * R, unit: u };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count);
  }

  function updatePriority() {
    if (state.mode !== 'priority' || !state.units.length) return;

    const count = parseInt(el.priorityCount.value);
    const topItems = getTopPriorityUnits(count);

    el.priorityList.innerHTML = '<h3>Top Priority Units</h3>';

    topItems.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'priority-item';

      const urgInfo = getUrgencyScore(item.unit);
      let deadlineHTML = '';
      if (urgInfo.days !== Infinity) {
        const cls = urgInfo.days < 0 ? 'overdue' : urgInfo.days <= 7 ? 'urgent' : urgInfo.days <= 30 ? 'soon' : 'distant';
        const label = urgInfo.days < 0 ? 'Overdue' : `${Math.floor(urgInfo.days)} days`;
        deadlineHTML = `<div class="deadline-info"><span class="deadline ${cls}">${label}</span></div>`;
      }

      div.innerHTML = `
        <div class="rank-badge">${i + 1}</div>
        <div class="priority-info">
          <div><strong>${item.unit.name}</strong></div>
          <div class="unit-meta">${item.unit.bt} › ${item.unit.cl}</div>
          ${deadlineHTML}
        </div>
        <div class="priority-score">${item.score.toFixed(3)}</div>
      `;

      div.addEventListener('click', () => {
        state.selectedUnits.add(item.id);
        renderTree();
      });

      el.priorityList.appendChild(div);
    });
  }

  // ─── MODE CONTROLS ──────────────────────────────────────────────────────────────
  el.modeToggle.addEventListener('click', () => {
    state.mode = 'select';
    el.modeToggle.classList.add('active');
    el.modePriority.classList.remove('active');
    el.priorityControls.classList.add('hidden');
    el.treeContainer.classList.remove('hidden');
    el.priorityList.classList.add('hidden');
  });

  el.modePriority.addEventListener('click', () => {
    state.mode = 'priority';
    el.modePriority.classList.add('active');
    el.modeToggle.classList.remove('active');
    el.priorityControls.classList.remove('hidden');
    el.treeContainer.classList.add('hidden');
    el.priorityList.classList.remove('hidden');
    updatePriority();
  });

  el.priorityCount.addEventListener('input', e => {
    el.priorityVal.textContent = e.target.value;
    updatePriority();
  });

  el.promptMode.addEventListener('change', e => { state.promptMode = e.target.value; });

  // ─── COPY PROMPT ────────────────────────────────────────────────────────────────
  document.getElementById('copy-prompt').addEventListener('click', async () => {
    let unitIds;

    if (state.mode === 'priority') {
      const count = parseInt(el.priorityCount.value);
      const topUnits = getTopPriorityUnits(count);
      if (!topUnits.length) return alert('No units available.');
      unitIds = topUnits.map(s => s.id);
    } else {
      if (!state.selectedUnits.size) return alert('Select at least one unit.');
      unitIds = Array.from(state.selectedUnits);
    }

    try {
      const res = await fetch(`/api/prompt/${state.promptMode}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: state.domain, unitIds })
      });
      const compiled = await res.text();
      await navigator.clipboard.writeText(compiled);
      showToast('Prompt copied');
    } catch (e) {
      console.error(e);
      alert('Failed to compile prompt: ' + e.message);
    }
  });

  // TEST BUTTON — store params, navigate to /test which runs the API call
  document.getElementById('test-btn').addEventListener('click', () => {
    if (!state.domain) return showToast('Select a domain first.');

    let unitIds;
    if (state.mode === 'priority') {
      const count = parseInt(el.priorityCount.value);
      const topUnits = getTopPriorityUnits(count);
      if (!topUnits.length) return showToast('No units available.');
      unitIds = topUnits.map(s => s.id);
    } else {
      if (state.selectedUnits.size === 0) return showToast('Select at least one unit.');
      unitIds = Array.from(state.selectedUnits);
    }

    console.log('[TEST] Navigating to /test with', { domain: state.domain, unitIds });
    sessionStorage.setItem('testParams', JSON.stringify({ domain: state.domain, unitIds }));
    window.location.href = '/test';
  });

  // XP INJECTION API CALL
  async function injectXP(injections) {
    const payload = { injections, domain: state.domain };
    const res = await fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      // Reload progress for this domain
      if (state.domain) {
        const progressRes = await fetch(`/api/progress/${state.domain}`);
        if (progressRes.ok) {
          const progressData = await progressRes.json();
          state.progress = {};
          progressData.tree.forEach(bt => bt.clusters.forEach(cl => cl.units.forEach(u => {
            state.progress[u.id] = u.logs || [];
          })));
        }
      }
      showXPModal(data.results);
      state.lastXPResult = data.results;
      // Refresh XP display in tree
      renderTree();
    }
    return data;
  }

  function showXPModal(results) {
    el.modalStats.innerHTML = '';

    const BAND_THRESHOLDS = { I: 0, II: 150, III: 600, IV: 1500, V: 2400 };
    const BAND_NAMES = { I: 'Novice', II: 'Apprentice', III: 'Practitioner', IV: 'Expert', V: 'Master' };
    const BAND_ORDER = ['I', 'II', 'III', 'IV', 'V'];

    // DV natural language mapping
    function dvTier(dv) {
      if (dv >= 85) return { label: 'Elite', color: '#7c3aed' };
      if (dv >= 70) return { label: 'Advanced', color: '#2563eb' };
      if (dv >= 50) return { label: 'Challenging', color: '#16a34a' };
      if (dv >= 30) return { label: 'Moderate', color: '#ca8a04' };
      if (dv >= 15) return { label: 'Light', color: '#f97316' };
      return { label: 'Warm-Up', color: '#ef4444' };
    }

    // BM → Marks natural language mapping
    function bmTier(bm) {
      if (bm >= 1.8) return { label: 'Flawless', color: '#7c3aed' };
      if (bm >= 1.4) return { label: 'Outstanding', color: '#2563eb' };
      if (bm >= 1.0) return { label: 'Solid', color: '#16a34a' };
      if (bm >= 0.6) return { label: 'Decent', color: '#ca8a04' };
      if (bm >= 0.2) return { label: 'Shaky', color: '#f97316' };
      if (bm >= 0) return { label: 'Slipping', color: '#6b7280' };
      return { label: 'Failing', color: '#ef4444' };
    }

    const totalGain = results.reduce((sum, r) => sum + r.delta, 0);

    // Summary bar
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #22c55e;border-radius:12px;padding:1rem;text-align:center;margin-bottom:0.8rem;';
    summaryDiv.innerHTML = `
      <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:600">Total Session XP</div>
      <div style="font-size:2.2rem;font-weight:800;color:#16a34a;line-height:1.1;margin-top:0.2rem">+${totalGain}</div>
      <div style="font-size:0.75rem;color:#888;margin-top:0.2rem">${results.length} unit${results.length > 1 ? 's' : ''} updated</div>
    `;
    el.modalStats.appendChild(summaryDiv);

    results.forEach((r, i) => {
      const unit = state.units.find(u => u.id === r.unitId);
      const unitName = unit ? unit.name : '';
      const pct = Math.min(100, (r.dv / 100) * 100);

      // Tier classification for card background
      let tier = 'tier-bronze';
      let xpColor = '#f87171';
      if (r.delta > 50 || r.bandShifted) { tier = 'tier-gold'; xpColor = '#f59e0b'; }
      else if (r.delta > 15) { tier = 'tier-silver'; xpColor = '#22c55e'; }

      const dvInfo = dvTier(r.dv);
      const bmInfo = bmTier(r.bm);

      // Band transition info
      const bandShifted = r.oldBand !== r.newBand;
      const oldBandName = BAND_NAMES[r.oldBand] || 'Novice';
      const newBandName = BAND_NAMES[r.newBand] || 'Novice';

      // Percentage calculations
      const beforePct = r.oldCum > 0 ? Math.min(100, (r.oldCum / BAND_THRESHOLDS.V) * 100) : 0;
      const gainPct = Math.min(100 - beforePct, (r.delta / BAND_THRESHOLDS.V) * 100);
      const afterPct = Math.min(100, (r.newCum / BAND_THRESHOLDS.V) * 100);

      // Band progress
      const currentBandIdx = BAND_ORDER.indexOf(r.newBand);
      const nextBand = currentBandIdx < BAND_ORDER.length - 1 ? BAND_ORDER[currentBandIdx + 1] : null;
      const toNextPct = nextBand ? Math.min(100, (r.newCum / BAND_THRESHOLDS[nextBand]) * 100) : 100;
      const toVPct = Math.min(100, afterPct);

      const div = document.createElement('div');
      let classes = `stat-row ${tier}`;
      if (bandShifted) classes += ' band-upgrade';
      div.className = classes;
      div.style.setProperty('--xp-pct', `${pct}%`);
      div.style.setProperty('--xp-color', xpColor);
      div.style.animationDelay = `${i * 0.08}s`;

      // Band display with transition animation
      let bandDisplay = '';
      if (bandShifted) {
        bandDisplay = `
          <div style="display:flex;align-items:center;gap:0.3rem;justify-content:center">
            <span class="band-badge band-${r.oldBand}" style="opacity:0.6;text-decoration:line-through">${r.oldBand}</span>
            <span style="color:#22c55e;font-weight:800;font-size:1rem">→</span>
            <span class="band-badge band-${r.newBand}">${r.newBand}</span>
          </div>
        `;
      } else {
        bandDisplay = `<span class="band-badge band-${r.newBand}">${r.newBand}</span>`;
      }

      // Progress to next band with gamified labels
      let bandProgressHTML = '';
      if (nextBand) {
        bandProgressHTML = `
          <div class="band-progress-section">
            <div class="band-progress-row">
              <span class="band-progress-label">→ ${BAND_NAMES[nextBand]}</span>
              <div class="band-progress-track">
                <div class="band-progress-fill to-next" data-target="${toNextPct.toFixed(1)}" style="width:0%"></div>
              </div>
              <span class="band-progress-pct">${toNextPct.toFixed(1)}%</span>
            </div>
            <div class="band-progress-row">
              <span class="band-progress-label">→ ${BAND_NAMES.V}</span>
              <div class="band-progress-track">
                <div class="band-progress-fill to-v" data-target="${toVPct.toFixed(1)}" style="width:0%"></div>
              </div>
              <span class="band-progress-pct">${toVPct.toFixed(1)}%</span>
            </div>
          </div>
        `;
      } else {
        // Already at Band V
        bandProgressHTML = `
          <div class="band-progress-section" style="text-align:center;background:linear-gradient(135deg,#fef3c7,#fbbf24);border-color:#f59e0b">
            <div style="font-weight:700;color:#92400e;font-size:0.85rem">👑 Band V — Master</div>
            <div style="font-size:0.7rem;color:#78350f">Maximum rank achieved</div>
          </div>
        `;
      }

      // Congrats banner for band upgrades
      let congratsHTML = '';
      if (bandShifted) {
        const icons = { II: '⚡', III: '🔥', IV: '💎', V: '👑' };
        const messages = {
          II: 'Getting Serious',
          III: 'Solid Foundation',
          IV: 'Advanced Player',
          V: 'Mastery Reached'
        };
        const icon = icons[r.newBand] || '🎉';
        const message = messages[r.newBand] || 'Band Upgraded!';
        congratsHTML = `
          <div class="congrats-banner">
            <span class="congrats-icon">${icon}</span>
            <div class="congrats-text">BAND UPGRADE!</div>
            <div class="congrats-detail">${r.oldBand} ${oldBandName} → ${r.newBand} ${newBandName} · ${message}</div>
          </div>
        `;
      }

      div.innerHTML = `
        <div class="stat-header">
          <span>
            <span style="color:#888">#${r.unitId}</span>
            <span class="stat-name">${unitName}</span>
          </span>
          <div class="xp-gain-display">
            <span class="xp-delta" style="color:${xpColor}">+${r.delta}</span>
            <span class="xp-label">XP</span>
          </div>
        </div>

        <div class="growth-bar">
          <div class="bar-track">
            <div class="bar-fill" style="width:0%;background:${xpColor}" data-target="${pct}"></div>
          </div>
          <span class="bar-label">${Math.round(pct)}%</span>
        </div>

        <div class="stat-details">
          <div class="stat-cell">
            <div class="cell-label">Difficulty</div>
            <div class="cell-value" style="color:${dvInfo.color}">${dvInfo.label}</div>
          </div>
          <div class="stat-cell">
            <div class="cell-label">Marks</div>
            <div class="cell-value" style="color:${bmInfo.color}">${bmInfo.label}</div>
          </div>
          <div class="stat-cell">
            <div class="cell-label">Band</div>
            <div class="cell-value">${bandDisplay}</div>
          </div>
          <div class="stat-cell">
            <div class="cell-label">XP Progress</div>
            <div class="cell-value">
              <span style="color:#6b7280">${beforePct.toFixed(0)}%</span>
              <span style="color:#22c55e;font-weight:800">+${gainPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div style="text-align:center;margin-top:0.5rem;font-size:0.75rem;color:#888">
          Total XP: <span style="font-weight:700;color:var(--text)">${r.newCum}</span>
          / ${BAND_THRESHOLDS.V} to Master
        </div>

        ${bandProgressHTML}
        ${congratsHTML}
      `;

      el.modalStats.appendChild(div);
    });

    // Animate bars after render
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll('.bar-fill, .band-progress-fill').forEach(bar => {
          bar.style.width = bar.dataset.target + '%';
        });
      }, 80);
    });

    el.modal.showModal();
  }

  function showHistoryModal() {
    const container = document.getElementById('modal-history');
    container.innerHTML = '';

    fetch(`/api/xp?domain=${state.domain}`).then(r => r.json()).then(xpData => {
      const history = (xpData._history || []).slice().reverse(); // newest first

      if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#888;padding:2rem">No XP history yet.</p>';
        return;
      }

      history.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-entry';
        div.dataset.sessionId = session.sessionId;

        const time = new Date(session.timestamp).toLocaleString();
        const units = session.results.map(r => {
          const unitName = state.units.find(u => u.id === r.unitId)?.name || '';
          return `#${r.unitId} ${r.bandShifted ? '🎉' : ''} (+${r.delta} → ${r.newBand})`;
        }).join(' · ');

        div.innerHTML = `
          <div class="history-header">
            <span class="history-time">${time}</span>
            <button class="btn-undo" data-session-id="${session.sessionId}">↩ UNDO</button>
          </div>
          <div class="history-units">${units}</div>
          <div style="font-size:0.75rem;color:#999">
            ${session.injections.map(inj => `Unit #${inj.unitId}: DV ${Math.round(inj.difficultyScore * inj.performanceRatio)}, PR ${inj.performanceRatio}`).join(' | ')}
          </div>
        `;

        container.appendChild(div);
      });

      // Attach undo handlers
      container.querySelectorAll('.btn-undo').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sessionId = btn.dataset.sessionId;
          if (!confirm('Undo this XP injection? This will recalculate XP for affected units.')) return;

          try {
            const res = await fetch(`/api/xp/${sessionId}?domain=${state.domain}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              showToast(`↩ Undone. ${data.undone.length} unit(s) recalculated.`);
              showHistoryModal(); // refresh
              // Refresh tree
              const xpRes = await fetch(`/api/xp?domain=${state.domain}`);
              if (xpRes.ok) {
                state.xpData = await xpRes.json();
                renderTree();
              }
            } else {
              alert('Undo failed: ' + (data.error || 'Unknown error'));
            }
          } catch(e) {
            alert('Undo error: ' + e.message);
          }
        });
      });
    });
  }

  document.getElementById('close-modal').addEventListener('click', () => el.modal.close());

  // SHOW XP HISTORY button
  document.getElementById('show-xp-history').addEventListener('click', () => {
    showHistoryModal();
    // Activate history tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="history"]').classList.add('active');
    document.getElementById('tab-history').classList.add('active');
    el.modal.showModal();
  });

  // Tab switching in modal
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'history') showHistoryModal();
    });
  });

  // CLEAR ALL HISTORY
  document.getElementById('clear-all-history').addEventListener('click', async () => {
    if (!confirm('Clear all XP history? This will reset all XP to 0 and remove all progress logs.')) return;

    try {
      const res = await fetch(`/api/xp?domain=${state.domain}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('🗑 All XP history cleared.');
        showHistoryModal();
        const xpRes = await fetch(`/api/xp?domain=${state.domain}`);
        if (xpRes.ok) {
          state.xpData = await xpRes.json();
          renderTree();
        }
      } else {
        alert('Clear failed: ' + (data.error || 'Unknown error'));
      }
    } catch(e) {
      alert('Clear error: ' + e.message);
}
  });

  // ─── TEACHING INJECTION — JSON paste & compile ─────────────────────────────────
  document.getElementById('copy-teaching').addEventListener('click', async () => {
    const textarea = document.getElementById('teaching-input');
    const raw = textarea.value.trim();
    if (!raw) return alert('Paste a teaching injection JSON first.');

    let entries;
    try {
      entries = JSON.parse(raw);
    } catch(e) {
      return alert('Invalid JSON: ' + e.message);
    }
    if (!Array.isArray(entries)) entries = [entries];

    // Validate entries
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.question) return alert(`Entry ${i + 1}: missing "question" field.`);
      if (!e.answer && !e.studentAnswer) return alert(`Entry ${i + 1}: missing "answer" or "studentAnswer" field.`);
      if (!e.relevantUnits || !Array.isArray(e.relevantUnits)) {
        return alert(`Entry ${i + 1}: missing or invalid "relevantUnits" array.`);
      }
    }

    // Collect all unit IDs from entries
    const allUnitIds = new Set();
    entries.forEach(e => e.relevantUnits.forEach(id => allUnitIds.add(id)));
    if (allUnitIds.size === 0) return alert('No relevantUnits found in entries.');

    // Normalize entry fields for the compiler
    const teachingEntries = entries.map(e => ({
      question: e.question,
      answer: e.answer || e.studentAnswer,
      studentAnswer: e.studentAnswer || e.answer,
      relevantUnits: e.relevantUnits
    }));

    try {
      const res = await fetch(`/api/prompt/teaching/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: state.domain,
          unitIds: Array.from(allUnitIds),
          entries: teachingEntries
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server error ${res.status}: ${errText}`);
      }

      const compiledPrompt = await res.text();
      await navigator.clipboard.writeText(compiledPrompt);
      showToast('✓ Teaching prompt compiled & copied!');
    } catch(e) {
      console.error('Teaching compile error:', e);
      alert('Error compiling teaching prompt: ' + e.message);
    }
  });

  // ─── ADD CONTEXT ─────────────────────────────────────────────────────────────────
  function showAcState(s) {
    el.acChoose.hidden = s !== 'choose';
    el.acProgress.hidden = s !== 'progress';
    el.acResult.hidden = s !== 'result';
  }

  el.addContextBtn.addEventListener('click', () => {
    showAcState('choose');
    el.addContextModal.showModal();
  });

  document.getElementById('close-add-context').addEventListener('click', () => {
    el.addContextModal.close();
  });

  document.getElementById('ac-try-again').addEventListener('click', () => {
    showAcState('choose');
  });

  document.getElementById('ac-pdf-splitter').addEventListener('click', () => {
    el.pdfFileInput.click();
  });

  el.pdfFileInput.addEventListener('change', async () => {
    const file = el.pdfFileInput.files[0];
    if (!file) return;
    document.getElementById('ac-progress-text').textContent = `⏳ Extracting chapters from ${file.name}…`;
    showAcState('progress');

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await fetch(`/api/courses/${courseId}/upload-textbook`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || `Server error ${res.status}`);

      const resultEl = document.getElementById('ac-result-content');
      const msg = document.createElement('p');
      msg.style.cssText = 'margin:0;font-weight:600';
      msg.style.color = 'var(--success)';
      msg.textContent = `✓ Loaded ${data.chapterCount} chapter${data.chapterCount !== 1 ? 's' : ''}`;
      resultEl.innerHTML = '';
      resultEl.appendChild(msg);
      showAcState('result');

      el.addContextBtn.textContent = '📚 ADD CONTEXT ✓';
      el.addContextBtn.style.color = 'var(--success)';
      showToast(`✓ ${data.chapterCount} chapters loaded`);
    } catch (e) {
      const resultEl = document.getElementById('ac-result-content');
      const pre = document.createElement('pre');
      pre.textContent = e.message;
      pre.style.cssText = 'color:var(--danger);border:2px solid var(--danger);padding:0.8rem;margin:0;overflow:auto;font-size:0.8rem;max-height:200px;white-space:pre-wrap';
      resultEl.innerHTML = '';
      resultEl.appendChild(pre);
      showAcState('result');
    } finally {
      el.pdfFileInput.value = '';
    }
  });
});
