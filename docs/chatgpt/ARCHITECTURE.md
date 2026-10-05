# Cairo simplified MVP architecture

**Current build order:** preparation notes and chart-aware chat → reviewed trade
management → Bookmap observation features → full acceptance/package. The first
app works with one-minute chart snapshots; broker/Bookmap connection is not a
gate for discussing notes and chart context. Bookmap-specific design below
remains the final feature phase. See [scope revision](PREPARATION-MANAGEMENT-PHASE.md).

Updated October 4, 2026. Start coding with [CODING-PLAN.md](CODING-PLAN.md), which selects explicit implementation defaults and supplies the ordered task checklist. This document explains the architecture; [MVP-SPEC.md](MVP-SPEC.md) covers behavior and [PLAN-DECISIONS.md](PLAN-DECISIONS.md) preserves user decisions. Earlier SQLite/history/replay requirements are superseded.

## Confirmed foundation and handoff defaults

TypeScript/Electron Windows desktop with React/Vite, Lightweight Charts, Massive, Schwab, Bookmap detector reuse, collaboratively authored tradebooks, and a deterministic trading engine independent of model latency.

**Selected AI runtime: Embedded OpenCode V2 plus a Cairo plugin. No Cairo-owned SQLite, ORM, migrations, or historical operational database.**

OpenCode packaging defaults to a pinned bundled headless server sidecar; T01 proves exact Windows compatibility. Schwab uses a valid token produced by `bookmap-plugin` (bmtrader), consumed read-only, plus direct backend HTTP. Charting uses Massive REST one-minute snapshots with no Cairo Massive WebSocket; a stale chart is acceptable. Management follows trader-authored human-language guidelines per setup. Entries are observer-only and exits reach exact-human-approved assistant. The final handoff defaults to main-process engine, WebSocket observations, Markdown/JSON artifacts with explicit attachment, one focus chart and one configured model. Additional observations are introduced only when the selected guideline requires them. Automated management and assisted entries are deferred.

## Small responsibilities

| Component | Owns |
| --- | --- |
| Desktop UI/main | Windows lifecycle, chart, plan/tradebook editor, positions, chat, exact approval cards, notifications |
| Cairo engine | In-memory market/account state, supported predicates, signal episodes, management, sizing, tickets, broker writer/reconciliation |
| OpenCode runtime | Model/provider requests, sessions, tool loop, streaming, compaction, generic permissions |
| Cairo OpenCode plugin | Fresh engine context, domain tool adapters, meaningful-event filtering, exact-ticket permission wiring |
| Small file writer | Current authored artifacts and a minimal unresolved-action/active-position checkpoint |

~~~mermaid
flowchart LR
  UI[Cairo desktop] <-->|chat / permissions| OC[OpenCode runtime]
  OC <-->|model inference| AI[OpenAI]
  OC <-->|domain tools / context| P[Cairo plugin]
  P <-->|local API / engine events| E[Cairo engine: in-memory state]
  UI <-->|chart / position / ticket state| E
  MR[Massive REST] -->|one-minute snapshots| E
  MW[Existing Massive WebSocket] --> BM[Bookmap plugin]
  BM -->|pattern observations: export needed| E
  E <-->|direct HTTPS| S[Schwab]
  F[Current tradebook / plan / config files] --> E
  E --> R[Small recovery checkpoint]
~~~

OpenCode may own internal session storage. Cairo does not duplicate it. A chat transcript never substitutes for a fresh broker snapshot or approved ticket. The Cairo TypeScript plugin is distinct from the existing Bookmap Java detector plugin.

## Modules, not a framework

Proposed organization: main/preload/renderer, shared contracts, engine market/Bookmap/broker/rules/execution/files/API modules, and one Cairo plugin module. One project is enough initially; split packages only when a real consumer requires it.

The engine imports no renderer globals or chart objects and can be tested against fake feeds/broker/clock. The final handoff defaults to an independent module in Electron main, with no initial utility-process framework. Keep provider I/O asynchronous and defer heavy research/backtests. Renderer reload must not restart the engine or subscriptions. The desktop runs monitoring while open/minimized; no Windows service or persistent daemon is required.

A small loopback HTTP interface and one engine event stream serve UI/plugin. Avoid duplicate IPC/HTTP domain command surfaces, unnecessary second event protocols, a plugin marketplace, or a large dependency-injection framework.

## Market and chart contract

Use **Massive REST one-minute aggregate snapshots**. Adapt ViteApp's pure REST `getPriceHistory`/`getBars`, `mapAggregate`, and session clock; do not reuse the live `MarketLoader`/trade backfill as the chart loader. The minimum is load on symbol/date selection and manual Refresh. Keep a bounded in-memory snapshot, replacing/upserting each symbol/minute without summing overlapping aggregate volume. Preserve Lightweight Charts attribution.

Show “Snapshot — no live updates”, last successful fetch time, and latest bar time. A refresh failure preserves the older snapshot with visible age/error. A fetched forming bucket is not represented as a completed candle or current quote. UTC times stay internal; exchange labels/session boundaries are Eastern and DST-aware. Candles/volume and plan/order overlays on a one-minute chart suffice; additional views and chart polish are secondary.

Cairo has no Massive trade/quote/aggregate WebSocket or REST trade polling. Bookmap keeps the existing connection. Raw market-data sharing and ViteApp-style live candle building are deferred; the Bookmap pattern-observation bridge below is still needed independently.

