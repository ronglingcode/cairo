# AI Bookmap assistance: sequence-aware live setup recognition

Date: 2026-10-05. Status: proposed implementation plan, based on the current local Cairo and bookmap-plugin source. No trading behavior is changed by this document.

## Intended experience

The trader continues watching Bookmap and making trading decisions. The plugin observes market structure continuously; Cairo independently recognizes likely setups, explains the evidence, and remembers the sequence surrounding entry. Manual tagging becomes a correction/confirmation option instead of the only way to establish a setup.

Start with these active short patterns:

- `bid-breakdown-no-bounce`
- `mini-bounce-then-bid-breakdown`
- `bid-breakdown-then-mini-bounce`

For all three, recognize prior rejection from an offer wall as a separate extra-confirmation fact. Retain bid step up and bid reappear observations; expand other patterns after validating the short workflow.

Example assistant card, with illustrative prices:

> Likely mini bounce then bid breakdown. Bid wall $10.20; bounce high $10.24 before the break. Prior offer rejection at $10.26. Ask now below the broken bid. [Accept] [Correct] [Evidence]

The evidence view shows the wall, touch, bounce start/high/end, breakdown and quote confirmation in time order. Provisional developments update the same card. Cairo can say “bounce still forming,” “two plausible bounces,” or “insufficient history.” It should not require the trader to choose a label before displaying useful observations.

Default proposal: AI suggestions with one-click acceptance for the confirmed trade tag. AI inference can answer recognition questions immediately, labeled as inferred; current confirmed-tag requirements continue to govern pattern-specific management until explicitly revised. Automatic attachment of an AI label is an optional later preference and must preserve its AI provenance.

## What exists, and what is missing

| Area | Current source evidence | Consequence for this plan |
| --- | --- | --- |
| Plugin market input | `RongPlugin` receives depth, trades, BBO and timestamps; `OrderBookState` keeps depth at all received price levels. | Reuse these callbacks; do not introduce another vendor stream. Audit actual callback timestamp and aggressor semantics during implementation. |
| Plugin patterns | `BookmapPatternEngine` tracks qualified walls and probable consumption using matched aggressive volume; its four definitions cover bid/offer reappear and steps. Recent trades are pruned to roughly 2.5 seconds; lifecycle state resets on session/toggle changes. | Existing processing is useful, but not a sufficient history for the requested breakdown/bounce sequence. Add an independent evidence recorder and structural primitives. |
| Existing export | `CairoObservationExport.allowed()` exports only `BID_STEP_UP` and `BID_REAPPEAR`. Exported episodes carry a label and trigger price/time, not wall/bounce evidence. Mode remains `unknown`; the server supplies readiness and bounded snapshots. | A wider allowlist alone will not solve recognition. Add a versioned evidence protocol and prove mode separately. |
| Cairo receive path | `BookmapReceiver` keeps up to 400 latest episode revisions, resets on connection, and uses a 6-second heartbeat / 10-second event freshness window. Its allowlist matches the two bid patterns. | Add persistent temporal context, per-symbol coverage, and proper stream continuity checks. Do not equate heartbeat connection with usable history. |
| Cairo AI | `CairoDomainTools` exposes recent observations; `CopilotWaker` filters for live/ready events and throttles automatic chat updates to 15 seconds. | Add targeted timeline tools and a separate recognition scheduler. The chat throttle is too slow for the local live-status display. |
| Trade setup | `BookmapPatterns` stores trader-selected tags scoped to the runtime/trade instance; `trade-context` says never infer a pattern. | Introduce a distinct inferred setup object, then deliberately update the skill/tool contracts to permit recognition without silently confirming tags. |
| Pattern sources | The active catalog links the three short-pattern Markdown rules. They specify distinct before/after bounce highs and bid reclaim conditions. | Preserve source wording and hashes. Do not let recognition merge the three stop rules. |

Relevant plugin implementation files are in the sibling repository, at `../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/` relative to the Cairo repository root: `RongPlugin.java`, `OrderBookState.java`, `patterns/*`, `orderwall/OrderWallChangeTracker.java`, and `SignalWebSocketServer.java`. Cairo integration points are `src/shared/contracts.mts`, `src/engine/BookmapReceiver.mts`, `BookmapPatterns.mts`, `EntryObserver.mts`, `src/copilot/CairoDomainTools.mts`, `CopilotWaker.mts`, `cairo-plugin.mts`, and the pattern/context/management skills.

