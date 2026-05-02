document.addEventListener('DOMContentLoaded', () => {
  // ─── STATE ──────────────────────────────────────────────────────────────────────
  const state = {
    domain: null,
    units: [],
    treeData: null,
    xpData: {},
    selectedUnitId: null,
    currentView: 'birdseye'
  };

  // ─── DOM REFS ───────────────────────────────────────────────────────────────────
  const el = {
    domainSelect: document.getElementById('domain-select'),
    unitIdInput: document.getElementById('unit-id-input'),
    showMappingBtn: document.getElementById('show-mapping'),
    viewBirdseye: document.getElementById('view-birdseye'),
    viewProximity: document.getElementById('view-proximity'),
    loadingMsg: document.getElementById('loading-msg'),
    birdseyeView: document.getElementById('birdseye-view'),
    proximityView: document.getElementById('proximity-view'),
    domainTitle: document.getElementById('domain-title'),
    btClusters: document.getElementById('bt-clusters'),
    focusedUnitName: document.getElementById('focused-unit-name'),
    unitXpInfo: document.getElementById('unit-xp-info'),
    prereqsList: document.getElementById('prereqs-list'),
    centerUnitDisplay: document.getElementById('center-unit-display'),
    dependentsList: document.getElementById('dependents-list'),
    clusterName: document.getElementById('cluster-name'),
    clusterUnits: document.getElementById('cluster-units'),
    fadedUnitsList: document.getElementById('faded-units-list')
  };

  // ─── INIT ───────────────────────────────────────────────────────────────────────
  fetch('/api/domains')
    .then(r => r.json())
    .then(domains => {
      domains.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        el.domainSelect.appendChild(opt);
      });
      if (domains.length) loadDomain(domains[0]);
    });

  fetch('/api/xp')
    .then(r => r.json())
    .then(xp => state.xpData = xp);

  // ─── DOMAIN LOADER ──────────────────────────────────────────────────────────────
  async function loadDomain(domain) {
    state.domain = domain;
    el.domainSelect.value = domain;
    el.loadingMsg.classList.remove('hidden');
    el.birdseyeView.classList.add('hidden');
    el.proximityView.classList.add('hidden');

    try {
      const unitsRes = await fetch(`/api/units/${domain}`);
      if (!unitsRes.ok) throw new Error('Domain not found');

      state.treeData = await unitsRes.json();
      parseUnits(state.treeData);
      el.loadingMsg.classList.add('hidden');

      if (state.currentView === 'birdseye') {
        renderBirdseyeView();
      }
    } catch (err) {
      el.loadingMsg.textContent = `Error: ${err.message}`;
      el.loadingMsg.classList.remove('hidden');
    }
  }

  el.domainSelect.addEventListener('change', e => loadDomain(e.target.value));

  // ─── UNIT PARSER ────────────────────────────────────────────────────────────────
  function parseUnits(data) {
    state.units = [];
    const idMap = {}; // Maps unit id from data to our unit object

    data.tree.forEach(btNode => {
      const btIdx = btNode.bt;
      const btName = data.meta.bt[btIdx];

      btNode.clusters.forEach(clNode => {
        const clIdx = clNode.cl;
        const clName = data.meta.cl[clIdx];

        clNode.units.forEach(u => {
          const unit = {
            id: u.id,
            name: u.n,
            bt: btName,
            cl: clName,
            btIdx,
            clIdx,
            isFoundation: u.t === 'f',
            links: u.l || [], // [[targetId, type], ...]
            dependents: [] // Will be populated
          };

          state.units.push(unit);
          idMap[u.id] = unit;
        });
      });
    });

    // Build dependents list
    state.units.forEach(unit => {
      unit.links.forEach(([targetId, type]) => {
        if (idMap[targetId]) {
          if (!idMap[targetId].dependents) idMap[targetId].dependents = [];
          idMap[targetId].dependents.push({ unitId: unit.id, type });
        }
      });
    });

    state.idMap = idMap;
  }

  // ─── VIEW TOGGLES ───────────────────────────────────────────────────────────────
  el.viewBirdseye.addEventListener('click', () => {
    state.currentView = 'birdseye';
    el.viewBirdseye.classList.add('active');
    el.viewProximity.classList.remove('active');
    el.birdseyeView.classList.remove('hidden');
    el.proximityView.classList.add('hidden');
    if (state.domain) renderBirdseyeView();
  });

  el.viewProximity.addEventListener('click', () => {
    state.currentView = 'proximity';
    el.viewProximity.classList.add('active');
    el.viewBirdseye.classList.remove('active');
    el.proximityView.classList.remove('hidden');
    el.birdseyeView.classList.add('hidden');
    if (state.selectedUnitId !== null) renderProximityView(state.selectedUnitId);
  });

  // ─── SHOW MAPPING ───────────────────────────────────────────────────────────────
  el.showMappingBtn.addEventListener('click', () => {
    const unitId = parseInt(el.unitIdInput.value);
    if (isNaN(unitId)) {
      alert('Please enter a valid unit ID');
      return;
    }

    if (!state.idMap || !state.idMap[unitId]) {
      alert(`Unit ID ${unitId} not found in this domain`);
      return;
    }

    state.selectedUnitId = unitId;

    // Switch to proximity view
    state.currentView = 'proximity';
    el.viewProximity.classList.add('active');
    el.viewBirdseye.classList.remove('active');
    el.proximityView.classList.remove('hidden');
    el.birdseyeView.classList.add('hidden');

    renderProximityView(unitId);
  });

  // ─── XP HELPERS ─────────────────────────────────────────────────────────────────
  function getXPInfo(unitId) {
    const xp = state.xpData[unitId];
    if (!xp) return { band: 'I', xp: 0, progress: 0 };
    return {
      band: xp.currentBand || 'I',
      xp: xp.cumulativeXP || 0,
      progress: xp.progressLogs?.length || 0
    };
  }

  function getBandColor(band) {
    const colors = {
      'I': 'var(--band-i)',
      'II': 'var(--band-ii)',
      'III': 'var(--band-iii)',
      'IV': 'var(--band-iv)',
      'V': 'var(--band-v)'
    };
    return colors[band] || 'var(--band-i)';
  }

  function getXPProgress(unitId) {
    const xp = state.xpData[unitId];
    if (!xp || !xp.cumulativeXP) return 0;
    // Max XP for band V is around 2400+
    return Math.min(100, (xp.cumulativeXP / 3000) * 100);
  }

  // ─── BIRDSEYE VIEW ──────────────────────────────────────────────────────────────
  function renderBirdseyeView() {
    el.domainTitle.textContent = state.domain.charAt(0).toUpperCase() + state.domain.slice(1);
    el.btClusters.innerHTML = '';

    state.treeData.tree.forEach(btNode => {
      const btIdx = btNode.bt;
      const btName = state.treeData.meta.bt[btIdx];

      const btSection = document.createElement('div');
      btSection.className = 'bt-section';

      const btTitle = document.createElement('div');
      btTitle.className = 'bt-title';
      btTitle.textContent = `📊 ${btName}`;
      btSection.appendChild(btTitle);

      const clusterGrid = document.createElement('div');
      clusterGrid.className = 'cluster-grid';

      btNode.clusters.forEach(clNode => {
        const clIdx = clNode.cl;
        const clName = state.treeData.meta.cl[clIdx];

        const clusterBox = document.createElement('div');
        clusterBox.className = 'cluster-box';

        const clusterName = document.createElement('div');
        clusterName.className = 'cluster-name';
        clusterName.textContent = clName;
        clusterBox.appendChild(clusterName);

        const unitsList = document.createElement('div');
        unitsList.className = 'cluster-units-list';

        clNode.units.forEach(u => {
          const miniUnit = document.createElement('div');
          miniUnit.className = 'mini-unit';

          const xpInfo = getXPInfo(u.id);
          const xpProgress = getXPProgress(u.id);

          miniUnit.innerHTML = `
            <div>
              <span class="unit-id">#${u.id}</span>
              ${u.n}
            </div>
            <span class="xp-badge" style="background: ${getBandColor(xpInfo.band)}">
              ${xpInfo.xp} XP
            </span>
          `;

          miniUnit.style.borderLeftColor = getBandColor(xpInfo.band);

          if (u.id === state.selectedUnitId) {
            miniUnit.classList.add('highlight');
          }

          miniUnit.addEventListener('click', () => {
            el.unitIdInput.value = u.id;
            el.showMappingBtn.click();
          });

          unitsList.appendChild(miniUnit);
        });

        clusterBox.appendChild(unitsList);
        clusterGrid.appendChild(clusterBox);
      });

      btSection.appendChild(clusterGrid);
      el.btClusters.appendChild(btSection);
    });

    el.birdseyeView.classList.remove('hidden');
  }

  // ─── PROXIMITY VIEW ─────────────────────────────────────────────────────────────
  function renderProximityView(unitId) {
    const unit = state.idMap[unitId];
    if (!unit) return;

    // Focused unit info
    el.focusedUnitName.textContent = `#${unitId}: ${unit.name}`;
    const xpInfo = getXPInfo(unitId);
    el.unitXpInfo.innerHTML = `
      <div class="xp-stat">
        <div class="label">Band</div>
        <div class="value" style="color: ${getBandColor(xpInfo.band)}">${xpInfo.band}</div>
      </div>
      <div class="xp-stat">
        <div class="label">XP</div>
        <div class="value">${xpInfo.xp}</div>
      </div>
      <div class="xp-stat">
        <div class="label">Progress Logs</div>
        <div class="value">${xpInfo.progress}</div>
      </div>
    `;

    // Center unit display
    el.centerUnitDisplay.innerHTML = `
      <div class="center-unit-name">${unit.name}</div>
      <div class="center-unit-meta">${unit.bt} > ${unit.cl}</div>
      <div style="margin-top: 0.5rem; height: 8px; background: #eee; border-radius: 4px; overflow: hidden;">
        <div style="height: 100%; width: ${getXPProgress(unitId)}%; background: ${getBandColor(xpInfo.band)};"></div>
      </div>
    `;

    // Prerequisites
    el.prereqsList.innerHTML = '';
    if (unit.links.length === 0) {
      el.prereqsList.innerHTML = '<div style="color: #999; font-style: italic;">No prerequisites</div>';
    } else {
      unit.links.forEach(([targetId, type]) => {
        const prereqUnit = state.idMap[targetId];
        if (!prereqUnit) return;

        const prereqXp = getXPInfo(targetId);
        const xpProgress = getXPProgress(targetId);

        const unitLink = document.createElement('div');
        unitLink.className = `unit-link ${type === 'h' ? 'hard-req' : 'soft-req'}`;

        // Check if prereq is completed (has sufficient XP)
        const isCutoff = type === 'h' && prereqXp.band === 'I' && prereqXp.xp === 0;

        unitLink.innerHTML = `
          <span class="unit-id-badge">#${targetId}</span>
          ${prereqUnit.name}
          ${isCutoff ? '<span style="color: var(--danger); font-size: 0.7rem;">⛔ CUTOFF</span>' : ''}
          <span class="xp-badge" style="background: ${getBandColor(prereqXp.band)}; margin-left: 0.5rem;">
            ${prereqXp.xp} XP
          </span>
        `;

        unitLink.style.borderLeftColor = isCutoff
          ? 'var(--prereq-cutoff)'
          : type === 'h' ? 'var(--danger)' : 'var(--warning)';

        unitLink.addEventListener('click', () => {
          el.unitIdInput.value = targetId;
          el.showMappingBtn.click();
        });

        el.prereqsList.appendChild(unitLink);
      });
    }

    // Dependents
    el.dependentsList.innerHTML = '';
    if (!unit.dependents || unit.dependents.length === 0) {
      el.dependentsList.innerHTML = '<div style="color: #999; font-style: italic;">No dependents</div>';
    } else {
      unit.dependents.forEach(({ unitId: depId, type }) => {
        const depUnit = state.idMap[depId];
        if (!depUnit) return;

        const depXp = getXPInfo(depId);

        const unitLink = document.createElement('div');
        unitLink.className = 'unit-link dependent';
        unitLink.innerHTML = `
          <span class="unit-id-badge">#${depId}</span>
          ${depUnit.name}
          <span class="xp-badge" style="background: ${getBandColor(depXp.band)}; margin-left: 0.5rem;">
            ${depXp.xp} XP
          </span>
        `;

        unitLink.addEventListener('click', () => {
          el.unitIdInput.value = depId;
          el.showMappingBtn.click();
        });

        el.dependentsList.appendChild(unitLink);
      });
    }

    // Context cluster
    el.clusterName.textContent = `📁 ${unit.cl}`;
    el.clusterUnits.innerHTML = '';

    // Find the cluster this unit belongs to
    const btNode = state.treeData.tree.find(bt => bt.bt === unit.btIdx);
    if (btNode) {
      const clNode = btNode.clusters.find(cl => cl.cl === unit.clIdx);
      if (clNode) {
        clNode.units.forEach(u => {
          const clusterXp = getXPInfo(u.id);
          const xpProg = getXPProgress(u.id);

          const card = document.createElement('div');
          card.className = `cluster-unit-card ${u.id === unitId ? 'is-center' : ''}`;
          card.style.borderLeftColor = getBandColor(clusterXp.band);

          card.innerHTML = `
            <div><span class="unit-id-badge">#${u.id}</span> ${u.n}</div>
            <div class="xp-indicator">
              <div class="xp-fill" style="width: ${xpProg}%; background: ${getBandColor(clusterXp.band)};"></div>
            </div>
          `;

          if (u.id !== unitId) {
            card.addEventListener('click', () => {
              el.unitIdInput.value = u.id;
              el.showMappingBtn.click();
            });
          }

          el.clusterUnits.appendChild(card);
        });
      }
    }

    // Faded units (everything else, with distance-based opacity)
    el.fadedUnitsList.innerHTML = '';

    // Calculate distances from the focused unit
    const distances = calculateDistances(unitId);

    // Sort by distance and show only units that are far away
    const farUnits = Object.entries(distances)
      .filter(([id, dist]) => dist > 2 && parseInt(id) !== unitId)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 30); // Limit to 30 for performance

    farUnits.forEach(([id, dist]) => {
      const farUnit = state.idMap[id];
      if (!farUnit) return;

      const farXp = getXPInfo(parseInt(id));
      const opacity = Math.max(0.2, 1 - (dist - 2) * 0.15);

      const fadedUnit = document.createElement('div');
      fadedUnit.className = 'faded-unit';
      fadedUnit.style.opacity = opacity;
      fadedUnit.innerHTML = `
        <span class="unit-id-badge">#${id}</span>
        ${farUnit.name.substring(0, 40)}${farUnit.name.length > 40 ? '...' : ''}
      `;

      fadedUnit.style.borderLeftColor = getBandColor(farXp.band);

      fadedUnit.addEventListener('click', () => {
        el.unitIdInput.value = id;
        el.showMappingBtn.click();
      });

      el.fadedUnitsList.appendChild(fadedUnit);
    });

    el.proximityView.classList.remove('hidden');
  }

  // ─── DISTANCE CALCULATOR (BFS) ─────────────────────────────────────────────────
  function calculateDistances(startId) {
    const distances = {};
    const visited = new Set();
    const queue = [[startId, 0]];
    visited.add(startId);

    while (queue.length > 0) {
      const [currentId, dist] = queue.shift();
      distances[currentId] = dist;

      const unit = state.idMap[currentId];
      if (!unit) continue;

      // Add prerequisites
      unit.links.forEach(([targetId, type]) => {
        if (!visited.has(targetId)) {
          visited.add(targetId);
          queue.push([targetId, dist + 1]);
        }
      });

      // Add dependents
      if (unit.dependents) {
        unit.dependents.forEach(({ unitId: depId }) => {
          if (!visited.has(depId)) {
            visited.add(depId);
            queue.push([depId, dist + 1]);
          }
        });
      }

      // Add same cluster units (distance 1)
      const btNode = state.treeData.tree.find(bt => bt.bt === unit.btIdx);
      if (btNode) {
        const clNode = btNode.clusters.find(cl => cl.cl === unit.clIdx);
        if (clNode) {
          clNode.units.forEach(u => {
            if (!visited.has(u.id)) {
              visited.add(u.id);
              queue.push([u.id, dist + 1]);
            }
          });
        }
      }
    }

    return distances;
  }

  // ─── AUTO-RELOAD XP PERIODICALLY ────────────────────────────────────────────────
  setInterval(() => {
    fetch('/api/xp')
      .then(r => r.json())
      .then(xp => {
        state.xpData = xp;
        // Re-render current view
        if (state.currentView === 'birdseye' && state.domain) {
          renderBirdseyeView();
        } else if (state.currentView === 'proximity' && state.selectedUnitId !== null) {
          renderProximityView(state.selectedUnitId);
        }
      });
  }, 5000);
});
