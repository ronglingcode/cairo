# Cairo — MVP Implementation Plan

This is the operative document for implementing agents. Work one task at a time, in order, and
stop when a task's acceptance criteria are not met. Read `00-decisions.md` and
`01-architecture.md` before starting; read `02-data-models.md`/`03-agent-harness.md`/
`04-integrations.md` for the area you are touching.

---

## 0. Ground rules

1. **Repos.** Almost all work happens in `cairo/`. The only other repo that may be modified in the
   MVP is `bookmap-plugin/` (tasks T0-*). `ViteApp/`, `Backtest/`, `ProxyServer/`, `TradingData/`
   are **read-only** references; do not change them. Never commit across repos in one change.
2. **Copy, don't link.** ViteApp modules are vendored into `packages/trading-core` with a header
   comment naming the source path and commit/date. Do not add cross-repo imports or symlinks.
3. **Secrets.** Never print, log, or commit credentials or full account numbers. Tests use fakes.
   Anything reading `secrets.json` must ignore values it does not need.
4. **Live money.** Order-path code is test-driven against the fake broker first.
   `orders` changes require: unit tests for payloads, an engine integration test with the fake
   broker, and a manual market-hours checklist run by the user.
5. **No invented rules.** Tradebook semantics come from `02-data-models.md` and the Backtest
   tradebooks; if a rule is ambiguous, add an open question rather than guessing.
6. **LLM boundaries.** Never hardcode model IDs or API keys. The model is a runtime choice.
7. **Style.** TypeScript strict; zod at boundaries; small pure functions; no `any` in `protocol`;
   every task adds or updates tests and runs `bun run verify`.
8. **Scope.** Do not refactor unrelated code, do not add dependencies without a note in the task,
   do not build post-MVP items.

## 0.1 Milestones

| Milestone | Outcome | MVP? |
| --- | --- | --- |
| **T0** | bookmap-plugin exports pattern signals (WS push + JSONL append, additive) | Yes (confirmed) |
| **M0** | Repo scaffold, engine + plugin + Electron shell + OpenCode sidecar + chat that calls one cairo tool | Yes |
| **M1** | Real Massive data, charts, tradebooks, premarket planner writing plan files | Yes |
| **M2** | Live signals (Bookmap + candle detectors), signals UI, observer mode, read-only Schwab account | Yes |
| **M3** | Assistant mode: staged orders, approvals, Schwab submit/modify/cancel/flatten, lifecycle, rule recommendations, auto-journal | Yes |
| **M4** | Auto exits from rules, kill switch | Stretch |
| **M5** | Journaling quality, research/backtest pipeline, bookmap level push, markdown tradebook importer, mac packaging | Post-MVP |

**MVP = T0 + M0 + M1 + M2 + M3.** T0 is confirmed by the user: the plugin broadcasts signals on
WS :8765 and appends them to JSONL. If the plugin change is unavailable, manual capture (M2-5) and
candle detectors keep the MVP usable.

---

## 1. T0 — Bookmap signal export (bookmap-plugin)

### T0-1 — Export pattern signals over WS + JSONL

- **Goal:** every `BookmapPatternSignal` add/update is (a) broadcast on the existing
  `SignalWebSocketServer` (`ws://localhost:8765`) and (b) appended as one JSON line to
  `%USERPROFILE%\Bookmap\bookmap-signals\pattern-signals.jsonl`.
- **Files:** `bookmap-plugin/src/main/java/com/bookmap/plugin/rong/patterns/` (new
  `PatternSignalExporter.java`), wire into `RongPlugin` where `patternSignalStore.addOrUpdate` is
  called (see `BookmapPatternEngine`/`PatternSignalStore` listeners), docs update in
  `bookmap-plugin/README.md`.
- **Notes:** gated by the display-only pattern feature; broadcast to connected clients first (fast
  path), then async best-effort file append with an immediate flush (single-thread executor,
  drop-with-log on failure); create the directory atomically; Java property override
  `-Dbmtrader.signalExport=<path>`; never throw into the Bookmap callback.
- **Acceptance:** with the feature enabled, a test/real signal produces one valid JSON line and one
  WS message with the fields from `02-data-models.md` §2.2; with the feature disabled, neither
  happens; unit test covers serialization, path override, and broadcast; a Java-WebSocket test
  client receives the message.

### T0-2 — Consumption contract verification

