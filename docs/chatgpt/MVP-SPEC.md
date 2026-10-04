# Cairo MVP behavior and contracts

This specification defines the implementation target. Schemas and examples below are planning notation, not implemented source. Read [ARCHITECTURE](ARCHITECTURE.md) and [IMPLEMENTATION](IMPLEMENTATION.md) alongside it.

## 1. Required user journeys

### Collaborate on a tradebook

The trader imports a Markdown tradebook or starts a conversation. Cairo preserves its thesis, context, entry/invalidation/risk/management rules, quality filters, and examples. It proposes a structured interpretation with a clause-to-rule mapping and an explicit list of ambiguous/missing conditions.

The trader can edit the narrative, choose observable conditions, attach examples, and compare a proposed revision with the published version. Publishing creates an immutable `TradebookVersion`. A daily plan supplies the symbol, date, concrete levels/targets, risk/quantity, tier allocations, and execution policy. A new setup does not have to match an application-owned strategy name to be documented and used in observer/assistant mode.

The compiler shows automation coverage per clause:

- `deterministic`: executable with a supported feature/detector and present data.
- `human`: requires a recorded trader confirmation for a defined scope/window.
- `advisory`: AI can discuss it, but it cannot independently authorize execution.
- `unsupported`: requires a new detector/data adapter or clearer definition.

Do not claim "fully automated" when a hard entry/management clause is unresolved. Publishing narrative and arming executable rules are separate operations.

### Detect a live setup

The trader binds a published tradebook to a symbol/date, reviews its capability/data requirements, and arms it. Cairo displays the observed conditions, pending conditions, invalidation, and source status. A new eligible pattern/bar event creates one signal episode with evidence; subsequent updates amend its score/details instead of creating new entry tickets.

Bookmap-dependent rules require a connected, ready observation source. Candle-only rules require the selected Massive inputs. A human context confirmation can make an otherwise discretionary tradebook usable in assistant mode, but cannot magically supply missing depth observations.

### Manage a Schwab trade

Schwab fills/positions populate Cairo whether the trade originated in Cairo, ViteApp, or another Schwab interface. Attach the appropriate plan; confirm unknown carry-in information when needed. Position cards show quantity, basis, planned tiers/stop/targets, actual working orders, current risk/estimates, and triggered rules.

In observer mode, a triggered rule creates an alert and recommendation. In assistant mode, it creates a concrete reviewable ticket. In automated mode, an armed deterministic rule can create an order intent without another prompt. AI explanations may arrive later and do not govern the execution transition.

### Review and replay

After a trade closes, the trader sees the versions used, signals, approvals, fills, management decisions, and notes. AI can summarize process adherence separately from P&L. Replay a recorded input stream through the same evaluator with a fake clock and simulated broker; do not send orders or call the model merely to reproduce deterministic decisions.

## 2. Domain objects

| Object | Essential fields / meaning |
| --- | --- |
| `TradebookVersion` | Tradebook ID/version, name, narrative Markdown, direction, contextual clauses, entry/invalidation/management rules, quality filters, example references, compiled capability report, detector references |
| `TradingPlanVersion` | Plan ID/version, tradebook ID/version, trading date, symbol, direction, level/feature bindings, entry window, stop/risk definition, tiers, daily invalidation/rearm policy, execution policy |
| `DetectorDefinition` | ID/version, required inputs, parameter schema, output schema, event-time semantics, fixture references |
| `Instrument` | Canonical stock symbol, currency, tick metadata, provider alias mapping |
| `Bar` | Symbol, interval, start/end milliseconds, OHLC, volume, bar VWAP/null, source, revision, observation sequence, provisional/evaluated status |
| `FeatureValue` | Feature ID, value/null, event time, receive time, source, quality, evidence reference |
| `PatternObservation` | Bookmap source identity/mode, symbol, pattern/version, episode/revision, event time, receive time, trigger/reference prices, quality index, contributions, configuration version, available wall/context facts |
| `Signal` | ID, plan/tradebook versions, symbol/direction, episode key, detection/expiry times, state, evidence, linked intent/trade |
| `Position` | Account/symbol/lifecycle ID, direction, net quantity, average basis, carry-in flag, realized estimate, broker version, plan attachment, initial risk, logical tiers |
| `BrokerOrder` | Broker ID, parent/OCO relationships, instructions, original/filled/remaining quantity, prices, status, raw supported payload |
| `Fill` | Stable provider execution identity or documented composite identity, order/leg IDs, time, price, quantity, instruction; never inferred from quote/target touch |
| `ActionIntent` | Intent ID, reason/rule/evidence, entry/reduce/close/replace/cancel, quantity/tier, requested order details, source versions, approval/policy decision, state |
| `AIProposal` | Proposal type, context versions, grounded facts, assumptions, proposed fields, validation result, accepted/rejected/historical state |
| `JournalEvent` | Local sequence, timestamp, type, subject IDs, fact payload/evidence; interpretation stored separately |

