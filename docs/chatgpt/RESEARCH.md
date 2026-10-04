# Cairo research notes

Research date: October 4, 2026. This is a planning deliverable; no application has been implemented.

## Findings that determine the design

1. OpenCode's current desktop is Electron, SolidJS, and TypeScript. Tauri descriptions refer to an older implementation.
2. Its most useful architectural idea is a headless local runtime with several clients. Cairo should borrow that boundary, not its coding tools or full infrastructure.
3. Lightweight Charts runs inside Electron's browser renderer. Cairo does not need a native chart renderer or an embedded TradingView website.
4. ViteApp already separates many vendor adapters and pure trading calculations from browser code. Adapt those modules selectively; rebuilding every integration would waste work.
5. A trading harness needs continuous, deterministic market monitoring alongside a bounded conversational agent. A coding-style model/tool loop alone does not provide market monitoring.
6. Massive stock trades and level-one quotes cannot reproduce Bookmap depth/wall-reversal information. The existing sibling Bookmap plugin already detects eight wall patterns, making an observation bridge a much smaller first step than a new detector.
7. The user confirmed US stocks, Schwab connectivity, collaborative tradebooks, and three modes: observer, human-approved assistant, and automated management with entries potentially still approved. These belong in the MVP design.

Recommendations below are Cairo design judgments. Source facts are distinguished from those judgments.

## OpenCode: inspected source, not an assumed stack

Inspected upstream: `anomalyco/opencode`, default `dev` branch, commit `907b3bc518fa48e90e8ec24dd327d13eee71c36c`, dated October 2, 2026. Package metadata identifies version `1.18.34`. This is a source snapshot, not a claim about the latest installed desktop release.

| Source | Observed responsibility | Cairo implication |
| --- | --- | --- |
| [Root package](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/package.json) | Bun workspaces, TypeScript, shared packages | Use TypeScript throughout and a small workspace layout. Bun can be developer tooling without being the desktop backend runtime. |
| [Desktop package](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/desktop/package.json) | Electron, electron-vite, electron-builder; Windows/macOS/Linux packaging commands | Choose Electron for Cairo's Windows app. No Rust/Tauri layer is needed to match the current desktop. |
| [Desktop server launcher](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/desktop/src/main/server.ts) | Launches a Node-capable Electron utility process | Keep feed processing and broker state outside the chart renderer. |
| [Sidecar entry](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/desktop/src/main/sidecar.ts) | Starts/stops a local server; reports lifecycle to the main process | Give Cairo an explicit runtime lifecycle and a ready/error handshake. |
| [Server implementation](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/server/server.ts) | Node HTTP server using Effect HTTP/HttpApi, with generated OpenAPI | Current source is more involved than older Bun/Hono descriptions. Cairo can use a smaller Hono server with the same architectural boundary. |
| [Public event handler](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/server/src/handlers/event.ts) | Streams typed events over SSE | Push domain changes into the UI. Cairo will use one WebSocket for market and application events instead of duplicating transports. |
| [Session runner](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/session/runner/llm.ts) | Builds context, streams model events, settles tool calls, continues turns, handles compaction/interruption | Reuse the concepts: context builder, tool registry, bounded run, streaming, cancellation. Implement a much smaller domain-specific loop. |
| [Tool registry](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/tool/registry.ts) | Materializes tool definitions, validates/settles calls, bounds tool output | Expose explicit market/plan/position tools, with limited output and known effects. |
| [Session compaction](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/session/compaction.ts) | Summarizes older context | Summarize conversations; always reload authoritative plans and positions separately. |
| [Durable event service](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/event.ts) | Event storage, sequences, publication | Retain an understandable decision timeline, without reproducing the full event-sourcing framework. |
| [Node SQLite adapter](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/database/sqlite.node.ts) | `node:sqlite` with Drizzle and Effect integration | Local SQLite is appropriate. Cairo does not need the surrounding Effect/ORM layers. |
| [Windows packaging](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/desktop/electron-builder.config.ts) | Windows NSIS build target | Start with an unpacked Windows build, then an unsigned private installer. |

