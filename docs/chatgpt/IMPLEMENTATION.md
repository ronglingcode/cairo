# Cairo implementation plan

Planning only. Nothing here has been built or validated against live accounts. The target is a personal Windows MVP, delivered as observer, then assistant, then automated management. Keep all changes local; never push a branch or commit.

## 1. How to use this handoff

Read [ARCHITECTURE](ARCHITECTURE.md), [MVP-SPEC](MVP-SPEC.md), and the relevant portion of [RESEARCH](RESEARCH.md). Implement one milestone at a time. Each milestone must leave a concrete demo and satisfy its acceptance conditions before proceeding. Do not ask an implementation model to create all packages, tools, providers, strategies, and modes in one pass.

The original request remains planning-only until the user starts implementation. This document is an implementation target, not authorization to begin coding now.

Preserve these decisions:

- TypeScript/SolidJS/Electron; Node utility runtime; Bun development tooling.
- Official Lightweight Charts and Massive history/live candles.
- Bookmap observations as a required personal-workflow input, reusing the existing detector.
- Schwab as broker/account/order authority, with one explicitly selected account.
- Reusable collaborative tradebooks separate from daily plan bindings.
- Deterministic detection/management alongside bounded OpenAI interpretation.
- Observer/assistant/automated modes with assistant entries as the first automated preset.
- Configurable logical tiers: the personal scalp/core/runner preset plus a single-tier ORB example.
- SQLite and inspectable decision/evidence records; meaningful fixture tests.
- No cloud/multi-user/scalability framework, coding shell harness, or whole OpenCode fork.

## 2. Release sequence

```text
M0 desktop/runtime proof
 -> M1 domain contracts + tradebooks + reference fixtures
 -> M2 Massive + charts
 -> M3 Schwab read/account projection
 -> M4 Bookmap observations + personal setup
 -> M5 OpenAI collaboration/harness
 -> M6 observer release + journal/replay foundation
 -> M7 assistant orders
 -> M8 armed automated management
 -> M9 packaged three-mode MVP verification

Later: deeper premarket research and historical strategy experiments
```

Bookmap mode/price/eligibility questions should be investigated during M0/M1, before spending heavily on UI polish. This is the main integration uncertainty. The order writer is the other major complexity; isolate it from the AI and prove it through simulated outcomes.

## M0 — A Windows desktop with a real headless runtime

Deliver:

1. Minimal workspace with contracts/core/runtime/ai and Electron desktop entries. Empty packages should not grow placeholder abstractions without a consumer.
2. Main -> utility process ready/error/stop handshake and Hono `/health` endpoint on loopback with an OS-assigned port.
3. Preload exposes runtime bootstrap/native notifications; renderer connects to the headless API. No provider credentials in renderer state.
4. Simple Solid page, WebSocket test event, local snapshot bootstrap, and native notification demo.
5. SQLite open/write/reopen using the exact embedded Electron Node version.
6. Unpacked Windows build that launches without globally installed Bun/Node.

Acceptance:

- Renderer reload leaves one runtime process alive.
- App exit closes runtime and database; restart restores the sample row.
- The packaged app serves `/health` and delivers its test event.
- Node version and SQLite support are recorded. If built-in SQLite fails, select and document one adapter before M1.
- No Massive/Schwab/OpenAI calls yet.

Early Bookmap spike: inspect installed addon/API version and locate supported live/replay metadata, alias/pips metadata, detector-config input, and signal callback/export path. Report concrete source/API findings, not a guessed `isLive` function. This investigation can be read-only until the Bookmap bridge milestone.

## M1 — Versioned tradebooks, plans, and deterministic fixtures

Deliver:

1. Shared DTO/Zod schemas and core ports with injected clock.
2. Immutable tradebook/plan repositories and compiler issue report.
3. First rule primitives (`compare`, `all/any`, registered events, scoped human confirmations); three-valued evaluation.
4. Detector registry with explicit IDs/versions/input capabilities. Do not implement a universal plugin loader.
5. ORB reference tradebook and synthetic crossing fixture.
6. Personal Gap Give and Go draft imported from the active Backtest files, with unsupported/ambiguous clauses retained.
7. Signal episode/attempt lifecycle, event identity, and durable evidence model.
8. Position/fill/intent schema and execution-policy decision function. Observer policy always denies broker submission.

