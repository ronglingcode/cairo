# Cairo

AI-native trading platform for US stocks.

Current priority: premarket notes and AI chat with one-minute chart context, then
trade-management assistance. Bookmap integration moves to the final feature phase.
See the [revised workflow](docs/chatgpt/PREPARATION-MANAGEMENT-PHASE.md).

## Run the current app

For your configured OpenAI setup, double-click [`Launch-Cairo.cmd`](Launch-Cairo.cmd).
It runs the OpenAI launcher with a temporary PowerShell execution-policy override
and your saved credentials-file reference. Keep the terminal open while Cairo runs.
From PowerShell, you can also run `.\Launch-Cairo.cmd`.

`npm install` then `npm run dev` starts Cairo's Electron app with a local fake
model by default. Preparation notes, one-minute chart snapshots and streaming chat
are implemented. See [model/chart setup and verification](docs/chatgpt/T32-VERIFICATION.md).
For a synthetic browser demo, run `npm run build` then `npm run preview:fake`.

Use **Planning** for notes, charts, and tradebooks alongside a wider chat panel.
**Live chat** gives the conversation the full workspace. **Pop out chat ↗** opens
a separate resizable desktop window; **Dock chat** or closing that window restores
the embedded conversation. Both views share the engine, conversation, and unsent
message draft. The chat includes source status, position summaries, and an expandable
**Trading context** drawer with protection, management, and exact exit review controls.
Enter sends a message; Shift+Enter adds a line break.

Type `/` to choose a skill; `/s` shows `set-stop-loss` and `set-targets`.
`manage-trade` includes both workflows. `/bookmap-pattern` tags the current trade;
stop, target and management requests share a trade/pattern picker when context is missing. Assign each stock's long/short tradebooks under **Tradebooks by stock and side** in preparation; held positions resolve the matching side automatically. Humans and AI editors share the Markdown
files in [`skills`](skills). Edits apply to the next skill invocation. See the
[skill library guide](docs/SKILL-LIBRARY.md) for composition and adding skills.

After building, run `node_modules/.bin/electron scripts/verify-chat-window.cjs`
for the native window lifecycle and layout check with a disposable fake profile.
Verification windows stay hidden and do not take focus.

The strategy selector reads only top-level `.md` tradebooks linked under `## Long`
and `## Short` in `activeTradebooks.md` in the configured tradebooks root.
That index controls active choices and matching by position side; unlisted books
are unavailable. A missing index or broken link prevents the library from loading.
Restart Cairo after index edits.

Set `CAIRO_TRADEBOOK_PATH` before launching to use another directory. Restart
Cairo to reload source edits. Narratives appear without interpretation files;
reviewed interpretations stay in Cairo's profile and are used only while their
hash matches the source narrative. Cairo tradebooks are read-only: edit their Markdown files in Backtest. Cairo cannot
create or replace tradebooks, including through AI proposals. Preparation notes
and reviewed per-position guidance remain editable; attaching preparation guidance
does not add it to the tradebook library.

## Coding agent handoff

Start with [CODING-PLAN.md](docs/chatgpt/CODING-PLAN.md), the complete MVP handoff with 50 small tasks, dependencies, verification steps, checkboxes, and separate local commits for each completed task.

Use [HANDOFF.md](docs/chatgpt/HANDOFF.md) for the ready-to-copy prompt to start or resume work with another coding agent.

The [planning index](docs/chatgpt/README.md) links the architecture, agreed decisions, and supporting research.

Reviewed per-position management, AI interpretation proposals, optional account-event updates, and exact exit/protection drafts are now available. Drafts cannot submit orders yet. The next task adds exact ticket approval; only bid step up and bid reappear are selected for the later Bookmap broadcast phase.
