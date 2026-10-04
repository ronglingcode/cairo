# Cairo — Integrations

Everything external that Cairo talks to, with the exact contracts verified during planning. Read
`00-decisions.md` (ADR-006, ADR-007, ADR-009) for why these choices were made.

---

## 1. Massive (market data)

Base REST URL: `https://api.massive.com` (ViteApp's `MassiveApi`). Live trades:
`wss://socket.massive.com/stocks`. The API key is read from
`%USERPROFILE%\bmtrader\secrets.json` (`massive.apiKey`, maintained alongside the Schwab token),
with an optional fallback to `%USERPROFILE%\Cairo\secrets.json`. No separate key step is needed
when bmtrader is configured.

### 1.1 REST endpoints used by the MVP

| Purpose | Request |
| --- | --- |
| 1-minute aggregates | `GET /v2/aggs/ticker/{symbol}/range/1/minute/{start}/{end}?adjusted=true&sort=asc&limit=50000` |
| Higher timeframe aggregates | same with `5/minute`, `15/minute`, `30/minute` |
| Daily candles | `GET /v2/aggs/ticker/{symbol}/range/1/day/{start}/{end}?adjusted=true&sort=asc` |
| Trades backfill (reconnect/partial-minute repair) | `GET /v3/trades/{symbol}?timestamp.gte={ns}&timestamp.lt={ns}&order=asc&sort=timestamp&limit=50000` |
| Ticker reference (shares outstanding) | `GET /v3/reference/tickers/{symbol}` |

Pagination follows `next_url` (same host only). `sip_timestamp` is stringified before `JSON.parse`
to preserve nanosecond precision (ViteApp does this; keep it).

Bar mapping: `{t,o,h,l,c,v,vw}` → `Candle {symbol, datetime (ms), open, high, low, close, volume, vwap}`.

### 1.2 WebSocket protocol

```json
{ "action": "auth", "params": "<apiKey>" }
{ "action": "subscribe", "params": "T.AAPL,T.INTC" }
```

Messages arrive as arrays; `ev: "status"` carries `auth_success | auth_failed | not_authorized`,
`ev: "T"` carries trades `{ev:'T', sym, t, p, s, ds, q, i, x, c}`. Fractional size prefers `ds`.
Trade mapping produces `{symbol, timestamp(ms), price, size, sequence?, id?, exchange?, conditions[]}`.

Realtime candle building uses the condition-code filter list ViteApp applies during RTH
(`2,7,12,13,15,16,20,21,37,52,53`) so odd prints do not move the last price. Aggregation is
`MarketState` (1-minute buckets, running VWAP map, premarket/regular high-low, volume/dollars).

### 1.3 Engine behavior

- History backfill on symbol add; exact-minute repair after reconnects via trade backfill; dedupe
  buffered live prints (ViteApp `MarketLoader` pattern).
- `feeds.massive.liveTrades: false` switches to REST polling (`feeds.massive.pollSeconds`) for a
  low-noise mode and for running alongside bmtrader without a second vendor socket.
- Vendor `packages/trading-core/src/trading/**` from ViteApp: `libraries/massive`,
  `core/marketdata/{marketState,marketClock}`, `core/algorithms/{riskSizing,entryTargets}`,
  `libraries/broker/schwab`. Keep the port interfaces (`HttpPort`, `SocketPort`,
  `CredentialPort`) and write Node adapters (`nodeHttp`, `wsSocket`, `fileCredentials`).

---

## 2. Bookmap plugin (signals + levels)

### 2.1 What exists today

- Java addon `bmtrader` runs the trading runtime itself (Massive, Firestore, Schwab) when attached.
- `BookmapPatternEngine` (display-only, flag `bookmap_pattern_signals`, disabled by default)
  computes `BookmapPatternSignal` objects with a full scoring model
  (`Backtest/tradebooks/bookmap_patterns/automation_scoring.md`).
- `BookmapPatternSignal.toJson()` already emits the wire object (see `02-data-models.md` §2.2).
- `SignalWebSocketServer` on `ws://localhost:8765` handles `custom_button_click`,
  `entry_retest_ready`, `core_plan_update`, and broadcasts `entry_retest_ready` to clients.
  It is explicitly **not a trading dependency**, and pattern signals currently never leave the
  heatmap.
- Plugin logs live at `%USERPROFILE%\bmtrader\logs\bmtrader-YYYY-MM-DD*.log`.
- The user must enable the **Bookmap Pattern Automation (display-only)** setting in Bookmap for the
  engine to run at all.

### 2.2 T0 — additive signal export (the only cross-repo change in MVP; user-confirmed)

Modify `bookmap-plugin` (small, gated, backward-compatible). Both paths carry the same JSON:

1. **WS push (fast path).** After `PatternSignalStore.addOrUpdate`, call
   `SignalWebSocketServer.broadcast(signal.toJson().toString())` so connected clients (Cairo)
   receive it immediately (one socket hop). Existing clients ignore the unknown `type`.
2. **File append (durable path / backfill).** Append the same `signal.toJson()` line to
   `%USERPROFILE%\Bookmap\bookmap-signals\pattern-signals.jsonl` and flush immediately (signal
   volume is low). Create the directory; best-effort async append on a small executor; never block
   detection; gated by the display-only pattern feature; Java property override
   `-Dbmtrader.signalExport=<path>`.

Constraints:

- No changes to existing message shapes or fields.
- No new dependency; Gson is already used.
- Keep the current logging/redaction rules.
- Add a parity test that a signal produced by `BookmapPatternEngineTest` serializes to the expected
  line shape and that the file path helper respects the override.

### 2.3 Cairo ingestion (fast + resilient)

One `BookmapSignalSource` merges two inputs into the same pipeline:

- **WS (primary):** connected while the engine runs; filter `type === "bookmap_pattern_signal"`.
  Push latency is the plugin's detection latency plus one socket hop.
- **JSONL tail (fallback/backfill):** watch the file (`fs.watch` as a hint, poll size every 250 ms);
  read from the stored byte offset; on truncation/rotation reset and re-read the last N minutes;
  skip malformed lines (rate-limited log).
- **Dedupe:** by `signal.id` and `episodeKey` so an update received on WS is not reprocessed from
  the file. Engine keeps the last 24 h in SQLite for the UI and agent tools.
- Each signal → `Signal` (source `bookmap`) → tradebook evaluation →
  `signal.detected|updated|invalidated`.
- Feed status chip: `ws+file | ws | file | none`; a WS drop falls back to the file without an engine
  restart.
- When T0 is absent: hotkey capture (manual source) and candle detectors still work; the UI shows
  "Bookmap export not detected".

### 2.4 Levels/config pushed toward Bookmap (P1)

Cairo's plan levels and tradebook selection can be pushed to the plugin using the **same message
shapes ViteApp sends** (`key_levels_config` with `priceUnit: "real"`, `previousDay`, `premarket`,
zones; and `trade_button_config` if desired). Because the live protocol must stay compatible on
both sides, this work must check ViteApp's `bookmapSocket.ts` and the plugin's parsers together and
is P1, not MVP-critical: the trader already runs Bookmap with the plugin drawing its own levels.

---

## 3. Schwab (broker)

### 3.1 Credentials — consume the token, never maintain one

The user's decision: **bmtrader or ViteApp keeps the Schwab token valid; Cairo consumes it.**
Cairo performs no OAuth and no token refresh/rotation in the MVP.

| Item | Value |
| --- | --- |
| Credential source | `%USERPROFILE%\bmtrader\secrets.json` (read-only), optional fallback `%USERPROFILE%\Cairo\secrets.json` |
| Fields used | `schwab.access_token`, `schwab.expires_at`, `schwab.accountHashValue` (plus `massive.apiKey`) |
| Read policy | Read fresh per broker call with a ≤10 s cache so bmtrader's token rotations are picked up automatically |
| Staleness | If the file is missing or `expires_at - now < 60 s`: block broker calls (reads included) with reason `token stale — refresh in bmtrader`; UI chip warns |
| Trader API | `https://api.schwabapi.com/trader/v1` (always through `http://localhost:3000/schwabApi`) |
| ProxyServer | pass-through; stores no tokens |

Notes: ViteApp stores tokens in browser localStorage, which is not consumable by other apps; if the
user runs only ViteApp, bmtrader must be the token keeper (it writes the JSON file). A direct-OAuth
fallback for Cairo is post-MVP.

### 3.2 ProxyServer routes (verified in `ProxyServer/routes/schwab.js`)

| Method + path | Behavior |
| --- | --- |
| `GET /schwabApi/userPreference` | pass-through; returns `streamerInfo` |
| `GET /schwabApi/accounts?fields=positions` | pass-through `accounts[0].securitiesAccount` |
| `GET /schwabApi/accounts/:accountHash/orders?fromEnteredTime&toEnteredTime&maxResults` | pass-through; split windows on 500-result pages |
| `POST /schwabApi/accounts/:accountHash/orders` | forwards body; returns `{orderId}` parsed from `Location` |
| `PUT /schwabApi/accounts/:accountHash/orders/:orderId` | replace |
| `DELETE /schwabApi/accounts/:accountHash/orders/:orderId` | cancel |

All calls send the caller's `Authorization` header onward. OAuth refresh goes through
`POST /schwabApi/v1/oauth/token` with Basic auth `base64(appKey:secret)`.

### 3.3 Order payloads (reuse ViteApp factories)

Base order: `{session:"NORMAL", duration:"DAY", orderLegCollection:[{orderLegType:"EQUITY",
instrument:{assetType:"EQUITY",symbol}, instruction:"BUY"|"SELL"|"SELL_SHORT"|"BUY_TO_COVER",
quantity}], orderType, orderStrategyType}`.

Bracket entry with multiple targets (ViteApp `entryOrderFactory`):

```json
{
  "orderStrategyType": "TRIGGER",
  "childOrderStrategies": [
    { "orderStrategyType": "OCO",
      "childOrderStrategies": [
        { "...": "STOP leg: stopPrice, quantity = target.quantity" },
        { "...": "LIMIT leg: price = target.target, quantity = target.quantity" }
      ] }
  ]
}
```

Also ported: OCO-only exits for existing positions, replace-with-new-price, replace-with-market,
cancel-and-replace, `flattenPosition`. Entry orders add +1 cent slippage to breakout stops
(`addSlippage`) as ViteApp does.

### 3.4 Reconciliation and reads

- Startup + periodic (e.g. every 30 s while flat, 10 s while positioned): read account/orders;
  derive positions, entry orders, exit pairs, executions using the same projection logic as
  `accountProjection.ts`.
- Paper trail: every submit/modify/cancel stores the raw request/response (redacted) in SQLite and
  an audit JSONL line.
- Ambiguity handling (timeouts/5xx after send): mark the draft `unknown`, do not resend
  automatically; require broker review + manual reset (same policy as bmtrader).

---

## 4. LLM (OpenAI via OpenCode)

- Configure the catalog `openai` provider; credential via `OPENAI_API_KEY` in the environment or
  OpenCode's `/connect`. Example in `03-agent-harness.md` §3.
- Choose the model interactively (`/models`) and put its ID in `opencode.jsonc` and agent files.
  **Do not hardcode a model ID in code.**
- Native packages available if a custom endpoint is ever needed:
  `@opencode/ai/providers/openai`, `.../openai/responses`, `.../openai-compatible`.
- Cost control: one live session per trading day (plus task sessions), compaction enabled,
  context injection capped, subagent for heavy research.

---

## 5. ProxyServer (localhost :3000) and replay

- Already required by ViteApp; Cairo uses it for Schwab only in the MVP.
- `/save` persists files posted from the app — useful as a fallback for dumping large tool outputs,
  but Cairo writes its own files directly.
- The market-data **replay** module (REST + WS) is used for deterministic engine tests
  (`replay` mode in the engine: a fake market port fed by ProxyServer's replay endpoints or by
  recorded trades JSONL). ViteApp itself has no replay; check `ProxyServer/` docs when wiring it.

---

## 6. Firestore / hosted config (optional, read-only)

- `TradingData` publishes watchlist/config to Firebase; ViteApp reads `configDataSnapshot` and
  writes trading state. Cairo MVP does **not** read or write Firestore: the trader types the active
  symbol, optionally seeded from `Backtest/data/processed/YYYY/MM/DD/premarket_watchlist.json`.
- If later desired, reuse ViteApp's `FirestoreApi` document codec from `trading-core` for a
  read-only config/watchlist import (`GET` only; never write trading state — bmtrader/ViteApp own
  that).

---

## 7. Ports, files, and processes

| Process / file | Default | Notes |
| --- | --- | --- |
| Cairo Engine HTTP/WS | `127.0.0.1:4318` (fallback: random free port) | token in `.state/runtime.json` |
| OpenCode server | `127.0.0.1:4096` | `opencode serve`, cwd = workspace |
| Bookmap plugin WS | `ws://localhost:8765` | display-only, optional for Cairo |
| ProxyServer | `http://localhost:3000` | Schwab pass-through; replay |
| Massive REST/WS | `api.massive.com` / `socket.massive.com` | outbound HTTPS/WSS |
| Workspace | `%USERPROFILE%\Cairo` | all user artifacts |
| Bookmap export | `%USERPROFILE%\Bookmap\bookmap-signals\pattern-signals.jsonl` | written by T0 |
| Engine state | `%USERPROFILE%\Cairo\.state\cairo.db` + `audit/` + `signals/` | SQLite + JSONL |
| Runtime file | `%USERPROFILE%\Cairo\.state\runtime.json` | `{enginePort, opencodePort, token, pid}` |
| Credential/token source (read-only) | `%USERPROFILE%\bmtrader\secrets.json` | maintained by bmtrader; Cairo reads fresh and never refreshes |
| ProxyServer logs | `ProxyServer/data/logs/YYYY-MM-DD.log` | useful when debugging orders |

---

## 8. Development without live markets

1. **Fixtures:** port ViteApp's fixture generators/tests for Massive mapping, `MarketState`, risk
   sizing, and Schwab payload factories into `trading-core` tests.
2. **Replay market port:** implement `MarketPort` twice — `massivePort` (prod) and `replayPort`
   (reads a recorded trades/bars JSONL and emits them with a controllable clock). This makes signal
   detectors, rule evaluation, and lifecycle fully testable after hours.
3. **Fake broker port:** `POST /orders/stage|submit` in `test` mode writes to SQLite only and
   simulates fills; used by engine and UI e2e tests.
4. **Bookmap replay:** `Backtest/scripts/bookmapBacktest.mjs` already consumes plugin exports from
   `~/Bookmap/backtest-exports/<run-id>/`; Cairo's replay port can consume the same
   `events.jsonl` shape later (post-MVP) for Bookmap-signal-driven backtests.
5. **UI smoke:** run the app with replay port + fake broker; assert a signal appears, a draft is
   staged, the approval card renders, and approval submits (to the fake broker).
