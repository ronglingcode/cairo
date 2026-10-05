# Bookmap observation bridge contract

Status: T16 design and fixture contract. This describes the normalized messages
Cairo requires; it does not claim the plugin currently sends them. T17–T19 add
the producer and connection lifecycle separately.

## Source audit

The sibling plugin declares Bookmap `api-simplified` and `api-core` version
`7.8.0.13`. `RongPlugin` implements `HistoricalModeListener`,
`SnapshotEndListener`, and the Bookmap callback interfaces. Its current readiness
path calls `patternEngine.markReady()` on `onSnapshotEnd()` or
`onRealtimeStart()`, but the mode distinction is discarded. These callbacks
establish initialization/realtime transitions; the existing observation payload
does not prove whether the whole source is live or replaying. Cairo must report
`unknown` unless the producer can read and publish trustworthy installed-API
mode metadata. Wall-clock timestamps are never mode evidence.

`BookmapPatternSignal.toJson()` currently emits `bookmap_pattern_signal`, an
alias in `symbol`, `episodeKey`, a random `id`, `pattern`, `triggerPrice`,
`triggerPriceTick`, `eventTimeNs`, and a creation `timestamp`, plus score data.
`BookmapPriceNormalizer` defines `priceUnit: "real"` and converts price levels
using Bookmap's `pips` multiplier. `PatternSignalStore` replaces the prior
signal with the same alias/episode key, so an update may have a different random
ID. Cairo identity must therefore use source instance + symbol + episode ID;
revision is the ordering field. The tick field is plugin-internal and must not
be treated as USD.

`BookmapPatternEngine` emits only when its local readiness, regular-session,
and `PatternEligibility` checks pass. The current read-only eligibility helper
is based on enabled tradebook groups with entry methods and matching direction
and pattern family. This is not yet independent observer configuration. Keep
that native eligibility behavior unchanged; T18 adds a separate observer path.

The existing WebSocket sends only `{"type":"standalone_status","native":true}`
on connection. External `onMessage` is intentionally ignored. There is no
pattern broadcast, source instance/sequence, detector/config revision, heartbeat,
reset, symbol canonicalization map, or explicit source mode/readiness status in
the current wire protocol. T17–T19 must add server-pushed observation messages;
Cairo sends no commands.

## Normalized event envelope

`src/shared/contracts.mts` defines the parsed Cairo boundary. All event times in
this contract are base-10 nanosecond strings to avoid JavaScript integer
precision loss. `receivedAt` is Cairo's receive time, not producer event time.
Prices are positive finite US-dollar values; absent prices and event times are
`null` on heartbeat/reset. Never substitute a wall tick for a real price.

| Field | Meaning |
| --- | --- |
| `sourceInstanceId` | New opaque ID for each plugin/server runtime; prevents sequence/episode collisions after restart. |
| `sequence` | Monotonically increasing integer within that source instance across status and observation messages. Gaps signal a resync requirement. |
| `symbol.source` | Exact Bookmap instrument alias, preserved for diagnostics and mapping. |
| `symbol.canonical` | Cairo's configured canonical equity symbol. Do not guess it from alias text; unresolved aliases remain unusable for symbol-scoped rules. |
| `priceUnit` | `USD`; the plugin converts with its instrument `pips` via `BookmapPriceNormalizer`. |
| `episodeId`, `revision` | Stable detector episode key and monotonically increasing revision. Random payload UUIDs are not identity. |
| `pattern`, `price`, `eventTime` | Detector label and event evidence. Price is the trigger's real price, not a quote or continuous price feed. |
| `receivedAt` | Cairo receive timestamp, represented as nanoseconds string. |
| `detectorRevision`, `configRevision` | Producer version identifiers, or `null` until the plugin can provide them. |
| `mode` | `live`, `replay`, or `unknown`, based only on explicit trustworthy Bookmap metadata. |
| `readiness` | `ready`, `not-ready`, or `unknown`; readiness is per symbol and must be reported from source state, not inferred from message arrival. |
| `delivery` | `snapshot` for connection bootstrap context; `live` for subsequent stream messages. Snapshot episodes update context and never create fresh signals. |
| `kind` | `episode`, `heartbeat`, or `reset`. A reset starts a new source epoch and invalidates prior readiness/sequence assumptions. |

The three JSON fixtures under `tests/fixtures/bookmap/` are normalized Cairo
events, not a claim about the current plugin's wire JSON. They cover snapshot
bootstrap, a higher-revision live update to the same episode, and a new-source
reset. They intentionally use null detector/config revisions and unknown mode
and readiness because the audited producer does not currently publish those
facts.

## Handling absent or uncertain facts

- Until explicit status establishes readiness for a symbol, expose `unknown` or
  `not-ready`; a pattern message by itself does not prove readiness.
- If mode is replay or unknown, retain events as observer context only and block
  source-dependent assistant proposals. A recent timestamp never upgrades mode.
- If alias-to-canonical mapping is missing or ambiguous, retain the source alias
  for display but do not attach the event to a different equity symbol.
- If the source instance changes, sequence regresses, or a gap is detected,
  discard readiness assumptions and await a fresh bounded snapshot/status.
- A snapshot is a bounded current-episode bootstrap, not replay history and not
  a trigger. Live revisions merge by `(sourceInstanceId, symbol.source,
  episodeId)` and only a higher revision updates an episode.
- Heartbeat and reset are observation-only lifecycle messages. No message type
  represents an order, execution input, credential, token, raw depth, quote, or
  inbound Cairo command.

## Parse verification

`npm run test` parses each fixture with `parseBookmapObservation` and checks USD
units, explicit canonical mapping, nanosecond strings, snapshot/live distinction,
episode revision ordering, unknown source mode, and reset readiness. The parser
rejects unknown mode/readiness/delivery values, non-finite prices, and numeric
nanosecond timestamps.
