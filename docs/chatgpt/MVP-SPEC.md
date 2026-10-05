# Cairo simplified MVP behavior and contracts

**Current first milestone:** save/reopen original premarket notes and discuss
them with AI using timestamped one-minute chart knowledge. Notes can be saved
without a machine-readable policy; reviewed guidance is attached separately.
Bookmap detection journeys below remain in the full MVP and move to the final
feature phase. See [scope revision](PREPARATION-MANAGEMENT-PHASE.md).

Updated October 4, 2026. Planning notation only. Read [CODING-PLAN.md](CODING-PLAN.md) for the final coding checklist/defaults, [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries, and [PLAN-DECISIONS.md](PLAN-DECISIONS.md) for user-confirmed choices. The checklist turns remaining compatibility questions into early verification tasks.

## 1. Required live journeys

**Coauthor a tradebook/plan.** Preserve thesis, entry/context, invalidation, risk, and trader-authored management guidelines in human language. Each setup can have a different management style. Cairo proposes supported structured conditions/actions internally and shows a clause-linked plain-language readback plus deterministic/human/advisory/unsupported coverage. Traders do not need to write a rule language. Clarify material ambiguity; missing hard gates are not satisfied. The active plan binds date/symbol, levels, sizing, stop/targets, optional allocations, and reviewed policy. Save accepted Markdown narrative/JSON interpretation pairs; keep unaccepted drafts in memory. Freeze active snapshots and require review/reactivation before replacing them. Attach accepted guidance explicitly per position. See [MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md).

**Detect a setup.** Display observed/pending/invalidated conditions and source status. One eligible live Bookmap episode creates one observer signal for the active attempt. Repeated score updates amend it. Entry detection produces alerts/recommendations only; enabling an attempt does not authorize orders. The trader executes entries externally. Disconnect is different from no pattern. Identity/evidence stay in memory; restart clears the attempt, and REST chart snapshots cannot create fresh entry signals. Conditions needing an unavailable live price/candle source show unavailable rather than true.

**Manage a trade.** Current Schwab positions/orders appear whether entered through ViteApp, Schwab, or elsewhere. Attach the reviewed interpretation of the selected setup's guidelines, including explicit trade overrides; confirm unknown carry-in context/allocation attribution. Show the source instructions, actual quantity/basis, known protection, targets, triggered conditions, and unenforced clauses. Observer recommends; exit assistant stages exact approval tickets for supported partial/full closes or protective exit-order changes. Each broker mutation requires human approval; no rule submits automatically. Confirming an interpretation does not itself authorize orders. Model latency does not govern rule monitoring.

**Approve an action.** Show exact account/symbol/action/quantity/type/prices, affected position/working orders, and reason. Approve this ticket once, then revalidate current facts. A changed plan/position/order arrangement invalidates it. Accepted, working, partial, filled, rejected, and unknown are distinct outcomes.

## 2. Small domain objects

| Object | Meaning |
| --- | --- |
| Tradebook | Current ID/revision, setup/management narrative, clause-linked reviewed interpretation, capability issues |
| Active plan | Date/symbol, tradebook reference, concrete levels/risk/stops/targets/tiers/policy |
| Armed attempt | In-memory identity, frozen snapshot, arming/expiry/rearm state, data requirements |
| Market/Bookmap snapshot | REST bars/as-of context distinct from live Bookmap episodes; source/event/receive/fetch times, mode/readiness/quality |
| Signal | In-memory episode/attempt identity and rule evidence/state |
| Broker snapshot | Selected account, positions, working orders, recent fills needed for management, refresh status |
| Position attachment | Setup/plan/guideline interpretation snapshot, optional allocations, rule state, matching broker facts |
| Action ticket | Exact engine-built fields, state revisions, reason/evidence, expiry/approval/submission state |
| Recovery checkpoint | Unresolved attempted actions and open-position metadata not inferable from Schwab |

Use finite valid prices, preserving provider precision until broker order rounding. The initial writer can support whole-share equities; display unsupported/fractional holdings accurately and keep their actions manual. The session timeline is bounded memory, not an audit/journal.

## 3. Supported setup semantics

Begin with scalar comparisons, small AND/OR groups, registered Bookmap events, and scoped human confirmations. Unknown data yields unknown, not true. Advisory language cannot authorize execution. Map structured conditions to their narrative clauses; no arbitrary generated JavaScript or universal strategy compiler. T21-T24 define only the vocabulary needed by the selected examples, with clause coverage and explicit review/attachment.

Personal reference sources: [Gap Give and Go](../../../Backtest/tradebooks/gap_give_and_go.md), [bid reappear](../../../Backtest/tradebooks/bookmap_patterns/bid_reappear.md), [Bookmap rules](../../../Backtest/tradebooks/bookmap_patterns/bookmap_patterns.md). Preserve key-level entry, bid-reappear/step-up context, either-side-of-VWAP permission, and the trader's explicit stop/day-invalidation/management clauses. Define when any requested LOD/HOD is bound. Core/runner/scalp allocations are optional when requested; no generic breakeven rule is imposed. The existing badge alone does not prove “price never gets below” the original wall. Final initial seed examples remain to be selected; the per-setup human-language management direction is confirmed.

Management interpretation must establish needed condition/source/timing, level binding, action/quantity basis, once/recurrence state, dependencies/precedence, and permitted mode. Clarify only fields required by the actual guideline. Confirmed MVP boundary: reviewed rules monitor and recommend; exit actions require exact human approval. Qualitative clauses without agreed evidence remain advisory or human-confirmed. Never report an unsupported clause as enforced. Follow-up actions contingent on an exit fill wait for broker fill facts, not a target touch or accepted request, and require their own exact approval.

Separate candle reference: 1-minute ORB remains a coauthoring example and synthetic rule fixture, not a required live detector with the REST-only chart. Its intended semantics are a valid frozen 09:30–09:31 Eastern range followed by a fresh crossing of high + buffer for long (short explicitly mirrored). Buffer/window/confirmation/stop/risk/targets are plan inputs. Missing/zero range or missing fresh crossing data is not eligible. Fixture with synthetic fresh inputs: high 101/low 100, prices 100.98 then 101.02, zero buffer -> one long signal. Reading those bars from a REST snapshot alone must not produce that live signal. Live implementation awaits an agreed fresh source.

## 4. Feed/source contract

Charting is confirmed as Massive REST aggregated one-minute bars only. The user's available Massive WebSocket is already occupied by `bookmap-plugin`; Cairo opens none, including trade/quote/aggregate subscriptions. Adapt ViteApp's REST client/aggregate mapper; do not activate its trade-built loader, individual-trade backfill, or REST trade polling. Load on symbol/date selection and explicit Refresh; automatic polling/live data sharing is not required. Store normalized bars in a bounded memory snapshot, replace/upsert overlap by symbol/minute without summing volume, and preserve DST-aware session labels.

Show snapshot/no-live-updates status, last successful fetch time, and latest bar time. Preserve older data with an error/age if refresh fails; do not present a forming bar as final or its close as a current tick. These bars and their derived levels/features are timestamped context. Never let loading/refreshing them prove a fresh entry crossing or live exit condition. Source-dependent conditions require their own fresh observations. Bookmap event prices are not continuous quotes. Chart staleness alone does not disable fresh Bookmap-only monitoring or supported explicit trader-requested exits using current broker facts. Raw market-data sharing from Bookmap is deferred; pattern export below remains necessary.

Bookmap export still needs implementation; the handoff defaults to additive observation messages on the existing local WebSocket with server-pushed status/snapshot on connection and live updates thereafter. Minimum observations include source identity, sequence, live/replay/unknown mode, readiness, heartbeat/reset, detector/config revision, symbol mapping, episode/revision, and real-dollar trigger/reference prices. Preserve nanoseconds safely. No disk recorder, file-tail fallback, or replay system.

Source-dependent broker actions cannot use unknown/replay/unready Bookmap observations. Validate installed API metadata instead of inferring live mode from timestamps. Observation export must not invoke native broker execution.

## 5. Broker facts and optional allocations

Connection/token ownership is confirmed: consume a valid Schwab token produced by `bookmap-plugin` (bmtrader) from its configured local credential file and make direct backend Schwab calls. Cairo never refreshes or writes the token. Validate presence/expiry before use, adopt rotations, and mark broker state unavailable/stale when authorization is missing, expired, or rejected. Read the selected account, including external/carry-in positions and preexisting protection. Broker positions/orders are authoritative. Coalesce account refresh; deduplicate recent fill observations in memory. Check token rotation/expiry/rejection using fake credentials and broker responses, not live secrets.

If the trader's guideline uses tiers/allocations, their quantities sum to current broker quantity. Allocate only filled shares with a declared remainder rule. A partial-exit rule declares whether its fraction refers to initially filled shares or current remaining shares and how rounding works. Unknown outside exits/adds require an agreed allocation or confirmation. A single-position guideline needs no tier model. OCO siblings are alternative exits. Unsupported/ambiguous topology blocks assistant order changes, not position visibility. No complete fill-history ledger/tax-lot accounting is needed.

Use current broker quantity/basis and known stop for simple risk estimates. Any broker-returned marks/quotes retain their source/as-of metadata; do not add a quote stream just for valuation or substitute the stale chart close as a live mark. If no sufficiently fresh mark exists, current unrealized estimates/price-dependent triggers are unavailable. Preserve an active position's original-risk reference only when its rules need R. Targets touched are not confirmed fills.

## 6. Modes and tickets

| MVP mode | Entries | Exits / protective management |
| --- | --- | --- |
| Observer | Detect / recommend; trader enters externally | Monitor / recommend |
| Exit assistant | Detect / recommend; trader enters externally | Stage supported exact exit/protection tickets; human approval for every broker mutation |

Assisted entries and automated management are deferred. No auto mode, standing rule execution permission, entry writer, or automation scaffolding is required. Engine validation rejects opening, increasing, or reversing a position in every MVP mode, independently of UI or OpenCode tool permissions. Identify exits using current broker side/quantity and pending protection; BUY can close a short and SELL can open a short, so order side alone is not the check.

Stage → validate → request exact approval → revalidate → checkpoint attempted action → submit → broker acceptance/status/fills or rejection/unknown.

Drafts/unused approvals stay in memory. Before the actual broker request, save the minimal attempt successfully. Keep known broker IDs; prune resolved attempts. A failed checkpoint prevents submission. An accepted order may remain working; it is not “unresolved” merely because unfilled.

Serialize per account/symbol and reserve in-flight/unresolved quantities. Duplicate command/approval/episode update cannot submit another local copy. Recheck current quantity, exact fields, working orders, rule/policy state, and source requirements.

Timeout-after-send is unknown: reconcile known IDs/recent orders; **never blindly retry**. Local files/deduplication do not promise exactly-once broker execution. Ambiguous matching requires resolution before conflicting actions. Support only a few tested partial/full-close and protective exit-order create/cancel/replace shapes for existing positions; unsupported stop/OCO transitions remain manual. Do not cancel/modify external entry orders in this MVP. Prefer broker-hosted protection. Changes after a fill need a new ticket and approval, not an automatic chained action.

## 7. OpenCode/Cairo plugin contract

Use the selected OpenCode V2 runtime, proposed as a pinned bundled server sidecar. The plugin is a thin adapter:

- Read current tradebook/plan, bounded market/Bookmap evidence, positions/working orders, and recent session events.
- Interpret per-setup human-language management guidelines into a clause-linked proposal, clarify gaps, and show a readback for review. Propose artifact revisions, entry observations, or exit recommendations; stage engine-built exit/protection tickets only.
- Wire exact-ticket approval and submission through engine policy. Generic tool allowance or model prose is not trading authority.
- Supply current context before requests/continuations and filter/coalesce meaningful engine events.

One live copilot is sufficient initially. OpenCode owns model-loop/session infrastructure; do not also implement a custom OpenAI loop or Agents SDK. It may retain internal session storage; Cairo adds no chat database.

Bound context/run frequency and handle cancellation/stale results. Numeric action/risk fields come from engine code. Partial streaming text never applies a plan/order. AI unavailability does not stop charts/account refresh/deterministic alerts/named rules.

## 8. In-memory API and retention

Small local routes: health/snapshot, bars/current context, authored artifacts, plan arm/disarm, account/position/orders, plan attachment, ticket stage/approve/dismiss, broker refresh, and engine events. Use OpenCode client events for chat/permissions; do not duplicate its session API. No journal/history/replay/database-query routes.

Commands include local identity and relevant state revision. Events include runtime-instance identity and in-memory sequence. Buffer while loading snapshot; after disconnect/restart fetch fresh state. No durable event replay requirement.

Keep current config/tradebooks/active plan and one small recovery file. Unresolved action fields: local/account/symbol identity, exact submitted request, attempt time, any broker ID, uncertain outcome. Active attachments: plan/rule snapshot, known tiers, matching quantity/basis, already-applied rule state if not recoverable from broker. Prune resolved/closed entries; no event archive.

Restart starts in observer mode, refetches market/account facts, reconciles uncertainty without automatic resend, confirms attachments, discards drafts/approvals/old signals, and requires monitoring reactivation. OpenCode history cannot revive an approval. Unreadable recovery blocks writes until resolved; charts/observer remain usable.

## 9. Meaningful acceptance

1. Different setups' human-language management guidelines produce different reviewed policies; each rule traces to its clause, no generic style is inserted, and unsupported/ambiguous hard gates stay visible.
2. An eligible Bookmap episode creates one signal; updates do not duplicate tickets. ORB is an example/fixture until fresh crossing data is available.
3. Cairo opens no Massive WebSocket or trade-polling substitute. REST refresh replaces/upserts bars without double-counting volume; snapshot age is visible and stale bars never issue fresh entry/exit triggers.
4. Replay/unknown/unready sources never drive live writes.
5. External positions/stops/OCOs appear; acceptance is distinct from fill.
6. Partial/outside fills cannot cause excess closes or silently wrong tiers.
7. Entry signals never submit broker actions. Observer writes nothing; exit assistant submits only approved current exact exit/protection tickets. Opening/increasing/reversing requests are rejected even with generic tool permission or ticket approval.
8. Duplicate approval sends once locally; unknown submit is reconciled without blind retry.
9. Failed checkpoint prevents sending; restart discards approvals and requires rearming.
10. AI stalls and renderer reload do not stop the engine.
11. Windows package starts without developer tooling or Cairo database dependencies.

Use small synthetic/fake broker/provider fixtures. No live orders/paid inference are required by automated checks; historical audit/replay tests are deferred.