Use finite positive real prices; preserve provider fractional precision in observations. Broker order-price rounding uses instrument/order rules, not a blanket rounding of every market price. Whole-share submitted orders are the initial supported writer. A fractional/unsupported broker holding is displayed accurately and does not get rounded into an automated order.

## 3. Tradebook rule language

Use a bounded typed expression/sequence model rather than arbitrary code:

```ts
type Condition =
  | { kind: 'compare'; left: ValueRef; op: 'gt'|'gte'|'lt'|'lte'|'eq'; right: ValueRef }
  | { kind: 'all'|'any'; conditions: Condition[] }
  | { kind: 'event'; detectorId: string; detectorVersion: string; parameters: object }
  | { kind: 'hold'; condition: Condition; durationMs: number }
  | { kind: 'sequence'; steps: Condition[]; withinMs: number }
  | { kind: 'human'; clauseId: string; scope: 'session'|'attempt'|'position' }
  | { kind: 'advisory'; clauseId: string };

type ValueRef =
  | { kind: 'literal'; value: number }
  | { kind: 'binding'; name: string }
  | { kind: 'feature'; name: string };
```

This is illustrative syntax. Implement strict discriminated schemas, bounded nesting (initially depth 4), registered feature IDs, and parameter validation. Restrict the first implementation to `compare`, `all/any`, registered `event`, and `human`; implement `hold/sequence` only for a selected tradebook that needs them. Existing Bookmap detectors already encapsulate their temporal wall behavior; do not duplicate their state machines in this DSL.

Logical evaluation is three-valued: true, false, unknown. `all` is false if any child is false, true if every child is true, otherwise unknown. `any` is true if any child is true, false if every child is false, otherwise unknown. A missing feature/source is unknown. Advisory conditions never satisfy a required executable gate.

Every rule carries `id`, `sourceClauseId`, `phase`, `requiredInputs`, and `capability`. Automated management rules also carry an explicitly permitted action. Hard gates, invalidation, and soft quality scores are distinct. Crossing/sequence memory is scoped to the armed attempt, not reconstructed from an unbounded chat.

Feature registry starts with price/quote fields, prior-session/premarket levels, closed candles, regular-session VWAP, 1-minute opening-range high/low/readiness, position quantities/R, and named Bookmap observations. Avoid implementing every possible indicator in the first milestone.

Compiler checks: valid version references, direction consistency, session window ordering, positive/known risk, supported data, no ambiguous quantity/tier action, no contradictory hard rule, all required plan bindings supplied, and each policy permission tied to a specific compiled rule. It returns human-readable issues and a normalized execution graph. An incomplete narrative is still saveable; an incomplete automated policy is not armable.

## 4. Two reference tradebooks

### Personal example: Gap Give and Go / bid reappear or step-up

