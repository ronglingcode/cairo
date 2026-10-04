# Comparison with the OpenCode-session plan

> Historical comparison, superseded scope October 4, 2026: the current MVP uses the selected OpenCode V2/Cairo plugin and React/Vite, with no Cairo-owned SQLite or full historical operational database. Read [SIMPLIFIED-MVP.md](SIMPLIFIED-MVP.md) for retention/live scope and [PLAN-DECISIONS.md](PLAN-DECISIONS.md) for confirmed/pending choices. The old table rows record the proposals being compared; they do not restore database, replay, journal, or custom-runner requirements. Charting is corrected to Massive REST one-minute snapshots, with the user's WebSocket left to Bookmap. Management follows human-language guidelines per setup. Entries are observer-only; exits reach exact-human-approved assistant. Earlier live-stream/preset/automated-execution alternatives below are historical.

Planning review, October 4, 2026. I read all eight documents in [docs/opencode](../opencode/README.md) and compared them with this folder's architecture, specification, research, implementation plan, and handoff. No application implementation was performed, and the other plan was not edited.

The plans agree on the trading foundation. The main disagreement is how much existing agent infrastructure to embed. Several other differences reflect additional preferences recorded in the other session, rather than competing technical conclusions.

## 1. Common ground

| Area | Agreement |
| --- | --- |
| Product | Personal, local Windows application for US stock trading; live detection and management have priority. |
| Desktop | TypeScript, Electron, Vite, Bun workspace tooling, Windows packaging. Neither plan forks the whole OpenCode application. |
| Trading runtime | A deterministic local engine owns market features, signals, sizing, broker state, and management rules. Model latency must not stall it. |
| Tradebooks | Trader and AI collaborate on reusable written setup definitions with machine-readable rules. Daily plans bind market context and levels. |
| Charting | Official Lightweight Charts, drawing candles, VWAP, levels, signals, fills, and working orders in the browser renderer. |
| Bookmap | Reuse the existing Java detector; leave its heatmap in Bookmap for the MVP; add pattern export rather than recreate order-flow detection in Cairo. |
| Broker | Schwab, adapting useful ViteApp modules; staged order drafts; human approval for assistant entries. |
| Execution modes | Observer, assistant, and rule-based automated management, with assisted entries initially. |
| Persistence | SQLite for operational state plus readable files/logs; no cloud database or multi-user infrastructure. |
| Verification | Synthetic market fixtures, fake broker, replay, duplicate-event handling, broker reconciliation, and visible unknown order outcomes. |
| Later work | Richer research/backtesting, journal polish, heatmap features, macOS/CLI packaging after the live workflow. |

These are substantial agreements. Both designs separate the trading engine from the conversational agent; the other design is not proposing that an LLM watch every tick and decide every exit.

## 2. Differences that affect implementation

| Choice | ChatGPT plan | OpenCode-session plan |
| --- | --- | --- |
| Agent runtime | Small custom Responses API loop in Cairo, with bounded tools, context, scheduling, streaming, cancellation, and proposals. | Bundled OpenCode V2 server plus Cairo plugin; reuse its sessions, tools, permissions, skills, compaction, and provider support. |
| Task roles | One assistant with five task profiles and selected tools. | Named planner, live copilot, manager, journalist, and later researcher profiles in the OpenCode workspace. Profiles do not necessarily imply concurrent agents. |
| Renderer | SolidJS, following the inspected upstream UI. | React, Zustand, and Tailwind. Both satisfy the main TypeScript requirement. |
| Engine host | Electron Node utility process from the first milestone. | Electron main process initially; utility-process migration possible later. |
| Transport | Engine HTTP plus one WS stream, including copilot events. | Engine HTTP/WS, optional engine SSE mirror, plus OpenCode HTTP/SSE and a plugin connection to the engine. |
| Tradebook lifecycle | Immutable published tradebook/plan versions; clause-to-rule mapping; deterministic/human/advisory/unsupported coverage; scoped arming. | Editable YAML files with structured fields and prose, a numeric version, validation, and hot reload. Exact published snapshots and live attachment behavior need strengthening. |
| Rule vocabulary | Bounded comparisons, groups, registered detector events, scoped human confirmations; extend only when selected setups require it. | More fixed context/signal/management fields and a built-in detector list; good for those examples, narrower for novel compositions. |
| Broker ownership | Cairo owns OAuth/refresh and directly reads the selected account; account activity triggers refresh. | Read tokens maintained by bmtrader, use existing ProxyServer, and periodically reconcile; no Cairo OAuth for MVP. |
| Candles | Massive REST + live minute aggregates (`AM`) are canonical; `T` supplies price observations and `Q` supplies quotes. | Adapt ViteApp's trade-built candles from `T`, with REST history and reconnect trade repair. |
| Bookmap bridge | Pattern export plus source mode, readiness, heartbeat/reset, price metadata, detector/config versions, and needed wall context. | First broadcast existing signal JSON over :8765 and append JSONL; file fallback/backfill. Most readiness/mode/config metadata remains unspecified. |
| Management model | Configurable logical tiers, personal scalp/core/runner preset, named per-position policy permissions. | Generic R-based partials, breakeven/trailing/flat-by rules, with target allocations; the personal tier skill is planned, but the DTO does not fully represent tier permissions. |
| Personal seed | Import Gap Give and Go early, preserving its VWAP exception and LOD stop discipline. | Start with offer-wall breakout and ORB YAML examples; Markdown tradebook importer later. |
| Symbol scope | One Bookmap focus symbol, small watchlist, subscriptions for held positions. | Exactly one active UI symbol, recent-symbol list; most subscriptions/context scoped to it. |
| Model scope | Configurable OpenAI model, selected using a small domain evaluation. | One preconfigured model inherited by every profile; per-trader/per-agent selection later. |
| SQLite adapter | Prove `node:sqlite` in the packaged runtime first; document a fallback if needed. | `better-sqlite3`, including its native Electron packaging requirements. |
| MVP boundary | Observer first, then assistant, then automated management as stages of the chosen MVP. | Observer + assistant are MVP; automated exits are a stretch milestone immediately afterwards. |