Acceptance:

- A novel narrative tradebook can be saved and revised without matching a fixed template name.
- Publishing/arming distinguishes human, deterministic, advisory, and unsupported clauses.
- ORB creates one ready signal; repeated prices do not duplicate it.
- Missing features produce unknown, with a useful explanation.
- Personal plan does not inherit a blanket VWAP condition or generic breakeven rule.
- Editing an armed plan creates a new version and preserves old evidence.

Scope control: implement the predicate vocabulary required by these examples. New setup freedom comes from preserving narrative, composition, and detector extension points, not implementing every indicator now.

## M2 — Massive live market data and Lightweight Charts

Deliver:

1. Node HTTP/socket/credential adapters; Massive paginated REST bars and reference/session calendar.
2. `AM` mapping with repeated-interval replacement, fractional aggregate volume handling, provisional/revised metadata.
3. `T` eligible price and `Q` quote observations; explicit entitlement/delay/source status.
4. Buffered historical/live handoff and reconnect backfill with historical entry suppression.
5. Session clock, RTH VWAP, 1m/5m cache, ORB reference features, gaps/corrections.
6. Solid chart wrapper: candles, volume, VWAP, levels, signal markers; correct resize/disposal and Eastern label formatting.

Acceptance:

- Chart and evaluator consume the same normalized bars/features.
- Repeated/corrected `AM` never double-counts volume.
- Older-candle corrections repair the chart's sorted cache.
- Reconnect/historical loading cannot issue past ORB entries as live.
- No qualifying-trade minute is a gap, not a fabricated candle.
- Feed capability is explicitly real-time/delayed/unsupported; a delayed feed is not labeled live.
- DST, holiday/early-close, and first-minute readiness fixtures pass.

Verify provider endpoint fields/entitlements against current docs and the user's account. Do not read unrelated secrets or place keys in fixture files. API keys are runtime configuration, not repository source.

## M3 — Schwab read integration and broker facts

Deliver:

1. Adapt ViteApp's headless OAuth, reads, stream protocol, and account projection.
2. Browser authorization + callback-URL paste flow, expiry-aware refresh, rotated-token persistence.
3. Explicit account selection/hash; reads address the selected account, not the first array element.
4. Positions, supported working orders, order trees, and fills; today executed orders plus relevant preexisting working orders.
5. `ACCT_ACTIVITY` triggers coalesced REST refresh; bounded polling fallback and reconnect status.
6. Stable fill identities, lifecycle splitting, carry-in basis flags, and logical tier allocation.
7. Broker versus planned protection display, including standalone stops and OCO quantities.

Acceptance:

- Synthetic partial/canceled/replaced order trees do not lose or duplicate fills.
- Preexisting/external positions appear without a Cairo entry signal.
- Reversals end one lifecycle and create another.
- OCO protection is not counted twice.
- Broker quantity/status remain authoritative when local tier history is incomplete.
- OAuth tests use fake responses; no tests submit trades or rotate real credentials.
- A manual read-only account connection can be verified separately when the user begins implementation.

Reuse pure modules selectively. Do not import ViteApp's browser globals, entire runtime, Firestore, or ten-partial execution policy. Public Schwab endpoint schemas were not accessible in this research; implementation checks them against the user's authenticated portal.

## M4 — Bookmap observation bridge and personal entry evaluation

Deliver in two small steps:

**M4a export and observer import:** add a small asynchronous JSONL exporter at the existing pattern signal callback, preserving the detector and native trading paths. Then tail/import `pattern-signals.jsonl` with a resumable cursor, parse nanosecond strings, map aliases, preserve quality contributions, merge by episode key, and label unknown/replay source mode. Use serialization fixtures before a real plugin export is available. This demonstrates Cairo's reaction to existing patterns without pretending the log is a live execution feed. The inspected plugin currently has serializable signals and badges, not an implemented JSONL writer.

**M4b live observation adapter:** a scoped additive change to the sibling `bookmap-plugin`, or an isolated companion reusing its detector, providing:

