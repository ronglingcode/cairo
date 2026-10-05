# Cairo MVP decisions

**Latest user revision (October 4, 2026):** Prioritize premarket notes to AI,
then AI help managing live trades. Build the first runnable Cairo app with
one-minute chart snapshot knowledge. Bookmap remains in the full plan but moves
to the final feature phase because the user has not chosen patterns yet. This
supersedes the earlier Bookmap-first ordering below. Existing read-only token
ownership and exact approval for broker actions remain. See
[the revised workflow](PREPARATION-MANAGEMENT-PHASE.md).

Discussion record, October 4, 2026. Planning only. This document records confirmed user choices and the differences between [the original comparison](PLAN-COMPARISON.md) and [the other plan](../opencode/README.md). [CODING-PLAN.md](CODING-PLAN.md) is now the authoritative final handoff requested by the user. It selects explicit implementation defaults for previously pending details; the discussion below preserves their earlier status rather than claiming the user individually chose every default.

| Topic | Status | Decision |
| --- | --- | --- |
| Product priority | Confirmed, revised | Premarket notes/chat first, AI help managing open trades next, Bookmap detection in the final feature phase. First app uses one-minute chart snapshot knowledge. |
| Agent runtime | Confirmed | Embedded OpenCode V2 with a Cairo plugin. The custom OpenAI loop and OpenAI Agents SDK are no longer the preferred implementation. |
| Desktop UI | Confirmed | React + TypeScript + Vite. User explicitly selected React; state/styling libraries remain small implementation choices. |
| Schwab connection | Confirmed | Consume a current valid Schwab token produced/maintained by `bookmap-plugin` (bmtrader), read-only; call Schwab directly from Cairo's backend. No ProxyServer dependency for Cairo. |
| Bookmap availability | Confirmed user assumption | `bookmap-plugin` will always be running during the user's trading workflow. Cairo consumes its existing token/output and does not need to launch the plugin or provide standalone Schwab login for the MVP. |
| Chart data | Confirmed, corrected | Load aggregated one-minute bars through Massive REST. Cairo opens no Massive WebSocket: the user's available connection is already used by `bookmap-plugin`. A snapshot/stale chart is acceptable. Sharing raw market data from Bookmap and live candles are deferred. |
| Trade management | Confirmed | Traders provide guidelines in human language per setup; Cairo interprets and enforces the reviewed instructions. Different setups can have different management styles. Neither earlier preset model defines the product. |
| OpenCode hosting | Coding-handoff default; compatibility to prove | Bundle the headless OpenCode server as a local sidecar and use its client in Cairo. T01 verifies the pinned Windows/server/plugin combination. The in-process SDK is an alternative, not an automatically selected fallback. |
| Cairo storage | Confirmed | No Cairo-owned SQLite, ORM, migrations, or historical operational database in the MVP. Keep live projections in memory and retain only necessary editable/recovery files. OpenCode can manage its own internal session storage. |
| Shared foundation | Agreed across both plans | TypeScript, Electron, Lightweight Charts, Massive market data, Schwab, existing Bookmap detector reuse, collaborative tradebooks, and a deterministic engine independent of model latency. |
| MVP modes/release boundary | Confirmed | Observer for entries; observer through assistant for exits. Traders enter through their existing platform. Cairo may submit supported exit/protective changes only after exact human approval. Assisted entries and automated management are deferred. |

The comparison topics are below. UI, broker connection, REST-only charting, management direction, and the MVP execution boundary were explicitly resolved by the user. For the final handoff, use the documented defaults: engine in Electron main; existing local WebSocket for Bookmap observations only; Markdown narrative plus reviewed JSON interpretation; explicit activation/attachment; personal Gap Give and Go narrative plus a separate ORB fixture; one focus chart and one configured model, with all held positions monitored. These are author-selected MVP defaults, not additional user-confirmed answers. Runtime and installed-source uncertainties become concrete early verification tasks.

