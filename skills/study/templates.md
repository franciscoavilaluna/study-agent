# File formats

## `<topic>/plan.md`

```markdown
# Plan: Fourier series
Goal: compute and interpret trigonometric Fourier coefficients
Progress: 2/6 nodes (33%)

| id | concept | needs | status |
|----|---------|-------|--------|
| N1 | Periodic signals | - | done |
| N2 | Orthogonality of sines and cosines | N1 | done |
| N3 | Coefficient formulas | N2 | learning |
| N4 | Even and odd symmetry | N3 | todo |
| N5 | Convergence at jumps | N3 | todo |
| N6 | Polar (magnitude and phase) form | N3 | todo |
```

Status is one of `todo`, `learning`, `done`. Progress is done nodes divided by total nodes. Only the mastery gate in SKILL.md may set `done`.

## `learner/events.jsonl`

One JSON object per line, appended. Keep `detail` short, with no double quotes and no newlines.

```json
{"t":"2026-10-18T14:02:11-06:00","topic":"fourier","node":"N3","kind":"quiz","result":"wrong","detail":"picked a_0 = integral without 1/T"}
```

- `kind`: `quiz`, `exercise`, `question` (something I asked), `misconception`, `approach` (a teaching move and how it went).
- `result`: `correct`, `wrong`, `dont_know`, `partial`, or `n/a`.
- Timestamp from `date -Iseconds`.
- Append with: `printf '%s\n' '<json line>' >> learner/events.jsonl`

## `learner/profile.md`

```markdown
# Learner profile
Updated: 2026-10-18

## Strong points
- ...

## Weak points and recurring mistakes
- ... (seen 3 times: N3, N4, N4)

## Misconceptions
- N3: believes the 1/T factor belongs only to a_0

## What works
- ...

## What doesn't
- ...

## Pace and energy
- ...
```

Every line must be supported by events. Mark single observations with `(once)`.

## `<topic>/exercises/<concept-slug>.md`

````markdown
---
topic: Fourier series
concept: Coefficient formulas
status: open
---

## Exercise 1

```typst
#exercise(1, level: 1)[
  Compute $a_0$ for $x(t) = 1$ on $[0, T]$.
]
```

**My answer:**


**Feedback:**

## Exercise 2

```typst
#exercise(2, level: 2)[
  ...
]
```

**My answer:**


**Feedback:**
````

`status`: `open` (waiting for me), `submitted` (I said done), `graded`. Write math in Typst only.
