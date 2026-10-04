# Cairo — Architecture Decision Records

These ADRs freeze the choices made during planning. An implementing agent should follow them.
Changing one requires the user's explicit approval; append a new ADR instead of rewriting the
old one.

Status legend: **Accepted** (MVP), **Deferred** (post-MVP), **Spike** (must be validated in M0).

---

## ADR-001 — Desktop stack: Electron + TypeScript

**Status:** Accepted

**Context.** The user wants a Windows desktop app in "the same programming language as OpenCode".
The installed OpenCode desktop app is an Electron application: `OpenCode.exe`, `resources/app.asar`,
`resources/opencode-cli.exe` (bundled sidecar), `electron-updater` artifacts, `main` at
`out/main/index.js`, renderer at `out/renderer/`. The user also uses OpenCode's CLI.

**Decision.** Build Cairo as an Electron + TypeScript app:

- `apps/desktop/electron/` — main + preload (TypeScript).
- `apps/desktop/src/` — renderer: React + Vite + TypeScript.
- Packaging with `electron-builder` (NSIS, Windows x64 only for MVP); `electron-updater` optional.
- The OpenCode CLI binary may be bundled in `resources/` exactly as OpenCode desktop does.

**Consequences.** One language across engine, plugin, UI, and agent tooling. Electron gives us
Node.js in main (engine host), Chromium for charts, and a proven packaging story. Bundle size is
acceptable for personal use.

**Alternatives rejected.** Tauri (Rust core, not the "same language"); a web app (no native file
access/lifecycle); forking the OpenCode desktop repo (fast-moving upstream; we only need its
composition pattern, not its UI).

---

## ADR-002 — Agent harness: reuse OpenCode V2, do not build a bespoke agent loop

**Status:** Accepted

**Context.** OpenCode V2 exposes everything a trading copilot needs: sessions with streaming model
output, a tool registry with JSON-Schema inputs and namespaces, agent profiles (Markdown/JSONC),
an ordered permission system (`allow` / `ask` / `deny`) that clients answer interactively, skills,
slash commands, lifecycle hooks (prompt admission, model requests, permission evaluation, tool
execute before/after), provider/model catalog configuration, compaction, and durable storage.
Building a comparable harness from scratch would dominate the MVP and delay the trading features
the user actually needs (signal detection and trade management).

**Decision.** Cairo embeds OpenCode as its agent runtime:

- Ship/pin the `@opencode/cli` (v2.x) binary as an app sidecar; run `opencode serve` bound to
  `127.0.0.1`, with the Cairo workspace as the OpenCode location (working directory).
- Write one Cairo OpenCode plugin (`packages/cairo-plugin`) that registers `cairo_*` tools, agents,
  skills, commands, permission rules and hooks.
- The renderer talks to the server with `@opencode/client` (browser-compatible; HTTP + event
  stream). `@opencode/sdk` (in-process embedding) is an option later if the HTTP hop ever matters.

