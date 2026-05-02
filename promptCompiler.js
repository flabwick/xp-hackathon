const fs = require('fs');
const path = require('path');
const { UserPaths } = require('./userPaths');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

function pathsFor(userId) {
  if (!userId) throw new Error('promptCompiler: userId is required');
  return new UserPaths(userId);
}

// ─── UNIT COMPILATION ─────────────────────────────────────────────────────────────
/**
 * Converts unit JSON data into natural language description.
 * Handles both single unitId and arrays of relevantUnits.
 */
function compileUnits(domain, unitIds, userId) {
  if (!unitIds || unitIds.length === 0) {
    return 'No specific units selected.';
  }

  const unitsFile = pathsFor(userId).unitsFile(domain);
  if (!fs.existsSync(unitsFile)) {
    return `Units data not found for domain: ${domain}`;
  }

  const unitsData = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  const ids = Array.isArray(unitIds) ? unitIds : [unitIds];

  // Build a flat map of all units
  const unitMap = {};
  unitsData.tree.forEach(btNode => {
    const btName = unitsData.meta.bt[btNode.bt];
    btNode.clusters.forEach(clNode => {
      const clName = unitsData.meta.cl[clNode.cl];
      clNode.units.forEach(u => {
        unitMap[u.id] = {
          id: u.id,
          name: u.n,
          type: u.t === 'f' ? 'Foundational' : 'Content',
          notes: u.nt || '',
          links: u.l || [],
          bt: btName,
          cl: clName
        };
      });
    });
  });

  // Helper to format a single unit entry
  function formatUnit(unit) {
    let output = `**Unit #${unit.id}: ${unit.name}**\n`;
    output += `- **Type**: ${unit.type}\n`;
    output += `- **Location**: ${unit.bt} > ${unit.cl}\n`;
    if (unit.notes) {
      output += `- **Scope**: ${unit.notes}\n`;
    }
    return output;
  }

  // Recursively collect all prerequisite IDs, tracking depth
  function collectPrereqs(unitId, visited, depth = 0) {
    const unit = unitMap[unitId];
    if (!unit || !unit.links.length) return [];

    const prereqs = [];
    for (const [targetId, linkType] of unit.links) {
      if (linkType !== 'h' && linkType !== 's') continue;
      if (visited.has(targetId)) continue;
      visited.add(targetId);

      const targetUnit = unitMap[targetId];
      if (targetUnit) {
        prereqs.push({ unit: targetUnit, depth, linkType });
        const nested = collectPrereqs(targetId, visited, depth + 1);
        prereqs.push(...nested);
      }
    }
    return prereqs;
  }

  // ─── {{UNITS}} — selected units only ───
  function compileUnitsOnly() {
    const sections = ids.map(id => {
      const unit = unitMap[id];
      if (!unit) return `Unit #${id}: Not found in domain`;
      return formatUnit(unit);
    });
    return `**Units Involved (${ids.length} total):**\n\n${sections.join('\n---\n\n')}`;
  }

  // ─── {{UNITS+CONTEXT}} — selected units + full prerequisite chain ───
  function compileUnitsWithContext() {
    const sections = ids.map(id => {
      const unit = unitMap[id];
      if (!unit) return `Unit #${id}: Not found in domain`;

      let output = `**Unit #${unit.id}: ${unit.name}**\n`;
      output += `- **Type**: ${unit.type}\n`;
      output += `- **Location**: ${unit.bt} > ${unit.cl}\n`;
      if (unit.notes) {
        output += `- **Scope**: ${unit.notes}\n`;
      }

      // Collect all prerequisites recursively
      const visited = new Set(ids); // Don't re-collect the focus units themselves
      const allPrereqs = collectPrereqs(id, visited);

      if (allPrereqs.length > 0) {
        output += `\n**Prerequisites for Unit #${unit.id}:**\n`;
        output += `> (These are supporting prerequisites, not the focus of this session. Included for context.)\n\n`;

        // Group by depth
        let currentDepth = -1;
        for (const prereq of allPrereqs) {
          if (prereq.depth !== currentDepth) {
            currentDepth = prereq.depth;
            const levelLabel = currentDepth === 0 ? 'Direct Prerequisites' : `Prerequisites (Depth ${currentDepth})`;
            output += `\n── ${levelLabel} ──\n\n`;
          }
          const linkType = prereq.linkType === 'h' ? 'hard prerequisite' : 'soft prerequisite';
          output += formatUnit(prereq.unit);
          output += `- **Relation**: ${linkType} of parent unit\n\n`;
          output += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n`;
        }
      }

      return output;
    });

    return `**Units Involved (${ids.length} total):**\n\n${sections.join('\n═══════════════════════════════════\n\n')}`;
  }

  // ─── {{UNITS+CONTEXT+PROGRESS}} — units + prerequisites + progress logs ───
  function compileUnitsWithContextAndProgress() {
    // Load progress for this domain
    let progressMap = {};
    if (domain) {
      const progressFile = pathsFor(userId).progressFile(domain);
      if (fs.existsSync(progressFile)) {
        const progressData = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        progressData.tree.forEach(bt => {
          bt.clusters.forEach(cl => {
            cl.units.forEach(u => {
              if (u.logs && u.logs.length > 0) {
                progressMap[u.id] = u.logs;
              }
            });
          });
        });
      }
    }

    // Collect all unit IDs that will appear (focus units + all prereqs)
    const allRelevantIds = new Set(ids);
    const prereqMap = {}; // focus unit id -> its prereqs
    ids.forEach(id => {
      const visited = new Set(ids);
      const prereqs = collectPrereqs(id, visited);
      prereqMap[id] = prereqs;
      prereqs.forEach(p => allRelevantIds.add(p.unit.id));
    });

    let output = '';
    output += `═══ FOCUS UNITS — These are the units being worked on in this session ═══\n\n`;

    // Render focus units
    ids.forEach((id, idx) => {
      const unit = unitMap[id];
      if (!unit) return;

      if (idx > 0) output += `\n${'─'.repeat(50)}\n\n`;

      output += `**🎯 FOCUS Unit #${unit.id}: ${unit.name}**\n`;
      output += `- **Type**: ${unit.type}\n`;
      output += `- **Location**: ${unit.bt} > ${unit.cl}\n`;
      if (unit.notes) {
        output += `- **Scope**: ${unit.notes}\n`;
      }

      // Show prerequisites for this focus unit
      const prereqs = prereqMap[id] || [];
      if (prereqs.length > 0) {
        output += `\n**Prerequisites for this unit:**\n`;
        output += `> (Supporting knowledge this unit builds on — not the focus of this session)\n\n`;

        let currentDepth = -1;
        for (const prereq of prereqs) {
          if (prereq.depth !== currentDepth) {
            currentDepth = prereq.depth;
            const levelLabel = currentDepth === 0 ? 'Direct Prerequisites' : `Prerequisites (Depth ${currentDepth})`;
            output += `\n── ${levelLabel} ──\n\n`;
          }
          const linkType = prereq.linkType === 'h' ? 'hard prerequisite' : 'soft prerequisite';
          output += `- ${prereq.unit.name} (Unit #${prereq.unit.id}) — ${prereq.unit.type} — ${linkType}\n`;
          if (prereq.unit.notes) {
            output += `  Scope: ${prereq.unit.notes.substring(0, 150)}...\n`;
          }
        }
      }
    });

    // Render progress logs for all relevant units
    const unitsWithProgress = [...allRelevantIds].filter(id => progressMap[id] && progressMap[id].length > 0);
    if (unitsWithProgress.length > 0) {
      output += `\n\n═══ PROGRESS LOGS — Historical notes for the focus units and their prerequisites ═══\n\n`;

      unitsWithProgress.forEach(id => {
        const unit = unitMap[id];
        const isFocus = ids.includes(id);
        const logs = progressMap[id];

        output += `\n**${isFocus ? '🎯 FOCUS' : '📎 PREREQ'} Unit #${id}: ${unit ? unit.name : 'Unknown'}** (${logs.length} log${logs.length > 1 ? 's' : ''})\n`;

        logs.forEach((log, i) => {
          const date = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown date';
          output += `\n  **Log ${i + 1}** (${date}):\n`;
          if (log.dv !== undefined) output += `  - Difficulty Value: ${log.dv}\n`;
          if (log.bm !== undefined) output += `  - Marks: ${log.bm}\n`;
          if (log.xpGain !== undefined) output += `  - XP Gained: ${log.xpGain}\n`;
          if (log.notes) output += `  - Notes: ${log.notes}\n`;
        });

        output += `\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
      });
    } else {
      output += `\n\n**Progress Logs:** No progress logs recorded for the focus units or their prerequisites.\n`;
    }

    return output;
  }

  return {
    unitsOnly: compileUnitsOnly(),
    unitsWithContext: compileUnitsWithContext(),
    unitsWithContextAndProgress: compileUnitsWithContextAndProgress()
  };
}

// ─── PROGRESS COMPILATION ─────────────────────────────────────────────────────────
/**
 * Compiles progress logs into readable natural language format.
 */
function compileProgress(domain, unitIds, userId) {
  const progressFile = pathsFor(userId).progressFile(domain);
  if (!fs.existsSync(progressFile)) {
    return `No progress logs found for domain: ${domain}`;
  }

  const progressData = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
  const ids = Array.isArray(unitIds) ? unitIds : null;

  // Flatten progress into a map
  const progressMap = {};
  progressData.tree.forEach(bt => {
    bt.clusters.forEach(cl => {
      cl.units.forEach(u => {
        if (u.logs && u.logs.length > 0) {
          progressMap[u.id] = u.logs;
        }
      });
    });
  });

  // Filter to relevant units if specified
  const targetIds = ids || Object.keys(progressMap).map(Number);
  const relevantProgress = {};
  targetIds.forEach(id => {
    if (progressMap[id]) {
      relevantProgress[id] = progressMap[id];
    }
  });

  if (Object.keys(relevantProgress).length === 0) {
    return 'No progress logs recorded for the selected units.';
  }

  const sections = Object.entries(relevantProgress).map(([unitId, logs]) => {
    const logEntries = logs.map((log, i) => {
      const date = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown date';
      let entry = `  **Entry ${i + 1}** (${date}):\n`;
      if (log.dv !== undefined) entry += `  - Difficulty Value: ${log.dv}\n`;
      if (log.bm !== undefined) entry += `  - Band Multiplier: ${log.bm}\n`;
      if (log.xpGain !== undefined) entry += `  - XP Gained: ${log.xpGain}\n`;
      if (log.notes) entry += `  - Notes: ${log.notes}\n`;
      return entry;
    }).join('\n');

    return `**Unit #${unitId}** (${logs.length} log${logs.length > 1 ? 's' : ''}):\n\n${logEntries}`;
  });

  return `**Progress Logs:**\n\n${sections.join('\n---\n\n')}`;
}

// ─── QUESTIONS & ANSWERS COMPILATION ──────────────────────────────────────────────
/**
 * Compiles teaching log entries into Q&A format.
 */
function compileQuestionsAnswers(entries) {
  if (!entries || entries.length === 0) {
    return { questions: 'No questions provided.', answers: 'No answers provided.' };
  }

  const questions = entries.map((entry, i) => {
    return `**Question ${i + 1}:** ${entry.question || 'Not provided'}`;
  }).join('\n\n');

  const answers = entries.map((entry, i) => {
    return `**Answer ${i + 1}:** ${entry.studentAnswer || entry.answer || 'Not provided'}`;
  }).join('\n\n');

  return { questions, answers };
}

// ─── SUMMARY COMPILATION ──────────────────────────────────────────────────────────
/**
 * Generates a dynamic summary from the domain's units data.
 * Falls back to summary.md if available.
 */
function compileSummary(domain, userId) {
  // If domain is provided, generate dynamic summary from units
  if (domain) {
    const unitsFile = pathsFor(userId).unitsFile(domain);
    if (fs.existsSync(unitsFile)) {
      const unitsData = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
      return generateDynamicSummary(unitsData);
    }
  }

  // Fallback to static summary.md
  const summaryFile = path.join(PROMPTS_DIR, 'summary.md');
  if (!fs.existsSync(summaryFile)) {
    return 'No summary available.';
  }
  return fs.readFileSync(summaryFile, 'utf8');
}

/**
 * Generates a structured summary from units data.
 */
function generateDynamicSummary(unitsData) {
  const includedContent = [];
  const excludedContent = [];
  const foundationalUnits = [];
  const contentUnits = [];

  // Parse the tree to collect content
  unitsData.tree.forEach(btNode => {
    const btName = unitsData.meta.bt[btNode.bt];
    let btIncluded = [];
    let btExcluded = [];

    btNode.clusters.forEach(clNode => {
      const clName = unitsData.meta.cl[clNode.cl];

      clNode.units.forEach(u => {
        const notes = u.nt || '';
        const name = u.n;

        if (u.t === 'f') {
          foundationalUnits.push(name);
        } else {
          contentUnits.push(name);
        }

        // Extract included topics from notes (before "excludes")
        const excludesMatch = notes.match(/^(.+?)(?:;\s*excludes\s+)/i);
        if (excludesMatch) {
          btIncluded.push(excludesMatch[1].trim());
        } else if (notes) {
          btIncluded.push(notes);
        }

        // Extract excluded topics
        const excludedMatch = notes.match(/;\s*excludes\s+(.+)$/i);
        if (excludedMatch) {
          btExcluded.push(excludedMatch[1].trim());
        }
      });
    });

    if (btIncluded.length > 0) {
      includedContent.push(`**${btName}**: ${btIncluded.slice(0, 3).join('. ')}`);
    }
    if (btExcluded.length > 0) {
      excludedContent.push(`**${btName}**: ${btExcluded.slice(0, 3).join(', ')}`);
    }
  });

  let output = '# Course Scope Summary\n\n';

  if (includedContent.length > 0) {
    output += '## ✅ Included Content\n';
    includedContent.forEach(item => {
      output += `- ${item}\n`;
    });
    output += '\n';
  }

  if (excludedContent.length > 0) {
    output += '## ❌ Excluded Content\n';
    excludedContent.forEach(item => {
      output += `- ${item}\n`;
    });
    output += '\n';
  }

  if (foundationalUnits.length > 0) {
    output += '## 🔑 Foundational Units\n';
    foundationalUnits.forEach(name => {
      output += `- ${name}\n`;
    });
    output += '\n';
  }

  if (contentUnits.length > 0) {
    output += '## 📚 Content Units\n';
    contentUnits.forEach(name => {
      output += `- ${name}\n`;
    });
  }

  return output;
}

// ─── MAIN COMPILER ────────────────────────────────────────────────────────────────
/**
 * Compiles a prompt template by resolving all placeholders.
 * 
 * @param {string} template - The raw prompt template with placeholders
 * @param {object} context - Compilation context
 * @param {string} context.domain - Domain name
 * @param {number[]|number} context.unitIds - Unit IDs to include
 * @param {object[]} context.entries - Teaching log entries (for teaching mode)
 * @returns {string} Compiled prompt
 */
function compilePrompt(template, context = {}) {
  const { domain, unitIds, entries, userId } = context;
  let result = template;

  // Compile UNITS, UNITS+CONTEXT, and UNITS+CONTEXT+PROGRESS
  if (result.includes('{{UNITS+CONTEXT+PROGRESS}}') || result.includes('{{UNITS+CONTEXT}}') || result.includes('{{UNITS}}')) {
    const { unitsOnly, unitsWithContext, unitsWithContextAndProgress } = domain && unitIds
      ? compileUnits(domain, unitIds, userId)
      : { unitsOnly: 'No units specified.', unitsWithContext: 'No units specified.', unitsWithContextAndProgress: 'No units specified.' };
    result = result.replace(/{{UNITS\+CONTEXT\+PROGRESS}}/g, unitsWithContextAndProgress);
    result = result.replace(/{{UNITS\+CONTEXT}}/g, unitsWithContext);
    result = result.replace(/{{UNITS}}/g, unitsOnly);
  }

  // Compile PROGRESS
  if (result.includes('{{PROGRESS}}')) {
    const progressText = domain ? compileProgress(domain, unitIds, userId) : 'No progress data available.';
    result = result.replace(/{{PROGRESS}}/g, progressText);
  }

  // Compile QUESTIONS & ANSWERS (teaching mode)
  if (result.includes('{{QUESTIONS}}') || result.includes('{{ANSWERS}}')) {
    const { questions, answers } = compileQuestionsAnswers(entries || []);
    result = result.replace(/{{QUESTIONS}}/g, questions);
    result = result.replace(/{{ANSWERS}}/g, answers);
  }

  // Compile SUMMARY
  if (result.includes('{{SUMMARY}}')) {
    const summaryText = compileSummary(domain, userId);
    result = result.replace(/{{SUMMARY}}/g, summaryText);
  }

  // Compile TEACHING_FORMAT
  if (result.includes('{{TEACHING_FORMAT}}')) {
    const fmtPath = path.join(__dirname, 'teaching-format.md');
    const fmtText = fs.existsSync(fmtPath) ? fs.readFileSync(fmtPath, 'utf8') : '';
    result = result.replace(/{{TEACHING_FORMAT}}/g, fmtText);
  }

  return result;
}

module.exports = {
  compilePrompt,
  compileUnits,
  compileProgress,
  compileQuestionsAnswers,
  compileSummary
};
