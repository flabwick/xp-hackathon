
{{UNITS}}

Test me on the given units of content with 6 questions. Test slightly above my current level of knowledge. Do not label questions with units or difficulty. Questions may multiple units all at different levels or connect them. Include 3 questions that target weaknesses (practice questions) and 3 questions on stuff I haven't covered at all (expand questions). Use the progress notes to determine this:


{{PROGRESS}}
Once I give my answers, mark them and compare with an example answer which would have got full marks. Then finally respond with 2 sets of json "injections". Each should be returned as copiable code blocks.


## XP INJECTION: 
One json file. For every demonstrated skill. Not necessarily one injection for every question, questions may have several skills demonstrated at different performance and levels of difficulty.


For example:
```
[
  {
    "unitId": 0,
    "difficultyScore": 65,
    "performanceRatio": 0.82,
    "notes": "Struggled with chain rule application but correctly identified outer/inner functions."
  },
  {
    "unitId": 3,
    "difficultyScore": 40,
    "performanceRatio": 0.95,
    "notes": "Solid grasp of fundamental derivatives. Ready for composite functions."
  }
]
```

**Field Constraints**

| Key                | Type     | Range         | Notes                                    |
| ------------------ | -------- | ------------- | ---------------------------------------- |
| `unitId`           | `int`    | `0..N-1`      | Implicit depth-first ID from domain JSON |
| `difficultyScore`  | `float`  | `20 – 100`    | 20 = recall, 100 = novel synthesis       |
| `performanceRatio` | `float`  | `0.0 – 1.0`   | 0.0 = blank/irrelevant, 1.0 = flawless   |
| `notes`            | `string` | `≤ 500 chars` | Verbatim append to unit's `progressLogs` |

The notes field is a handoff note from the current session to the next. It notes what was covered, what wasn't covered and where the friction was.

Notes how the student thought, flow, confidence and errors. Notes how they handled connections to other units.

Avoids loading it with redundant information. Writes in isolation, DOES NOT note what to do in the next session.

## Teaching Injection

Determine which which units need teaching and consider how you might group them into lessons. Then create a json file injection for each one. Avoid making heaps of them unnecessarily, group by relevance.

**Format:** Flat JSON object. Paste directly into the Teaching textarea.
```json
{
  "question": "Derive the electric field of a uniformly charged infinite plane using Gauss's Law.",
  "studentAnswer": "Used cylindrical pillbox. Flux = 2EA = Q/ε₀ → E = σ/(2ε₀). Correct symmetry identification.",
  "relevantUnits": [3, 7]
}
```
**Field Constraints**

| Key             | Type     | Notes                                                                                       |
| --------------- | -------- | ------------------------------------------------------------------------------------------- |
| `question`      | `string` | Original prompt or exercise                                                                 |
| `studentAnswer` | `string` | Raw response, not adjusted                                                                  |
| `relevantUnits` | `int[]`  | Array of `unitId`s. Links/context auto-resolved from domain JSON during markdown generation |

## Criteria for Difficulty Score and Performance.

**Difficulty Score:** `20` (Basic) → `100` (Hardest)

Difficulty is not to be mistaken with obscure and trick-laden questions. Higher order thinking is rewarded, not obscure knowlege.

| Score Range  | Tier Name                       | Cognitive Load & Structure                                                                                      | Linkage & Dependencies                                                                                              | Context & Framing                                                                                                     | Consistency Anchor                                                                                                      |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **20 – 35**  | **Recall & Direct Application** | **Low Load.** Single concept. 1–2 linear steps. No branching logic.                                             | **None.** Isolated unit or explicit formula application. No hidden pre-reqs.                                        | **Standard.** Familiar phrasing. Direct mapping to textbook examples.                                                 | _A student who just reviewed the unit can solve this immediately without hesitation._                                   |
| **36 – 55**  | **Procedural Fluency**          | **Moderate Load.** Single concept + 1 supporting mechanism. 2–4 sequential steps. Minor decision points.        | **Soft Pre-reqs.** Requires recalling a related fact or minor transformation. No hard blocking dependencies.        | **Varied.** Standard concept applied to a slightly novel scenario. One mild distractor.                               | _Errors arise from skipped steps or notation slips, not conceptual misunderstanding._                                   |
| **56 – 75**  | **Integrative Navigation**      | **High Load.** 2+ interacting concepts. 3–5 steps with branching logic. Requires prioritizing constraints.      | **Hard Pre-reqs.** Must activate a foundational unit before solving the target. Failure to link causes total block. | **Novel Framing.** Requires translating between representations (e.g., graph ↔ equation). Ambiguity in method choice. | _Correct answer depends on identifying the right dependency chain. Common failure is using right steps in wrong order._ |
| **76 – 100** | **Synthesis & Adaptation**      | **Max Load.** Multi-unit network. Open-ended structure. Student must define the path. Meta-constraints present. | **Conjunctions.** Forces parallel processing of linked units. Requires bridging distinct broad topics.              | **Unfamiliar/Abstract.** Cross-context application. Hidden assumptions. Requires justifying method trade-offs.        | _Distinguishes mastery from fluency. Requires self-correction and handling of edge cases or conflicting constraints._   |

**Performance Ratio:** `0.0` (Blank/Irrelevant) → `1.0` (Flawless)

Defines reasoning fidelity and integration of ideas, not just correctness.

|Ratio Range|Tier Name|Accuracy & Completeness|Reasoning Flow & Coherence|Constraint Handling|Metacognition & Transfer|Consistency Anchor|
|---|---|---|---|---|---|---|
|**0.0 – 0.15**|**Inactive / Misaligned**|Blank, irrelevant, or fundamentally incorrect.|Disconnected fragments. Guessing. No logical chain.|Ignored or misunderstood.|None.|_Schema not activated. Indicates a need for foundational review._|
|**0.16 – 0.35**|**Fragmented / Mechanical**|Partially correct or coincidentally right answer.|Recognizes first step/formula but breaks down mid-process. Rigid template following.|Acknowledged but inconsistently applied. Errors in execution.|Cannot explain why a step failed. No awareness of alternatives.|_Procedural familiarity exists, but conceptual control is missing. Recoverable with a hint._|
|**0.36 – 0.60**|**Fluent / Stable**|Correct answer.|Logical sequence. Clear cause-effect. Minor notation or efficiency gaps.|Applied correctly. Standard path followed.|Can retrace steps. Struggles if conditions change slightly.|_Reliable execution under familiar conditions. Ready for linkage stress._|
|**0.61 – 0.85**|**Strategic / Integrated**|Correct + explicit justification.|Chooses optimal path among alternatives. Anticipates edge cases.|Actively managed. Trade-offs explained. Constraints used to guide method.|Explains _why_ the method fits. Notes limitations. Connects to related units.|_Demonstrates schema integration. Errors would only come from novel, untrained constraints._|
|**0.86 – 1.00**|**Adaptive / Masterful**|Correct + generalizes beyond prompt.|Self-corrects mid-process. Reframes if initial approach fails. Elegant, high-order patterns.|Turns constraints into advantages. Identifies hidden assumptions.|Articulates underlying principles. Proposes extensions. Maps to broader domain.|_Operates at the conceptual level. Solution reveals structural understanding and transfer capacity._|

