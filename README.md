# study-agent

A [pi](https://github.com/earendil-works/pi) setup for **learning by practice**. It is a config package, not a course: it teaches whatever you ask it to, in whatever folder you launch pi from.

Derived from [amosblomqvist/learn](https://github.com/amosblomqvist/learn), extended with Typst exercise files, a learner profile split into a general layer and per-subject dossiers, and Linux support for the visualization tools.

It works for any subject: quantitative ones get exercises and error fingerprints, conceptual ones get argument-and-transfer questions, and the same profile accumulates across all of them.

## What's in it

| Path | What it does |
|---|---|
| `skills/study/SKILL.md` | The teaching process: map → plan → teach, a hard mastery gate, and the checks that run after every answer |
| `skills/study/templates.md` | Exact formats for `plan.md`, `events.jsonl`, and the two profile layers |
| `skills/study/typst-rules.md` | LaTeX → Typst cheat sheet (all math is Typst, never LaTeX) |
| `skills/study/study.typ` | Typst preamble: `#exercise`, `#mcq`, `#hint`, `#predict` |
| `extensions/quiz.ts` | Graded multiple-choice with instant ✓/✗ feedback |
| `extensions/ask-user-question.ts` | Popup questions for goals and decisions |
| `extensions/md-log.ts` | Mirrors the session to a `.md` file you read rendered in Obsidian |
| `extensions/visual-tools/` | `write/edit/render_{mermaid,svg}` tools for the visual subagents |
| `agents/researcher.md` | Verifies facts on the web so the teacher can say "I'm not sure" honestly |
| `extensions/web-tools.ts` | `web_search` + `web_fetch` for that researcher: keyless, zero-dependency, no API key |
| `extensions/web-tools-core.ts` | The machinery behind them (HTML reduction, DuckDuckGo parsing, URL safety): no imports, unit-tested |
| `tests/web-tools.test.ts` | 48 tests for that machinery: `npm test` |
| `agents/mermaid-maker.md`, `agents/svg-maker.md` | Draw one diagram, look at the PNG, iterate, publish to `viz/` |

## Install

### 1. Install the package from git

```bash
pi install git:github.com/franciscoavilaluna/study-agent
pi list          # should list study-agent
```

This clones into `~/.pi/agent/git/github.com/franciscoavilaluna/study-agent` and adds an entry to `~/.pi/agent/settings.json`, so the skills and extensions load **from every directory you launch pi in**. Update later with `pi update --extensions`.

### 2. Subagents (required for visuals)

The `visualize` skill spawns `mermaid-maker` / `svg-maker`. That needs a subagent implementation:

```bash
pi install git:github.com/amosblomqvist/pi-interactive-subagents
sudo pacman -S tmux          # or your package manager; tmux is required
```

**Subagents only work when pi runs inside tmux.** Launch it as:

```bash
cd ~/learn && tmux new -A -s pi 'pi'
```

Without tmux, spawning fails with `Subagents require tmux` — teaching still works, you just get no diagrams.

#### Register the agent definitions

Agent files are discovered from `~/.pi/agent/agents/` or a project `.pi/agents/`, **not** from a package's `agents/` folder. Copy them once after installing:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.pi/agent/git/github.com/franciscoavilaluna/study-agent/agents/*.md ~/.pi/agent/agents/
```

Re-run that after updating the package if the agent definitions changed.

### 3. Runtime deps for the diagram tools

Their npm dependencies are not committed. Install them inside the clone:

```bash
cd ~/.pi/agent/git/github.com/franciscoavilaluna/study-agent/extensions/visual-tools
npm install
node node_modules/puppeteer/install.mjs   # fetches a Chrome for Mermaid rendering
```

SVG rendering needs `rsvg-convert` (librsvg) with ImageMagick's `magick` as fallback:

```bash
sudo pacman -S librsvg imagemagick
```

### 4. Check it

```bash
cd /tmp && pi -p --no-session "List the skills and non-builtin tools available to you."
```

Expected: skills `study`, `visualize`; tools include `quiz`, `ask_user_question`, `web_search`, `web_fetch`, `subagent`.

### Models

The agent definitions ship pointing at `deepseek/deepseek-flash`. Paid OpenRouter models (Claude, etc.) fail with `402 billing_error` when the balance is low — if you hit that, either add credits or edit `model:` in `~/.pi/agent/agents/*.md`. Model IDs are per-machine, which is why this is the one thing you may need to change.

> `researcher` gets `web_search` and `web_fetch` from its own bundled extension, so it works on a fresh install with no API key and no MCP server. `web_search` reads DuckDuckGo's HTML endpoint (three fallbacks deep) and `web_fetch` strips a page down to its content; both use Node's built-in `fetch`. If a machine blocks those endpoints, the researcher says the search failed instead of inventing a source. Run `npm test` in a checkout to exercise the parsing and fallback logic offline.

## Use it

```bash
cd ~/learn                                  # anywhere you want your notes to land
tmux new -A -s pi 'pi'                      # tmux is required for subagents
```

Then:

```
Teach me Bayesian updating
```

or `resume Fourier`, `review probability`, `quiz me on Taylor series`.

### Learner memory: two layers

The agent keeps what it learns about you in **two separate files**, on purpose:

| file | holds | contains subject matter? |
|---|---|---|
| `learner/profile.md` | how you learn: what works, what derails you, how you answer, your energy | **never** |
| `learner/topics/<topic>.md` | one subject: node map, open gaps, the cards that unblocked you, the names you did not know, the exact wrong answers you produce | yes |

The point is that the profile survives a change of subject. A rule like "always run the bound check before answering" is worth keeping when you move from statistics to circuits; "confuses $sigma^2$ with $sigma$" is not.

General claims carry an evidence mark, because a *wrong* general rule costs you in every later subject:

- *(no mark)* — seen in several sessions or in more than one subject
- `(once)` — seen once; kept, but not built on
- `[1 topic]` — single-subject evidence, assumed to transfer but unproven

A claim that fails in a second subject is marked `[contradicted in <topic>]` rather than deleted. When the agent cannot tell whether something transfers, it stays in the topic dossier.

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

- pi 1.3+ (this repo uses the `@earendil-works/` package scope; pi aliases the older `@mariozechner/` scope, which is what `pi-interactive-subagents` imports)
- Node 20+ for the diagram tools
- `tmux` and [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) for subagents (diagrams, web research)
- `rsvg-convert` (librsvg) and/or ImageMagick for SVG; Chrome — system or puppeteer-managed — for Mermaid
- Node 22.18+ (or any Node that strips TypeScript types) only if you want to run `npm test`; nothing at runtime needs it

Without the subagent layer the main session still teaches and quizzes; you just lose generated diagrams and fact-checking by `researcher`.

## Known limitations

- **Subagents need tmux.** They spawn in tmux panes; a plain terminal session fails with `Subagents require tmux`.
- **`web_search` depends on DuckDuckGo's markup.** It is keyless by design (a key would make the package unusable for the next person who clones it), so if the endpoint changes the search returns an error rather than results. It tries three DuckDuckGo paths (html, lite, POST form) before giving up, so a rate-limit usually degrades into a working search instead of a failure. `web_fetch` is independent of it and keeps working. Neither tool opens PDFs.
- **`web_fetch` reads text, not rendered pages.** It drops nav/header/footer/aside/script chrome and prefers a page's `<article>`/`<main>`; on a page built entirely by JavaScript it returns "no readable text" rather than an empty answer. Binary and non-UTF-8 pages are decoded from their declared charset, but a scanned PDF stays unreadable.
- **Model IDs are machine-specific.** Agents ship on `deepseek/deepseek-flash` because it is cheap and works without credit. Paid models fail with `402 billing_error` on a low balance.
- **Agent files are copied, not linked.** They live in `~/.pi/agent/agents/`, so a package update needs the `cp` from step 2 repeated.
- **Learner state is written to the cwd**, not to the package. Launch pi from the folder where you want your notes.

## Customizing

The skill is written for one learner. Edit `skills/study/SKILL.md` — especially "My rules", "The check that comes after every answer" and the mastery gate — to match how you actually learn.

Your own accumulated evidence lives in your notes folder, not in this repo (`learner/` and `*/plan.md` are gitignored). Edit `learner/profile.md` freely: delete anything that does not describe you. The agent rewrites it from logged events, so if you disagree with a line, say so — the log is the record it argues from.

To use a different layout for plans and weakness registries, describe the mapping in the project's own `AGENTS.md`; the skill follows the project when it defines one.
