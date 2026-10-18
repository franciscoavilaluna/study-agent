# AGENTS.md

This project is a **pi study setup**. When someone uses it, follow `skills/study/SKILL.md` exactly.

## Where learner state lives

All learner state is written **relative to the current working directory** (the folder pi was launched in), never inside this setup repo:

```
learner/profile.md
learner/events.jsonl
<topic>/plan.md
<topic>/exercises/<concept>.md
```

## If this is the working directory

Someone launched pi *inside* the setup repo. Before starting a session, tell them once:

> This is the config repo. Run `pi` from the folder where you want your notes (e.g. your Obsidian vault), or keep going here and your notes will live inside this repo.

Then continue with the skill as written.
