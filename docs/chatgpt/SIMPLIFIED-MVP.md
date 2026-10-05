# Cairo: simplified live-trading MVP

**October 4 scope revision:** The first app delivers freeform premarket notes
and AI chat grounded in timestamped one-minute chart snapshots. Trade management
follows. Bookmap observation work remains in the full MVP and moves to the final
feature phase. The earlier Bookmap-first sequence below is superseded by
[PREPARATION-MANAGEMENT-PHASE.md](PREPARATION-MANAGEMENT-PHASE.md) and the revised
CODING-PLAN.md task dependencies. No plugin work is required for the initial app.

October 4, 2026. This replaces the earlier database/history-heavy MVP. The user requested no SQLite, prioritized live trading, and selected **Embedded OpenCode V2 with a Cairo plugin**. Planning only.

For coding, [CODING-PLAN.md](CODING-PLAN.md) is the final handoff: 50 small tasks with checks and separate local commits. It selects explicit defaults for the discussion-stage details below and supersedes this document's coarse proposed work sequence.

[PLAN-DECISIONS.md](PLAN-DECISIONS.md) records user choices. React/TypeScript/Vite, read-only Bookmap-maintained Schwab tokens with direct backend requests, REST one-minute chart snapshots without a Cairo Massive WebSocket, human-language setup-specific management, observer entries, and assistant exits are confirmed. The final coding handoff selects main-process engine, WebSocket observations, Markdown narrative/reviewed JSON interpretation with explicit attachment, one focus chart/model, and the personal narrative/ORB fixture defaults. Compatibility questions become early verification tasks. Raw-data sharing/live candles, assisted entries, and automated management are deferred.

## The first useful product

A Windows desktop where the trader writes preparation notes, discusses the
one-minute chart snapshot with AI, and later reviews management of positions
entered externally. Broker facts enrich management when connected. Bookmap
evidence and live setup detection arrive in the final feature phase.

Traders describe management in their own words, with different styles for different setups. Cairo clarifies material gaps, shows a clause-linked interpretation for review, and attaches the accepted policy to each trade. It enforces supported rules in the selected mode; presets and tier structures are optional examples, not required styles. See [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md).

For entries, Cairo monitors/detects and recommends only; traders execute through their existing platform. For exits, observer mode monitors/recommends and assistant mode stages exact partial/full-close or protective exit-order tickets for human approval. Every broker mutation needs its own approval, including a follow-up after a fill. Engine validation rejects opening/increasing/reversing a position. Assisted entries and automated management are deferred; there is no automatic-management milestone or scaffolding in this MVP.

The lean proposal is one focus chart and one configured model. Held-position monitoring must continue independently of chart focus/age. Leave the heatmap and wall-pattern algorithms in Bookmap; Cairo consumes their observations through a still-needed pattern bridge. The one-minute REST chart loads on selection/manual Refresh and shows its age. It supplies context, not live price triggers. The 1-minute ORB is a separate narrative/synthetic reference; live ORB awaits an agreed fresh source.

## What gets simpler

| Earlier requirement | Simplified MVP |
| --- | --- |
| SQLite, tables, repositories, ORM/migrations, adapter packaging spike | No Cairo database dependency |
| Complete signals/fills/decisions/AI history | Current in-memory state and bounded session timeline |
| Saved drafts/approvals | In memory; discard on restart |
| Recording and deterministic captured-session replay | Deferred; small synthetic fixtures suffice for checks |
| Journal/research modules and background workflows | Deferred; no initial journal/backtest screens |
| Full immutable version-history archive | Current authored artifacts plus frozen snapshots needed by live attempts/positions |
| Universal strategy compiler/plugin framework | Supported typed conditions for selected setups, with honest capability gaps |
| Many packages/roles/skills/commands | Small modules, one live copilot, thin Cairo plugin |
| Every-tick persistence or append-only audit schema | No automatic feed/history recorder |
| Assisted entries and rule-triggered automatic management | Observer entries; approved assistant exits/protection only |
| Cairo Massive WebSocket, live trade-built candles, raw-data relay | REST one-minute snapshot chart; connection remains with Bookmap |

Broker connection is resolved as existing credentials with direct transport. Charting is corrected to REST-only snapshots; the earlier trade-built live candle decision is superseded. The execution release boundary is also resolved. Human artifact format, observation bridge transport, and UI/model scope are discussed separately. Simplification is not a reason to silently replace those choices.

The user will always run `bookmap-plugin` while trading. Cairo treats it as an existing companion for token renewal and Bookmap observations; plugin launching and a standalone Cairo broker login are outside this MVP.

## Keep only essential authored/recovery files

These live in the user's Cairo data directory, outside the repository. Use the small file names/defaults in CODING-PLAN.md; the narrative is Markdown and its reviewed internal interpretation is JSON.