- Observation subscription/configuration independent of native execution buttons.
- Hello/readiness/mode/heartbeat/reset metadata and explicit detector/config version.
- Pattern episode/revision observations and real reference/trigger prices.
- Selected wall/context facts only where required by the initial management rules.
- An observation-only mode that never invokes the native trade dispatch path.

All Cairo application code stays TypeScript. The small external Bookmap adapter uses its existing Java environment. No edits to Backtest tradebooks are required; Cairo imports reviewed versions with source provenance.

Acceptance:

- Existing eight detector patterns retain their documented behavior/rule version.
- One episode with multiple UUID/score updates becomes one Cairo signal/intent identity.
- Tick-to-dollar conversion occurs once using instrument metadata.
- Replay/unknown mode and initial history cannot authorize Schwab orders.
- Missing bridge is visibly different from no pattern.
- The Gap Give and Go reference combines Bookmap event, key-level constraint, and explicit context confirmation.
- Unsupported "never below wall"/composite conditions remain visibly unresolved unless their evidence/detector is implemented.
- Native Bookmap execution and Cairo execution do not both act on a Cairo-managed signal.

If global live/replay metadata cannot be established through the installed API, retain observer import and report this exact dependency. Do not fake a live mode from timestamps. This uncertainty has to be resolved before automatic broker actions from Bookmap signals.

Bridge implementation changes should follow that repository's applicable instructions and validation, including its existing Java build/fixtures. Keep them local and scoped. This planning task has made no such changes.

## M5 — OpenAI copilot and collaborative tradebook editing

Deliver:

1. Official SDK Responses adapter, streaming chat, completed tool-call handling, cancellation, and local run records.
2. Mode-specific prompts for tradebook/planner, monitor, manager, journal, and research.
3. Bounded read tools and draft-only proposal tools from the spec.
4. Context snapshots carrying tradebook/plan/position versions, Bookmap evidence, data quality, source times, and selected events.
5. Narrative/rule diff and unresolved-input cards; accept/reject draft; publish/version/arm through app commands.
6. Meaningful-event scheduling, coalescing, run budgets, and historical-result detection.
7. Model configuration/capability validation and token/run usage display.

Acceptance:

- Fake provider fixtures exercise tool-result `call_id` continuation and complete output preservation.
- Invalid schema, wrong-direction stop, invented feature, stale position version, refusal, and incomplete result never apply a live policy.
- A stalled provider does not block deterministic signal/management processing.
- All numerical action/risk fields are domain-validated; facts cite evidence.
- No AI tool can submit a broker order or execute arbitrary code.
- Tradebook editing preserves personal rules; exact qualitative ambiguities produce questions/draft issues, not automatic substitutions.

Then use a small opt-in real API evaluation during implementation. Evaluate available configured models on the same 10-20 cases: clause extraction, no-VWAP exception, tier discipline, missing Bookmap source, ambiguous stop binding, stale position, correct evidence use, and refusal/incomplete handling. Choose by valid output, grounded reasoning, latency, and measured usage. Do not conflate API quality evaluation with profitability.

## M6 — First observer release, timeline, and replay

Deliver:

1. Watchlist/focus symbol, chart, tradebook/plan editor, Bookmap evidence cards, position/order panel, event timeline, contextual copilot.
2. One click to inspect a rule's evidence and source status.
3. Desktop notifications for distinct ready/invalidated/management events while minimized.
4. Trade/plan/AI timeline persistence and basic factual journal with user notes.
5. Normalized-input recorder and deterministic replay mode with fake clock/broker.

Acceptance demo:

Import personal tradebook -> bind levels/tiers -> connect fixtures for Massive/Bookmap/Schwab -> arm -> receive bid-reappear evidence -> external broker fill -> attach/confirm plan -> see tier management event -> close fill -> factual journal -> restart -> replay the same deterministic trace.

Observer mode generates zero broker writes. Repeat the demo for the ORB example without a Bookmap connection. Disconnect OpenAI during the demo and verify the market/account workflow continues.

Live observer usage is the first useful checkpoint. It lets the trader review detector/narrative fit before orders are enabled.

## M7 — Assistant mode with approved Schwab tickets

