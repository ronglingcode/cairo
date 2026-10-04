# Cairo planning package

Updated October 4, 2026 after the request to simplify the MVP and prioritize live trading. Planning only; no application or live integration has been implemented.

The target is a personal Windows US-stocks desktop for **live signal detection and open-trade management**. Use TypeScript, Electron, React/Vite, Lightweight Charts, Massive, Schwab, existing Bookmap observations, and collaboratively authored tradebooks.

**The user selected Embedded OpenCode V2 with a Cairo plugin. Cairo does not need its own SQLite database for this MVP.** Live state stays in memory. Recover market/account facts from feeds and broker on startup. Save only editable tradebooks/config/active plan and a small broker-action/active-position recovery checkpoint.

Schwab connection is confirmed: consume a valid token produced/maintained by `bookmap-plugin` (bmtrader), read-only, and connect directly from Cairo's backend. Cairo checks expiry and picks up rotations; it requires neither ProxyServer nor its own login/refresh UI for this MVP.

Charting is corrected to **Massive REST aggregated one-minute snapshots**. Cairo opens no Massive WebSocket because the user's available connection is already used by `bookmap-plugin`. A stale chart is acceptable: load on selection/manual Refresh and show its age. Live monitoring uses available Bookmap observations/broker facts; stale bars cannot prove live triggers. Raw-data sharing/live candles are deferred.

Management is confirmed: traders provide guidelines in human language for each setup, and Cairo interprets and enforces the reviewed instructions. Different setups can use different styles; the earlier preset models are optional examples.

The MVP execution boundary is confirmed: **observer for entries, and up to assistant for exits**. Traders enter externally. Supported partial/full exits and protective exit-order changes require exact human approval for every broker mutation. Assisted entries and automated management are deferred.

The plan is still being finalized. [PLAN-DECISIONS.md](PLAN-DECISIONS.md) records confirmed choices and differences awaiting discussion. Recommendations in the documents below do not override that ledger.

## Current planning source of truth

| File | Purpose |
| --- | --- |
| [SIMPLIFIED-MVP.md](SIMPLIFIED-MVP.md) | Start here: scope cuts, retained/discarded data, restart behavior |
| [PLAN-DECISIONS.md](PLAN-DECISIONS.md) | Confirmed choices and remaining discussion |
| [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md) | Human-language guidelines, interpretation/review, and per-trade enforcement |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Small engine/plugin/UI boundaries and provisional hosting choices |
| [MVP-SPEC.md](MVP-SPEC.md) | Live behavior, minimal contracts, approval/recovery acceptance |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Proposed implementation checkpoints; unresolved choices must be resolved before their work |
| [HANDOFF.md](HANDOFF.md) | Starting prompt once decisions and implementation authorization are complete |

The selected OpenCode plan proposes a bundled local server sidecar, with exact Windows packaging to prove. OpenCode may retain its own runtime/session storage internally; **no Cairo-owned SQLite** does not promise an entirely database-free third-party runtime.

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

No secrets were inspected or paid inference/broker calls made. This simplification changes planning documents only; no commits or pushes are part of it.