| File/artifact | Retained contents | Reason |
| --- | --- | --- |
| Config | Selected account/source settings, model setting, UI preferences | Avoid configuring each launch |
| Current tradebooks | Original setup/management narrative, clause-linked reviewed conditions/actions and coverage, current revision | Authored material cannot be rebuilt from a feed |
| Active plan | Date/symbol, tradebook reference, levels, sizing, stop/targets, optional tiers | Avoid retyping the plan; loading does not arm it |
| Small recovery checkpoint, e.g. .state/recovery.json | Unresolved attempted broker actions and active-position plan/tier/rule facts not inferable from Schwab | Avoid repeating an uncertain request or applying the wrong management rule after restart |

Use one serialized temporary-file replacement writer for small snapshots. Before a broker request, checkpoint its minimal attempted action; if the write fails, do not send. Prune resolved attempts and confirmed-closed position metadata. The checkpoint is not an event store, history index, or general repository layer.

An unresolved action needs local ID, account/symbol, action kind, exact submitted fields, attempted time, any known broker order ID, and unresolved outcome. An active attachment needs the rule/plan snapshot, broker quantity/basis used for matching, known tier allocation, and already-applied management rule IDs where broker facts cannot reconstruct them. No credentials, complete broker payload history, or explanation transcripts belong there.

Unused approvals and staged drafts are never saved as future trading authority. A resolved accepted order becomes a broker fact; keep only unresolved references and active rule metadata, not a growing order archive.

## Keep live state in memory

REST bar snapshots/as-of context, Bookmap episodes/source status, observer-attempt signal deduplication, current broker positions/orders/recent fills and timestamped returned marks, notifications, session timeline, proposals, drafts, and approvals. No independent Massive trades/quotes cache or stream. Bound caches by the current session or a small explicit limit; refresh bars manually when needed.

OpenCode can keep its own conversations/runtime state. Cairo does not duplicate that storage and does not promise OpenCode is internally database-free. A restored conversation is never authority for the current position or permission to submit.

The cost is deliberate: after restart there is no complete Cairo signal/evidence/decision timeline, replay, or reconstructable journal. Broker history can recover recent fills but not every earlier interpretation or tier attribution. This is acceptable for the live-first MVP.

## Startup and restart behavior

1. Load current artifacts/recovery; start in observer mode with monitoring attachments awaiting current-state confirmation.
2. Fetch the one-minute REST chart snapshot and connect Bookmap observation/status output. Keep historical chart context separate from live observations; loading/refreshing bars never generates fresh entry/exit triggers.
3. Fetch selected Schwab positions and working orders, including external/carry-in trades. Broker facts are authoritative.
4. Reconcile unresolved attempts using known broker IDs/recent orders. **Never automatically retry an uncertain submission.** Ambiguous matching is shown and resolved before conflicting actions.
5. Match saved position attachments to current facts. Unknown quantity, basis, working orders, or tier attribution requires confirmation.
6. Discard old drafts and approvals. Rebuild an actionable ticket from fresh state when needed.
7. Reactivate entry observation attempts or management monitoring only after current state is confirmed. Saved assistant preferences never restore an approval; every exit mutation needs a fresh exact ticket and approval.

If recovery data is unreadable, keep observer/charts usable but block Cairo broker writes until possible pending actions/current state are resolved. Broker-hosted protective orders remain at Schwab according to broker behavior. Cairo-only monitoring and software exits require the app and relevant feeds.

## Keep the harness small

The continuous engine handles feed/account updates and deterministic rule evaluation. It never waits for a model. The copilot runs on user requests and a few meaningful events, merging repeated episode updates rather than inferring every tick.

OpenCode owns model calls, sessions, streaming, tool continuation, compaction, and generic permission interaction. A thin Cairo plugin supplies fresh context, read/proposal/staging tools, event filtering, and exact-ticket approval wiring. The engine owns trading arithmetic, actual broker state, mode policy, validation, and submission.

The supplied plan's baseline is a bundled headless OpenCode server sidecar. Prove the pinned Windows/plugin/client combination; choosing OpenCode does not settle engine hosting. React/TypeScript/Vite is independently confirmed for the UI. No custom OpenAI loop or Agents SDK implementation is needed alongside it.

## Proposed work sequence

- Desktop/engine lifecycle, in-memory snapshot/events, current artifact loader.
- Schwab position/order visibility and a basic REST snapshot chart.
- Bookmap observation export, selected personal setup, observer alerts and management recommendations; ORB stays a narrative/synthetic example until fresh data exists.
- One copilot and collaborative tradebook/plan review.
- Exact approved exit/protection tickets, minimal recovery checkpoint, tested Schwab exit writer/reconciliation: confirmed MVP completion.

Detailed architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Behaviors/checks: [MVP-SPEC.md](MVP-SPEC.md). Checkpoints: [IMPLEMENTATION.md](IMPLEMENTATION.md).