Deliver:

1. Concrete entry/exit/stop/target tickets with exact account, side, quantity, price/type, position/tier, rule, and supporting evidence.
2. Deterministic payload factories, adapted from ViteApp where appropriate.
3. Intent persistence and local command deduplication; exact approval transitions; per-account/symbol execution queue with pending-quantity reservations.
4. Order submit/cancel/replace adapter with accepted/rejected/unknown results and broker reconciliation.
5. Tested managed order topology: bracket/OCO relationships, remaining protection, partial fills, and unsupported-layout fallback.
6. Simulated broker implements realistic accepted-but-unfilled, partial, rejected, timeout-after-submit, cancel failure, and replacement states.

Acceptance:

- No assistant order is submitted before exact approval.
- Duplicate approval/request/episode update creates no second submission.
- Approval is revalidated against changed position/plan/order state.
- HTTP success never counts as a fill.
- Unknown response triggers status resolution, not blind retry.
- Tested exits account for existing stop/OCO quantities and their supported cancel/replace transitions; a separate close cannot leave excess closing quantity working.
- Two local intents cannot reserve the same remaining shares, including while the broker projection is waiting for a refresh or an outcome is unknown.
- Unsupported fractional/complex positions/orders are displayed but not forced through the whole-share writer.

Do not build a generic arbitrary-order JSON editor. Start with a few named tested shapes. Live verification, if later requested, must be a concrete reviewed ticket; automated tests remain simulated. There is no inferred requirement to execute a live order merely to complete implementation.

## M8 — Armed automated trade management

Deliver:

1. Per-position rule/action permissions with assistant entries as the initial preset.
2. Supported deterministic stop/target/reversal/runner conditions acting through the same M7 intent/writer service.
3. Logical tier management, remaining-quantity allocation, and already-working-order checks.
4. Pause/resume controls and mode changes; observer after restart until recovery/resume.
5. Priority/conflict handling: existing broker fill/status takes precedence; duplicate rules cannot issue competing closes; unknown order outcomes remain unresolved until reconciled.

Acceptance:

- A named permitted deterministic rule acts without a fresh user prompt.
- An AI recommendation, unsupported discretionary clause, or unrelated pattern cannot execute under that policy.
- Replay/unknown/unready Bookmap observations cannot produce live writes.
- Partial fills and outside exits reduce the quantity available to a later rule.
- Personal LOD/core/runner rules retain their tradebook semantics; no generic early core exit is introduced.
- Pausing/mode changes prevent new Cairo actions; broker working protection remains accurately visible.
- Delayed/unavailable AI has no effect on an already-armed deterministic exit.
- Restart displays orders but does not silently resume software automation.

Default stop protection is broker-hosted. Software thesis exits require a running app/observation feed. Distinguish those in the UI without adding a broad infrastructure/security project.

## M9 — Three-mode Windows MVP verification

Deliver:

1. Unpacked app and private NSIS installer; local settings, source statuses, reconnection, and saved sessions.
2. A minimal getting-started flow for Massive/OpenAI keys, Schwab OAuth/account, and Bookmap observation source.
3. Packaged-runtime smoke checks and a redacted fixture/demo recording for both reference tradebooks.
4. A concise feature/support matrix identifying automated, human-confirmed, advisory, and unsupported rules/order shapes.
5. A final local implementation summary listing tests run, source adaptations, remaining limitations, and actual output paths.

Acceptance:

- Run all relevant fixture tests, type checks, and the packaged Windows smoke once after the final relevant changes.
- A clean installed app starts without developer tooling and loads its migrations.
- UI reload/minimization, source disconnects, token-refresh failures, SQLite restart, and unknown order response are handled as specified.
- Captured replay uses no live network/order path.
- No keys, real account payloads, or raw private captures are committed into fixtures.
- No commits/branches are pushed.

## 3. Subsequent work across the five workflows

### Premarket preparation

Extend the planner with bounded daily/intraday history and source-backed news/catalyst inputs. Keep a distinction between a factual catalyst, user interpretation, and an inferred thesis. Save the stock-selection/context checklist with source/time and manual confirmations. Bind chosen higher-timeframe key levels into the plan rather than asking the live monitor to rediscover them on every tick.