Source: [active Backtest tradebook](../../../Backtest/tradebooks/gap_give_and_go.md), [bid reappear](../../../Backtest/tradebooks/bookmap_patterns/bid_reappear.md), [Bookmap global rules](../../../Backtest/tradebooks/bookmap_patterns/bookmap_patterns.md).

The initial imported structure should preserve:

- Long context and higher-timeframe stock selection, initially trader-confirmed.
- A chosen key level and entry above that key level.
- A supported bid reappear or bid step-up observation from Bookmap.
- No universal VWAP gate: this tradebook permits either side of VWAP.
- Explicit LOD stop/day invalidation and the instruction not to casually move it.
- Core target commonly at intraday high; bind a concrete reference/price.
- Runner trigger/target and scalp/core/runner percentages supplied before entry.

Do not fill every ambiguous clause automatically. In particular, define whether LOD means the low at arming, at entry, or a later lower low. The existing detector's bid-reappear badge does not by itself prove the narrative condition "price never gets below" the original wall. Preserve that clause as human-confirmed until the observation payload/history can verify it. Import should show this gap.

An example rule combines human context confirmation, a bid-reappear/step-up detector event, and price above the bound key level. A soft minimum quality-index filter can be a trader option; do not invent one from the published tier labels. The score is not a win probability.

### Candle example: 1-minute opening-range breakout

This is a platform example for other traders, not an imported personal strategy.

1. Capture the valid regular-session 09:30:00-09:31:00 Eastern minute and freeze its high/low for the attempt after Cairo's close watermark.
2. Before range readiness, entry eligibility is unknown.
3. Long trigger: an eligible fresh price moves from at/below `rangeHigh + entryBuffer` to above it. Short is explicitly mirrored below `rangeLow - entryBuffer`.
4. `entryBuffer`, allowed time window, stop choice, quantity/risk, and targets are plan inputs. A closed-bar confirmation variant is a separate parameter, not silently interchangeable with price crossing.
5. If the first minute is missing, zero-range, or an invalid/gapped load, the example cannot arm; do not guess the opening range.
6. Only one live signal/entry intent per attempt. Repeated trades above the level do not create repeated orders. Rearm explicitly under the plan's policy.
7. Historical/backfilled breakouts may be shown as review evidence, never issued as fresh live entry tickets.
8. Use one logical position tier in the reference example; scalp/core/runner is available as an optional preset for a different management plan.

Synthetic acceptance fixture: first minute high 101.00/low 100.00; zero buffer; next eligible observations 100.98 then 101.02. This creates one long signal, with the stop/target/risk taken from the fixture plan. These numbers are test data, not trading recommendations.

## 5. Signal lifecycle

```text
draft plan -> armed attempt -> observing -> candidate -> ready
                         \-> invalidated / expired / disarmed
ready -> entry intent -> approval pending / policy permitted
      -> expired / dismissed
entry intent -> broker pending -> partially filled / filled / rejected / unknown
filled -> position management
```

`candidate` is optional for simple event rules. Source unavailable is a monitoring/data state, not proof of setup invalidation. A daily hard invalidation persists for that symbol/direction and cannot be cleared by a new AI draft without an explicit user rearm decision.

Signal identity includes tradebook/plan versions, armed attempt, detector episode or rule crossing episode, and direction. Bookmap episode updates may change quality/evidence while retaining the same signal and intent. Multiple rule interpretations of one episode are visible but cannot silently create multiple entries into the same attempt.

Keep detection time, event time, expiry, evidence operands, and source mode. Entry expiry is a tradebook/plan parameter. A changed plan, expired attempt, or incompatible position state invalidates the old ticket's applicability and requires a new validation/review. Expiry never removes an existing position's protection.

## 6. Bookmap bridge contract

### Existing versus required

Existing `bookmap_pattern_signal` serialization is suitable for a JSONL exporter and observer/replay import. The inspected plugin does not already implement the JSONL writer or live pattern feed. `id` can change on an episode update; `eventTimeNs` is a string; `timestamp` is creation time, not necessarily exchange event time. `referenceWallPriceTick` is not a real-dollar reference price.

