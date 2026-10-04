# Cairo simplified implementation checkpoints

Updated October 4, 2026. Planning only. This replaces the earlier M0–M9 database/history-heavy sequence. Read [SIMPLIFIED-MVP.md](SIMPLIFIED-MVP.md), [MVP-SPEC.md](MVP-SPEC.md), and [PLAN-DECISIONS.md](PLAN-DECISIONS.md). The plan is not finalized; resolve each pending choice before implementing its dependent work.

## Proposed order

Desktop/engine → chart/account visibility → Bookmap/live rules/observer → one OpenCode copilot → approved exit tickets/recovery/writer. The confirmed MVP ends with observer entries and exits up to assistant. Assisted entries and automated management are deferred.

No Cairo SQLite, ORM, migrations, event-store/audit framework, every-tick recording, journal/research module, or custom OpenAI loop alongside OpenCode. One project with clear modules is sufficient.

## M0 — Windows shell and selected runtime proof

Resolve engine hosting first. Deliver a TypeScript/Electron shell with React/Vite, engine lifecycle, in-memory state, health/snapshot, one engine event stream, current artifact file load/save, and native notification.

Prove a pinned Windows OpenCode server/client/plugin combination with one fake Cairo read tool, current-context hook, meaningful synthetic event, and mock ticket/permission interaction. Keep its own session storage internal. Do not build role/skill catalogs.

Acceptance: renderer reload preserves engine/feeds, exit shuts down owned processes, restart loads artifacts unarmed/observer, unpacked Windows app needs no global Bun/Node. No database packaging spike or paid/broker calls.

Inspect installed Bookmap source/mode/price/config metadata and existing Schwab connection examples read-only. Do not read secrets or invent API fields.

## M1 — Broker visibility and basic snapshot chart

The corrected chart pipeline is confirmed: Massive REST aggregated one-minute bar snapshots, with no Cairo Massive WebSocket because the user's available connection belongs to Bookmap. Adapt ViteApp's REST `getPriceHistory`/`getBars` and `mapAggregate`, not its streaming protocol, trade-built `MarketLoader`, or trade backfill. Broker ownership/transport is confirmed: consume a valid token produced by `bookmap-plugin` (bmtrader) from its configured credential file without refreshing/writing it; use direct backend Schwab HTTP. Selectively adapt ViteApp pure modules, not its whole browser runtime. Test token presence/expiry, rotation adoption, authorization rejection, and stale-state behavior with fixtures; no ProxyServer or Cairo OAuth UI is needed.

Deliver load-on-selection/manual-refresh one-minute candles/volume with essential plan/order overlays, snapshot/fetch/latest-bar timestamps, and aggregate normalization/upsert. No candle freshness guarantee, auto-polling, or chart polish is needed. Deliver selected-account positions/working protection, coalesced account refresh and recent-fill deduplication. Keep broker/live Bookmap facts distinct from REST chart context. Proposed UI is one focus symbol; held positions continue monitoring independently of chart focus/age.

Acceptance: no Massive WebSocket or REST trade-polling substitute; one-minute aggregate mapping and refresh overlap do not double-count volume; snapshot age/errors are visible; stale/refreshed chart bars never produce fresh entry/exit triggers. External/preexisting positions are visible, OCO protection is not double-counted, and expired connection is visibly degraded. No full past-fill ledger or journal.

## M2 — Bookmap and usable observer

Resolve bridge transport, tradebook activation, and initial seed examples/additional required observations. Management direction is confirmed: per-setup trader-authored human-language guidelines, interpreted and enforced by Cairo. Deliver the smallest observation-only export/stream from the existing detector and Cairo normalization for alias/real prices, episode updates, mode/readiness/heartbeat/reset, detector/config revision. Recording/file-tail replay is not mandatory.

Add selected tradebook/current plan, source management narrative and reviewed internal interpretation, supported comparison/group/event/human gates, per-clause capability issues, frozen active snapshots, and explicit monitoring activation. Keep the ORB as a separate narrative/synthetic fixture; live crossing detection is deferred until a fresh source is agreed. Before the M3 copilot, use manually reviewed example interpretations for these engine fixtures, not a trader-facing rule editor or preset selection. Show Bookmap signal evidence, position-management alerts/recommendations, bounded session timeline, and notifications. Identify fresh price/quote/candle clauses unsupported by the available observation export; do not infer them from a stale chart or silently add a feed.