The official [OpenCode server documentation](https://opencode.ai/docs/server/) confirms the client/server API concept. Use pinned source links above for implementation details because the project is changing. The inspected repository contains both established code paths and newer core/session packages; do not assume one isolated file represents every shipped code path.

### Borrow versus leave behind

Borrow headless ownership, typed client contracts, a tool registry, streaming chat, sessions, cancellation, and local persistence. Leave behind filesystem coding tools, shell execution, LSP, Git/worktrees, PTYs, code diffs, provider catalogs, coding permission machinery, cloud console, plugin marketplaces, multi-agent delegation, and Effect dependency-injection infrastructure. A Cairo signal should explain a trading predicate, not a source-code edit.

Do not fork the whole OpenCode repository. It creates unnecessary migration work and a coding-oriented domain model. Build Cairo independently, citing OpenCode as an architectural reference. If source is copied later, preserve its license/notice requirements.

Follow-up comparison: the current [OpenCode V2 plugin](https://opencode.ai/v2/docs/build/plugins), [network client](https://opencode.ai/v2/docs/build/client), and [embedded SDK](https://opencode.ai/v2/docs/build/sdk) documentation establish a viable runtime-embedding alternative. My first research pass did not evaluate that surface deeply enough. The original Cairo-owned harness is a scope choice, not a claim that OpenCode cannot host trading tools. Exact pinned runtime/plugin compatibility and Windows packaging still need an implementation spike. See [the plan comparison](PLAN-COMPARISON.md).

## ViteApp: concrete reuse map

Inspected local checkout: `C:/Users/lingr/code/ViteApp`, HEAD `41e9aa1`. Working-tree files were inspected, so this is not a guarantee that every file exactly matches that commit. Existing untracked review documents were left untouched.

| Local source | What is reusable | What needs adaptation |
| --- | --- | --- |
| [Massive REST adapter](../../../ViteApp/src/trading/libraries/massive/api.ts) | Pagination, bars/reference reads, origin-bound cursors, precise nanosecond parsing before millisecond conversion | Parameterize adjusted/unadjusted history. Extend fractional aggregate-volume mapping. Do not copy keys. |
| [Massive mapper](../../../ViteApp/src/trading/libraries/massive/mapper.ts) | Trade IDs/sequences, fractional trade sizes, REST/stream normalization | Audit condition handling against the selected provider policy; it is not a complete generic bar-construction specification. |
| [Massive stream protocol](../../../ViteApp/src/trading/libraries/massive/streamingProtocol.ts) | Authentication and trade subscriptions | Cairo adds minute aggregates and quotes. Current module primarily subscribes to `T`. |
| [Market loader](../../../ViteApp/src/trading/runtime/marketLoader.ts) | Buffering live data during historical loads and controlling overlap | Cairo chooses provider minute aggregates as canonical candles, rather than importing the trade-built loader wholesale. |
| [Market state](../../../ViteApp/src/trading/core/marketdata/marketState.ts) | Session levels, VWAP, pure state separation | This implementation rejects prints in older closed buckets. Cairo must explicitly support provider candle corrections. |
| [Market clock](../../../ViteApp/src/trading/core/marketdata/marketClock.ts) | Eastern time and historical DST conversion | Add exchange holidays and early closes; do not assume every weekday is a full session. |
| [VWAP helper](../../../ViteApp/src/trading/core/marketdata/premarketVolume.ts) | Prefers a valid bar VWAP, otherwise falls back to typical price | Preserve whether a reconstructed VWAP is exact or estimated; never silently mix anchor definitions. |
| [Schwab OAuth](../../../ViteApp/src/trading/libraries/broker/schwab/oauth.ts) | Expiry-aware refresh, coalescing refresh calls, rotated refresh-token persistence, code exchange | Implement local file credentials and a desktop connect flow. |
| [Schwab reads](../../../ViteApp/src/trading/libraries/broker/schwab/readApi.ts) | Account/preferences/order reads and capped-order handling | Existing `getAccount` takes the first returned account. Cairo explicitly selects the user's account and reads that account. Use Eastern trading-day query boundaries. |
| [Account projection](../../../ViteApp/src/trading/libraries/broker/schwab/accountProjection.ts) | Equity position normalization, recursive order trees, partial/canceled/replaced fill extraction | Add standalone protective stops, stable fill identity, raw statuses, and reconciliation with carry-in positions. |
| [Broker stream protocol](../../../ViteApp/src/trading/libraries/broker/schwab/streamingProtocol.ts) | Streamer preferences/login, `ACCT_ACTIVITY`, incremental level-one quote parsing | Treat account activity as a refresh trigger unless a particular payload is validated as authoritative. |
| [Trading runtime](../../../ViteApp/src/trading/runtime/tradingRuntime.ts) | REST refresh after account activity, reconnect handling, coalescing reads | Adapt patterns, not the whole runtime: it also contains execution, Firestore, and existing strategy policy. |
| [Trade ledger](../../../ViteApp/src/trading/core/account/tradeLedger.ts) | Fill grouping and reversal-splitting examples | Cairo needs its own versioned position lifecycle and stable journal attribution; do not assume its averaging matches every broker P&L method. |
| [Chart code](../../../ViteApp/src/ui/chart.ts) | Candle/VWAP/level/stop/target/marker presentation ideas | Rewrite the wrapper. It mixes DOM, globals, order handling, and strategy decisions. |
| [Chart update helper](../../../ViteApp/src/utils/chartSeries.ts) | Evidence of older-candle update issues | Cairo repairs a corrected older candle from its sorted cache rather than swallowing the error. |
| [Entry decisions](../../../ViteApp/src/trading/core/controllers/entryRuleDecision.ts) | Pure decision function and explanations | Treat existing thresholds as the user's legacy policy, not universal defaults for Cairo. |
| [Core-target rule](../../../ViteApp/src/trading/core/controllers/coreTargetRule.ts) | Explicit restrictions on early exits from protected partials | Only add this policy once the user selects it; a basic MVP should not inherit all ten-partial rules automatically. |

ViteApp's package is `sunrise-tv-lightweight-charts`, a v4-era wrapper. A new Cairo renderer should use the official `lightweight-charts` package, pinned to a verified current 5.x release. Its APIs differ: [v4 to v5 migration](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5) describes `addSeries(...)` and the marker primitive. This is selective porting, not a drop-in import of `chart.ts`.

ViteApp's live strategies include [Bookmap wall reversals](../../../ViteApp/src/tradebooks/bookmapWallReversal.ts) and related [plan definitions](../../../ViteApp/src/trading/core/configuration/tradingConfig.ts). Their presence makes the data-requirements boundary essential. Bid/ask quotes are not a depth ladder, wall history, or reliable absorption detector.

## Backtest and the existing Bookmap detector

Additional inspected local sources: `Backtest` HEAD `e571d353`; `bookmap-plugin` HEAD `5bee2e3`. These are working-tree observations, not promises about installed plugin builds. Neither repository was edited.

The [tradebook index](../../../Backtest/tradebooks/index.md) defines reusable setup documents, not merely ticker-specific trade plans. It separates context, entries, quality filters, invalidation, stop/risk, management, and review. Cairo therefore needs both reusable `TradebookVersion` and daily `TradingPlanVersion` objects.

The user's [Gap Give and Go](../../../Backtest/tradebooks/gap_give_and_go.md) uses bid reappear/step-up, allows entry above the key level on either side of VWAP, uses LOD as a stop/day invalidation, and describes a usual core target at intraday high. Preserve these specifics when importing; do not apply a universal VWAP filter. [Shared Bookmap rules](../../../Backtest/tradebooks/bookmap_patterns/bookmap_patterns.md) also describe large-order transactions, comparable replacement walls, and focus on one stock. This supports one primary Bookmap focus symbol with other symbols available as a watchlist.

[Three-tier management](../../../Backtest/tradebooks/shared/3-tier-live-trade-management.md) separates scalp flexibility, core target/stop/reversal discipline, and a runner with an explicit trigger and trailing structure. Cairo must track logical tier quantities and rule permissions; a single generic trailing stop cannot stand in for that model. Undefined tier percentages, runner conditions, and discretionary signal strength are unresolved inputs, not opportunities for the AI to invent policy.

[Automation scoring](../../../Backtest/tradebooks/bookmap_patterns/automation_scoring.md) specifies eight deterministic patterns: offer breakout, bid breakdown, offer/bid reappear, offer step-down/bid step-up, and offer/bid V-shape. It documents event-time detection, snapshot readiness, wall qualification, execution-backed clearing, and a quality index that is explicitly not a win probability. Preserve detector rule versions and contributions in Cairo evidence.

The implementation is in [BookmapPatternEngine](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/BookmapPatternEngine.java), [pattern definitions](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/PatternType.java), and [signal serialization](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/BookmapPatternSignal.java). Signals contain `episodeKey`, pattern/direction, trigger price, wall reference ticks/size, score contributions, nanosecond event time as a string, and a separate creation timestamp. [PatternSignalStore](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/PatternSignalStore.java) replaces a signal by episode key; successive updates can have new UUIDs. Deduplicate an episode, not just a UUID.

Correction from the comparison review: current inspected output updates in-memory badges. `RongPlugin.handlePatternSignal` calls `PatternSignalStore.addOrUpdate`; neither path implements the JSONL writer previously described here. `toJson()` supplies serialization, not persistence. Add the exporter before expecting `~/Bookmap/bookmap-signals/pattern-signals.jsonl` to exist. The pattern contract says signals do not enter trading/WebSocket paths. [SignalWebSocketServer](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/SignalWebSocketServer.java) checks pattern eligibility against existing enabled tradebook groups. Cairo needs a small explicit observation/configuration integration; simply listening to port 8765 will not supply a pattern stream. Existing plugin native execution must not become Cairo's second execution route.

After implementing export, use log ingestion for initial observer replay/debugging. For live assistant/automated operation, add an observation-only stream with mode/readiness/heartbeat metadata, real prices, normalized alias mapping, detector/config version, and episode revisions. Convert raw ticks using Bookmap instrument `pips` in the Java adapter, not guessed scaling in Cairo. The [official Bookmap API examples](https://github.com/BookmapAPI/DemoStrategies) expose depth/trade/BBO callbacks and historical/live notification concepts; [Bookmap's API reference](https://github.com/BookmapAPI/ai-skills/blob/main/references/core-api.md) explains tick-versus-real-price units. A historical-to-live notification alone is not proof that an entire Bookmap session is live rather than replay; verify the installed API's replay-mode metadata before enabling broker writes from that source.

Do not claim every narrative pattern is already automated. For example, [Main Job Done, Protection Removed](../../../Backtest/tradebooks/bookmap_patterns/main_job_done_protection_removed.md) is a composite narrative beyond the eight enum patterns. Keep it human-confirmed/advisory until a tested detector or supporting wall-lifecycle events exist. Also validate the narrative [bid reappear](../../../Backtest/tradebooks/bookmap_patterns/bid_reappear.md) against detector semantics; a pattern badge alone does not establish all context/entry requirements in the complete tradebook.

## Market data and charting evidence

- [Massive minute aggregates](https://massive.com/docs/websocket/stocks/aggregates-per-minute): `AM` contains timestamped OHLCV and VWAP. Cairo uses these as its live minute-candle source.
- [Massive trades](https://massive.com/docs/websocket/stocks/trades): `T` supports price-event observation. Sequences increase per ticker but are not necessarily consecutive; a sequence gap alone is not proof of lost messages.
- [Massive quotes](https://massive.com/docs/websocket/stocks/quotes): `Q` supplies bid/ask information. A side can be absent. Cairo cannot treat a missing side as a zero price or assume a last trade is an executable exit price.
- [Massive custom bars](https://massive.com/docs/rest/stocks/aggregates/custom-bars): history supports split-adjustment choice; empty intervals may legitimately have no bars. The limit counts base aggregates and is not a universal guarantee of complete multi-day coverage.
- [WebSocket quickstart](https://www.massive.com/docs/websocket/quickstart): connect, authenticate, then subscribe. Feed access depends on the user's subscription; possession of a key does not establish real-time access.
- [Aggregate correction explanation](https://massive.com/blog/aggregate-bar-delays): bars can be late or rebroadcast with corrections. This explanation is from 2020; use it to justify correction support, not as a promise of current fixed latency or finality.
- [Market status/calendar](https://massive.com/knowledge-base/article/does-massive-have-a-market-holiday-or-status-page): current status and upcoming holidays/early closes are available through API endpoints.
- [Lightweight Charts getting started](https://tradingview.github.io/lightweight-charts/docs): client-side TypeScript chart library, initial `setData`, incremental `update`, and attribution requirements. Electron's renderer is the appropriate host.
- [Chart primitives](https://tradingview.github.io/lightweight-charts/docs/plugins/intro): overlays can use primitives. Start with built-in price lines and markers; defer a full drawing suite.

## OpenAI and harness evidence

The [function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling) describes tools executed by application code, strict schemas, and continuation with tool results. With reasoning models, returned reasoning items must be retained when continuing tool calls. Cairo must preserve provider output items and call IDs, not rebuild a turn from assistant text alone.

[Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) can enforce output shape. Shape adherence does not establish that a price, strategy, or calculation is correct. Cairo also validates domain semantics and handles incomplete/refused responses.

[Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) supports application-managed context, including `store: false`. Cairo's local database remains authoritative for trading state, while selected context is sent to OpenAI for inference. Local execution does not make OpenAI inference offline.

The [Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) is a viable local agent-loop library. Cairo's initial tool set and workflow are small enough to use the official OpenAI SDK with a bounded Responses loop. Adopt the Agents SDK later if its runtime features demonstrably reduce maintenance. A hosted managed harness adds little to the first local trading MVP.

## Desktop/runtime evidence

[Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process) provide Node-capable child processes, lifecycle events, and communication with the main process. This directly supports the proposed runtime sidecar. [Hono's Node adapter](https://hono.dev/docs/getting-started/nodejs) supports a smaller HTTP layer than copying OpenCode's current server. [Node SQLite](https://nodejs.org/api/sqlite.html) provides a built-in database API; verify it in the exact Electron runtime before committing the storage implementation.

## Limits of this investigation

- No Massive, OpenAI, or Schwab credentials were read; no paid inference, broker login, orders, or account queries were performed.
- Schwab's [official documentation entry](https://developer.schwab.com/products/trader-api--individual/details/documentation/Retail%20Trader%20API%20Production) exposes no readable endpoint specification through public browsing here. Detailed Schwab behavior in this plan is grounded in local working code, and must be checked against the user's authenticated portal during implementation.
- No strategy profitability claim is made. Example thresholds are deterministic fixtures for verifying behavior, not recommended trading parameters.
- The user selected the three execution modes and Bookmap support. Exact tier allocation, stop/runner bindings, per-rule automation permission, and ambiguous narrative-to-detector mappings still need to be specified while creating each tradebook/plan.
