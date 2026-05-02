# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start server (nodemon) + Tailwind watcher concurrently, port 6969
npm start          # Start production server
npm run build:css  # One-shot Tailwind build (minified) → public/style.css
```

No test or lint tooling is configured.

## CSS / Styling

Tailwind CSS v4 is used for all styling. Source is `src/input.css`, output is `public/style.css` (committed). Custom neobrutalism design tokens are defined in `tailwind.config.js`:

- `shadow-brutal` / `shadow-brutal-lg` / `shadow-brutal-sm` — hard black drop shadows
- Font: Space Grotesk (sans), Space Mono (mono)

When writing UI, use Tailwind utility classes directly in HTML. Do not write custom CSS unless a utility class genuinely cannot cover the case.

## AI Provider

All AI inference must go through a **provider-agnostic interface** so the underlying model can be swapped without touching call sites. The default provider is **Google Gemini** (free tier, no API cost). Other providers (OpenAI-compatible, Ollama, etc.) must be drop-in replaceable by changing config only.

Implement a thin adapter layer (e.g. `aiClient.js`) that exposes a single `generate(prompt, options)` function. Each provider is a separate adapter that implements this interface. Never call a provider SDK directly from `server.js` or other modules.

Do **not** use the Anthropic/Claude API.

## Hosting

Target host is **Railway** (not Vercel). Vercel is ruled out because:
- The filesystem-based data layer (`fs.writeFileSync` to `data/`) requires persistent disk, which Vercel serverless functions don't provide
- Tesseract.js OCR exceeds Vercel's 10s/60s function timeout limits

The Express server runs as a long-lived process on Railway with no architecture changes needed.

## UI Design

All UI must follow **neobrutalism**: bold black borders, flat solid colors, hard drop shadows (no blur), raw sans-serif typography, and high contrast. No gradients, rounded corners, or soft shadows.

## Python tooling

`scripts/Seperate_By_Chapter_Final.py` — splits a PDF into per-chapter `.txt` files. Used by `POST /api/courses/:courseId/upload-textbook`.

One-time setup:
```bash
pip install -r requirements.txt   # pypdf, pdfplumber
```

`python3` must be on PATH for the Node server to invoke it.

## Architecture

This is a Node.js/Express backend for an adaptive learning system that tracks student mastery through XP progression across mathematical units. There is no frontend beyond a static mapping page.

### Core Modules

**`server.js`** — Express REST API on port 6969. All data is stored as JSON files on the filesystem (synchronous reads/writes with automatic timestamped backups before each write).

**`promptCompiler.js`** — Template engine that resolves `{{PLACEHOLDER}}` tokens in prompt markdown files into contextual content. Placeholders include `{{UNITS}}`, `{{UNITS+CONTEXT}}`, `{{UNITS+CONTEXT+PROGRESS}}`, `{{PROGRESS}}`, `{{QUESTIONS}}`, `{{ANSWERS}}`, and `{{SUMMARY}}`. Context expansion recursively walks prerequisite chains from the unit tree.

**`prompts/*.md`** — Prompt templates for study, test, teaching, and summary modes. These are compiled server-side with unit/progress context before being sent to an AI tutor.

### Data Layout

```
data/
  units/<domain>.json        # Curriculum definition (unit tree + metadata)
  progress/<domain>.json     # Current XP state (mirrors unit tree, adds logs[])
  progress/<domain>-history.json  # Per-session injection history
  deadlines/<domain>.json    # Deadline config
  backups/<domain>/          # Timestamped backups created on every write
```

**Units JSON shape** — `meta.bt[]` (behavior taxonomies) and `meta.cl[]` (clusters/topics) are index arrays. Each unit has: `id`, `n` (name), `t` (`"f"` foundational or `"c"` content), `nt` (scope notes), `l` (prerequisite links as `[targetId, linkType]` where `"h"`=hard, `"s"`=soft).

**Progress JSON shape** — Mirrors the unit tree; each unit carries a `logs[]` array of entries `{ timestamp, dv, bm, xpGain, notes, sessionId }`.

### XP System

- **Bands I–V** with cumulative thresholds: 0 / 150 / 600 / 1500 / 2400 XP
- **XP formula**: `base_xp_for_band × bm (band multiplier) × 0.3 (if foundational unit)`
- **Difficulty score (dv)**: 20–100 (20–35 recall, 36–55 procedural, 56–75 integrative, 76–100 synthesis)
- **Performance ratio (bm)**: 0.0–1.0 (0.0–0.15 inactive, 0.16–0.35 fragmented, 0.36–0.60 fluent, 0.61–0.85 strategic, 0.86–1.0 adaptive)
- Sessions can be undone atomically via `DELETE /api/xp/:sessionId`

### Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/domains` | List domains |
| GET | `/api/units/:domain` | Full unit tree |
| GET/POST | `/api/progress/:domain` | Read or write progress logs |
| GET | `/api/prompt/:type` | Raw prompt template |
| POST | `/api/prompt/:type/compile` | Compile prompt with context |
| GET | `/api/xp` | Computed XP state |
| POST | `/api/xp` | Inject XP session (bulk) |
| DELETE | `/api/xp/:sessionId` | Undo session |
| GET | `/api/courses` | List courses (id, name, domain, chaptersDir) |
| POST | `/api/courses/:courseId/upload-textbook` | Upload PDF → run splitter → populate `data/courses/<id>/chapters/` |

### Utility Scripts

- **`simplify_xp.js`** — Generates a simplified XP mapping from a units file; run once to bootstrap a new domain.
- **`update_detailed_xp.js`** — Initialises detailed per-unit XP structure; run once per domain setup.
