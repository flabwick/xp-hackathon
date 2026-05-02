# AI Endpoints — API Contract

> **For:** AK (#3, #4) and James (#6)
> **Written by:** Josh
>
> These are the two endpoints I'm building that power the test page. Build your frontend against this contract.

---

## `POST /api/test/generate`

Generates practice questions for the selected units.

**Request:**
```json
{
  "domain": "optimization",
  "unitIds": [3, 7, 12]
}
```

**Response:**
```json
{
  "questions": [
    { "id": 1, "question": "Define a convex set and give a geometric example." },
    { "id": 2, "question": "Prove that the intersection of two convex sets is convex." },
    { "id": 3, "question": "..." }
  ]
}
```

- Always returns 10 questions
- Questions increase in difficulty — do not reorder them
- Store `questions` in state — you'll need to send them back with answers on submit

---

## `POST /api/test/mark`

Submits student answers for marking. Automatically grants XP — no extra call needed.

**Request:**
```json
{
  "domain": "optimization",
  "unitIds": [3, 7, 12],
  "questions": [
    { "id": 1, "question": "Define a convex set and give a geometric example." }
  ],
  "answers": [
    { "id": 1, "answer": "A set where any two points can be connected by a line within the set." }
  ]
}
```

**Response:**
```json
{
  "results": [
    {
      "id": 1,
      "state": "Pass",
      "feedback": "Correct geometric intuition. Did not write convex combination formally.",
      "exampleAnswer": "A set S ⊆ ℝⁿ is convex if for all x, y ∈ S and λ ∈ [0,1], λx + (1−λ)y ∈ S.",
      "unitIds": [3]
    }
  ],
  "xpResult": {
    "success": true,
    "sessionId": "abc123",
    "results": [
      {
        "unitId": 3,
        "delta": 42,
        "oldBand": "I",
        "newBand": "II",
        "bandShifted": true,
        "oldCum": 120,
        "newCum": 162
      }
    ]
  }
}
```

---

## Question Result States

Each result in `results[]` has a `state` field — use this to drive UI colours and labels:

| `state` | Colour | Meaning |
|---|---|---|
| `"Mastered"` | Purple | Full marks + generalised beyond the prompt |
| `"Pass"` | Green | Correct with justification |
| `"Partial"` | Yellow | Correct answer, gaps in reasoning |
| `"Incomplete"` | Orange | Partially correct |
| `"Incorrect"` | Red | Wrong or blank |

---

## XP Result Shape

`xpResult.results[]` is what you feed into the XP modal. Each entry has:

| Field | Type | Notes |
|---|---|---|
| `unitId` | int | Which unit gained XP |
| `delta` | int | XP gained this session |
| `oldBand` / `newBand` | string | `"I"` through `"V"` |
| `bandShifted` | bool | `true` if the student levelled up |
| `oldCum` / `newCum` | int | Cumulative XP before/after |

The existing `showXPModal()` function in `app.js` already accepts this shape — reuse it.

---

## Error Responses

Both endpoints return `{ "error": "..." }` with an appropriate HTTP status on failure. Always check for this before rendering results.

---

## Notes

- You do **not** need to call `POST /api/xp` separately — marking does it automatically
- Hold onto `xpResult.sessionId` if you want to support undo via `DELETE /api/xp/:sessionId`
- Both endpoints may take 3–10 seconds — show a loading state
