# Prompt System

This document explains how the prompt compilation system works and how to use it when building AI-powered features.

## Overview

Prompt templates live in `prompts/*.md`. They contain `{{PLACEHOLDER}}` tokens that get replaced with real unit/progress data before being sent to the AI. The compiler (`promptCompiler.js`) handles this resolution.

You never call `promptCompiler.js` directly from the frontend — you call the API endpoint, which does it server-side.

---

## API Endpoint

### `POST /api/prompt/:type/compile`

Compiles a prompt template with the given units and returns the full prompt string ready to send to the AI.

**`:type`** — one of: `study`, `test`, `teaching`, `summary`

**Request body:**
```json
{
  "domain": "optimization",
  "unitIds": [3, 7, 12],
  "entries": []
}
```

- `domain` — the domain name (matches a file in `data/units/`)
- `unitIds` — array of unit IDs selected by the user
- `entries` — only required for `teaching` mode (see below)

**Response:** plain text string (the compiled prompt)

---

## Placeholders

| Placeholder | What it expands to |
|---|---|
| `{{UNITS}}` | The selected units only — name, type, location, scope notes |
| `{{UNITS+CONTEXT}}` | Selected units + their full prerequisite chains, grouped by depth |
| `{{UNITS+CONTEXT+PROGRESS}}` | Same as above, plus the student's historical progress logs per unit |
| `{{PROGRESS}}` | Progress logs for the selected units only (no unit descriptions) |
| `{{QUESTIONS}}` | Teaching entries formatted as questions |
| `{{ANSWERS}}` | Teaching entries formatted as student answers |
| `{{SUMMARY}}` | Static course scope summary from `prompts/summary.md` |

---

## Prompt Templates

### `study` — 6-question practice session
Uses `{{UNITS}}` and `{{PROGRESS}}`. Asks the AI to generate 6 questions (3 targeting weaknesses from progress, 3 on uncovered material). After the student answers, the AI marks them and returns XP injection JSON + teaching injection JSON.

### `test` — 10-question exam
Uses `{{UNITS}}`. Generates 10 questions increasing in difficulty, no unit labels. After answers, returns XP injection JSON + teaching injection JSON.

### `teaching` — tutoring session
Uses `{{UNITS+CONTEXT}}`, `{{QUESTIONS}}`, and `{{ANSWERS}}`. Takes a set of question/answer pairs and compiles them into a structured tutoring prompt so the AI can diagnose gaps and teach.

### `summary` — course scope overview
Uses `{{SUMMARY}}`. Returns a static overview of what's in and out of scope for the domain. No unit selection needed.

---

## AI Response Format

After sending a compiled prompt to the AI (via `aiClient.generate()`), the AI returns two JSON blocks:

### 1. XP Injection
One entry per demonstrated skill (not per question — a single question may cover multiple units).

```json
[
  {
    "unitId": 3,
    "difficultyScore": 65,
    "performanceRatio": 0.82,
    "notes": "Identified outer/inner functions correctly. Struggled with chain rule application."
  }
]
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `unitId` | int | 0..N-1 | Unit ID from domain JSON |
| `difficultyScore` | float | 20–100 | 20 = recall, 100 = novel synthesis |
| `performanceRatio` | float | 0.0–1.0 | 0.0 = blank/irrelevant, 1.0 = flawless |
| `notes` | string | ≤500 chars | Handoff note for next session — what was covered, where friction was. Does NOT prescribe next steps. |

Post this to `POST /api/xp` to record it:
```json
{ "domain": "optimization", "injections": [...] }
```

### 2. Teaching Injection
One entry per topic cluster that needs teaching (group related units, don't make one per question).

```json
{
  "question": "Derive the electric field of a uniformly charged infinite plane.",
  "studentAnswer": "Used cylindrical pillbox. Flux = 2EA = Q/ε₀ → E = σ/(2ε₀).",
  "relevantUnits": [3, 7]
}
```

Post this array to `POST /api/prompt/teaching/compile` with the relevant `unitIds` to get a compiled teaching prompt.

---

## Difficulty & Performance Reference

**Difficulty Score (20–100):**
| Range | Tier | Description |
|---|---|---|
| 20–35 | Recall | Single concept, 1–2 steps, no branching |
| 36–55 | Procedural | 2–4 steps, minor decision points |
| 56–75 | Integrative | 2+ concepts, branching, hard prereqs required |
| 76–100 | Synthesis | Multi-unit, open-ended, meta-constraints |

**Performance Ratio (0.0–1.0):**
| Range | Tier | Description |
|---|---|---|
| 0.0–0.15 | Inactive | Blank or irrelevant |
| 0.16–0.35 | Fragmented | Partially correct, no conceptual control |
| 0.36–0.60 | Fluent | Correct, minor gaps |
| 0.61–0.85 | Strategic | Correct + justified, anticipates edge cases |
| 0.86–1.00 | Masterful | Generalises, self-corrects, structural understanding |

---

## Example: Generating a Test (issues #3 + #4)

```js
// 1. Compile the prompt
const res = await fetch('/api/prompt/test/compile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ domain: 'optimization', unitIds: [3, 7, 12] })
});
const prompt = await res.text();

// 2. Send to AI
const { generate } = require('./aiClient');
const aiResponse = await generate(prompt);

// 3. Parse questions from aiResponse, display to user
// 4. After user submits answers, send back to AI for marking
// 5. Parse XP injection JSON from marking response
// 6. POST to /api/xp to record XP
```