- **Goal:** prove Cairo can consume the export fast and simply: a small script connects to `:8765`,
  receives a `bookmap_pattern_signal`, and compares it to the JSONL line.
- **Acceptance:** the script passes against a running plugin (or a captured fixture replay), and the
  contract in `04-integrations.md` §2.2–§2.3 is confirmed accurate.

### T0-3 — Contract documentation

- **Goal:** document the export contract (both paths, gating, override, line shape) in the plugin
  README and cross-reference `cairo/docs/opencode/04-integrations.md`.
- **Acceptance:** a fresh reader can implement the Cairo consumer from the doc alone.

---

## 2. M0 — Foundations

### M0-1 — Monorepo scaffold

- **Goal:** `cairo/` is a Bun-workspaces monorepo with strict TypeScript and verification scripts.
- **Deliverables:** root `package.json` (workspaces: `apps/*`, `packages/*`), `tsconfig.base.json`,
  `.gitignore` (`node_modules`, `dist`, `.state`, `secrets.json`), `eslint.config.js`,
  `.prettierrc`, package skeletons for `apps/desktop`, `packages/{protocol,engine,trading-core,cairo-plugin}`,
  `scripts/verify.mjs` (typecheck + lint + unit tests), `scripts/dev.mjs` (start engine + opencode
  serve + electron), `docs/spikes/` dir.
- **Acceptance:** `bun install && bun run verify` passes on empty packages; `bun run dev` starts the
  engine and prints a health URL.

### M0-2 — Protocol v0

- **Goal:** all shared schemas exist as zod + inferred types.
- **Files:** `packages/protocol/src/{signal,tradebook,plan,order,trade,journal,events,config}.ts`,
  `index.ts`.
- **Contents:** exactly the models in `02-data-models.md` §1–§6 and the event union in
  `01-architecture.md` §4.2. Tradebook schema includes the two seed YAMLs as test fixtures.
- **Acceptance:** fixtures parse; invalid YAML returns useful errors; `bun test packages/protocol`
  green; no `any`.

### M0-3 — Engine skeleton + runtime + store

- **Goal:** the engine starts, binds `127.0.0.1`, enforces a bearer token, streams events.
- **Files:** `packages/engine/src/{app.ts,index.ts,api/*,store/{sqlite.ts,kv.ts,audit.ts},runtime.ts}`.
- **Notes:** Hono + `@hono/node-server` + `ws`; SQLite via `better-sqlite3` (WAL, migrations in
  `store/migrations.ts`); `runtime.json` written atomically with `{enginePort, token, pid}`;
  `GET /health`, `GET /config` + `PUT /config`, `GET /events` (SSE), `WS /ws` echo channel with
  subscribe message; structured JSON logging to `.state/logs/engine-YYYY-MM-DD.log` (no secrets).
- **Acceptance:** integration test boots the engine on a random port, rejects missing/incorrect
  token, serves health, delivers an event over WS; restart preserves kv values.

### M0-4 — Plugin skeleton + first tool + workspace template

- **Goal:** OpenCode loads the Cairo plugin and a `cairo_*` tool calls the engine.
- **Files:** `packages/cairo-plugin/src/index.ts` (Promise plugin via `Plugin.define`),
  `packages/cairo-plugin/src/tools/*.ts`, `packages/cairo-plugin/src/engineClient.ts`,
  `workspace-template/` (`AGENTS.md`, `opencode.jsonc`, `cairo.config.yaml`, `recent-symbols.yaml`,
  `tradebooks/*.yaml` from `02-data-models.md`, `.opencode/agents/*.md`, `.opencode/skills/`,
  `.opencode/commands/`, `.opencode/plugins/cairo/` loader note), `scripts/seed-workspace.mjs`.
- **Notes:** plugin reads `.state/runtime.json` at call time; first tools: `cairo_health` plus
  `cairo_market_context` returning a stub from the engine; namespace `cairo`.
- **Acceptance:** with a seeded workspace and `opencode serve`, asking the agent "run cairo_health"
  returns the engine health JSON; `bun run seed-workspace` is idempotent.

### M0-5 — SPIKE: permissions & approvals mechanics