The implementation must add a separate observation stream/configuration surface. Suggested additive message contract:

```ts
type BookmapObservationEnvelope = {
  schemaVersion: 1;
  sourceInstance: string;
  sequence: number;
  sourceMode: 'live'|'replay'|'unknown';
  snapshotReady: boolean;
  detectorVersion: string;
  configurationVersion: string;
  type: 'hello'|'status'|'pattern'|'wall_context'|'reset';
  symbol: string | null;
  eventTimeNs: string | null;
  payload: object;
};
```

Pattern payload: canonical pattern ID, direction, episode key/revision, real trigger/reference price (`priceUnit: 'real'`), wall peak size, quality index/contributions, relevant captured extreme/levels when available, and source signal ID. `wall_context` supplies only facts required by selected management rules; full depth transport/heatmap rendering is deferred.

Subscription/config: chosen instrument aliases/patterns, key levels/zones, thresholds, tradebook/config version. Add read-only pattern eligibility independent of native execution groups, while preserving existing display-only defaults. The existing detector should remain the authority for its eight patterns. A rule requiring a new context event is unsupported until that event is implemented and fixture-tested.

Validate instrument mapping, snapshot readiness, rule/config versions, and live/replay mode. Heartbeat/status distinguish no pattern from a disconnected source. Reset/replay seek clears temporal observation memory; initial historical snapshots cannot become fresh live signals. Log-tail import has `sourceMode: unknown` unless captured metadata establishes otherwise, so it cannot authorize orders.

The installed API's true replay/live metadata must be established during the bridge milestone. Do not manufacture `live` from a near-current timestamp. If unavailable, keep that source in observer mode and report this specific implementation dependency.

## 7. Broker projection and logical position tiers

REST positions/orders provide authoritative current quantities/status. Account-activity events request a refresh. A target touch is market evidence; a fill is execution evidence. A broker accepted response does not mean filled.

Use selected-account reads; handle working orders entered before today and executed today; build Eastern trading-day history windows; deduplicate fill legs across repeated order-tree reads. Opening fills, adds, partial exits, and reversals are separate events. A reversal closes one lifecycle and opens a new one. A carry-in position with missing prior fills uses its broker basis and flags incomplete history.

Store a plan-defined list of logical tiers with stable IDs, allocation percentages, and management rules. The personal preset uses `scalp`, `core`, and `runner`; the ORB reference uses a single tier. Allocate initial fills by plan percentages with a deterministic rounding/remainder rule whose totals equal the filled whole-share quantity. The personal preset assigns a remainder to core unless changed; other plans specify their remainder tier. Partial fills allocate only filled shares, not requested size. Adds require an explicit allocation; outside/manual exits use a declared allocation order or ask the trader to classify them.

Core and runner management follows the active tradebook. Generic breakeven/ATR trailing rules are not globally enabled. A "strong reversal" remains human/advisory unless the tradebook maps it to a measurable rule. Broker orders may not map one-to-one to tiers; store explicit allocation/order links and display unknown mappings. Never double-count both legs of an OCO as twice the protected quantity.

Risk/P&L examples:

- Initial risk reference: `abs(entryBasis - initialStop) * initialFilledQuantity`; unavailable if the initial stop/basis is unknown. Preserve this denominator for R reporting.
- Estimated remaining stop risk uses remaining quantity and the agreed/broker stop; proposed protection is labeled separately.
- Long liquidation estimate uses a valid bid; short uses a valid ask. Fees/commissions and unavailable spreads make the estimate incomplete.
- Realized estimates use a documented fill-ledger accounting method. Compare against broker totals rather than claiming automatic tax-lot parity.

Automatic rules may reduce/close an assigned tier, adjust a supported protective order, or activate a defined runner. They must account for current broker remaining quantity and already-working closing orders. Conflicting/unknown arrangements fall back to a reviewable assistant action.

