# Cairo

AI-native trading platform for US stocks.

Current priority: premarket notes and AI chat with one-minute chart context, then
trade-management assistance. Bookmap integration moves to the final feature phase.
See the [revised workflow](docs/chatgpt/PREPARATION-MANAGEMENT-PHASE.md).

## Run the current app

`npm install` then `npm run dev` starts Cairo's Electron app with a local fake
model by default. Preparation notes, one-minute chart snapshots and streaming chat
are implemented. See [model/chart setup and verification](docs/chatgpt/T32-VERIFICATION.md).
For a synthetic browser demo, run `npm run build` then `npm run preview:fake`.

## Coding agent handoff

Start with [CODING-PLAN.md](docs/chatgpt/CODING-PLAN.md), the complete MVP handoff with 50 small tasks, dependencies, verification steps, checkboxes, and separate local commits for each completed task.

Use [HANDOFF.md](docs/chatgpt/HANDOFF.md) for the ready-to-copy prompt to start or resume work with another coding agent.

The [planning index](docs/chatgpt/README.md) links the architecture, agreed decisions, and supporting research.