- **Goal:** resolve the unknowns documented in `03-agent-harness.md` §4–§5.
- **Questions to answer with a running spike (results written to `docs/spikes/000-permissions.md`):**
  1. What permission action name does a plugin tool emit — the effective tool name
     (`cairo_order_submit`) or a declared/custom action (`cairo.order.submit`)?
  2. Do session-scoped rules (`ctx.permission.rules`) override agent rules in the direction needed
     (relaxing `ask` to `allow` for auto mode), or must we ship three agent variants?
  3. What exactly does a client permission event expose (action, resources, message, sessionID,
     requestID) so the approval card can find the draft id?
  4. Which `@opencode/client` method names reply to a permission (`client.permission.get/list/reply`)?
     Confirm against the running server's `/openapi.json`.
- **Acceptance:** a scripted spike (a throwaway session + a stub `cairo_demo_order` tool) records
  answers and the chosen design; any deviation from `03-agent-harness.md` is written up as a task
  adjustment before M3 starts.

### M0-6 — Electron shell

- **Goal:** the desktop app opens, starts the engine + OpenCode sidecar, and shows chat.
- **Files:** `apps/desktop/electron/{main.ts,preload.ts,sidecars.ts}`, `apps/desktop/src/**`
  (React + Vite + Tailwind; panels stubbed), `apps/desktop/electron-builder.yml`.
- **Notes:** dev uses the globally installed `opencode`; packaged resolves the active binary via a
  `resolveOpencodeBinary()` helper (factory `resources/opencode-cli.exe`, later overridable by
  `.state/opencode/<version>/` for the manual update flow — ADR-015). Main passes
  `{enginePort, opencodePort, token}` via preload. Window state persistence; single instance;
  graceful sidecar shutdown.
- **Acceptance:** `bun run dev` opens a window; chat sends "hello" and streams a reply; killing the
  engine from the app restarts it and the renderer reconnects.

### M0-7 — Agents + provider seed

- **Goal:** the five agents load against one default model, OpenAI is connected, and a live session can be created.
- **Files:** `workspace-template/.opencode/agents/{premarket-planner,live-copilot,trade-manager,journalist,researcher}.md`,
  `workspace-template/opencode.jsonc` (model placeholder), `apps/desktop/src/features/chat/*`.
- **Notes:** create today's `live YYYY-MM-DD` session on app start if missing; model picker calls
  the OpenCode model list.
- **Acceptance:** each agent appears in the picker; asking the planner "what do you need to build a
  plan?" enumerates its cairo tools (proves tool advertising works).

### M0-8 — Dev scripts + docs

- **Goal:** a new machine can go from clone to running app in one page.
- **Deliverables:** root `README.dev.md` (prereqs: Node 22+, Bun, OpenCode CLI 2.x, ProxyServer for
  orders; Massive + OpenAI keys), `.env.example` for `OPENAI_API_KEY`, `scripts/verify.mjs`,
  `scripts/smoke.mjs` (engine + plugin tool call, no Electron).
- **Acceptance:** following the doc on a clean checkout reaches a working chat with a tool call; CI
  is out of scope (local verify only).

---

## 3. M1 — Premarket, tradebooks, charts

### M1-1 — Vendor trading-core

- **Goal:** ViteApp's headless trading logic lives in `packages/trading-core` with tests.
- **Source paths:** `ViteApp/src/trading/libraries/massive/{api,mapper,streamingProtocol}.ts`,
  `ViteApp/src/trading/core/marketdata/{marketState,marketClock,premarketVolume}.ts`,
  `ViteApp/src/trading/core/algorithms/{riskSizing,entryTargets}.ts`,
  `ViteApp/src/trading/libraries/broker/schwab/{entryOrderFactory,closingOrderFactory,accountProjection,oauth,readApi,streamingProtocol}.ts`,
  `ViteApp/src/trading/ports/*`, `ViteApp/src/utils/helper.ts` (`jsDateToUTC`).
- **Notes:** keep port interfaces; add Node adapters (`nodeHttp.ts`, `wsSocket.ts`,
  `fileCredentials.ts`); prefer `fetch` over `readHttp`; copy fixture tests from
  `ViteApp/scripts/` where practical; put `// vendored from ViteApp <path> @ <date>` headers.
- **Acceptance:** parsed/mapped fixtures match ViteApp; `MarketState` reproduces a fixture day's
  VWAP/HOD/LOD/premarket volume; order payload builders produce byte-identical JSON for the same
  inputs as the ViteApp snapshot fixtures.

### M1-2 — Market service (REST) + active symbol

- **Goal:** engine serves real bars/quotes/context for the active symbol.
- **Endpoints:** `GET /market/bars`, `GET /market/quote`, `GET /market/context`, `GET /watchlist`
  (active + recent symbols).