## 8. Execution policy and action lifecycle

Policy planning notation:

```ts
type ExecutionPolicy = {
  mode: 'observer'|'assistant'|'automated';
  entry: 'recommend'|'approve';        // MVP automated mode still approves entries
  management: 'recommend'|'approve'|'rules';
  allowedRuleIds: string[];
  allowedActions: ('reduce'|'close'|'replace_stop'|'replace_target')[];
  maximumPositionQuantity: number;
  requiresLiveSources: string[];
};
```

An observer policy cannot reach a broker write. An assistant approval is for exact intent/version/quantity/side/order details, not unlimited future orders. An automated policy applies only to named deterministic rules and current plan/position attachment. Changing to observer disables pending policy execution immediately. User pause stops new Cairo actions while broker-hosted orders remain visible.

```text
proposed -> validated -> approval_pending | policy_permitted
         -> dismissed | invalid
approved/permitted -> submitting -> accepted -> working -> partial -> filled
                              \-> rejected | unknown
```

Save the intent before submission. Accept a `commandId` on UI commands and reuse the same intent for retries of that command. Do not promise exactly-once delivery at the broker: if the network fails after submission, show unknown, query/reconcile known order IDs/recent orders, and request manual resolution if identity is ambiguous. Never blindly repeat an unknown submit.

Before sending, revalidate actual quantity, instrument/side, price fields, working orders, applicable rule/policy versions, and required source mode. This is local order correctness; no distributed fences/account-ownership framework is needed.

Use one execution queue per account/symbol and account for quantities reserved by in-flight/accepted intents until the broker projection catches up. Two locally triggered rules cannot independently allocate the same remaining shares. OCO alternatives are counted by topology, not summed as independent exits. An unknown intent keeps its reservation until reconciled or explicitly resolved. Outside broker actions remain possible and must be reconciled; ambiguous arrangements pause new conflicting actions.

Initial supported order shapes:

1. Whole-share equity entry with explicit market/limit/stop type and a tested protective bracket when appropriate.
2. Broker-native stop/limit exits linked to known positions/tiers.
3. Human-approved partial/full closing order.
4. Rule-based partial/full close or stop replacement only for the tested managed order topology.

Reuse ViteApp's pure factories as examples; preserve actual broker status and IDs. Do not submit unsupported combinations as generic JSON from the model. Shorts depend on the broker's acceptance; Cairo does not invent borrow availability.

Cancel/replace and closing against live OCOs require explicit topology handling. Avoid leaving a full-size closing stop working after a separate closing order, or removing all protection without making the transition visible. Schwab does not become an atomic order coordinator merely because Cairo wraps several requests. Test sequential failures; if a layout cannot be safely handled by the implemented writer, keep that action assistant/manual.

A broker-hosted protective stop is preferred to a software-only protective stop. Automated Bookmap/thesis exits are supplementary rule actions; they require Cairo/feeds running. On restart, restore visibility, reconcile account state, and explicitly resume automated rules before new software-managed actions.

## 9. AI harness contract

### Tools

| Tool | Inputs / bounded result | Effect |
| --- | --- | --- |
| `get_tradebook` | ID/version -> narrative + structured rules | Read |
| `get_plan` | ID/version -> plan + capability issues | Read |
| `get_market_snapshot` | Symbol -> selected features, source times/quality | Read |
| `get_bars` | Symbol/interval/range, maximum 500 bars | Read |
| `get_bookmap_context` | Symbol/episode -> recent pattern/wall evidence | Read |
| `get_position` | Position ID -> quantity, basis, tiers, working orders | Read |
| `get_recent_events` | Symbol/subject and limit <= 50 | Read |
| `propose_tradebook_revision` | Existing version + draft clauses/rules | Save draft only |
| `propose_plan` | Published tradebook + plan bindings | Save draft only |
| `propose_management_action` | Position/version + suggested intent/evidence | Save proposal only |
| `draft_journal_review` | Trade ID + factual/interpretive sections | Save draft only |
| `propose_experiment` | Versioned setup, data scope, parameters | Save draft only |