The other plan explicitly labels one active symbol, one shared model, externally maintained tokens, and Bookmap export as user-confirmed in that session. Those preferences were not established in this conversation when my first plan was written. They should be treated as that plan's recorded scope, not described as technical mistakes. If they are the intended Cairo constraints, they can be applied without changing the engine/harness separation.

## 3. The important harness tradeoff

The OpenCode alternative is real. Its current [V2 plugin documentation](https://opencode.ai/v2/docs/build/plugins) supports tools, session hooks, skills, permissions, and runtime extensions. My earlier research did not assess that embedding surface deeply enough. Its [JavaScript client](https://opencode.ai/v2/docs/build/client) connects to a server; the separate [embedded SDK](https://opencode.ai/v2/docs/build/sdk) can host OpenCode in-process. Neither documented surface has been proven in a packaged Cairo app yet.

Embedding OpenCode can save implementing session continuation, compaction, skill loading, provider integration, and a general tool runtime. It is particularly attractive if Cairo should offer a file-oriented research workspace, many extensible skills, or CLI parity soon. The other plan's early plugin/permission spike is a good way to establish the real integration contract.

It also adds a runtime/version dependency, plugin and permission mappings, another event stream, packaged binary management in the proposed sidecar approach, and OpenCode-specific workspace/session behavior. Trading rules, source fidelity, position accounting, order payloads, and approval correctness still belong to Cairo. Reusing a general permission system does not implement those domain semantics.

I disagree with ADR-002's categorical description of a bespoke OpenAI loop as “months of work.” Recreating the entire OpenCode feature set would be a large project. A narrowly scoped tool loop does not require that feature set, and no calendar estimate has been validated for either route. Maintenance, continuation handling, and test coverage are real costs for a custom loop; packaged integration and upstream API changes are real costs for embedding.

There is also a middle option: use the [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) for the reusable agent runner while Cairo owns context, tools, storage, event scheduling, approvals, and trading policy. This reduces hand-written loop mechanics without adopting OpenCode's whole workspace model.

My preference remains a small Cairo-owned harness for the initial OpenAI-only live workstation. I would use the Agents SDK if its tested runner simplifies that bounded design. OpenCode becomes more compelling when its workspace/skills/CLI features are explicit product requirements. This is a recommendation, not an implementation change or a declaration that the other route cannot work.

## 4. Corrections and contracts to tighten

### A correction to my Bookmap research

My earlier documents incorrectly described JSONL pattern export as already implemented. On rechecking [RongPlugin](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/RongPlugin.java) and [PatternSignalStore](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/PatternSignalStore.java), the signal handler updates the in-memory store and badges. [BookmapPatternSignal](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/BookmapPatternSignal.java) has JSON serialization; that is not a file writer. The inspected source does not establish an existing JSONL exporter.

The other plan correctly makes the exporter an explicit T0 task. I corrected the affected research, architecture, specification, implementation, and index text in this folder. A fixture can demonstrate Cairo ingestion before export exists, but a usable real Bookmap path requires implementing export.

### Bookmap output needs operational meaning

Plain WS push plus JSONL is a good transport. Add live/replay/unknown source mode, initial-history readiness, heartbeat, reset, instrument mapping, and detector/config version before using it for broker actions. File backfill is historical observation recovery, not automatically a fresh entry. Never infer live mode merely from a current-looking timestamp.

The other plan maps `Signal.ts = timestamp` while describing `ts` as event time. Actual serialization uses `timestamp = createdAtMs` and separately carries `eventTimeNs`. Preserve both; the distinction matters for replay, temporal detector evidence, and entry expiry. Real trigger price and reference wall ticks are also different units.

The detector's eligibility currently depends on enabled native tradebook groups. Broadcasting signals alone does not make Cairo's chosen setup/configuration reach the detector. Establish an observation configuration path that does not also enable native execution for Cairo-managed trades.

### File editing should produce a reviewed publication

Readable YAML/Markdown is a strength of the other plan. Keep it, but treat an external edit as a draft/change proposal. A file watcher can load and validate it immediately without changing an armed plan or open position. Snapshot published versions and record the exact attachment on signals, orders, and journals. A manually bumped `version` field and a tradebook ID alone do not preserve the old rule content.

### Exact approval and automated policy need domain identity

The other plan already has drafts, expiry, mode checks, and unknown-outcome handling. Preserve those. Tie approval to the actual draft revision, account, order details, plan/position versions, and allowed action. A broad tool “allow” or “always” reply cannot stand in for permission to change every future trade.

For automated actions, require a named armed management rule with current evidence and position attachment, not merely a valid quantity/price and an auto-mode tool permission. Serialize actions per account/symbol, reserve pending quantities until reconciliation, and test OCO replacement/closing failures. Both plans must address broker state changing outside Cairo.

### Personal semantics need stronger representation

The other plan's generic breakeven/partial examples are optional strategy examples, not universal rules to apply to all Bookmap setups. Its `min-wall` example checks premarket volume; that does not itself establish wall size. Bind wall requirements to detector evidence/configuration and label separate liquidity gates accurately.

Represent the personal scalp/core/runner allocations and permissions explicitly. A target label “core” alone does not encode the core hold discipline. Preserve Gap Give and Go's stop-at-LOD instruction and either-side-of-VWAP entry rule. A missing pullback stop cannot silently become a wider day-low stop; that changes sizing and thesis and requires a reviewed binding.

### Market and chart details

Both candle approaches can work. Trade-built candles require an audited provider condition policy, overlap handling, and explicit historical/live parity. Provider minute aggregates reduce the first implementation's bar-construction responsibility. Whichever source is chosen, handle older-bar corrections; the other implementation plan's statement that closed minutes are immutable should be revised.

The other plan selects Lightweight Charts v5 but mentions direct series `setMarkers`, which is a v4 API. V5 uses a marker primitive created with `createSeriesMarkers`, then updates that primitive. Check the [official migration guide](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5). Keep UTC instants in the domain and isolate any display-time conversion inside the renderer.

## 5. What I would combine

1. Keep the agreed TypeScript/Electron engine, Lightweight Charts, Bookmap detector reuse, and staged execution modes.
2. Use the other plan's small user-facing scope: one focus chart and one preconfigured model. Continue observing held positions independently of the selected chart symbol.
3. If external token ownership is the intended preference, expose it as the initial credential/broker adapter. Cairo's rule engine should not care whether a token comes from its own OAuth flow or a read-only external provider. Do not have two applications rotate the same credential store.
4. Keep readable tradebook, plan, and journal files, backed by immutable published snapshots and operational SQLite state.
5. Implement Bookmap export explicitly, then add the mode/readiness/configuration metadata needed by real management rules.
6. Preserve the personal tier semantics and coverage report, rather than replacing them with generic R-based management defaults.
7. Keep the harness replaceable behind a small interface. If selecting OpenCode, prove its actual pinned tool, approval, synthetic-event scheduling, and Windows packaging path early. If selecting the custom/Agents SDK route, prove strict tools, continuation, cancellation, historical-result detection, and bounded runs early.

No application code was changed by this comparison. These are recommendations for the next design decision, not a silent replacement of either implementation plan. See [the SQLite and harness explanation](HARNESS-AND-STORAGE.md) for the answers to the follow-up questions.