- **Notes:** per-symbol cache with TTL (bars: immutable for closed minutes; context: 2 s); context
  fields from `02-data-models.md` §3; the active symbol is persisted in `kv` and mirrored to
  `recent-symbols.yaml`; the engine still accepts any symbol via API for tests.
- **Acceptance:** integration test with a fake Massive HTTP port returns deterministic context;
  live manual check against Massive returns data for the typed symbol after hours.

### M1-3 — Tradebook loader + validation

- **Goal:** `tradebooks/*.yaml` loads, validates, hot-reloads.
- **Endpoints:** `GET /tradebooks`, `POST /tradebooks/reload`, `POST /tradebooks/validate`,
  `GET /tradebooks/:id` (implicitly in §4 list; add to `01-architecture.md` §4.1 when implementing).
- **Notes:** file watcher (chokidar or fs.watch with debounce); keep last-good definition on parse
  error and expose errors; `enabled: false` books are listed but inert.
- **Acceptance:** editing a seed file updates `GET /tradebooks` within 1 s; an invalid edit reports
  a zod path; engine keeps running.

### M1-4 — Plan service

- **Goal:** plan markdown + JSON sidecar read/write with validation.
- **Endpoints:** `GET /plans?date`, `GET /plan?date&symbol`, `PUT /plan`.
- **Notes:** markdown follows the Backtest trade-plan format; sidecar zod-validated; atomic writes;
  reject writes outside `plans/`.
- **Acceptance:** round-trip write/read; invalid sidecar rejected; `plan.updated` event emitted.

### M1-5 — Chart panel (single active symbol)

- **Goal:** one chart for the active symbol with candles, volume, VWAP, premarket high/low,
  levels/zones, markers.
- **Files:** `apps/desktop/src/features/charts/*` (React wrapper around `lightweight-charts` v5).
- **Notes:** port overlay logic from `ViteApp/src/ui/chart.ts` (one `setData` for history, then
  `series.update` coalesced at ≤10 Hz; price lines for key levels; `setMarkers` for executions and
  signals; fake-UTC time conversion); symbol input + recent list in the toolbar; full
  teardown/recreate on symbol change (no series leaks).
- **Acceptance:** a fixture day renders correctly (user screenshot check); switching the symbol
  loads fresh data and disposes the previous series; no console errors; smooth streaming updates.

### M1-6 — Symbol entry and plan UI

- **Goal:** the trader types a symbol and sees the day plan beside the chart.
- **Notes:** symbol input (uppercase, validated via a cached Massive reference lookup) + recent-
  symbols dropdown; plan panel renders markdown with structured levels highlighted; "level chip"
  click draws a price line temporarily; no watchlist management UI in MVP.
- **Acceptance:** typing `AAPL` loads history and context and persists it as the active/recent
  symbol; plan edits saved from the panel appear in the file.

### M1-7 — Premarket planner agent

- **Goal:** `/plan SYMBOL` produces plan files grounded in real context.
- **Files:** `.opencode/skills/trade-plan/**` (adapted), `.opencode/agents/premarket-planner.md`,
  `.opencode/commands/plan.md`, `cairo_plan_write` tool.
- **Notes:** the skill requires daily/30m/intraday context + news; news source for MVP is user-pasted
  text or `news.txt` in the plan folder; the agent must call tools for every number.
- **Acceptance:** run `/plan` on the active symbol; plan markdown + sidecar created; sidecar parses
  and contains at least one scenario; no invented prices (verified by diffing sidecar levels against
  `cairo_market_context` output).

### M1-8 — History loading/backfill for charts

- **Goal:** opening a symbol loads today's 1m bars + daily context efficiently.
- **Notes:** `getFullPriceHistory`-style fetch (today 1m + N daily bars) with caching in SQLite;
  renderer requests ranges; pagination respected.
- **Acceptance:** cold load of 4 symbols under 3 s on a normal connection; cached reload under 500 ms.

### M1-9 — M1 verification

- **Goal:** fixtures + manual premarket checklist.
- **Acceptance:** `bun run verify` green; manual checklist: launch → charts → `/plan` → edit plan →
  restart app → data/plan persist.

---

## 4. M2 — Live signals (observer mode)

### M2-1 — Live market ingestion

- **Goal:** live trades stream for the active symbol into `MarketState`; quotes/context update;
  feed status visible (the engine still supports more symbols for replay/tests).