No model tool is a general shell, arbitrary network request, SQL executor, or direct broker submit. App commands handle publication, arming, policy selection, approvals, and execution. This is a small domain surface, not a general coding harness.

All tools return an envelope: `ok`, result/error code, `asOf`, subject versions, source/evidence references, and completeness. Limit output size; query extra data deliberately. Public tool JSON schemas use strict mode, closed objects, and required nullable fields where needed by OpenAI's schema subset. Local domain validation remains mandatory. Use one sequential tool dispatch policy initially; independent-read parallelism can be added later if measured latency justifies it.

### Run flow

1. Choose mode-specific instructions/tools and load current factual context.
2. Start a Responses request with configured model, streaming, bounded output, strict tools or structured final output, and application-owned conversation state.
3. Preserve returned output items, including reasoning items needed for continuation.
4. Execute only completed validated tool calls; append a result with the correct `call_id`.
5. Continue within the mode's step/time budget.
6. Validate the complete final draft/proposal and current subject versions.
7. Persist outcome/usage/tool trace and publish it. Historical results remain readable but cannot auto-apply.

Use `store: false` with application-maintained context if selected; retain encrypted reasoning items when required for stateless continuation by the chosen model/API. Verify the exact SDK representation during implementation. Local persistence is independent of provider state.

A monitor/manager result should separate `facts`, `interpretation`, `missingInputs`, and `proposal`. Facts cite supplied evidence IDs. Numeric calculations used for orders/risk are produced or checked by core, not trusted from prose. A quality index or AI confidence label cannot be presented as a calibrated probability of profit.

### Failure behavior

| Failure | Required behavior |
| --- | --- |
| OpenAI unavailable/timeout/refusal/incomplete result | Mark interpretation unavailable; deterministic alerts/policies continue |
| Unknown tool or invalid arguments | Structured tool error; no side effect |
| Model draft has unsupported predicate | Save unresolved draft; do not arm that rule |
| Position/plan changed during inference | Show result as historical; refresh before actionable review |
| Bookmap disconnected/unready/replay | Dependent signal/action gates unknown or disabled; preserve broker protection |
| Massive reconnect/backfill | Restore context; suppress historical entry submissions |
| Schwab refresh/login failure | Visible degraded broker state; stop new Cairo submissions until resolved |
| Unknown submit/cancel/replace result | Reconcile status; no blind order retry |
| App exits | Monitoring/software exits stop; distinguish broker working orders from Cairo policy |

## 10. Local API and events

Routes are implementation targets, not generated code:

| Route | Purpose |
| --- | --- |
| `GET /health` | Runtime readiness/capabilities |
| `GET /snapshot` | UI bootstrap state + event sequence |
| `GET /tradebooks/:id/versions/:version` | Read published/draft tradebook |
| `POST /tradebooks/drafts` | Save draft |
| `POST /tradebooks/:id/publish` | Validate/publish immutable version |
| `POST /plans` | Save/validate daily plan |
| `POST /plans/:id/arm`, `/disarm` | Attempt lifecycle |
| `GET /market/:symbol/bars` | Normalized chart history |
| `GET /positions`, `GET /orders` | Current selected-account projections |
| `POST /positions/:id/attach-plan` | Explicit versioned attachment |
| `POST /positions/:id/policy`, `/pause` | Select/arm/pause execution policy |
| `POST /intents/:id/approve`, `/dismiss` | Exact action review |
| `POST /broker/connect`, `/callback`, `/refresh` | Desktop OAuth and account refresh |
| `POST /bookmap/connect` | Observation source/configuration |
| `POST /ai/runs`, `/ai/runs/:id/cancel` | Streamed copilot tasks |
| `GET /trades/:id/timeline` | Facts/evidence/journal |
| `GET /events` (WebSocket upgrade) | Chart/application/chat updates |