`BOOKMAP-OBSERVATION-CONTRACT.md` describes an earlier design audit; some producer features now exist. Reconcile it with implementation rather than treating its historical “not implemented” statements as current facts. The plugin also has pre-existing local modifications; implementation must preserve and inspect them.

## Architecture and responsibility

```text
Bookmap depth / trades / BBO / event time
  -> plugin evidence recorder + wall lifecycle + compact price/quote path
  -> bounded local stream and replay files
  -> Cairo timeline + deterministic candidate extraction
  -> AI setup interpretation using timeline and source pattern rules
  -> live evidence card / chat / entry-linked setup record
  -> trader acceptance or correction
```

**Plugin: measurement.** Track walls, depth changes, executions, quotes and price responses with stable identities. Publish primitives even when no complete pattern fires. Keep its existing pattern labels as optional hypotheses. Recording must be independent of enabled trading buttons and display indicators; observer configuration selects symbols/session coverage without changing execution eligibility.

**Cairo: independent recognition.** Compute breakdown and bounce candidates from the exported measurements and evaluate alternative sequences. The AI sees candidates plus the underlying compact path; it is not limited to agreeing with the plugin's label. It selects the evidence-supported interpretation, explains uncertainty and can request a more detailed time slice through local read tools.

**AI: contextual interpretation.** Connect prior offer rejection, bid touches, failed recovery, successive bounces and entry timing to the trader's source definitions. Return a constrained structured result; engine validation checks every referenced event and price. Numerical levels come from measured candidate extrema, not model-generated prices. No retraining is needed for the first version; collect corrections before considering a learned classifier.

The observer path has no order submission or execution-configuration dependencies. Pattern-specific stop descriptions may reference recognized structures, but current protection/ticket approval remains a separate workflow.

## Evidence to preserve

Introduce a versioned protocol alongside the existing episode contract. It needs:

- Source instance, per-instrument epoch, alias and verified canonical symbol, tick size/price units, detector/config revisions, source mode and depth readiness.
- Source event time as a nanosecond string, monotonic capture order for equal timestamps, producer emission time and Cairo receive time as distinct fields. Mark timestamp fallbacks explicitly.
- Per-symbol stream sequence, batch ID and coverage interval. Lifecycle status and snapshots need explicit boundaries/sequence watermarks. The current source-wide sequence allocator creates values for individual client snapshots too; blindly requiring contiguous sequence per receiver would misidentify such gaps. Define the new ordering scope before implementing gap detection.
- Stable wall IDs spanning qualification, contact, growth/decrease, disappearance, refill and reappearance. A wall at the same price later is not automatically the same wall.
- Wall side, price, first/last observed time, displayed size, peak size, qualification threshold and attribution evidence. Aggregate depth cannot prove individual-order identity or exact cancellation/consumption; retain `probable-consumption`, `probable-pull`, `mixed` and `unknown` explanations.
- Price/quote path with last-trade extrema and their times, BBO transitions, volume and aggressor-known flags. Keep last trade, best bid and best ask separate: ask below a wall and bid reclaim are not interchangeable.
- Touch/rejection/break/reclaim events, duration below/above a level, running/session low and its coverage provenance. Late attachment cannot establish the day's true low without prior history or an explicitly identified authoritative source.
- Coverage intervals, missing batches, warmup, truncated windows and dropped records. A quiet market with continuous coverage is distinct from missing data.

Proposed initial sizing, subject to capture/replay measurements: a 10-minute in-memory context ring per watched symbol; 100–250 ms compact price/flow buckets; lossless capture of structural events and relevant BBO crossings/extrema within buckets. Pin event detail around wall contact/breakdown and entry. Use event-triggered export with a bounded batch flush, not an AI call per tick.

Persist opt-in dedicated market-evidence files with bounded disk retention and a schema/version manifest. Existing action logs explicitly omit raw market streams and cannot serve as replay evidence. Save setup/entry slices separately so ordinary ring-buffer eviction does not remove their evidence. Capture all raw inputs in bounded test/replay sessions when needed to evaluate whether compression loses meaningful bounces.

A dropped queue/batch invalidates coverage immediately. Reconnect loads a bounded snapshot/history with coverage metadata; snapshot data supplies context and does not generate new live alerts. Session changes, source restarts and detach/toggles open a new epoch and clear stale assumptions.

## Recognition rules and temporal behavior

### Bid breakdown

Identify a previously qualified bid wall, contact history, disappearance/consumption evidence, trades crossing below and the best-ask relation to the wall. Treat quote confirmation as an explicit fact with timestamp and duration. A pulled bid followed by price moving below may be a different interpretation from a traded-through bid; expose the difference and calibrate it against the trader's examples.