- **Notes:** WS auth/subscribe (T.{symbol}), reconnect with exponential backoff, trade backfill for
  the gap, condition-code filtering; respect `feeds.massive.liveTrades`; emit `quote.updated`
  throttled (≤4/s/symbol); `feed.status` events.
- **Acceptance:** replay test feeds a recorded trade sequence and produces the expected final candle
  + VWAP; reconnect during a replay window backfills without double counting.

### M2-2 — Signal framework

- **Goal:** one signal registry with lifecycle, persistence, tradebook evaluation, and events.
- **Files:** `packages/engine/src/signals/*`.
- **Notes:** episodeKey dedupe; status transitions from `02-data-models.md` §2.4; append to
  `.state/signals/YYYY-MM-DD.jsonl`; match active tradebooks (direction + gates) and attach
  `tradebookId`; emit `signal.detected|updated|invalidated`.
- **Acceptance:** feeding two updates with the same episodeKey yields one row + one `updated` event;
  a tradebook gate failure marks the signal `invalidated` with reason.

### M2-3 — Candle detectors v1

- **Goal:** `orb`, `premarket_break`, `vwap_cross` detectors produce signals per tradebook params.
- **Notes:** operate on closed 1-minute candles plus live price crossings for stop-style triggers;
  ORB range uses the first `rangeMinutes` of RTH; volume ratio vs the same-day average of the
  opening window or premarket baseline; params from the tradebook rule.
- **Acceptance:** fixture-day unit tests for each detector (positive + negative cases); detector
  signals carry the evidence shape in `02-data-models.md` §2.3.

### M2-4 — Bookmap signal ingestion (WS fast path + file fallback)

- **Goal:** engine consumes `bookmap_pattern_signal` messages from WS `:8765` and the
  `pattern-signals.jsonl` file as `bookmap` signals, without duplicates.
- **Notes:** one `BookmapSignalSource` with WS primary and file tail fallback (see
  `04-integrations.md` §2.3): offset tracking in `kv`, rotation/truncation handling, partial-line
  buffering, dedupe by `id`/`episodeKey`, `feed.status.bookmap = ws+file | ws | file | none`.
- **Acceptance:** replay over WS and file simultaneously yields one signal per episode; killing WS
  falls back to the file without restart; a truncated file does not crash; malformed lines are
  skipped with a rate-limited log.

### M2-5 — Manual signal capture

- **Goal:** trader can capture a signal in one action.
- **Notes:** UI button on a chart (uses last price + selected side/pattern) and a global hotkey
  registered in Electron main; `POST /signals/manual`; source `manual`; optional note prompt.
- **Acceptance:** capture creates a signal that appears in the rail and is usable by
  `cairo_order_stage`; works when the Bookmap export is absent.

### M2-6 — Signals UI + alerts

- **Goal:** live signals are impossible to miss and easy to inspect.
- **Notes:** rail sorted by time with source/pattern/score/status chips; chart markers; optional
  sound via Electron; click → focus chart + "explain" button that prompts the live-copilot with the
  signal id; `signal.invalidated` dims the row.
- **Acceptance:** replay run shows signals appearing live and remaining after restart (SQLite).

### M2-7 — Live copilot: context hook + notifications

- **Goal:** the agent sees live state cheaply and comments on signals.
- **Notes:** implement `03-agent-harness.md` §8 (context hook cache, synthetic messages, prompt);
  the plugin keeps its own engine WS subscription; signal → synthetic message only for the active
  symbol (engine multi-symbol capable) and non-low tiers (configurable).
- **Acceptance:** in a replay session, a signal produces a chat message and asking "what changed?"
  yields an explanation grounded in the snapshot; token usage of the injected context < 1.5 KB.

### M2-8 — Schwab read-only account (token consumed from bmtrader)

- **Goal:** positions/orders/executions/buying power displayed using the token bmtrader maintains.
- **Notes:** port `SchwabReadApi` + `accountProjection` from `trading-core`; Node HTTP adapter
  calling ProxyServer; read `%USERPROFILE%\bmtrader\secrets.json` fresh (≤10 s cache) for
  `schwab.access_token`, `schwab.expires_at`, `schwab.accountHashValue`; **never refresh or rotate
  the token**; if missing/stale (`expires_at - now < 60 s`) surface "refresh in bmtrader" and disable
  broker calls (reads included); startup + periodic reconciliation.
