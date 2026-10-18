# study-agent

A [pi](https://github.com/earendil-works/pi) setup for **learning by practice**. It is a config package, not a course: it teaches whatever you ask it to, in whatever folder you launch pi from.

Derived from [amosblomqvist/learn](https://github.com/amosblomqvist/learn), extended with Typst exercise files, a learner profile, and Linux support for the visualization tools.

## What's in it

| Path | What it does |
|---|---|
| `skills/study/SKILL.md` | The teaching process: map → plan → teach, with a hard mastery gate |
| `skills/study/templates.md` | Exact formats for `plan.md`, `events.jsonl`, `profile.md`, exercise files |
| `skills/study/typst-rules.md` | LaTeX → Typst cheat sheet (all math is Typst, never LaTeX) |
| `skills/study/study.typ` | Typst preamble: `#exercise`, `#mcq`, `#hint`, `#predict` |
| `extensions/quiz.ts` | Graded multiple-choice with instant ✓/✗ feedback |
| `extensions/ask-user-question.ts` | Popup questions for goals and decisions |
| `extensions/md-log.ts` | Mirrors the session to a `.md` file you read rendered in Obsidian |
| `extensions/visual-tools/` | `write/edit/render_{mermaid,svg}` tools for the visual subagents |
| `agents/researcher.md` | Verifies facts on the web so the teacher can say "I'm not sure" honestly |
| `agents/mermaid-maker.md`, `agents/svg-maker.md` | Draw one diagram, look at the PNG, iterate, publish to `viz/` |

## Install

```bash
# 1. runtime deps for the diagram tools
npm install                          # in this repo
cd extensions/visual-tools && npm install && cd -

# 2. (once) a Chrome for mermaid rendering
cd extensions/visual-tools && node node_modules/puppeteer/install.mjs && cd -
```

Then register the package with pi:

```bash
pi install /home/pacosmosis/.config/study-agent
pi list          # should show study-agent
```

`pi install` writes an entry to `~/.pi/agent/settings.json`, so the skill and extensions load **from every directory you launch pi in**.

> Alternative without installing: launch with explicit paths.
> ```bash
> pi --skill ~/.config/study-agent/skills/study \
>    -e ~/.config/study-agent/extensions/quiz.ts \
>    -e ~/.config/study-agent/extensions/ask-user-question.ts \
>    -e ~/.config/study-agent/extensions/md-log.ts
> ```

## Use it

```bash
cd ~/learn       # anywhere you want your notes to land
pi
```

Then:

```
Teach me Bayesian updating
```

or `resume Fourier`, `review probability`, `quiz me on Taylor series`.

### The loop

1. **Phase 1 — map.** The agent quizzes you along every strand the topic depends on, binary-searching for the *edge* of what you know. All-correct is treated as too easy; it goes harder.
2. **Phase 2 — plan.** It writes `<topic>/plan.md`: a dependency-ordered table of nodes. It waits for your go-ahead.
3. **Phase 3 — teach.** Per node: *why it exists* → build the idea → practice → **mastery gate** (two consecutive unassisted checks of different forms, at least one a predict/transfer question). No advancing until it passes.

### Reading your session comfortably

In Obsidian or anywhere markdown renders:

```
/md-log ~/learn/sessions/2026-10-18.md
```

Math (`$...$`), code and quiz blocks render live. `/md-unlog` stops it.

### Answering exercises

The agent writes `<topic>/exercises/<concept>.md` with Typst cards. Fill in `**My answer:**` in Obsidian, then say **"done"** — it grades each one under `**Feedback:**` and marks `status: graded`.

## Obsidian setup (for the Typst exercises)

1. Community plugins → install **Typst Mate** (or **Typst Renderer**).
2. Paste `skills/study/study.typ` into the plugin's **shared preamble**.
3. Enable the math-block override so `$...$` is parsed as Typst.
4. Reload Obsidian and test one `#exercise` block.

## Requirements

- pi 1.3+
- Node 20+ for the diagram tools (`rsvg-convert` for SVG; Chrome — system or puppeteer-managed — for Mermaid)
- Optional: a subagent implementation for `researcher` / `mermaid-maker` / `svg-maker`. Without it the main session still teaches; you just lose web verification and generated diagrams.

## Customizing

The skill is written for one learner. Edit `skills/study/SKILL.md` — especially "My rules" and the mastery gate — to match how you actually learn.