Import only the selected active Backtest tradebooks first. Preserve source path/hash and reviewed version. External file changes create an import/review proposal; they do not silently change an armed Cairo policy. Export to Markdown/JSON for portability after the initial editor works.

### Additional live setups

Extend the feature/detector registry and rule composition with fixture-backed detectors. Example additions: candle reclaim/retest, gap-and-crap context, offer step-down, or a supported composite protection-removal signal. For a novel discretionary idea, use narrative + human confirmation + AI review immediately; enable full deterministic automation only after its inputs and rules are implemented and reviewed.

Do not call an LLM on every Bookmap depth event. Feed it summarized wall/pattern episodes and bounded evidence when context interpretation is valuable.

### Journaling

Expand the initial factual timeline into a readable trade review: setup selection, actual evidence, plan adherence, approved/automatic actions, tier outcomes, and user notes. Keep process quality separate from outcome. Preserve the version/data known at the time and do not score a trade using a later revised plan or post-close candle correction as if it were available live.

### Strategy research/backtesting

Add a separate experiment runner when the live modes work. Three levels of evidence must stay distinct:

| Experiment | Valid claim | Cannot establish |
| --- | --- | --- |
| Captured Cairo observations | Reproduce Cairo's signal/action decisions from observed inputs | Raw Bookmap detector correctness if only pattern events were recorded |
| Historical final 1m bars | Evaluate a bar-defined strategy under specified fill assumptions | Original live revision timing, precise intrabar path/spread, wall patterns |
| Raw Bookmap depth/trades or provider depth history | Validate order-flow detectors under that source's coverage | Equivalent results from a different feed/depth model without comparison |

Run the same pure rules with an injected historical clock. A simulated broker handles fills, costs, partials, and order sequencing separately. For bar-only experiments, enter on data available after the trigger, model commissions/slippage, and use a declared conservative policy for a candle hitting stop and target when order is unknown. Do not call a target touch a broker fill in a live journal.

Experiment schema: tradebook/rule versions, symbol universe, dates/sessions, data source/fidelity, adjustment policy, entry/fill policy, costs, parameter set, warmup, and metric definitions. Report sample count, exposure, expectancy in R, drawdown, and sensitivity with the actual assumptions. Split development/validation periods and keep long/short/setup populations labeled. No strategy improvement is auto-published or auto-armed from an experiment.

Existing `Backtest` research scripts/data can become a later import or external research adapter. Do not rewrite that repository or add Python to Cairo's live runtime now. Run heavier experiments outside the market-processing event loop, in a worker/process, and return a typed result artifact to the copilot.

## 4. Verification priorities

Test the difficult behavior rather than superficial component wiring:

1. Temporal facts: closed-bar vs forming-bar, event vs receive time, correction vs original evidence, live vs replay.
2. Identity: Bookmap episode updates, repeat broker reads/fills, repeat user approvals, unknown submit outcomes.
3. Semantics: tradebook exceptions, ambiguous human clauses, fixed original risk, tier allocation, broker-vs-planned protection.
4. Independence: AI stalls, renderer refreshes, source disconnects, restart recovery.
5. Real packaging: Node SQLite/utility process/notifications in the Windows build.

Fixture tests are warranted because a wrong state transition can produce an unintended trade. CSS/layout-only iterations need visual inspection, not a matching unit test for every component. Broaden tests only when failures or new behavior justify it.

## 5. Questions resolved versus left for tradebook authoring

Resolved: US equities, Schwab, Bookmap for the personal workflow, flexible coauthored tradebooks, all three modes, local/private Windows-first operation, and the ORB reference example.

Inputs supplied per tradebook/plan rather than blocking architecture: tier percentages, exact quantity/risk, LOD/HOD binding time, runner trigger/target, reversal strength, source requirements, action permissions, and rearm/entry expiry. Cairo's collaborative editor should surface these in context.

Implementation uncertainties to resolve early: installed Bookmap live/replay API evidence, additive observation/config path, Massive entitlements, and verified Schwab order schemas/topologies. These require adapter validation, not another broad architecture redesign.
