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

Expected: skills `study`, `visualize`; tools include `quiz`, `ask_user_question`, `subagent`.

### Models

The agent definitions ship pointing at `deepseek/deepseek-flash`. Paid OpenRouter models (Claude, etc.) fail with `402 billing_error` when the balance is low — if you hit that, either add credits or edit `model:` in `~/.pi/agent/agents/*.md`. Model IDs are per-machine, which is why this is the one thing you may need to change.

> `researcher` is granted only `bash`. `web_search` / `web_fetch` are separate pi extensions that are not bundled with pi; install one and add it to the agent's `tools:` line to give it real web access. Until then it reports that it has no search tool rather than inventing sources.

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

Without the subagent layer the main session still teaches and quizzes; you just lose generated diagrams and fact-checking by `researcher`.

## Known limitations

- **Subagents need tmux.** They spawn in tmux panes; a plain terminal session fails with `Subagents require tmux`.
- **`researcher` has no web tools by default.** `web_search`/`web_fetch` are not bundled with pi. It is granted `bash` only, so it will say it cannot search rather than invent a source. This is deliberate: the skill forbids fabricating sources.
- **Model IDs are machine-specific.** Agents ship on `deepseek/deepseek-flash` because it is cheap and works without credit. Paid models fail with `402 billing_error` on a low balance.
- **Agent files are copied, not linked.** They live in `~/.pi/agent/agents/`, so a package update needs the `cp` from step 2 repeated.
- **Learner state is written to the cwd**, not to the package. Launch pi from the folder where you want your notes.

## Customizing

The skill is written for one learner. Edit `skills/study/SKILL.md` — especially "My rules" and the mastery gate — to match how you actually learn.