- **Acceptance:** fake account fixture projects correctly (unit); live read shows the real account
  while bmtrader keeps the token fresh; an aged token file blocks calls with a clear message instead
  of an opaque 401.

### M2-9 — Observer mode wiring

- **Goal:** the whole app runs read-only with mode enforcement.
- **Notes:** `PUT /config` mode; permission rules deny all mutating cairo actions in observer; UI
  shows a "read-only" banner; the engine refuses mutations regardless of the agent.
- **Acceptance:** in observer, a test tool that calls `cairo_order_submit` is denied by OpenCode and
  the engine also returns 403; audit line records the attempt; mode switch persists across restart.

### M2-10 — Replay harness + M2 verification

- **Goal:** signals and observer flows testable after hours.
- **Notes:** `replayPort` reading a trades/bars JSONL with a controllable clock; CLI
  `bun run engine:replay --file fixtures/day-xxx.jsonl --speed 60x`; script drives signals through
  the engine.
- **Acceptance:** deterministic run produces an expected signal list; manual market-hours checklist
  (with T0 enabled) shows Bookmap signals arriving live; `bun run verify` green.

---

## 5. M3 — Assistant trade management

> **Before starting M3, complete the M0-5 spike.** The approval wiring depends on its answers.

### M3-1 — Risk service + guardrails

- **Goal:** deterministic sizing and the `validate` endpoint.
- **Notes:** port ViteApp `riskSizing` semantics (`R = config.risk.rDollars`, daily max loss,
  buying-power caps, `maxShares`); `/risk/size` returns shares/R-per-share/worst-case/cappedBy;
  `/risk/validate` implements every check in `03-agent-harness.md` §5.4 and returns
  `{verdict, reasons[]}`.
- **Acceptance:** unit tests match ViteApp fixture expectations; validate blocks: wrong mode, kill
  switch, daily limit, oversized, wrong-side stop, expired draft, disabled tradebook.

### M3-2 — Order drafts

- **Goal:** `/orders/stage` produces a complete, reviewable draft without touching the broker.
- **Notes:** fill entry/stop/targets from the tradebook when `intent.kind = "entry"`; compute qty
  via risk; price sanity check vs last (±3% or ±25 ticks — make it config); `title` per
  `02-data-models.md` §6; `expiresAt = now + 5 min`; `order.staged` event; persist in SQLite.
- **Acceptance:** staging from a fixture signal yields exact expected qty/levels; expired draft
  cannot be submitted; repeated stage with same signal episode updates rather than duplicates.

### M3-3 — Schwab submission (token consumed)

- **Goal:** `/orders/submit` sends the bracket through ProxyServer, idempotently.
- **Notes:** port `entryOrderFactory` multi-target TRIGGER/OCO payload; submit only when mode allows
  (assistant/auto) and the consumed token is fresh (same check as M2-8; otherwise blocked); Cairo
  never refreshes tokens; store request/response (redacted); `orderId` from ProxyServer's
  `{orderId}`; mark draft `submitted`; `order.submitted` event.
- **Acceptance:** fake broker integration test observes exactly one POST and one bracket shape per
  submit; double submit returns the same order id; observer mode returns 403 without a broker call;
  a stale token returns a blocking reason and performs no broker call.

### M3-4 — Modify / cancel / flatten

- **Goal:** full management actions with the same safety level.
- **Notes:** port ViteApp replacement flows (replace exit pair with new price, cancel-and-replace,
  replace-with-market, flatten); guard duplicate replacements; ambiguous outcome → `unknown`, no
  automatic resend; `order.canceled|order.rejected` events.
- **Acceptance:** fake-broker tests for stop move, target change, cancel pair, flatten; an ambiguous
  timeout produces `unknown` and requires manual review (tested).

### M3-5 — Trade lifecycle

- **Goal:** open trades are tracked accurately across restarts and partial fills.
- **Notes:** derive from orders/executions; average entry; current stop/targets; R per share and
  R multiple from live quotes; MFE/MAE best-effort; reconciliation on startup + interval;
  `trade.opened|updated|closed` events.
- **Acceptance:** replay of a filled bracket yields one trade with correct R at each fill; killing
  the engine mid-trade and restarting reconstructs the same trade.

### M3-6 — Management rules v1 (recommendation mode)

