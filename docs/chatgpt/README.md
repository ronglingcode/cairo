# Cairo planning package

Updated October 4, 2026. **T01–T16 are implemented and checked off (16/50).** Next is T23, then T29–T32 for a runnable notes/chat app with one-minute chart knowledge. Bookmap work moves to the final feature phase and remains required for the full MVP. Read [the scope revision](PREPARATION-MANAGEMENT-PHASE.md). [HANDOFF.md](HANDOFF.md) records local commits; task checks are in [CODING-PLAN.md](CODING-PLAN.md).

The target is a personal Windows US-stocks desktop for **premarket preparation and AI-assisted trade management**, with Bookmap signal detection added in the final feature phase. Use TypeScript, Electron, React/Vite, Lightweight Charts, Massive, Schwab, and collaboratively authored notes/guidance.

**The user selected Embedded OpenCode V2 with a Cairo plugin. Cairo does not need its own SQLite database for this MVP.** Live state stays in memory. Recover market/account facts from feeds and broker on startup. Save only editable tradebooks/config/active plan and a small broker-action/active-position recovery checkpoint.

Schwab connection is confirmed: consume a valid token produced/maintained by `bookmap-plugin` (bmtrader), read-only, and connect directly from Cairo's backend. Cairo checks expiry and picks up rotations; it requires neither ProxyServer nor its own login/refresh UI for this MVP.

Charting is corrected to **Massive REST aggregated one-minute snapshots**. Cairo opens no Massive WebSocket because the user's available connection is already used by `bookmap-plugin`. A stale chart is acceptable: load on selection/manual Refresh and show its age. Live monitoring uses available Bookmap observations/broker facts; stale bars cannot prove live triggers. Raw-data sharing/live candles are deferred.

Management is confirmed: traders provide guidelines in human language for each setup, and Cairo interprets and enforces the reviewed instructions. Different setups can use different styles; the earlier preset models are optional examples.

The MVP execution boundary is confirmed: **observer for entries, and up to assistant for exits**. Traders enter externally. Supported partial/full exits and protective exit-order changes require exact human approval for every broker mutation. Assisted entries and automated management are deferred.

**Start implementation with [CODING-PLAN.md](CODING-PLAN.md).** It is the final self-contained handoff with 50 ordered tasks, verification, checkboxes, and separate local commits. It preserves the user-confirmed choices and selects explicit MVP defaults for remaining implementation details. [PLAN-DECISIONS.md](PLAN-DECISIONS.md) retains the decision/discussion history; it does not require reopening routine defaults before coding.

## Current planning source of truth

| File | Purpose |
| --- | --- |
| [CODING-PLAN.md](CODING-PLAN.md) | Authoritative coding handoff: 50 tasks, completion flags, checks, and per-task commits |
| [SIMPLIFIED-MVP.md](SIMPLIFIED-MVP.md) | Start here: scope cuts, retained/discarded data, restart behavior |
| [PLAN-DECISIONS.md](PLAN-DECISIONS.md) | Confirmed choices and remaining discussion |
| [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md) | Human-language guidelines, interpretation/review, and per-trade enforcement |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Small engine/plugin/UI boundaries and provisional hosting choices |
| [MVP-SPEC.md](MVP-SPEC.md) | Live behavior, minimal contracts, approval/recovery acceptance |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Proposed implementation checkpoints; unresolved choices must be resolved before their work |
| [HANDOFF.md](HANDOFF.md) | Short prompt to start/resume the task checklist |

T01 verifies the pinned OpenCode 2.0.22 Windows server with a bundled plugin and explicit mock permission gate. Application-side lifecycle and complete Windows packaging remain T29/T48. OpenCode may retain its own runtime/session storage internally; **no Cairo-owned SQLite** does not promise an entirely database-free third-party runtime.

## Background research and explanations

These preserve earlier research. Their SQLite, full-history, replay, journal/research, package, agent-profile, assisted-entry, automated-management, and Cairo live-market-stream requirements are superseded for the MVP by the current documents above.

| File | Purpose |
| --- | --- |
| [RESEARCH.md](RESEARCH.md) | Pinned source evidence, reuse map, adapter uncertainties |
| [PLAN-COMPARISON.md](PLAN-COMPARISON.md) | Historical comparison with the other AI's proposal |
| [HARNESS-AND-STORAGE.md](HARNESS-AND-STORAGE.md) | Earlier SQLite rationale and custom-loop explanation |
| [OPENCODE-HARNESS-WALKTHROUGH.md](OPENCODE-HARNESS-WALKTHROUGH.md) | Selected OpenCode/plugin mechanics and live event/approval examples |
| [Other AI's plan](../opencode/README.md) | Original independent proposal, left unchanged |

Important findings remain: the Bookmap detector currently keeps serializable signals in memory and still needs an observation export/stream; Cairo leaves its heatmap external. ViteApp supplies reusable Massive/Schwab examples. Personal management semantics and the separate 1-minute ORB reference must survive simplification. The engine never waits for model inference.

Planning through the scope decisions was committed locally as `8f7a2d7`. Implementation through T15 and the T01/T02 retries has separate local commits, recorded in HANDOFF.md. The latest OpenCode probe uses synthetic local model responses and no credentials or broker calls. Nothing was pushed remotely.