### Mini bounce

Cairo extracts all plausible upward excursions near the selected wall/break: start low, first rise, provisional high, final high, end/reversal, amplitude in ticks, duration, volume, relation to spread/volatility and distance from the wall. Include path samples so AI can compare candidates independently.

Do not hard-code an invented universal bounce size. Start with configurable, versioned noise thresholds and tune using trader-labeled clips across symbols and volatility regimes. A developing high is provisional. A reversal rule may confirm it later; record both the high's event time and the later time at which it became knowable.

| Setup | Required sequence | Structural level from the source rule |
| --- | --- | --- |
| Mini bounce then bid breakdown | Wall contact -> meaningful bounce -> subsequent breakdown of that wall. | High of the selected bounce before breakdown. |
| Bid breakdown then mini bounce | Breakdown -> meaningful bounce -> source-defined entry confirmation (new low of day or ask stayed below the broken wall). | High of the selected bounce after breakdown. |
| Bid breakdown no bounce | Breakdown with adequate covered contact/pre-break history and no qualifying bounce in the defined window. | Broken wall price; source stop watches the level-one bid reclaim. |

“No bounce observed yet” is a provisional observation, not proof of absence. Missing history must produce `unknown`. Define the no-bounce window and what “ask stayed below” means through examples and recorded parameters. Handle bounces on both sides of a break, multiple bid walls, spread-only moves, one-print spikes, pulls/refills and competing before/after interpretations explicitly.

### Prior offer rejection and other context

Store an offer wall's existence, touch/proximity, subsequent downward response and time relation to the bid break. Infer rejection only with sufficient evidence; merely having an offer above price is insufficient. Limit relevance by configurable elapsed time, price distance and intervening structure. Keep the evidence visible when causality is uncertain: observed sequence does not prove that the offer caused the decline.

Represent this as `extraConfirmations` rather than adding a new label for every combination. Extend later with repeated failed retests, liquidity refill, buying/selling pressure and relevant key levels, each with its own evidence/coverage constraints.

### Entry context versus evolving setup

Use two records: an evolving market setup and a frozen entry assessment. Match broker executions to the evidence timeline by canonical symbol, side, execution timestamp and trade instance. Allow timestamp uncertainty and entry windows; position snapshot arrival time alone is not exact entry time. Adds and opposite/new positions require separate execution association.

Freeze evidence available at entry, with `availableAt` as well as event time. A later bounce must not retroactively turn a no-bounce entry into a bounce-after-break entry. Append post-entry developments or retrospective analysis as separate assessments. Corrections create a revision with provenance, not an overwritten historical truth.

## Cairo interfaces and live presentation

Add read tools such as `read_bookmap_timeline(symbol, start, end)`, `read_setup_candidates(symbol, asOf)` and `read_entry_setup(tradeInstanceId)`. Expose bounded detail with coverage and hashes; restrict queries to recorded data. A model may request a narrower/larger recorded window, but cannot establish missing history by guessing.

An inferred assessment includes: ID/revision, symbol/side, setup/catalog ID or unknown, state (`forming`, `candidate`, `confirmed-by-evidence`, `invalidated`), as-of/available-at, wall ID, selected bounce ID and alternatives, before/after relation, measured high/low, extra confirmations, contradictions, missing evidence, evidence IDs, source hashes and recognition version. `confirmed-by-evidence` describes recognition and is distinct from `traderConfirmed`.

Validate model output against actual IDs, times, price extrema, side and active catalog. Reject fabricated levels, out-of-window evidence and impossible orderings. Use qualitative uncertainty initially; plugin quality scores and model confidence are not calibrated probabilities.

Show one concise card per active setup with freshness, a timeline and correction controls. Before entry, this answers “what is forming?” After entry, show the frozen entry context plus current developments. On disagreement with a trader label, keep the trader's tag and show the inferred alternative. Offer “wrong wall,” “wrong bounce,” “before/after wrong,” and “not this setup” corrections.

Update the `bookmap-pattern`, `trade-context`, `set-stop-loss` and related tool instructions together: allow inference and evidence inspection; distinguish inferred recognition from accepted management context; require the exact selected bounce's measured high for a numerical answer. If it is provisional or ambiguous, state that. Keep the existing manual picker usable.

## Scheduling and operational limits