- **Goal:** engine evaluates tradebook management rules and recommends actions.
- **Notes:** supported actions: `moveStop(breakeven|rMultiple)`, `partial`, `exitAll`,
  `trailStop(distanceR)`, plus `flatBy`; evaluate on quotes/closed minutes (throttled); in
  observer/assistant only `rule.evaluated` + suggestion; dedupe rules per trade; `alert` on
  protective conditions.
- **Acceptance:** fixture trade reaches +1R and emits exactly one BE recommendation; invalidation
  fixture emits `exitAll`; flat-by fires at the configured minute.

### M3-7 — Trade-manager agent + skill

- **Goal:** `/manage` runs the manager loop safely.
- **Files:** `.opencode/agents/trade-manager.md`, `.opencode/skills/manage-trade/**`,
  `.opencode/commands/manage.md`.
- **Acceptance:** with a fake open trade, the agent calls `cairo_trade_list`, proposes the nearest
  rule via a staged draft, and in assistant mode the approval card appears; rejection produces a
  revised or abandoned proposal (no retry loop).

### M3-8 — Approvals inbox

- **Goal:** every `ask` is a clear trade card.
- **Notes:** subscribes to OpenCode permission events; fetches the draft from the engine; card shows
  side/qty/entry/stop/targets/R/worst-case/expiry/source signal/tradebook; buttons: Approve once /
  Reject (and "Always allow" only for auto-mode `modify`); keyboard shortcuts; pending list
  survives engine restart (re-fetch by draft id); audio cue.
- **Acceptance:** e2e replay test with the fake broker: stage → ask → approve → submit; reject path;
  two pending approvals do not cross; expired draft card disables approve.

### M3-9 — Auto-journal + journalist (light)

- **Goal:** a closed trade always produces a journal JSON, and `/journal` produces markdown.
- **Notes:** engine writes the JSON on `trade.closed` (schema in `02-data-models.md` §5);
  journalist agent writes the markdown using `trade-review` skill; `cairo_journal_append` for
  trader notes; link paths in `journal_index`.
- **Acceptance:** closing a fake trade produces the JSON automatically; `/journal` writes a readable
  markdown review referencing the plan and tradebook; missing review inputs are stated, not invented.

### M3-10 — M3 verification (manual, market hours)

- **Checklist for the user:** one real assisted entry, one stop move, one partial, one manual
  flatten, one rejected proposal, kill-switch behavior; confirm audit lines for each action;
  confirm positions match Schwab; confirm a stale bmtrader token blocks submit with a clear
  message.
- **Acceptance:** all checklist items pass and are written into `docs/spikes/m3-acceptance.md`.

---

## 6. M4 — Auto exits (stretch)

- **M4-1 — Execution mode in rules engine.** In auto, `rules` executes pre-validated actions via the
  same `/orders/*` endpoints after `/risk/validate` returns `ok`; writes `rule_evals` with
  `executed=true`; emits synthetic session note. Never executes `exitAll` on ambiguous price data.
- **M4-2 — Kill switch + auto sessions.** Global `PUT /config {killSwitch}`; UI button + hotkey;
  session rules/agent selection synced to auto; panic flatten always `ask`.
- **M4-3 — Guardrail stress tests.** Disconnect/reconnect mid-trade, engine restart mid-trade,
  double fill, partial fill at stop, flat-by while a target partial is pending, daily-limit trip.
- **Acceptance:** every stress case leaves a consistent trade record and an audit trail; no
  duplicate orders.

---

## 7. M5 — Post-MVP backlog (do not build now)

1. Journaling: screenshots, batch reviews, weekly/monthly aggregation compatible with
   `Backtest/analysis/reports` schemas.
2. Research/backtest pipeline: port Backtest strategy-optimization shape (deterministic validation
   thresholds: min 10 trades, +5pp win rate, +0.3 profit factor, +20% avg PnL, 2 months
   consistency); add `cairo_backtest_run`; consume `~/Bookmap/backtest-exports/` events.
3. Tradebook importer: draft YAML from existing `Backtest/tradebooks/*.md` markdown (proposal
   files, human approves).
4. Push plan levels/trade buttons to the Bookmap plugin (same wire shapes as ViteApp).
5. Firestore read-only watchlist/config import.
6. macOS packaging (same codebase, `@opencode/cli` darwin binary).
7. OpenCode upgrade flow: in-app update check against the npm registry, versioned sidecar binaries
   under `.state/opencode/<version>/`, staged download, compatibility smoke (serve + plugin load +
   `cairo_health` + permission action), activate/rollback UI; plugin-pin bumps still ship with a
   Cairo release after the smoke/approvals/replay suites pass (ADR-015).
