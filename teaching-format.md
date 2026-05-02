# Teaching Format Guide

AI responses in Teach Mode are written in Markdown with LaTeX math. Follow this guide to produce consistent, correctly-rendered output.

---

## Text Structure

Use `##` for the main heading of a response, `###` for sub-sections. Never use `#` (H1) — it's too large.

```
## What Is Integration?

### The Core Idea
```

Bold key terms with `**double asterisks**`. Use *italics* sparingly for emphasis or definitions.

---

## Lists

Standard Markdown bullets and numbered lists both work.

```
- First point
- Second point
- Third point

1. Step one
2. Step two
3. Step three
```

Do not use manual bullets like `▸` or `•` typed as plain text — use real Markdown lists.

---

## Blockquotes

Use `>` for key insights, memory tips, or warnings. These render with a yellow highlight.

```
> **Key insight:** the derivative equals the slope of the tangent line.
```

---

## Tables

Keep tables to 2–3 columns. Pipe syntax only.

```
| Symbol | Meaning |
|---|---|
| $f'(x)$ | First derivative |
| $f''(x)$ | Second derivative |
```

---

## Inline Math

Wrap in single `$` dollar signs. Write it mid-sentence.

```
The function $f(x) = x^2$ has derivative $f'(x) = 2x$.
```

**Rules:**
- No spaces inside the `$` delimiters: `$x^2$` not `$ x^2 $`
- One `$` on each side — never mismatched

---

## Display Math (block equations)

Wrap in `$$` on its **own paragraph** — blank line before and after. Never inline with surrounding text on the same line.

```
The general power rule is:

$$\frac{d}{dx}[x^n] = nx^{n-1}$$

This works for any real $n$.
```

**Rules:**
- Opening `$$` and closing `$$` must each be on their own line
- Always leave a blank line above the opening `$$` and below the closing `$$`
- Use `\\` (double backslash) for LaTeX commands: `\\frac`, `\\sqrt`, `\\lim`, `\\implies`

---

## Common LaTeX Reference

| What you want | Write |
|---|---|
| Fraction | `\\frac{a}{b}` |
| Square root | `\\sqrt{x}` |
| Limit | `\\lim_{x \\to 0}` |
| Sum | `\\sum_{i=1}^{n}` |
| Integral | `\\int_0^1` |
| Implies | `\\implies` |
| Approx | `\\approx` |
| Times | `\\cdot` or `\\times` |
| Greek alpha | `\\alpha` |
| Infinity | `\\infty` |
| Subscript | `x_{n}` |
| Superscript | `x^{2}` |

---

## What to Avoid

- **Code blocks** (triple backticks) — avoid them; use numbered steps or plain text instead
- **H1 headings** (`# Title`) — too large, use `##` instead
- **Nested lists** — stick to a single level
- **Display math mid-sentence** — always put `$$...$$` on its own paragraph
- **Trailing `\` at end of line** — use a blank line to separate paragraphs instead

---

## Full Example

```markdown
## The Chain Rule

Use the chain rule when differentiating a *composed* function — one function inside another.

### Formula

$$\frac{d}{dx}[f(g(x))] = f'(g(x)) \cdot g'(x)$$

### Worked Example

Differentiate $y = \sin(x^2)$:

1. Identify outer: $\sin(u)$ → derivative $\cos(u)$
2. Identify inner: $x^2$ → derivative $2x$
3. Multiply: $\dfrac{dy}{dx} = \cos(x^2) \cdot 2x$

> **Pattern:** outer-prime evaluated at the inner, times inner-prime.
```