Compute local primitives/candidates continuously and refresh their UI without waiting for a model. Invoke AI on a meaningful setup transition, prior-confirmation change, new entry, user question or correction. Coalesce minor updates; use one in-flight request per symbol/setup and reject late results against the latest epoch/revision. Chat and recognition should not block each other.

Proposed acceptance targets to measure, not current performance claims: local evidence/candidate display p95 under 500 ms after receipt; AI card p95 under 3 seconds after a meaningful trigger. Record source-to-receive, local processing and model latency separately. If the model misses its budget, show local evidence and “AI catching up”; no trading operation waits for it. Replay and unknown-mode data are visibly labeled and cannot masquerade as current live assistance.

Bound per-call context, model calls per minute, queue memory and disk retention. Publish capture/coverage errors, reconnect/warmup and last usable event age per symbol. Use local loopback transport, and send only the selected market context/source rules through Cairo's configured model connection. Do not include credentials or unrelated broker data in recognition payloads.

## Implementation phases and completion criteria

| Phase | Deliverables | Completion criterion |
| --- | --- | --- |
| 0. Definitions and capture | Versioned meaning of bounce, wall, break, rejection and no-bounce coverage; real labeled clips; protocol draft; mode/callback audit. | Trader can identify the relevant wall/bounce in examples; raw inputs and expected sequences can be replayed. At least 20 initial examples covering all three setups plus ambiguity/missing-data cases; expand before release. |
| 1. Plugin evidence foundation | Independent observer capture, wall lifecycle evidence, compact trade/BBO history, versioned batched export, coverage and bounded persistence. | Replay reproduces event order, quotes and extrema; observer works without trading buttons; callback performance and overflow behavior meet budget. |
| 2. Cairo timeline and candidates | Timeline store, continuity/snapshot handling, independent breakdown/bounce extraction, per-symbol status and read tools. | Cairo identifies before/after candidates from measurements even if the plugin pattern label is absent or wrong. Gaps prevent unsupported no-bounce claims. |
| 3. AI interpretation and live card | Structured recognition, contextual offer rejection, validation, meaningful-event scheduler and correction UI. | Every displayed setup/level has inspectable evidence; ambiguous alternatives remain visible; delayed model output cannot overwrite newer state. |
| 4. Entry association and confirmation | Frozen entry evidence, execution association, suggested tags/acceptance, provenance-aware management tools and skill edits. | An entry keeps its original assessment after later price changes; accepting a suggestion resolves the existing picker workflow; incorrect/unknown AI results can be corrected. |
| 5. Shadow live validation | Side-by-side live assistance with recorded trader review; threshold/latency/noise tuning and rollout controls. | Measured setup accuracy, bounce identity/level accuracy and alert burden meet agreed thresholds on held-out sessions; mode/coverage failures behave as designed. |
| 6. Broader patterns | Independent bid step/reappear interpretation, then other active setups and richer context. | Each new pattern has a source definition, replay cases and demonstrated evidence coverage. |

Build the first vertical slice through phases 1–4 for a single bid-breakdown episode, including a prior offer rejection and competing bounce candidates. Prove the complete live workflow before implementing a large catalog.

Tests must include all three sequence variants; bounces both before and after; two competing walls/bounces; offer touched versus merely nearby; pulled versus consumed depth; missing aggressor classification; wrong quote side; interrupted coverage; equal/out-of-order timestamps; replay/unknown source mode; late attachment with incomplete day-low history; reconnect/snapshot duplication; revision changes while AI runs; source restart; entry/add/reopen association; and compression losing a brief excursion.

Evaluate causally by replaying only inputs available at each decision time. Split tuning and held-out clips by session rather than nearby excerpts. Measure setup precision/recall and abstention, selected wall/bounce agreement, high-price error in ticks, before/after agreement, offer-rejection precision, time to recognition, false/repeated alerts per watched minute, and resource/model cost. Review omissions as well as fired signals. Recognition quality is not a claim about trade profitability.

## Decisions to settle with examples

1. What makes a mini bounce meaningful: amplitude, duration, response to wall contact, spread/volatility, or a visual combination?
2. How long and how completely must Cairo observe before it can label “no bounce,” and how long must the ask stay below the broken bid?
3. Which bounce is intended when there are several, or meaningful bounces on both sides of the breakdown?
4. Which session coverage is needed (regular only versus premarket too), and when is a prior offer rejection no longer relevant?
5. Start with one-click accepted AI tags, or automatically attach a clearly inferred label that the trader can correct?

These are calibration decisions, not reasons to delay the evidence recorder. Begin with explicit configurable assumptions and show them in replay review; do not silently convert them into the trader's rules.
