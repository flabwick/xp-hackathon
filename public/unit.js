document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get('domain');
  const id = parseInt(params.get('id'), 10);

  const loader = document.getElementById('unit-loader');
  const content = document.getElementById('unit-content');

  if (!domain || isNaN(id)) {
    loader.textContent = 'No unit specified. Return to the home page.';
    return;
  }

  document.getElementById('back-btn').href = `${ROUTES.HOME}`;

  try {
    const [unitsRes, xpRes] = await Promise.all([
      fetch(`/api/units/${domain}`),
      fetch(`/api/xp?domain=${domain}`)
    ]);

    if (!unitsRes.ok) {
      loader.textContent = 'Failed to load unit data.';
      return;
    }

    const unitsData = await unitsRes.json();
    const xpData = xpRes.ok ? await xpRes.json() : {};

    // Build flat unit map
    const unitMap = {};
    const unitList = [];
    for (const bt of unitsData.tree) {
      const btName = unitsData.meta.bt[bt.bt];
      for (const cl of bt.clusters) {
        const clName = unitsData.meta.cl[cl.cl];
        for (const u of cl.units) {
          const entry = {
            id: u.id,
            name: u.n,
            isFoundation: u.t === 'f',
            links: u.l || [],
            nt: u.nt || '',
            btName,
            clName
          };
          unitMap[u.id] = entry;
          unitList.push(entry);
        }
      }
    }

    const unit = unitMap[id];
    if (!unit) {
      loader.textContent = `Unit #${id} not found in domain "${domain}".`;
      return;
    }

    // Build dependents map: targetId → [{unitId, linkType}]
    const dependentsMap = {};
    for (const u of unitList) {
      for (const [targetId, linkType] of u.links) {
        if (!dependentsMap[targetId]) dependentsMap[targetId] = [];
        dependentsMap[targetId].push({ unitId: u.id, linkType });
      }
    }

    const BAND_THRESHOLDS = { I: 0, II: 150, III: 600, IV: 1500, V: 2400 };
    const BAND_NAMES = { I: 'Novice', II: 'Apprentice', III: 'Practitioner', IV: 'Expert', V: 'Master' };
    const NEXT_BAND = { I: 'II', II: 'III', III: 'IV', IV: 'V', V: null };

    const xpInfo = xpData[id] || { currentBand: 'I', cumulativeXP: 0, progressLogs: [] };

    document.title = `${unit.name} — Unit Detail`;

    // Hero
    document.getElementById('unit-id-display').textContent = `Unit #${id} · ${domain}`;
    document.getElementById('unit-name-display').textContent = unit.name;

    const typeBadge = document.getElementById('unit-type-badge');
    typeBadge.textContent = unit.isFoundation ? 'Foundation' : 'Content';
    typeBadge.classList.add(unit.isFoundation ? 'type-foundation' : 'type-content');

    document.getElementById('unit-location').textContent = `${unit.btName} › ${unit.clName}`;

    // XP
    const bandEl = document.getElementById('xp-band');
    bandEl.textContent = `${xpInfo.currentBand} — ${BAND_NAMES[xpInfo.currentBand]}`;
    bandEl.className = `stat-value band-display band-${xpInfo.currentBand}`;

    document.getElementById('xp-total').textContent = `${xpInfo.cumulativeXP} XP`;
    document.getElementById('xp-sessions').textContent = xpInfo.progressLogs?.length || 0;

    // XP bar: progress toward next band threshold
    const nextBand = NEXT_BAND[xpInfo.currentBand];
    const maxThreshold = nextBand ? BAND_THRESHOLDS[nextBand] : BAND_THRESHOLDS.V;
    const prevThreshold = BAND_THRESHOLDS[xpInfo.currentBand];
    const bandRange = maxThreshold - prevThreshold;
    const bandProgress = xpInfo.cumulativeXP - prevThreshold;
    const pct = nextBand
      ? Math.min(100, (bandProgress / bandRange) * 100)
      : 100;

    setTimeout(() => {
      const bar = document.getElementById('xp-bar');
      bar.style.width = `${pct}%`;
      bar.className = `xp-bar-fill band-fill-${xpInfo.currentBand}`;
    }, 80);

    // Scope notes
    if (unit.nt) {
      document.getElementById('unit-scope-text').textContent = unit.nt;
      document.getElementById('unit-scope-section').classList.remove('hidden');
    }

    // Prerequisites
    if (unit.links.length > 0) {
      const prereqList = document.getElementById('prereqs-list');
      for (const [targetId, linkType] of unit.links) {
        const prereqUnit = unitMap[targetId];
        if (!prereqUnit) continue;
        const prereqXP = xpData[targetId] || { currentBand: 'I', cumulativeXP: 0 };
        prereqList.appendChild(buildUnitRow(prereqUnit, prereqXP, domain, linkType, false));
      }
      document.getElementById('prereqs-section').classList.remove('hidden');
    }

    // Dependents
    const deps = dependentsMap[id] || [];
    if (deps.length > 0) {
      const depList = document.getElementById('dependents-list');
      for (const { unitId: depId, linkType } of deps) {
        const depUnit = unitMap[depId];
        if (!depUnit) continue;
        const depXP = xpData[depId] || { currentBand: 'I', cumulativeXP: 0 };
        depList.appendChild(buildUnitRow(depUnit, depXP, domain, linkType, true));
      }
      document.getElementById('dependents-section').classList.remove('hidden');
    }

    // Cluster peers
    const peers = unitList.filter(u => u.clName === unit.clName && u.btName === unit.btName && u.id !== id);
    if (peers.length > 0) {
      const clusterList = document.getElementById('cluster-units-list');
      for (const peer of peers) {
        const peerXP = xpData[peer.id] || { currentBand: 'I', cumulativeXP: 0 };
        clusterList.appendChild(buildUnitRow(peer, peerXP, domain, null, false));
      }
      document.getElementById('cluster-section').classList.remove('hidden');
    }

    loader.classList.add('hidden');
    content.classList.remove('hidden');

  } catch (err) {
    loader.textContent = 'Error: ' + err.message;
    console.error(err);
  }
});

function buildUnitRow(unit, xpInfo, domain, linkType, isDependent) {
  const div = document.createElement('div');

  let rowClass = 'unit-link-row cluster-peer';
  if (linkType === 'h') rowClass = 'unit-link-row hard-req';
  else if (linkType === 's') rowClass = 'unit-link-row soft-req';
  else if (isDependent) rowClass = 'unit-link-row dependent';

  div.className = rowClass;

  let badgeHTML = '';
  if (linkType === 'h') {
    badgeHTML = `<span class="req-type-badge">Hard</span>`;
  } else if (linkType === 's') {
    badgeHTML = `<span class="req-type-badge">Soft</span>`;
  } else if (isDependent) {
    badgeHTML = `<span class="req-type-badge dep-badge">Dep</span>`;
  }

  div.innerHTML = `
    ${badgeHTML}
    <a href="${ROUTES.UNIT}?domain=${domain}&id=${unit.id}" class="unit-link-name">${unit.name}</a>
    <span class="unit-link-meta">${unit.btName} › ${unit.clName}</span>
    <span class="score-badge band-${xpInfo.currentBand}">${xpInfo.currentBand}</span>
    <span class="score-badge xp">${xpInfo.cumulativeXP} XP</span>
  `;

  return div;
}