Acceptance: one episode/crossing per attempt; unsupported personal clauses remain unresolved; no blanket VWAP/breakeven substitution; replay/unknown sources cannot authorize writes; native Bookmap and Cairo do not both execute. Observer works with AI unavailable and submits nothing.

The plugin currently has serializable in-memory signals, not an implemented exporter/feed. If installed metadata cannot prove live mode, keep observer-only and report the exact dependency. Follow sibling repository instructions when scoped adapter implementation is authorized.

## M3 — One live copilot and collaboration

Use OpenCode V2 with a thin Cairo plugin. Deliver streaming chat, fresh context, bounded reads, artifact/action proposals, engine ticket staging, meaningful-event coalescing, cancellation/stale-result handling, and review/accept of current artifact edits. Implement [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md): human-language input per setup, traceable interpretation, targeted ambiguity clarification, coverage/readback, and reviewed attachment to the actual position. Traders need not write JSON/YAML or select a built-in style.

Acceptance: two different setup guidelines produce different reviewed policies without inserted defaults; unsupported/invented conditions never arm, invalid/stale outputs never apply, live edits cannot replace active policy silently, and engine continues during model stalls. OpenCode owns continuation/compaction/session storage. No custom runner, duplicate chat database, five-role tree, researcher, or journal agent.

## M4 — Approved assistant exits and minimal recovery

Deliver exact exit/protection ticket cards, one-time approval/revalidation, deterministic supported payloads, local command deduplication, account/symbol queue, pending quantity reservations, and one small recovery checkpoint. Entry signals remain observer-only and traders enter externally. Reject requests to open/increase/reverse positions in the engine, including approved or directly tool-requested actions. Checkpoint minimal attempt before request; a failed write prevents sending. Prune resolved attempts/closed attachments.

Implement supported partial/full closes and protective exit-order create/cancel/replace shapes for existing positions, with partial fills and known stop/OCO topology. Unsupported arrangements stay manual. Do not modify external entry orders. Every mutation, including a follow-up stop change after a partial exit fills, needs a new exact approval. Reconcile acceptance/rejection/unknown responses; never automatically retry uncertainty. Startup discards drafts/approvals, refetches current facts, resolves attempts, confirms attachments, and requires reviewed monitoring reactivation.

Acceptance with fake broker: no entry/increase/reversal or automatic rule write, no unapproved exit write, repeat approval sends one local request, changed state invalidates, acceptance ≠ fill, timeout-after-send reconciles, excess closing protection cannot remain unnoticed, checkpoint failure sends nothing, restart resumes no approval. Verify exit classification using position facts rather than BUY/SELL alone, and verify that a fill-dependent follow-up stops at a new approval ticket.

Package private Windows app and document supported observer rules/assistant exit orders. This is the confirmed initial MVP completion boundary. No live trade is required merely to complete implementation.

## Deferred execution capabilities

Assisted entries and automated management require a later separately authorized plan. Do not add entry-order writers, auto-mode UI, standing execution permission, automatic follow-up actions, or automation rule scaffolding in this MVP. Preserve clear rule monitoring/ticket boundaries so later work can reuse them without expanding today's permissions.

## Verification and later work

Test difficult state transitions with small fake-clock/feed/broker fixtures: episode duplicates, REST snapshot refresh/upsert/age, stale-chart trigger suppression and independent Bookmap monitoring, source mode, partial fills/OCO, stale tickets, failed checkpoint, unknown submit, and restart. Verify chart load/refresh never constructs a Massive WebSocket. Type-check and run relevant fixtures plus packaged Windows smoke after the relevant changes. No every-component tests or captured-session recorder required.

Defer raw market-data sharing/live candles/live ORB, deeper prep/news/scanning, journaling/analytics, recording/replay, research/backtests, CLI/macOS, and security/scalability infrastructure. Add a database later only if actual retained history/query needs justify it. No commits or remote pushes are part of this planning update.