Separate snapshot context from live evidence. Any derived VWAP/high/low/range is labeled as of the loaded bars, not the current market. Required fresh prices/candle crossings are unavailable unless a separately agreed source supplies them. Bookmap event prices are evidence of that event, not continuous quotes. Do not introduce another provider/quote feed silently. The ORB example stays a narrative/synthetic fixture until fresh crossing data exists. Bookmap-driven monitoring and broker position refresh continue even while the chart is stale or focused elsewhere.

## Bookmap observations

The existing detector can serialize patterns but currently keeps them in memory. A scoped observation export/stream still needs implementation. Keep its detector/heatmap in Bookmap. Send pattern episodes and only context required by chosen rules; no full-depth transport or Cairo detector rewrite.

The handoff defaults to observation-only messages on the existing local WebSocket, with server-pushed status/episode snapshot on connection and live updates thereafter. No JSONL tail/replay fallback. Minimum meaningful contract: symbol/alias and real-price mapping, episode/revision, source mode live/replay/unknown, readiness/heartbeat/reset, detector/config revision, and event/receive time. T16-T19 verify installed metadata and implement the additive export. Unknown/replay inputs can support observer review but cannot authorize source-dependent broker writes. Current-looking timestamps are insufficient.

Separate observation eligibility from native execution so Bookmap and Cairo cannot both act on one managed signal. Recording, log-tail backfill, and general replay are not required to deliver live observations.

## Broker and management contract

Use selected-account positions/working orders as authoritative current facts, including external/carry-in trades and preexisting protection. Account activity can trigger coalesced refresh; modest polling can fill gaps. Consume a valid Schwab token produced/maintained by `bookmap-plugin` (bmtrader), reading its configured credential file without refreshing or writing it, and make direct Schwab HTTP calls in the backend. Validate token presence and expiry with a small buffer; re-read before writes and pick up the plugin's rotations. Schwab rejection invalidates usable authorization even if local expiry looks current. Missing/stale authorization blocks new broker requests until the plugin renews it; market monitoring can continue with broker state labeled stale. Adapt ViteApp's broker codecs/order factories and a read-only token provider, not its refreshing OAuth provider. No ProxyServer or Cairo login UI is required. Do not expose credentials in model/UI context. HTTP success alone never establishes a fill.

User-confirmed operating assumption: `bookmap-plugin` is always running during trading. Cairo does not own its startup/lifecycle or add a second token keeper; it consumes the companion's outputs.

Management follows each setup's trader-authored human-language guidelines. The copilot proposes a traceable executable interpretation, clarifies material gaps, and shows it for review before attachment/arming. No fixed management preset governs every setup. Logical tiers and original-risk references are optional, present only when the guidelines need them. Broker quantity wins; ambiguous outside exits/allocation mapping requires confirmation. An accepted request is not a fill. OCO siblings are alternative protection, not double quantity. See [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md).

Stage concrete engine-built tickets. Approval attaches to exact details and current applicability. Serialize actions per account/symbol, reserve in-flight quantities, and reconcile unknown outcomes without blind retry. Understand working stops/OCOs before replacing protection or placing separate closes. Unsupported order topology stays manual/reviewable. Broker-hosted protection is preferred to relying entirely on an app exit.

The MVP writer handles approved exit/protective mutations for existing positions only. Entry recommendations never reach it. Engine validation rejects opening/increasing/reversing requests, using current broker side/quantity and pending protection rather than only BUY/SELL labels. Each mutation needs approval; an approved partial exit does not authorize a later stop change automatically. No entry writer or autonomous-management permissions are part of this release.

## Continuous engine and copilot

Live update → normalize → update memory → evaluate supported rules → publish entry/management evidence → recommend or stage an exit/protection ticket.

Exact human approval → revalidate current exit eligibility/ticket → checkpoint → submit → reconcile broker status/fills. The monitoring loop cannot submit directly.

Meaningful event/user request → fresh compact engine snapshot → OpenCode/model/tools → validated explanation/draft → review.

The first path never waits for the second. Merge repeated episodes; do not call a model each tick. Start with the live copilot and necessary domain tools. Large role/skill/command trees, deep premarket, journal, research/backtesting, recording/replay, and historical analytics are deferred.

Tradebooks keep the trader's setup/management narrative and its reviewed interpretation with deterministic/human/advisory/unsupported coverage per clause. The trader does not have to write a rule language. One position can follow a different setup's style from another. Freeze an enabled/attached snapshot; file edits or AI drafts cannot silently change active rules. Qualitative assessments without agreed observable criteria stay advisory or require assistant approval. The handoff defaults to Markdown narrative plus a revision/hash-linked JSON interpretation and explicit review/attachment; no complete immutable-history database is required.

## Files and recovery

Keep only current config, tradebooks, active plan, and one small recovery checkpoint. The checkpoint contains unresolved broker attempts plus active-position rule/tier metadata not recoverable from Schwab. All live chart/signal/account/session projections, drafts, unused approvals, and buffers stay in memory.

Before a broker request, write its minimal attempt successfully through a serialized temporary-file replacement. Prune resolved attempts/closed attachments. No append-only event framework, every-tick recording, indexes, migration scaffolding, or general file database.

Restart loads artifacts in observer state with monitoring attachments awaiting confirmation, refetches feeds/account, reconciles uncertainty, discards drafts/approvals, and confirms attachments before reactivating their monitoring. No standing action authority is restored. Unreadable recovery data blocks new broker writes until resolved while observer/charts continue.

UI reconnect fetches current state. An in-memory runtime-instance/sequence envelope and bounded buffer bridge snapshot/events within one run; no durable event replay is needed. Distinct action/signal transitions stay visible during the session; high-rate visual updates may coalesce.
