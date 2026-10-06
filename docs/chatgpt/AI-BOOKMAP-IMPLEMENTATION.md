# AI Bookmap assistant: implemented first vertical slice

Implemented October 5, 2026. See the sibling [plugin settings and replay guide](../../../bookmap-plugin/docs/cairo-evidence.md).

The plugin now emits independently configured wall/trade/BBO evidence behind `evidenceEnabled` (default true). Cairo builds a causal timeline, recognizes the three bid-breakdown/bounce sequences without using plugin pattern labels, identifies prior offer rejection, and exposes measured candidates/source rules to its existing AI connection. Automatic AI review uses the shared chat connection, coalesces setup changes, respects busy chat/cancellation, and validates epoch-scoped evidence and revisions before displaying an explanation. The model can also be asked to inspect a different bounce or wall.

Setup cards appear in Bookmap observations and above the live chat's Trading context drawer. Their local measurements update before the model reply. Multiple bounce candidates retain separate identities so AI can select an earlier bounce; both before/after bounces remain visible; provisional after-break highs, missing history and observed-window day lows are explicit. Model dollar prices must match actual recorded prices. “Accept for ... short” uses the existing trader-confirmed tag mechanism for current live positions; replay/unknown/stale/invalidated candidates cannot be accepted. Manual correction still uses `/bookmap-pattern`.

Sell fills associated with current short holdings retain a frozen entry-time assessment in the running Cairo session, including separate adds. Later bounces do not change it. Up to 200 frozen assessments are archived in Cairo’s profile as `bookmap-entry-evidence.json` and restored across restart; plugin evidence files provide replay, and accepted tags retain their existing persistence/reconfirmation behavior. Exact entry assessment depends on broker execution timestamps and available capture coverage.

Calibration variables are read when Cairo starts:

```powershell
$env:CAIRO_BOOKMAP_BOUNCE_TICKS = '2'
$env:CAIRO_BOOKMAP_BOUNCE_MS = '200'
$env:CAIRO_BOOKMAP_COVERAGE_MS = '5000'
```

These are initial noise/coverage defaults. Before calling recognition validated, review real clips across spreads/volatility and refine these values. Full day-low provenance, all other active pattern families and a dedicated model session are further work from the broader plan. The current shared AI queue can lag when chat is busy; no market/trading operation waits for model completion.

Checks: Cairo typecheck/build and Node tests; actual pinned OpenCode tool loading; Java tests and obfuscated release-JAR checks; real Java producer -> recorded replay WebSocket -> Cairo receiver/candidates -> validated AI-card contract. Real Bookmap replay and a live model's interpretation quality still require the trader's visual review after loading the new JAR.

For a disposable browser preview with the fake model and no broker runtime, run `npm run preview:fake -- --bookmap` after building. It connects to the local evidence producer, or `CAIRO_BOOKMAP_ENDPOINT` if set. Fake-model prose does not validate recognition quality; local candidates and recorded measurements are real inputs.

## Offer observations and confirmation

Large-offer breakouts now have a separate observation channel. They are visible even when there is no bid-breakdown trade setup and can trigger automatic AI explanations. They do not enter the trade-pattern catalog or expose an Accept/tag action.

A qualified offer must have been observed for at least 500 ms. A trade at least one tick above it, after observed price below/contact, creates a `large-offer-breakout` observation. The measured high and overshoot are retained. Crossing the price level does not prove that resting orders were consumed; cancellation/pull remains possible.

The user's rejection definition is a pop of about 1% and a return below within five seconds. The configurable default treats 1% as the maximum small overshoot. A subsequent below-price/quote measurement at least one second after the return confirms `offer-rejection`. One second is a provisional engineering hold filter. A recrossing resets that hold; a later reclaim invalidates the current confirmation. Large overshoots and late returns stay visible as extended/expired breakouts. Heartbeat silence cannot confirm a hold. Evidence gaps, source/epoch changes and readiness loss reset observations.

Runtime overrides: `CAIRO_BOOKMAP_OFFER_MAX_OVERSHOOT_PCT=1`, `CAIRO_BOOKMAP_OFFER_RETURN_MS=5000`, and `CAIRO_BOOKMAP_OFFER_HOLD_MS=1000`. Cards and tools expose the applied values. Times use replay market time, not wall clock playback speed. These heuristics need replay comparison with the trader's visual judgment.

Confirmed rejection observations above a subsequent bid breakdown are attached as context when available before the break and within the preceding two minutes. Touch-only rejections remain distinct; they cannot substitute for a clear/return/hold rejection on the same observed offer. The frozen entry assessment retains only evidence available at execution.

`read_setup_candidates`/`read_bookmap_timeline` expose offer observations; `interpret_bookmap_observation` publishes an evidence- and revision-validated advisory explanation. Automatic wakeups follow observation phases (breakout, return, rejection, extension/expiry/reclaim), coalescing high updates without calling AI on every tick. All capture remains behind the plugin's existing default-enabled `evidenceEnabled` flag; no plugin rebuild is required for this addition.

Card updates validate both observed price levels and the observation's measured overshoot distance. For example, a $90.14 high over a $90 offer supports describing a $0.14 overshoot even though $0.14 is not a market price. Unsupported prices/distances still fail validation. Known card-validation errors are returned through the tool bridge and displayed beside failed card updates; unexpected internal errors remain generic. Bookmap-triggered prompts focus on market observations and omit account-change assessment, so unrelated stale broker facts do not block replay explanation. A changed observation can be refreshed and retried once.