Command bodies include `commandId` and expected relevant object version. A version mismatch returns a conflict with the updated object. This prevents a stale draft approval, not a multi-user coordination system.

Event envelope: `schemaVersion`, local `sequence`, `type`, `observedAt`, optional `eventTime`, subject IDs, versions, and payload. Events include source status, bar upsert/correction, pattern observed/updated, tradebook/plan state, signal state, position/order/fill changes, management trigger, intent state, AI deltas/completion, and journal update.

WS subscribe/snapshot bootstrap must not miss intermediate events. Buffer on client before snapshot, then apply only events with larger sequence. After a runtime restart or reconnect, refresh the snapshot. Critical notifications have durable IDs for local deduplication. High-rate display updates can coalesce; distinct signals/fills/intent transitions cannot.

## 11. SQLite and recording

Initial tables: `tradebook_versions`, `plan_versions`, `armed_attempts`, `signals`, `broker_orders`, `fills`, `positions`, `position_tiers`, `execution_policies`, `action_intents`, `domain_events`, `ai_sessions`, `ai_messages`, `ai_runs`, `ai_proposals`, `bars`, `session_metadata`, `journal_notes`, and a schema-migration table.

Version rows are immutable; editing creates another row. Separate provider JSON from normalized fields, preserve meaningful broker statuses, and keep credential files outside the project/database/model context. Use small transactions for intent/event/projection updates. High-frequency raw observations go to the asynchronous recorder rather than one synchronous SQLite transaction per tick.

Recorder headers identify trading calendar, provider capabilities, detector/config versions, tradebook/plan versions, starting broker snapshot, and whether the recording includes raw depth, summarized walls, pattern events, or only bars. Recorded inputs carry arrival sequence and both times. Replaying pattern events tests Cairo's reaction to patterns; it does not independently validate Bookmap's raw-depth detector.

## 12. Acceptance scenarios

1. A tradebook can be imported/edited/published without rewriting its thesis into a generic setup.
2. Narrative-to-rule mapping exposes missing human/detector conditions; unsupported hard rules cannot be armed for automation.
3. Gap Give and Go's executable rules do not acquire an unintended VWAP filter or breakeven stop.
4. The ORB synthetic crossing creates one signal and repeated above-range prints create no duplicate entry.
5. Corrected `AM` candles replace values/volume; a late correction cannot retroactively issue a fresh live entry.
6. Backfill/reconnect restores charts but cannot submit a stale entry from the gap.
7. Bookmap episode score updates replace the observation and retain one action identity.
8. Price ticks are converted once; nanoseconds survive parsing; symbol aliases are explicit.
9. Replay/unknown Bookmap events never reach live Schwab writes. Disconnect is different from no pattern.
10. Schwab startup recognizes external/carry-in positions and supported standalone/OCO protection.
11. Partial/canceled/replaced orders retain fills without duplication; reversals split position lifecycles.
12. Tier quantities always sum to broker remaining quantity; an ambiguous outside exit is visible.
13. Observer produces zero writes. Assistant writes only after exact approval. Automated writes only from named armed deterministic rules.
14. Repeated user commands or detector updates cannot submit a second copy of the same intent.
15. Unknown submit outcome is reconciled/displayed, never blindly retried.
16. Closing/replacing tested OCO orders does not create excess closing quantity; sequential failures remain visible and actionable.
17. A stale AI result cannot arm/change a newer tradebook/plan/position policy.
18. Slow/unavailable OpenAI does not delay deterministic signals or permitted management.
19. Restart restores timeline/working-order visibility but requires explicit automation resume.
20. Deterministic replay produces the same signal/intent trace from the same recorded observed inputs, without live network/order effects.

Keep these as meaningful fixtures and integration checks. No live orders are part of the automated test suite.