| Order | Difference to resolve | Original ChatGPT plan | Other plan |
| --- | --- | --- | --- |
| 1 | Trading engine process | Separate Electron Node utility process from the beginning. | Engine module inside Electron main for the MVP. |
| 2 | Desktop UI | SolidJS to match the inspected upstream desktop. | React with a small UI store. |
| 3 | Schwab connection | Cairo handles OAuth/refresh and connects directly. | Reuse the existing externally maintained tokens and local ProxyServer. |
| 4 | Charting — resolved by REST-only snapshots | Earlier aggregate/trade/quote streaming is superseded. | Earlier trade-built live candles are superseded. |
| 5 | Bookmap bridge | Export observations plus explicit live/readiness/context metadata. | Start with signal JSON broadcast/export and expand its metadata. |
| 6 | Tradebook authoring and activation | Published snapshots and a broader clause/rule vocabulary. | Editable YAML, validation, and hot reload with fixed fields. |
| 7 | Management behavior — resolved by trader-authored guidelines | Earlier scalp/core/runner policies become optional examples of trader instructions. | Earlier partial/breakeven presets become optional examples of trader instructions. |
| 8 | Release boundary — execution resolved; UI/model scope pending | Earlier assisted entries and automated management are deferred. | Earlier assisted entries and automated management are deferred. One focus chart/shared model still needs resolution. |

Transport and agent-role scaffolding should follow the chosen runtime with the smallest necessary interfaces. SQLite adapter selection is removed. Full recording/replay, journal infrastructure, and deep research/backtesting are deferred by the simplification; they are not competing MVP implementation requirements.

The other plan records one active UI symbol, one shared model, external token ownership, and Bookmap export as preferences from its own conversation. Preserve that evidence when resolving those topics rather than treating them as technical errors. Held broker positions still need monitoring even if a different chart is selected.

The following paragraphs preserve the discussion before the final coding handoff selected its defaults. Statements that a choice remained pending describe that earlier discussion; use CODING-PLAN.md for current implementation instructions.