8. Footprint/heatmap-lite panel if Bookmap is unavailable.
9. CLI parity (`cairo plan`, `cairo signals`) reusing the same engine + OpenCode sidecar.

---

## 8. Verification strategy

| Layer | Tool | What it proves |
| --- | --- | --- |
| Protocol | Vitest + fixtures | schemas accept/reject correctly; event union exhaustive |
| trading-core | Vitest (ported fixtures) | parity with ViteApp for mapping/aggregation/payloads |
| Engine unit | Vitest | detectors, risk, rules, lifecycle math |
| Engine API | integration tests + fake ports | mode enforcement, drafts, idempotency, reconciliation |
| Plugin | smoke script against `opencode serve` | tools registered, permission actions visible, approvals work |
| Renderer | component tests + manual screenshot | chart overlays, signals rail, approval card |
| End-to-end | `scripts/smoke.mjs` + replay CLI | signal → explanation → stage → ask → approve → fake broker fill → journal |
| Market hours | manual checklist per milestone | real Massive, Bookmap export, real Schwab read; assisted order only in M3 |

Fixtures: copy/generate from `ViteApp/scripts` and `ViteApp/src/trading/state-fixtures.json`; record
a real trading day (trades JSONL) once during M2 for the replay port. Never commit account data or
credentials.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| OpenCode plugin API differs from docs at the pinned version | Medium | High | M0-5 spike before M3; pin versions; keep the plugin thin |
| Permission precedence doesn't allow session-level relax to `allow` | Medium | Medium | Fall back to three agent variants (documented path) |
| Bookmap plugin change destabilizes the live path | Low | High | T0 is additive, gated, file-first, tested; WS broadcast is P1 |
| Consumed Schwab token goes stale (bmtrader not running) | Medium | Medium | read the token file fresh per call; block broker calls with a clear "refresh in bmtrader" message; Cairo never refreshes tokens |
| Massive WS limits / double stream alongside bmtrader | Medium | Medium | `liveTrades` setting; REST polling mode; Bookmap export is independent of Cairo's feed |
| Agent latency during fast markets | High | Medium | engine detects and (M4) executes rules without the LLM; the agent is advisory |
| Over-trusting the model | Medium | High | engine owns numbers; guardrails + approvals; audit of every action |
| Chart timezone/date bugs | Medium | Medium | port ViteApp's fake-UTC + marketClock; fixture screenshots |
| Scope creep into heatmap/backtesting | High | Medium | ADR + non-goals; M5 backlog is explicit |
| Windows packaging surprises (sidecar path, updater) | Low | Medium | mirror OpenCode desktop layout; smoke-test the packaged app at M3 |

---

## 10. Resolved decisions (user, planning session)

1. **MVP includes assistant-mode Schwab orders.** M2 ships observer first; M3 adds staged drafts,
   approval cards, and bracket submit/modify/cancel/flatten via ProxyServer. The app defaults to
   observer mode.
2. **Cairo consumes the Schwab token; it does not maintain one.** bmtrader (or ViteApp) keeps the
   token valid; Cairo reads `%USERPROFILE%\bmtrader\secrets.json` fresh (≤10 s cache) and blocks
   broker calls when it is stale. No OAuth/token-rotation code in Cairo for the MVP.
3. **One active symbol at a time.** The trader types the symbol; a recent list is kept. No watchlist
   UI, scanner, or Firestore import in the MVP.
4. **One preconfigured LLM model for all agents.** The model ID is chosen at setup in
   `opencode.jsonc`; per-agent/per-trader selection is post-MVP.
5. **bookmap-plugin exports pattern signals** over the existing WS (fast path) and to
   `~/Bookmap/bookmap-signals/pattern-signals.jsonl` (durable/backfill). T0 implements both; Cairo
   consumes push first and falls back to the file.

There are no open questions blocking implementation. Any new ambiguity should be recorded as an ADR
proposal or a task note, not guessed.

---

## 11. Definition of done (per task)

- Code typechecks (`tsc -b`), lint passes, unit/integration tests added and green.
- `bun run verify` passes from a clean `bun install`.
- Docs touching the change are updated (`docs/` or the package README).
- No secrets, no account numbers, no machine-specific absolute paths in committed files.
- The task's acceptance criteria are demonstrably met (test output or a written checklist entry).
- The change works with the replay/fake ports before it is ever pointed at live money.
