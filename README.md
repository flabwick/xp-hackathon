# StudyXP

**Adaptive XP-based learning that turns any PDF textbook into a personalised mastery curriculum.**

StudyXP treats studying like a long-form RPG. Every concept is a unit, every test session injects experience points, and the system continuously rebalances what you should learn next based on what you have actually mastered. You can upload your own textbooks, generate fresh question sets on demand, and watch your progress climb through five competency bands.

The hosted demo is bring-your-own-key: you supply a free Groq API key and an optional OpenAI key, and the platform never touches a server-side credential.

---

## Table of Contents

- [StudyXP](#studyxp)
  - [Table of Contents](#table-of-contents)
  - [The Story](#the-story)
  - [What StudyXP Does](#what-studyxp-does)
  - [The XP System](#the-xp-system)
    - [Bands](#bands)
    - [Scoring inputs](#scoring-inputs)
    - [XP formula](#xp-formula)
    - [Atomic undo](#atomic-undo)
  - [Add Your Own Course](#add-your-own-course)
  - [Bring Your Own Key](#bring-your-own-key)
  - [Architecture](#architecture)
    - [Core modules](#core-modules)
    - [Data layer](#data-layer)
    - [Prompt templates](#prompt-templates)
  - [Tech Stack](#tech-stack)
  - [Local Development](#local-development)
    - [Prerequisites](#prerequisites)
    - [Setup](#setup)
    - [Running](#running)
  - [Project Structure](#project-structure)
  - [API Reference](#api-reference)
    - [Configuration](#configuration)
    - [Domains and units](#domains-and-units)
    - [Progress and XP](#progress-and-xp)
    - [AI flows](#ai-flows)
  - [Deployment](#deployment)
  - [Roadmap](#roadmap)
  - [Creators](#creators)
  - [License](#license)
  - [Acknowledgements](#acknowledgements)

---

## The Story

StudyXP began as a 24-hour entry to the **ANU AI Buildathon**. The original brief was to ship something that could measurably help a student learn faster. We sketched the smallest interesting version: a curriculum graph, a numerical mastery score per node, and an AI tutor that always knows where you are in the graph.

By the end of the hackathon we had a working prototype across four real subjects (basic algebra, optimisation, ancient Roman history, and AI vibe coding) with full test generation, automatic XP calculation, and a chat-based teaching mode. Friends asked to use it. They asked if it could ingest their own PDFs. They asked for a public link.

So we kept building. The version in this repository is the result: a polished, deployable, multi-tenant ready product that anyone can self-host or use through our public Railway deployment with their own API key. It is no longer a hackathon prototype. It is a small piece of production-grade educational software that we are releasing for anyone curious enough to try it.

---

## What StudyXP Does

StudyXP organises any subject into a hierarchical curriculum tree of broad topics, clusters, and individual units. Each unit has a name, scope notes, and a list of prerequisites. As you study, you accumulate XP per unit, and your XP determines which competency band you have reached.

Three primary modes drive every session:

| Mode | Purpose | What it produces |
| :--- | :--- | :--- |
| **Test** | Probe your current understanding of selected units | Ten AI-generated questions calibrated to your XP, then automatic marking with per-question feedback and an XP injection that updates your progress file |
| **Teach** | Conversational tutoring on the same units | A streaming chat session where the AI tutor has full context of which units you have selected and how much XP you carry on each |
| **Study** | Self-directed exploration | A compiled study prompt that includes unit definitions, prerequisite context, and your current progress, copyable into any external chat |

The interesting part is what happens between sessions. Every test result is stored as a structured log entry on each affected unit. The system builds up a per-unit history of difficulty scores and performance ratios, and can therefore recommend what to test next, replay a session that went badly, or undo a single test injection without losing the rest of your work.

---

## The XP System

The mastery model is the heart of StudyXP. It is intentionally simple enough to reason about and rich enough to differentiate a memorised answer from a synthesised one.

### Bands

| Band | Cumulative XP threshold | Plain English |
| :--- | :---: | :--- |
| I (Inactive) | 0 | No measurable activity yet |
| II (Fragmented) | 150 | Recognises the topic, struggles to apply it |
| III (Fluent) | 600 | Reliably handles standard procedures |
| IV (Strategic) | 1500 | Selects the right approach without prompting |
| V (Adaptive) | 2400 | Transfers the idea to unfamiliar problems |

### Scoring inputs

Every test result feeds two numbers into the XP formula:

- **Difficulty score (`dv`)**: 20 to 100, scaled across four cognitive tiers (recall, procedural, integrative, synthesis).
- **Performance ratio (`bm`)**: 0.0 to 1.0, mapped to the same five-band vocabulary as the player's current band.

### XP formula

```
xpGain = base_xp_for_band(dv) * bm * (foundational ? 0.3 : 1.0)
```

Foundational units (typically introductory definitions) attract less XP per session than content units, so the system rewards depth over volume.

### Atomic undo

Every XP injection is tagged with a `sessionId`. A single API call (`DELETE /api/xp/:sessionId`) reverses every log entry written by that session across every affected unit. Backups of the previous progress file are written automatically before each mutation, so the data layer is recoverable even if a process crashes mid-write.

---

## Add Your Own Course

The "Add a Course" button on the home page accepts any text-based PDF textbook and produces a brand new curriculum tree in roughly 30 to 60 seconds.

The pipeline:

1. Browser uploads the PDF as multipart form data along with a course name and the user's OpenAI API key.
2. Server reads the bytes into memory (capped at 25 MB) and runs `pdf-parse` to extract the full text.
3. The extracted text (truncated to 200,000 characters to fit comfortably inside `gpt-4o-mini`'s 128k token window) is sent to OpenAI in JSON mode with a structured extraction prompt.
4. The model returns a unit tree in the canonical StudyXP shape: 5 to 8 broad topics, 2 to 4 clusters per topic, 2 to 4 units per cluster, all with sequential ids and prerequisite links.
5. The server validates the shape, slugifies the name, writes `data/units/<slug>.json`, and bootstraps empty progress, history, and deadlines files.
6. The home page refreshes and the new course appears as a regular card, indistinguishable from the four bundled subjects.

The new course is immediately testable, teachable, and trackable through the same flows as everything else.

---

## Bring Your Own Key

StudyXP's hosted instance never charges a single token to its operators. The key resolution rule is enforced in a single module (`byok.js`):

| Environment | Per-request header (user) | `.env` fallback |
| :--- | :---: | :---: |
| Local development | Wins if present | Used otherwise |
| Production (`NODE_ENV=production` or `RAILWAY_ENVIRONMENT` set) | **Required** | **Refused even if set** |

In production the env-var fallback is explicitly disabled at the adapter layer, not just at the UI layer. Even if a server-side `GROQ_API_KEY` is accidentally added to the deployment environment, the adapter will refuse to use it and return HTTP 401 with a friendly message asking the visitor to supply their own key. The client stores user-supplied keys only in `localStorage`, sends them as `X-Groq-Api-Key` and `X-OpenAI-Api-Key` headers, and never persists them server-side.

The TEST button on the home page is disabled until a Groq key is detected, and the API key modal opens automatically on first visit when the server reports no key is available. The result is that a casual visitor cannot accidentally drain the operator's quota, no matter how aggressively they click around.

---

## Architecture

StudyXP is a long-lived Express server backed by a flat-file JSON data layer. There is no database. The choice was deliberate: it makes the entire student state of the system inspectable, diff-able, and version-controllable.

### Core modules

| Module | Responsibility |
| :--- | :--- |
| `server.js` | Express REST API, route handlers, static file serving, multipart upload handling |
| `aiClient.js` | Provider-agnostic facade. Selects the active adapter from `AI_PROVIDER` env var |
| `aiAdapters/groq.js` | Groq SDK wrapper for `generate`, `chat`, `chatStream`. Used for all study and test inference |
| `aiAdapters/openai.js` | OpenAI SDK wrapper. Used by Add Course for PDF-to-curriculum extraction |
| `aiAdapters/gemini.js` | Google Gemini wrapper, kept available for fallback or experimentation |
| `byok.js` | Single source of truth for API key resolution and production-mode detection |
| `addCourse.js` | PDF parsing, OpenAI extraction, slug allocation, file scaffolding |
| `promptCompiler.js` | Template engine that resolves `{{PLACEHOLDER}}` tokens (units, progress, prerequisite chains) into prompt context |
| `testPromptCompile.js` | Specialised compiler for the test-generation flow with built-in retry on validation failure |
| `answers/` | Mobile upload sub-router for handwritten answer OCR via Tesseract.js |
| `routes.js` | HTML page routing for the front-end |

### Data layer

```
data/
  units/<domain>.json              Curriculum definition (topics, clusters, units)
  progress/<domain>.json           Current XP state mirroring the unit tree
  progress/<domain>-history.json   Per-session injection history
  deadlines/<domain>.json          Optional deadline configuration
  backups/<domain>/                Timestamped backups written before every mutation
  courses/<courseId>/chapters/     Per-chapter text files from the PDF splitter
```

### Prompt templates

| File | Used by |
| :--- | :--- |
| `prompts/test.md` | Test question generation |
| `prompts/test-mark.md` | Test answer marking and XP injection calculation |
| `prompts/study.md` | Study mode compilation |
| `prompts/teaching.md` | Teaching mode system prompt |
| `prompts/chat.md` | Streaming chat sessions |
| `prompts/summary.md` | Session summarisation |

Every template is a plain markdown file with `{{TOKEN}}` placeholders. The compiler walks the unit tree, resolves prerequisite chains recursively, attaches the user's progress data, and produces a fully-contextualised prompt before any LLM call is made.

---

## Tech Stack

| Layer | Choice | Why |
| :--- | :--- | :--- |
| Runtime | Node.js 20+ | Modern async, long-running process model fits Railway |
| Server | Express 5 | Mature, minimal, easy to reason about |
| AI (study and test) | Groq (`llama-3.3-70b-versatile`) | Free tier, very fast inference, JSON mode |
| AI (PDF extraction) | OpenAI (`gpt-4o-mini`) | 128k context window comfortably swallows full textbooks, reliable JSON mode |
| PDF parsing | `pdf-parse` v2 | Pure TypeScript, no native dependencies, works on Railway |
| File uploads | `multer` (memory storage) | No temp files, no disk pressure on the host |
| OCR (handwritten answers) | `tesseract.js` | Browser-compatible, no server-side native install required |
| Front-end | Vanilla HTML, CSS, and JavaScript | No build step required for the public site, fast time-to-paint |
| Optional toolchain | Vite, React, Tailwind CSS v4 | For an in-progress richer client |
| Hosting | Railway | Persistent disk for the JSON data layer, no serverless timeout limits for OCR |
| Storage | Filesystem (JSON) | Inspectable, diff-able, version-controllable, zero database overhead |

---

## Local Development

### Prerequisites

- Node.js 20 or newer
- A Groq API key (free at `console.groq.com/keys`)
- An OpenAI API key (only needed if you want to use Add Course locally)

### Setup

```bash
git clone https://github.com/flabwick/xp-hackathon.git
cd xp-hackathon
npm install
cp .env.example .env
# Edit .env and paste your keys
```

The minimal `.env` for local development:

```
AI_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
OPENAI_API_KEY=sk-your_key_here
```

### Running

```bash
npm run dev
```

This starts the Express server on port 6969 with `nodemon` watching for file changes, and Vite alongside it for the optional richer client. Open `http://localhost:6969` in your browser.

To run the production build locally:

```bash
NODE_ENV=production npm start
```

In production mode the env-var key fallback is deliberately disabled, which lets you smoke-test the bring-your-own-key flow exactly as a deployed visitor would experience it.

---

## Project Structure

```
xp-hackathon/
  server.js                  Express entry point
  aiClient.js                Provider-agnostic AI facade
  aiAdapters/                Per-provider adapters (groq, openai, gemini)
  addCourse.js               PDF to curriculum pipeline
  byok.js                    API key resolution and production detection
  promptCompiler.js          Prompt template engine
  testPromptCompile.js       Test-generation orchestrator
  routes.js                  HTML page routing
  answers/                   Mobile answer upload sub-router
  prompts/                   Markdown prompt templates
  public/                    Static front-end (HTML, CSS, JavaScript)
  data/                      JSON data layer (units, progress, deadlines, backups)
  scripts/                   Bootstrap and migration utilities
  Procfile                   Railway process definition
  railway.json               Railway build configuration
  package.json
```

---

## API Reference

### Configuration

| Method | Path | Description |
| :--- | :--- | :--- |
| GET | `/api/config` | Returns `{ appName, provider, production, hasGroqKey, hasOpenAIKey }`. Used by the UI to decide whether to require user-supplied keys |
| GET | `/api/server-info` | Returns local IP and port (used by the mobile upload QR code) |

### Domains and units

| Method | Path | Description |
| :--- | :--- | :--- |
| GET | `/api/domains` | Lists every available course slug |
| GET | `/api/units/:domain` | Returns the full unit tree for a course |
| DELETE | `/api/domains/:domain` | Deletes a course and all its associated files |
| POST | `/api/add-course` | Multipart upload (PDF + courseName). Generates a new course via OpenAI |

### Progress and XP

| Method | Path | Description |
| :--- | :--- | :--- |
| GET | `/api/progress/:domain` | Reads the current progress file |
| POST | `/api/progress/:domain` | Appends a study log to a unit |
| GET | `/api/xp` | Returns computed XP totals and current bands |
| POST | `/api/xp` | Injects an XP session in bulk |
| DELETE | `/api/xp/:sessionId` | Atomically reverses every log entry from a session |
| GET | `/api/deadlines/:domain` | Returns the deadlines configuration for a course |

### AI flows

| Method | Path | Description |
| :--- | :--- | :--- |
| POST | `/api/test/generate` | Generates 10 calibrated test questions |
| POST | `/api/test/mark` | Marks answers and computes XP injections |
| POST | `/api/test/compile-and-generate` | One-shot prompt compile plus generate |
| POST | `/api/teach` | Single-turn AI tutor reply |
| POST | `/api/teach/stream` | Streaming AI tutor (Server-Sent Events) |
| GET | `/api/prompt/:type` | Returns a raw prompt template |
| POST | `/api/prompt/:type/compile` | Returns a fully-compiled prompt with context |

All AI endpoints honour the `X-Groq-Api-Key` request header. The Add Course endpoint honours `X-OpenAI-Api-Key`.

---

## Deployment

StudyXP is built to deploy to Railway with zero configuration. The repository ships with a `Procfile` and `railway.json` that point Railway at `node server.js` and listen on Railway's injected `PORT` environment variable.

To deploy your own instance:

1. Sign in to `railway.app` with GitHub.
2. Create a new project from this repository.
3. Pick the branch you want to deploy (`master` or `deploy-hackathon`).
4. Optionally add a custom domain in Settings, Networking.
5. **Do not** add `GROQ_API_KEY` or `OPENAI_API_KEY` as environment variables. Leaving them blank is what enforces the bring-your-own-key flow for every visitor.

Railway sets `NODE_ENV=production` and `RAILWAY_ENVIRONMENT` automatically, which triggers StudyXP's strict BYOK mode. Visitors will be prompted for a Groq API key on their first visit and the server will refuse all AI calls until they provide one.

---

## Roadmap

The version released today is the public launch milestone. The next features under active discussion:

| Feature | Status |
| :--- | :--- |
| Persistent multi-user accounts (currently single-user per browser) | Designing |
| Cloud sync of progress across devices | Designing |
| Spaced repetition scheduler driven by the unit prerequisite graph | Prototyping |
| Mobile-first companion app for offline study | Idea |
| Public course marketplace (share generated curricula across users) | Idea |
| Voice tutor mode (audio-first teaching sessions) | Idea |
| Self-hostable container image with one-command setup | Planned |

If you have a feature request or have spotted a bug, please open a GitHub issue.

---

## Creators

StudyXP was designed and built by:

- **Yevin**
- **Anubhav**
- **James**
- **Joseph**

Originally produced for the ANU AI Buildathon. Now released as a public project for anyone who wants to learn something new the structured way.

---

## License

Released under the ISC License. Use it, fork it, ship your own version. If you do something interesting with it, we would love to hear about it.

---

## Acknowledgements

Built with Groq, OpenAI, Express, pdf-parse, multer, and a great deal of coffee. The neobrutalist visual language is inspired by the broader brutalist web movement and intentionally rejects the soft-corner, gradient-heavy aesthetic that has saturated educational software for the past decade.
