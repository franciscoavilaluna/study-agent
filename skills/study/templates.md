# File formats

Everything below is written **relative to the folder where pi was launched**. The names of the topic files are up to you; keep the two layers of `learner/` separate.

```
learner/profile.md              general layer: how I learn, no subject content
learner/topics/<topic>.md       topic layer: one file per subject
learner/events.jsonl            raw append-only log
<topic>/plan.md                 the node plan with status
<topic>/exercises/<concept>.md  exercises for one concept
```

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

- `topic`: the subject slug, matching `learner/topics/<topic>.md`. Use `"*"` for learner-level events that belong to no subject (a change of teaching approach, a claim promoted to the profile).
- `node`: the node id, or `"-"` for events that are not about a node.
- `kind`: `quiz`, `exercise`, `question` (something I asked), `misconception`, `approach` (a teaching move and how it went), `exam` (a real assessment: duration, self-assessment, items I doubted).
- `result`: `correct`, `wrong`, `dont_know`, `partial`, or `n/a`.
- Timestamp from `date -Iseconds`.
- Append with: `printf '%s\n' '<json line>' >> learner/events.jsonl`

## `learner/profile.md` — the general layer

```markdown
# Learner profile — general
Updated: 2026-10-19 · applies to every subject

> Topic-agnostic: how I learn, how to diagnose me, how to write questions,
> energy. Anything specific to one subject lives in `learner/topics/<topic>.md`.
>
> Evidence bar: no mark = repeated across sessions or subjects · `(once)` = seen
> once · `[1 topic]` = evidence from a single subject, assumed to transfer but
> unproven.

## How to teach me

- Rules that override the rest, in one line each.

## When I say "I don't know"

| cause | how it looks | fix |
|---|---|---|
| procedure | ... | ... |
| confidence | ... | ... |
| vocabulary | ... | ... |
| last link | ... | ... |

Which one dominates, and the question that identifies it.

## The pattern behind my mistakes

- The one or two sentences that explain most of my failures. If I have a
  standing check that keeps saving me, it goes here, phrased for any subject.

## Strong points

- ...

## Weak points and recurring mistakes

- ... (seen 3 times: <topic> N3, N4)

## Misconceptions

- ...

## What works

- ...

## What doesn't

- ...

## Pace and energy

- Session length that holds, when it breaks down and how it announces itself,
  time of day, how fast I answer with a card in front of me.

## Topic index

| topic | dossier | plan | weakness registry | status |
|---|---|---|---|---|
| | `learner/topics/` | | | |
```

Every line must be supported by events. Mark single observations with `(once)` and single-subject evidence with `[1 topic]`.

## `learner/topics/<topic>.md` — the topic layer

```markdown
# Topic: <name>

**Dossier for one subject.** The general layer lives in `learner/profile.md`;
this file holds only what does not transfer: nodes, gaps, cards, vocabulary and
the wrong answers I produce *in this subject*.

- Plan: `<topic>/plan.md`
- Weakness registry: `weaknesses/<topic>.md` (or wherever the project keeps it)
- Exam / deadline: ...

## Node map

| id | concept | status |
|----|---------|--------|

## Open gaps, in order of risk

1. **<what fails>** — the trigger that sets it off, the wrong answer I produce,
   and the card or check that fixes it.
2. ...

## Cards that worked in this subject

One row per card, phrased so it can be pasted in front of me again.

| when I see | I apply |
|---|---|
| | |

## Error fingerprints

Only for subjects with a computable answer. If my wrong value is recognisable,
map it: seeing the output tells you the belief without asking me.

| if this value appears | the error is |
|---|---|
| | |

## Vocabulary that was the real cause

Names, symbols and standard objects I did not recognise, and what unlocked them.
A missing name blocks exactly like a missing step.

## How progress is measured here

The mastery gate applied to this subject, plus anything specific: the shape of
the exam, whether practice over- or under-estimates it, which items were left
open at the end.
```

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