**Consequences.** Large amount of harness behavior for free and a path to the CLI (parity with
OpenCode's TUI) later. We depend on OpenCode's plugin API; pin the CLI version and keep the plugin
thin and Promise-based. All trading capability remains behind the Cairo Engine API, so replacing
the harness later is possible without touching trading logic.

**Alternatives rejected.** A bespoke loop on the OpenAI SDK (months of work, worse approvals,
skills, compaction); an MCP server only (no sessions/approvals UI); forking OpenCode (unnecessary).

---

## ADR-003 — Separate Cairo Engine owns trading state and actions

**Status:** Accepted

**Context.** Order placement, signal detection and trade management must be deterministic,
testable, and available when the model is slow, offline, or being upgraded. LLMs must never be on
the critical path of an order's arithmetic.

**Decision.** A local TypeScript engine (`packages/engine`) is the single source of trading truth:

- Market data ingestion + 1-minute aggregation (Massive REST/WS), market context (VWAP, premarket
  high/low, HOD/LOD, gap, ATR, key levels).
- Tradebook loading/validation and signal detection (Bookmap signals + candle detectors).
- Risk sizing and deterministic guardrails.
- Order staging/submission/modification via Schwab, trade lifecycle tracking, management-rule
  evaluation, journaling, audit log.
- Local HTTP + WebSocket API (`127.0.0.1`, random/fixed port, bearer token from a runtime file).
- SQLite for operational state, JSONL for append-only audit, files for human artifacts.

For the MVP the engine runs inside the Electron main process (Node). It is written as a standalone
package so it can run under `bun`/`node` in tests or a utility process later.

**Consequences.** The agent and UI are both clients of a boring, testable service. Automatic exits
(later) run in the engine, not in the model. The engine API is the contract to test.

---

## ADR-004 — The tradebook is the shared human/AI artifact

**Status:** Accepted

**Context.** The user wants the trader and Cairo to collaborate on a tradebook that can describe
any setup — currently Bookmap order-flow setups, but also candle setups such as a 1-minute opening
range breakout for other traders. The `Backtest` repo already keeps tradebooks as markdown with a
14-section template, and a machine-readable scoring spec for Bookmap patterns.

**Decision.** A tradebook is one YAML file in `%USERPROFILE%\Cairo\tradebooks\` containing both:

- **Structured rules** the engine executes: `signals`, `entry`, `sizing`, `management`, `exits`,
  `session`, `automation`.
- **Prose** the agent and human read: `thesis`, `context`, `quality_conditions`, `invalidation`,
  `failure_modes`, `checklist`, free-form `notes`.

One schema (`packages/protocol`) validates all tradebooks. The engine hot-reloads on file change.
Two seed examples ship in `workspace-template/tradebooks/`: `orb-1m.yaml` (simple candle setup for
any trader) and `bookmap-offer-wall-breakout.yaml` (the user's real style).

**Consequences.** The file is versionable, diffable, portable, and readable by both parties. The
agent edits it with normal file tools plus a `cairo_tradebook_validate` tool. Converting the
existing markdown tradebooks from `Backtest/` is a later, assisted task.

---

## ADR-005 — Charting: TradingView Lightweight Charts + custom overlays

**Status:** Accepted

**Context.** ViteApp already draws 1-minute candles, VWAP, premarket high/low, Camarilla/key
levels, order price lines and execution markers with `sunrise-tv-lightweight-charts@4`. Bookmap
signals are not candles, so they render as markers/badges and rows in a Signals rail, not as a
second chart type. A full heatmap is out of MVP scope.

**Decision.** Use upstream `lightweight-charts` (v5) in the renderer and port the proven overlay
patterns from `ViteApp/src/ui/chart.ts`: one `setData` for history then coalesced `series.update()`
at ≤10 Hz, price lines for levels/stops/targets, `setMarkers` for executions and signals, a line
series for running VWAP and lazy premarket high/low line series. Times follow ViteApp's convention:
domain times are epoch ms; chart times are "fake UTC" seconds so the axis shows exchange-local
time (port `Helper.jsDateToUTC`).

**Consequences.** Familiar code, fast to implement, no rendering risk. Heatmap/footprint is a
possible later panel but is explicitly not MVP.

---

## ADR-006 — Market data: Massive REST + WebSocket, vendored from ViteApp

**Status:** Accepted

**Context.** ViteApp has a working, fixture-tested Massive client (`src/trading/libraries/massive`),
trade mapper with condition-code filtering, `MarketState` 1-minute aggregation, and a market clock.
The user has a Massive API key.

**Decision.** Vendor the relevant ViteApp `src/trading/**` modules into `packages/trading-core`
(Massive API client, mapper/streaming protocol, `MarketState`, `marketClock`, risk sizing,
Schwab payload builders), keeping the port-injectable structure. The engine consumes them.

Data flow: REST backfill + WS trades → `MarketState` → quotes/context/signals → UI events.
Live WS is a setting; when off (or when another app owns the vendor stream), Cairo uses REST
backfill + a slower polling/context refresh.

**Consequences.** Fast, consistent behavior with ViteApp and its tests. Vendor-copy, not a shared
dependency, so the live ViteApp is never destabilized.

---

## ADR-007 — Broker path: Schwab through ProxyServer, consuming a token maintained elsewhere

**Status:** Accepted (user-confirmed)

**Context.** ViteApp and the Bookmap plugin both trade Schwab. ProxyServer (`:3000/schwabApi`)
is a pass-through: it forwards the caller's `Authorization` header to Schwab and returns the
`Location`-derived `orderId` for POSTs. Token stores do not synchronize (ViteApp: localStorage;
bmtrader: `%USERPROFILE%\bmtrader\secrets.json`). The user decided: *bmtrader or ViteApp will keep
the token valid; Cairo simply consumes it.*

**Decision.**

- MVP order path: Cairo Engine → ProxyServer → Schwab, reusing ViteApp's bracket payload builders.
- **Cairo never runs OAuth or refreshes/rotates tokens in the MVP.** It reads the credential file
  `%USERPROFILE%\bmtrader\secrets.json` (read-only) fresh, with a ≤10 s in-memory cache, for
  `schwab.access_token`, `schwab.expires_at`, `schwab.accountHashValue` and `massive.apiKey`.
  An optional fallback file lives at `%USERPROFILE%\Cairo\secrets.json`.
- If the token is missing or expires within 60 s, the engine blocks broker calls (reads included)
  with a clear "refresh in bmtrader" reason instead of failing opaquely; the UI surfaces it.
- Consequence for ownership: Cairo can run alongside the token-owning app because it never writes
  the credential file. Residual risk (two apps trading the same account simultaneously) is the
  user's responsibility; every Cairo order action is audit-logged.

**Consequences.** Zero OAuth/token code in Cairo, no rotation conflicts, and one less setup step
(the bmtrader file already contains Massive and Schwab credentials). Post-MVP, if bmtrader is not
running, a direct OAuth fallback can be added behind a setting.

---

## ADR-008 — Modes map to OpenCode permissions plus engine guardrails

**Status:** Accepted

**Context.** The user defined three modes: observer, assistant, full automated (entries still
assisted, exits/management automated from rules). OpenCode has exactly the right primitive:
tools declare permission actions; rules (`allow`/`ask`/`deny`, last match wins) are configured
globally, per agent, and per session (session rules are evaluated after agent rules); clients
answer `ask` with `once` / `always` / `reject`; a `permission: evaluate` hook can attach a reason
or downgrade to `deny` after deterministic validation; hard `deny` rules and policies are final.

**Decision.**

| Action class | observer | assistant | auto |
| --- | --- | --- | --- |
| market/context/signal/tradebook reads | allow | allow | allow |
| `risk.validate` / `order.stage` | allow | allow | allow |
| entry submit | deny | ask | ask |
| exit/intent modify (stop move, partial, flatten-on-invalidation) | deny | ask | allow only after engine `risk.validate` verdict `ok` |
| cancel/panic flatten | deny | ask | allow (kill switch overrides everything) |

Enforcement is triple-layered: (1) OpenCode permission rules (what the model may call), (2) the
`permission: evaluate` hook calling the engine's deterministic validator, (3) the engine itself
refusing out-of-mode actions. The engine is authoritative; OpenCode is the UX gate.

**Consequences.** One coherent place for approvals; the UI renders OpenCode permission requests as
trade approval cards. The exact action-name mechanics (whether a plugin can declare custom actions
or the tool's effective name is used) are an M0 spike; both paths are supported by the docs.

---

## ADR-009 — Bookmap signal ingestion: plugin-side export (JSONL + optional WS)

**Status:** Accepted (requires one additive change to `bookmap-plugin`, task T0)

**Context.** The Bookmap engine already computes `BookmapPatternSignal` objects with a full JSON
serialization (`type: "bookmap_pattern_signal"`, `symbol`, `pattern`, `direction`, `triggerPrice`,
`referenceWallPeakSize`, `qualityScore`, `qualityTier`, `eventTimeNs`, `timestamp`,
`scoreContributions[]`). Today those signals are display-only (heatmap badge, sound) and never
leave Bookmap. `Backtest/tradebooks/bookmap_patterns/automation_scoring.md` already specifies the
persistence contract: "Every signal/update is appended to `~/Bookmap/bookmap-signals/pattern-signals.jsonl`".

**Decision.**

- T0 (bookmap-plugin, additive, backward-compatible, confirmed by the user): when the pattern engine
  updates a signal, (a) broadcast `BookmapPatternSignal.toJson()` on the existing
  `SignalWebSocketServer` (`ws://localhost:8765`) for the fast path, and (b) append the same JSON
  line to `%USERPROFILE%\Bookmap\bookmap-signals\pattern-signals.jsonl` for durability/backfill.
  Both are gated by the existing display-only pattern feature flag. No existing message type changes;
  ViteApp ignores unknown types.
- Cairo's `BookmapSignalSource` consumes WS first, falls back to JSONL tail (offset tracking,
  rotation handling), and dedupes by `signal.id`/`episodeKey` so the same signal never double-fires.
- When T0 is not installed, Cairo falls back to (a) a manual signal-capture hotkey and (b) its own
  candle detectors.
- Cairo never requests book depth or tries to reconstruct the heatmap in the MVP.

**Consequences.** Low-risk, low-latency signal path with an audit file. The interface is one line
of JSON and already matches the Backtest spec.

---

## ADR-010 — Storage: files for humans, SQLite for operations, JSONL for audit

**Status:** Accepted

**Context.** Personal, local, single-user. Scalability is out of scope, but trading data must be
queryable and durable enough to survive crashes, and the human artifacts must stay portable.

**Decision.**

- **Files** (`%USERPROFILE%\Cairo\`): `tradebooks/*.yaml`, `recent-symbols.yaml`, `plans/YYYY-MM-DD/`,
  `journal/YYYY-MM-DD/`, `research/`, `config.yaml`. Written with atomic temp-file replace.
- **SQLite** (`%USERPROFILE%\Cairo\.state\cairo.db`, better-sqlite3): signals, order drafts and
  orders, fills, trade lifecycle records, rule evaluations, session/task index, key-value settings.
- **JSONL audit** (`%USERPROFILE%\Cairo\.state\audit/YYYY-MM-DD.jsonl`): append-only stream of every
  agent-proposed and engine-executed action, with mode, permissions decision, and result.

**Consequences.** Easy to inspect and back up; no server. No Firestore writes in MVP.

---

## ADR-011 — Journaling and research reuse `Backtest` conventions

**Status:** Accepted

**Context.** `Backtest/` already defines trade review fields (`setups`, `mistakes`, `r_multiple`,
`mae`, `mfe`, risk, holdtime), review templates, the strategy-optimization pipeline with
deterministic validation thresholds (min 10 trades, +5pp win rate, +0.3 profit factor, +20% avg
PnL, 2 months consistency), and the trade-plan/trade-review skills.

**Decision.** Cairo's workspace copies/adapts those skills and templates; the journal schema uses
the same field vocabulary; the post-MVP research module ports the pipeline shape (extract →
aggregate → AI hypotheses → deterministic validation → human accept). Cairo writes only inside its
own workspace; `Backtest/` stays read-only unless the user asks otherwise.

**Consequences.** Reports stay compatible with the user's existing review habits, and the
optimization loop keeps its "never auto-apply tradebook changes" rule.

---

## ADR-012 — Compute and secrets stay local; no cloud

**Status:** Accepted

**Context.** Personal use, possibly shared with a few friends at most. Market data, broker tokens,
and journals are sensitive. The user explicitly asked to skip scalability/security work.

**Decision.** Everything runs on the local machine: Electron app, engine, OpenCode sidecar, plugin.
Local HTTP endpoints bind `127.0.0.1` and use a per-run bearer token written to
`%USERPROFILE%\Cairo\.state\runtime.json`. Credentials (`massive.apiKey`, the maintained Schwab
token) are consumed read-only from `%USERPROFILE%\bmtrader\secrets.json`, with an optional
`%USERPROFILE%\Cairo\secrets.json` fallback (never in the repo, never in prompts, never logged).
The only outbound traffic is Massive, Schwab, and the configured LLM provider. Nothing is uploaded
anywhere else.

**Consequences.** Sharing with friends means zip-and-run, each with their own secrets. No
multi-tenancy anywhere in the design.

---

## ADR-013 — One active symbol at a time (MVP)

**Status:** Accepted (user-confirmed)

**Context.** The user's workflow is one focused stock at a time (Bookmap pattern trading requires
full attention; the Backtest tradebook rules say "Only Focus On One Stock"). Multi-symbol
watchlists add UI, data, and context cost with no MVP benefit.

**Decision.** The MVP UI supports exactly one active symbol, typed in by the trader, plus a recent-
symbols list. The engine remains multi-symbol capable internally (detectors, market state, replay
tests), but charts, subscriptions, signals, alerts, and agent context are scoped to the active
symbol. The planned `watchlist.yaml` is replaced by an optional `recent-symbols.yaml`; scanners and Firestore imports
are post-MVP.

**Consequences.** Simpler charts, prompts, and subscriptions. Multi-symbol watchlists return later.

---

## ADR-014 — One preconfigured LLM model for all agents (MVP)

**Status:** Accepted (user-confirmed)

**Context.** The user chose: "for MVP, use the same model preconfigured; later we will allow traders
to choose a model."

**Decision.** `opencode.jsonc` sets a single default model (ID chosen at setup via `/models`, never
hardcoded in code). Agent files omit `model:` and inherit it. The MVP UI does not offer per-agent or
per-trade model selection.

**Consequences.** Simple configuration and prompt tuning; changing the model is one config edit.
