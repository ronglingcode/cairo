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

For after-hours testing with real AI and a simulated broker, double-click
[`Launch-Test-Case.cmd`](Launch-Test-Case.cmd) or run `npm run build` then
`npm run test:case -- 2026-10-05-PCVX`. Open the printed localhost URL.
Cases live under `test-cases/{date}-{symbol}/`; start with the
[PCVX scenario and acceptance steps](test-cases/2026-10-05-PCVX/README.md).
The simulation uses a disposable profile, read-only tradebook sources and an
in-memory order transport. `--fake` is UI-only; `--smoke` verifies startup without
paid model calls. Restart the launcher to reset a case.

Use **Planning** for notes, charts, and tradebooks alongside a wider chat panel.
**Live chat** gives the conversation the full workspace. **Pop out chat ↗** opens
a separate resizable desktop window; **Dock chat** or closing that window restores
the embedded conversation. Both views share the engine, conversation, and unsent
message draft. The chat includes source status, position summaries, and an expandable
**Trading context** drawer with protection, management, and exact exit review controls.
Enter sends a message; Shift+Enter adds a line break.

Your questions and automatic updates use independent AI sessions and can respond
at the same time, with all replies shown chronologically in one conversation.
Automatic replies are labeled **Automatic update**. Background Bookmap/account
reviews never disable your message composer. **Cancel reply** stops your response;
**Stop auto** stops automatic analysis and pauses automatic updates. The former
shared conversation remains visible in this timeline when upgrading.

Type `/` to choose a skill; `/s` shows `set-stop-loss` and `set-targets`.
`manage-trade` includes both workflows. `/bookmap-pattern` tags the current trade;
stop, target and management requests share a trade/pattern picker when context is missing. Assign each stock's long/short tradebooks under **Tradebooks by stock and side** in preparation; held positions resolve the matching side automatically. Humans and AI editors share the Markdown
files in [`skills`](skills). Edits apply to the next skill invocation. See the
[skill library guide](docs/SKILL-LIBRARY.md) for composition and adding skills.

After building, run `node_modules/.bin/electron scripts/verify-chat-window.cjs`
for the native window lifecycle and layout check with a disposable fake profile.
Verification windows stay hidden and do not take focus.

Open **Settings → Tradebooks root path** to type or browse for the folder containing
all human-authored trading documents. Save and restart Cairo to apply a folder change.
**Workspace root path** selects the shared parent folder (for example,
`C:\Users\lingr\trading`). **Use paths from workspace root** fills
`Backtest\tradebooks` and `secrets\storeSecrets.js` beneath it; both paths can also
be changed separately. **Secrets file path** references the provisioning script;
its contents are never sent to the settings view. Path changes apply after restart.
The absolute path is stored as `tradebooks_root_path` in Cairo's local `config.json`.
The strategy selector reads only top-level `.md` tradebooks linked under `## Long`
and `## Short` in `activeTradebooks.md` there. That index controls active choices
and matching by position side; unlisted books are unavailable. A missing index or
broken link prevents the library from loading. Restart Cairo after index edits.
Bookmap sources use `bookmap_patterns/activePatterns.md` and its linked
files beneath the same root. Preparation notes are saved in `preparation/preparation.json`.
Existing profile preparation is copied once when the root has no preparation notes;
the original is preserved and existing root notes are never replaced by migration.
Other human-authored document features should place their files beneath this root.
The credentials source stays at the selected secrets file; reviewed interpretations,
broker recovery and runtime state remain in Cairo's profile. Changing roots leaves
documents in the old root untouched.

For configurations without a saved root, `CAIRO_TRADEBOOK_PATH` supplies the initial
default; otherwise Cairo uses `%USERPROFILE%\trading\Backtest\tradebooks` if it exists,
falling back to `%USERPROFILE%\code\Backtest\tradebooks`. The saved setting takes precedence.
Restart Cairo to reload source edits. Narratives appear without interpretation files;
reviewed interpretations stay in Cairo's profile and are used only while their
hash matches the source narrative. Cairo tradebooks are read-only: edit their Markdown files in Backtest. Cairo cannot
create or replace tradebooks, including through AI proposals. Preparation notes
and reviewed per-position guidance remain editable; attaching preparation guidance
does not add it to the tradebook library.

## Coding agent handoff

Bookmap setup assistance now includes an independent evidence timeline, recognition
of the three bid-breakdown/bounce setups, separate large-offer breakout/rejection
observations, prior offer-rejection context and AI explanations on cards. The plugin's `evidenceEnabled` flag defaults to true.
See [implementation and limitations](docs/chatgpt/AI-BOOKMAP-IMPLEMENTATION.md) and
the [plugin replay guide](../bookmap-plugin/docs/cairo-evidence.md). Recognition is
advisory; accepting a live suggestion uses the existing confirmed-tag workflow.

Start with [CODING-PLAN.md](docs/chatgpt/CODING-PLAN.md), the complete MVP handoff with 50 small tasks, dependencies, verification steps, checkboxes, and separate local commits for each completed task.

Use [HANDOFF.md](docs/chatgpt/HANDOFF.md) for the ready-to-copy prompt to start or resume work with another coding agent.

The [planning index](docs/chatgpt/README.md) links the architecture, agreed decisions, and supporting research.

Reviewed per-position management, AI interpretation proposals, optional account-event updates, and exact exit/protection drafts are now available. Drafts cannot submit orders yet. The next task adds exact ticket approval; only bid step up and bid reappear are selected for the later Bookmap broadcast phase.