For decision 1, the discussion recommendation was to host the trading engine as a separate TypeScript module **inside Electron main for the MVP**, following the other plan. This reduces process lifecycle and recovery plumbing while the workload is primarily asynchronous feeds and small rule evaluations. OpenCode remains a separate runtime process. Avoid synchronous disk/network work or heavy computation in the main event loop, consistent with [Electron's performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).

The alternative is an Electron [utility process](https://www.electronjs.org/docs/latest/api/utility-process), which provides a separate Node process. It offers a separate failure/event-loop boundary at the cost of another process to start, monitor, and recover. Neither arrangement has been benchmarked in Cairo. Keep the engine independent of desktop UI code and accessed through the same small local API so a later move does not require changing its trading behavior.

Decision 1 remains pending the user's preference. Do not treat this recommendation as a confirmed architectural choice.

The user moved the discussion to the next difference without explicitly choosing the engine placement. Keep decision 1 pending rather than interpreting that transition as acceptance.

For decision 2, the user confirmed **React + TypeScript + Vite** for Cairo's renderer. The original SolidJS recommendation matched the inspected OpenCode desktop's UI stack. That is a reasonable consistency benefit, but Cairo is consuming OpenCode's headless runtime rather than copying its renderer. The [OpenCode client](https://opencode.ai/v2/docs/build/client) is browser-compatible and does not require a particular UI framework.

| Consideration | React | SolidJS |
| --- | --- | --- |
| Principal language | TypeScript/JavaScript. | TypeScript/JavaScript. |
| OpenCode integration | Consume the same client/session/event interfaces. | Consume the same client/session/event interfaces. |
| UI updates | Component rendering driven by state updates. | Fine-grained reactive dependencies update the affected UI. |
| Chart integration | A thin component owns the chart instance and its lifecycle; incoming data updates the chart API. | The same chart API, with Solid lifecycle/reactivity wiring. |
| Reason to select | Concrete integration examples and reusable React component primitives for the proposed desktop panels. | Closer match to OpenCode's inspected renderer and a reactive model suited to frequently changing UI values. |

Solid's targeted reactive updates are documented in its [reactivity guide](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity). This is an architectural difference, not proof that Cairo's React chart will be slower. Cairo has no framework benchmark, and the chart renders through Lightweight Charts in either option.

The recommendation favors React because the intended panels need familiar controls such as dialogs, tabs, dropdowns, and tooltips, available through [Radix's React primitives](https://www.radix-ui.com/primitives/docs/overview/introduction). TradingView also provides an [official React integration example](https://tradingview.github.io/lightweight-charts/tutorials/react/advanced). These are concrete implementation resources; no claim has been made that an implementation model is inherently more accurate with React. Solid remains capable of the same product behavior.

Whichever framework is chosen, create the chart once per mounted chart view, dispose it on unmount, and apply live changes through its series API. Do not route the entire tick history through component state or recreate the chart for each price update. [Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs) supports incremental series updates and advises against replacing all series data for routine live changes. Maintain the full rule-engine inputs independently of throttled/coalesced UI display updates.

The inspected [ViteApp manifest](../../../ViteApp/package.json) has TypeScript and Vite but no React or Solid dependency. Its [chart module](../../../ViteApp/src/ui/chart.ts) uses direct DOM and chart calls. Neither UI choice therefore gives automatic reuse of existing framework components. Reuse useful data/broker/chart logic selectively and write a small framework-specific chart adapter.

Decision 2 is confirmed by the user's message, "ok, prefer react." Selecting React does not by itself commit Cairo to a particular CSS library, a large state framework, or a routing/server-rendering framework; use only the controls and client state the MVP needs.

For decision 3, separate **who maintains the Schwab login** from **how Cairo sends broker requests**. The original plan assigned login/refresh to Cairo and used direct broker HTTP. The other plan assigned login/refresh to the existing bmtrader runtime and used the existing ProxyServer. Those two choices do not have to travel together.

| Option | What Cairo implements | Dependency / tradeoff |
| --- | --- | --- |
| Reuse bmtrader's token; call Schwab directly | Read-only token provider, Node HTTP adapter, reused broker codecs/order factories. | Existing token keeper must maintain authorization; no ProxyServer required by Cairo. |
| Reuse bmtrader's token and ProxyServer | Read-only token provider and broker requests through the existing local proxy. | Both token keeper and ProxyServer must be available; proxy responses need validated status handling. |
| Cairo owns login/refresh and calls Schwab directly | Authorization UI, callback-code handling, token refresh/file persistence, Node HTTP adapter. | More MVP work, but Cairo can maintain its broker connection without the existing token keeper. |

The user confirmed **consume a valid token produced by `bookmap-plugin` (bmtrader), read-only, and call Schwab directly from Cairo's backend**. This combines the other plan's smaller credential scope with the original plan's direct transport. Credentials and broker calls remain in the engine; the renderer and model receive normalized account/order facts, not tokens. Cairo does not require ProxyServer.

Evidence from the inspected local source:

- [LocalCredentials.java](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/miniviteapp/runtime/LocalCredentials.java) reads the user-owned JSON credential file and persists rotated Schwab credentials. We inspected this code, not the actual credential file.
- [TradingRuntime.java](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/miniviteapp/runtime/TradingRuntime.java) schedules token refresh while its runtime is active. Opening Bookmap by itself must not be assumed to guarantee that this runtime is active or refreshing.
- [The Java broker reader](../../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/miniviteapp/libraries/broker/schwab/ReadApi.java) already makes direct Schwab HTTP requests without ProxyServer.
- [ViteApp's OAuth module](../../../ViteApp/src/trading/libraries/broker/schwab/oauth.ts) already supports authorization-code exchange, refresh, and saving returned expiry. Cairo-owned OAuth would adapt this module rather than invent a new protocol implementation.
- [ProxyServer's Schwab routes](../../../ProxyServer/routes/schwab.js) forward the supplied authorization header. Several routes return their own success response without preserving the upstream error status; the order-submit route can return HTTP 200 with `orderId: -1`. A proxy-based Cairo adapter must correct/preserve that meaning before treating responses as broker acceptance.

Electron's [backend networking API](https://www.electronjs.org/docs/latest/api/net) supports HTTP/HTTPS outside the renderer. The direct-transport recommendation is supported by that capability and the existing Java direct client. It remains subject to the normal mock/integration checks during implementation; no live request has been made in this discussion.

The confirmed token contract is:

1. **Producer:** `bookmap-plugin` owns authorization and renewal; its `LocalCredentials` writer persists the Schwab token. ViteApp/browser-local storage is not Cairo's token source.
2. **Existing handoff:** read the plugin's configured credential-file path, default `%USERPROFILE%\bmtrader\secrets.json`. An overridden plugin path can be selected in Cairo's config. Consume `schwab.access_token`, `schwab.expires_at` (epoch milliseconds), and the selected account binding. No separate token-export service is needed.
3. **Before use:** require a nonempty token and finite future expiry with a small expiry buffer (proposed 60 seconds, matching the existing plugin's refresh lead). Re-read before a broker action; any short read cache must be invalidated on expiry/change/rejection. Local checks establish usable metadata; Schwab determines actual authorization validity.
4. **Renewal:** use the newly persisted token when the plugin rotates it. Cairo never exchanges authorization codes, refreshes tokens, or writes the producer's file. Do not reuse ViteApp's refreshing OAuth provider accidentally; adapt a read-only token provider.
5. **Unavailable/rejected token:** show "Waiting for Bookmap Schwab token" or "Refresh Schwab connection in Bookmap", label account data stale, and block new broker requests until usable authorization returns. Re-read on authorization failure. Do not automatically retry broker writes; uncertain action outcomes retain the normal reconciliation behavior. Market/Bookmap monitoring can continue.

No actual credential file or token was inspected during planning. The existing `publishToken()` method also sends an `execution_token` message to the plugin's native execution component; that is not evidence of an externally exposed Cairo WebSocket token endpoint. Use the already persisted file handoff for this MVP.

The practical distinction is whether the trader wants Cairo to operate without bmtrader's token keeper. Decision 3 is resolved: reuse existing authorization for the MVP and leave standalone Cairo login for later.

The user clarified that `bookmap-plugin` will always be running. Treat it as an existing companion in this personal MVP, rather than adding plugin startup management or a second token keeper to Cairo. Cairo still performs the previously specified token/freshness checks; a running producer is the workflow assumption, not a claim that a broker can never reject authorization.

Decision 4 is corrected: **load aggregated one-minute charts from Massive REST, with no live candle stream in Cairo**. The user reports that the available Massive WebSocket connection is already occupied by `bookmap-plugin`; treat that as the deployment constraint rather than a claim about every Massive subscription. Both earlier live-stream approaches, including the interim choice to build candles from trades, are superseded.

The selected pipeline is **Massive REST one-minute aggregates -> normalized in-memory bar snapshot -> Lightweight Charts and timestamped context**. Adapt [ViteApp's Massive REST client](../../../ViteApp/src/trading/libraries/massive/api.ts) (`getPriceHistory(symbol, 1, date)` / `getBars`) and [aggregate mapper](../../../ViteApp/src/trading/libraries/massive/mapper.ts) (`mapAggregate`). Do not wire its live `MarketLoader`/trade backfill, streaming protocol, or candle builder into Cairo for this MVP.

The lean default is load on symbol/date selection and explicit Refresh. Display the last successful fetch time and latest bar time, with an explicit snapshot/no-live-updates label. Retain the last successful snapshot if refresh fails and show the error/age. Replace or upsert returned OHLCV by symbol/minute; never accumulate the volume of an overlapping aggregate twice. Do not infer that the latest returned bucket is a completed minute or a current tick. Automatic REST polling is not required to finish this low-priority chart.

Cairo must not open any Massive trade, quote, or aggregate WebSocket, take over the plugin's connection, or poll individual REST trades to reconstruct a substitute stream. Bookmap market-data sharing may later permit ViteApp-style live candle building, but the raw-data relay is deferred. The existing pattern-observation bridge is a separate, still-required MVP integration; it does not imply that full trades/quotes/candles are already exported.

Live monitoring uses fresh exported Bookmap observations and current broker facts where applicable. A pattern's trigger/reference price is event evidence, not a continuously updated quote. Chart bars and derived VWAP/high/low/ranges carry their snapshot timestamp into model context. They can provide historical context or explicitly bound plan levels; they cannot prove a current crossing, target touch, support break, or bid/ask spread. A clause requiring an unavailable fresh price/candle input stays unavailable/needs trader confirmation. Chart staleness alone does not disable Bookmap-only monitoring or supported explicit trader-requested exits based on current broker facts.

The one-minute ORB remains a human-language setup example and synthetic rule fixture, not a mandatory live detector in this MVP. Showing the opening range from a snapshot does not supply the later live crossing. Resume live ORB/candle triggers only after an appropriate fresh source is agreed. Current caches stay in memory; no recorder, raw-data relay, live-candle repair framework, or extra market feed is added for this change.

Decision 7 is resolved by a third approach: **traders provide management guidelines in human language, and Cairo enforces them; each setup can have its own style**. No personal or generic preset is mandatory. Scalp/core/runner, breakeven, R-based partials, and trailing examples are optional language inputs only when the trader requests them.

The proposed implementation is language -> Cairo copilot interpretation/clarification -> trader-reviewed policy attached to the setup/trade -> engine monitoring and mode-appropriate action. Preserve the original clauses, show how each was interpreted and its execution coverage, bind quantities/levels/timing to the actual position, and freeze the active interpretation. Edits are proposed changes requiring review/rearm rather than silent hot changes to an open trade. The trader need not author structured rules.

[MANAGEMENT-GUIDELINES.md](MANAGEMENT-GUIDELINES.md) specifies the workflow and handoff. The confirmed MVP boundary below supersedes the earlier automatic-enforcement recommendation: rules monitor and recommend, and exit actions require exact human approval. Qualitative judgment is advisory or contributes to a reviewed assistant proposal; arbitrary prose is not assumed to be machine-enforceable. Exact initial examples, additional observations/actions, and artifact format remain to be agreed. The authored-guideline direction itself is confirmed.

Decision 8's execution boundary is confirmed: **observer for entries and up to assistant for exits**. Cairo detects entry conditions and explains/recommends them; it does not submit entries. Traders execute entries through Schwab/ViteApp or another existing interface, and Cairo attaches the reviewed management guidance to the resulting broker position.

For exits, Cairo monitors the guidelines and recommends or stages a supported exact partial/full close or protective exit-order change. Each actual submit/cancel/replace request needs current exact human approval; accepting a tradebook is not a standing broker-action approval. A fill-dependent follow-up is a new recommendation/ticket requiring new approval. Automated management, assisted entries, and their arming/permission scaffolding are outside this MVP, with no commitment to ship them immediately afterwards.

Enforce this boundary in the engine, not only by hiding entry UI/tools: a request that opens, increases, or reverses a position is rejected even if generic OpenCode permission or a user-approved ticket exists. Use broker position side/quantity and pending orders, not just BUY/SELL labels, to establish that an action is an exit. Assistant protection changes also validate known stop/OCO arrangements and cannot create excess close quantity. The writer/recovery checkpoint is still needed for approved exit requests and uncertain responses. One focus symbol versus watchlist and one configured model remain separate scope choices.
