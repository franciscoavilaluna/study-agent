# AGENTS.md

This project is a **pi study setup**. When someone uses it, follow `skills/study/SKILL.md` exactly.

## Where learner state lives

All learner state is written **relative to the current working directory** (the folder pi was launched in), never inside this setup repo:

```
learner/profile.md              general layer: how this person learns, no subject content
learner/topics/<topic>.md       topic layer: one file per subject
learner/events.jsonl            raw append-only log
<topic>/plan.md
<topic>/exercises/<concept>.md
```

Keep the two `learner/` layers separate: subject content (formulas, node names, vocabulary, error values) never goes into `learner/profile.md`, and general claims about how the person learns are earned with the evidence marks described in the skill. A project may already have its own layout for plans and weakness registries; follow the project's `AGENTS.md` when it defines one, and record the mapping in the topic dossier.

## If this is the working directory

Someone launched pi *inside* the setup repo. Before starting a session, tell them once:

> This is the config repo. Run `pi` from the folder where you want your notes (e.g. your Obsidian vault), or keep going here and your notes will live inside this repo.

Then continue with the skill as written.
