# Cairo — Data Models & Storage

All types in this document belong to `packages/protocol` and are the contract shared by the engine,
the renderer, and the OpenCode plugin. Schemas are defined with **zod**; TypeScript types are
inferred from them.

---

## 0. Conventions

| Concern | Rule |
| --- | --- |
| Time | Epoch **milliseconds** UTC in the domain. Session math uses `America/New_York`. Charts receive "fake UTC" seconds (ViteApp convention) for exchange-local display. |
| Prices | Real decimal prices (`number`). Bookmap wire messages carry `priceUnit: "real"`; adapters convert to/from ticks internally. |
| Quantities | Whole shares (`number`, integer). |
| Risk | `R` is a dollar amount from config (default `1000`). `rMultiple = pnl / R`. Distances use `rPerShare = |entry − stop|`. |
| IDs | ULIDs (`ulid()`), prefixed by type in display only: `sig_`, `draft_`, `ord_`, `trd_`, `sig_`. |
| Files | UTF-8, LF, atomic replace via temp file + rename. |
| Money | USD only. |

---

## 1. Tradebook (`tradebooks/*.yaml`)

The shared artifact. Structured rules are engine-executable; prose is for the human and the agent.

### 1.1 Schema (TypeScript view)

```ts
interface Tradebook {
  id: string;                     // kebab-case, unique in workspace
  name: string;
  version: number;                // bump on material rule change
  enabled: boolean;
  direction: "long" | "short" | "both";
  symbols?: string[];             // optional restriction; omitted = all watchlist
  thesis: string;                 // 1-3 sentences: why the edge exists
  context?: ContextGate[];        // whole-setup eligibility gates (hard)
  signals: SignalRule[];          // what to detect
  entry: EntryRule;
  sizing: SizingRule;
  management: ManagementRule[];   // ordered; first matching rule wins
  exits: ExitRule;
  session: SessionRule;
  automation: AutomationRule;
  quality_conditions?: string[];  // prose: A+ / lower quality
  invalidation?: string[];        // prose, mirrored by signals[].invalidate
  failure_modes?: string[];
  checklist?: string[];
  notes?: string;                 // free-form markdown-ish prose
}

interface ContextGate {
  id: string;
  description: string;
  // deterministic checks evaluated by the engine against MarketContext
  check:
    | { kind: "gapPct"; op: ">=" | "<=" | ">" | "<"; value: number }
    | { kind: "premarketVolumeShares"; op: ">=" | "<="; value: number }
    | { kind: "priceAbove"; level: "vwap" | "pdc" | "pmHigh" | "pmLow" }
    | { kind: "sessionTime"; after?: "HH:mm"; before?: "HH:mm" };
}
```

```ts
interface SignalRule {
  id: string;                     // referenced by entry.trigger
  name: string;
  source: "bookmap" | "candle" | "manual";
  side: "long" | "short";
  // bookmap: match engine output; candle: built-in detector id + params
  match: { pattern: string; minQualityScore?: number }            // source=bookmap
       | { detector: "orb" | "premarket_break" | "vwap_cross" | "gap_and_go" | "gap_and_crap";
           params: Record<string, number | string | boolean> }    // source=candle
       | { hotkey: string };                                      // source=manual
  invalidate?: ContextGate[];     // signal becomes invalid when true
  expiresAfterSeconds?: number;
}

interface EntryRule {
  trigger: string | string[];     // signal rule id(s)
  orderType: "market" | "stop_market" | "stop_limit" | "limit";
  priceRef?: "signalPrice" | "pmHigh" | "pmLow" | "hod" | "lod" | "vwap" | "manual";
  bufferTicks?: number;
  stop: StopRule;
  targets?: TargetRule[];         // defaults derived from R if omitted
  allowAddOns?: boolean;
  maxEntrySlippageCents?: number;
}

type StopRule =
  | { kind: "level"; ref: "pmLow" | "pmHigh" | "lod" | "hod" | "vwap" | "signalLow" | "signalHigh"; bufferTicks?: number }
  | { kind: "atr"; multiple: number }
  | { kind: "percent"; value: number }
  | { kind: "manual" };

interface TargetRule {
  id: string;                     // e.g. "t1"
  rMultiple: number;              // 1R, 2R ...
  partialPercent: number;         // 0-100, sum <= 100
  label?: string;
}

interface SizingRule {
  model: "r" | "fixedShares";     // MVP supports "r"
  riskMultiplier: number;         // 1 = full R, 0.1 = starter
  maxShares?: number;
  maxPercentOfBuyingPower?: number;
}

interface ManagementRule {
  id: string;
  when: {
    rMultipleAtLeast?: number;
    rMultipleAtMost?: number;
    priceVs?: { ref: "vwap" | "entry" | "signalPrice"; op: ">=" | "<=" };
    secondsSinceEntry?: number;
    signalId?: string;
    tradebookInvalid?: boolean;
  };
  action:
    | { kind: "moveStop"; to: "breakeven" | "rMultiple"; value?: number }
    | { kind: "partial"; percent: number; atLimit?: number }
    | { kind: "exitAll"; reason: string }
    | { kind: "trailStop"; distanceR: number }
    | { kind: "alert"; message: string };
  automation?: "inherit" | "manual" | "auto";   // inherit = tradebook.automation.management
}

interface ExitRule {
  flatBy: string;                 // "HH:mm" America/New_York, e.g. "15:55"
  stopFirst: boolean;             // stop order lives from entry (default true)
}

interface SessionRule {
  start: string;                  // "09:30"
  end: string;                    // "16:00"
  entryWindowEnd?: string;        // no new entries after this
}

interface AutomationRule {
  entry: "assistant" | "auto";    // auto entries are post-MVP; engine treats "auto" as "assistant"
  management: "manual" | "assistant" | "auto";
  exit: "assistant" | "auto";
}
```

### 1.2 Seed example A — candle setup (`orb-1m.yaml`)

```yaml
id: orb-1m
name: 1-Minute Opening Range Breakout
version: 1
enabled: true
direction: both
thesis: >-
  The first minute establishes an auction extreme; a decisive break with volume
  continuation through the range often extends before the first pullback fills.
context:
  - id: liquid
    description: Premarket participation confirms attention
    check: { kind: premarketVolumeShares, op: ">=", value: 100000 }
  - id: rth-only
    description: Entries only during the first two hours
    check: { kind: sessionTime, after: "09:30", before: "11:30" }
signals:
  - id: orb-high-break
    name: Opening range high break
    source: candle
    side: long
    match:
      detector: orb
      params: { rangeMinutes: 1, breakBufferTicks: 2, requireVolumeRatio: 1.5 }
  - id: orb-low-break
    name: Opening range low break
    source: candle
    side: short
    match:
      detector: orb
      params: { rangeMinutes: 1, breakBufferTicks: 2, requireVolumeRatio: 1.5 }
entry:
  trigger: [orb-high-break, orb-low-break]
  orderType: stop_market
  priceRef: signalPrice
  bufferTicks: 2
  stop:
    kind: level
    ref: signalLow        # long: low of the opening range; adapter flips for short
    bufferTicks: 2
  targets:
    - { id: t1, rMultiple: 1, partialPercent: 50, label: first }
    - { id: t2, rMultiple: 2, partialPercent: 50, label: runner }
sizing: { model: r, riskMultiplier: 1, maxShares: 2000, maxPercentOfBuyingPower: 25 }
management:
  - id: be-at-1r
    when: { rMultipleAtLeast: 1 }
    action: { kind: moveStop, to: breakeven }
  - id: bail-below-vwap
    when: { priceVs: { ref: vwap, op: "<=" }, secondsSinceEntry: 120 }
    action: { kind: exitAll, reason: lost VWAP" }
exits: { flatBy: "15:55", stopFirst: true }
session: { start: "09:30", end: "16:00", entryWindowEnd: "15:30" }
automation: { entry: assistant, management: assistant, exit: auto }
quality_conditions:
  - Fresh catalyst or clear relative strength/weakness
  - Opening range is not a tiny doji inside premarket chop
invalidation:
  - Price re-accepts inside the opening range after the break
failure_modes:
  - First-minute extremes get swept then reversed (wait for the reclaim)
checklist:
  - Premarket volume confirmed
  - Range drawn on the chart
  - R plan reviewed before first entry
notes: |
  Simple reference setup for traders without Bookmap. Copy and adapt.
```

### 1.3 Seed example B — Bookmap setup (`bookmap-offer-wall-breakout.yaml`)

Structured rules mirror `Backtest/tradebooks/bookmap_patterns/automation_scoring.md`; prose mirrors
`big_offer_clear_pullback_go.md`.

```yaml
id: bookmap-offer-wall-breakout
name: Big Offer Clear, Pullback, Go (Bookmap)
version: 1
enabled: true
direction: long
thesis: >-
  Buyers consume a large displayed offer wall; when price pulls back and then
  takes out the post-clear high, the absorbed supply is treated as fuel.
context:
  - id: min-wall
    description: Only large, comparable walls
    check: { kind: premarketVolumeShares, op: ">=", value: 1000000 }
signals:
  - id: offer-wall-break
    name: Offer wall breakout (pullback and go)
    source: bookmap
    side: long
    match: { pattern: offer_wall_breakout, minQualityScore: 60 }
    expiresAfterSeconds: 300
entry:
  trigger: offer-wall-break
  orderType: stop_market
  priceRef: signalPrice        # post-clear high from the signal evidence
  bufferTicks: 1
  stop:
    kind: level
    ref: signalLow             # tight: pullback low; wide: pre-push low (see notes)
    bufferTicks: 1
  targets:
    - { id: t1, rMultiple: 1.5, partialPercent: 40, label: core }
    - { id: t2, rMultiple: 3, partialPercent: 60, label: runner }
sizing: { model: r, riskMultiplier: 1, maxShares: 2000, maxPercentOfBuyingPower: 25 }
management:
  - id: be-at-1.5r
    when: { rMultipleAtLeast: 1.5 }
    action: { kind: moveStop, to: breakeven }
  - id: core-invalidation
    when: { tradebookInvalid: true }
    action: { kind: exitAll, reason: wall level re-accepted" }
exits: { flatBy: "15:55", stopFirst: true }
session: { start: "09:30", end: "16:00", entryWindowEnd: "15:30" }
automation: { entry: assistant, management: auto, exit: auto }
quality_conditions:
  - Wall ≥ 5,000 lots, qualified ≥ 500 ms, and actually traded through
  - Signal within 2 ticks of a configured level/zone
  - VWAP agrees with direction (breakout family only)
invalidation:
  - Offer reappears at the same or lower price (short-side signal) — stand down
failure_modes:
  - Flash clear not backed by aggressor volume
  - Stacked-wall sweep (score penalty in the engine already)
checklist:
  - Bookmap pattern automation enabled
  - Wall size/duration pasted into the signal note
notes: |
  Wide-stop variant: stop at the low before the push that cleared the wall.
  Price levels arrive from the Bookmap plugin signal export; see 04-integrations.md.
```

---

## 2. Signal model

### 2.1 `Signal`

```ts
interface Signal {
  id: string;                 // sig_...
  episodeKey: string;         // stable identity across updates (Bookmap supplies one)
  source: "bookmap" | "cairo" | "manual";
  symbol: string;
  side: "long" | "short";
  pattern: string;            // bookmap: offer_wall_breakout; candle: orb-high-break; manual: free
  status: "detected" | "armed" | "triggered" | "invalidated" | "expired";
  price: number;              // trigger price
  ts: number;                 // event time (ms)
  strength: number;           // 0-100 quality score (bookmap) / heuristic (cairo) / 100 manual
  tier?: "low" | "medium" | "high" | "very_high";
  tradebookId?: string;       // matched tradebook, if any
  planRef?: { date: string; symbol: string };
  evidence: Record<string, unknown>; // source-specific payload (see below)
  notes?: string;             // human/agent annotation
}
```

### 2.2 Bookmap evidence (from `BookmapPatternSignal.toJson()`)

The plugin already emits (one JSON line per signal/update, and optionally over WS):

```json
{
  "type": "bookmap_pattern_signal",
  "priceUnit": "real",
  "id": "0d1f...",
  "episodeKey": "INTC|offer|offer_wall_breakout|1760000123",
  "symbol": "INTC",
  "pattern": "offer_wall_breakout",
  "direction": "long",
  "triggerPrice": 35.12,
  "triggerPriceTick": 35120,
  "referenceWallPriceTick": 35080,
  "referenceWallPeakSize": 8200,
  "qualityScore": 72,
  "qualityTier": "high",
  "eventTimeNs": "1760000123456789000",
  "timestamp": 1760000123456,
  "scoreContributions": [
    { "ruleId": "wall-size-2x", "points": 10, "detail": "wall 2.1x threshold" },
    { "ruleId": "vwap-agrees", "points": 5, "detail": "price above RTH VWAP" }
  ]
}
```

Mapping into `Signal`: `symbol`, `pattern`, `side = direction`, `price = triggerPrice`,
`strength = qualityScore`, `tier = qualityTier`, `ts = timestamp`, `episodeKey`, evidence = the raw
object. `postClearHigh` / `pullbackLow` for entry/stop come from an extended export field (T0 adds
`triggerReference` values if available; until then the entry uses `priceRef: signalPrice` = trigger
price and the stop uses the wider Bookmap day low/high when no pullback low is known).

### 2.3 Candle evidence

```json
{
  "detector": "orb",
  "rangeMinutes": 1,
  "rangeHigh": 35.10, "rangeLow": 34.62,
  "breakCandle": { "t": 1760000700000, "close": 35.14, "volume": 120000 },
  "volumeRatio": 1.8,
  "vwap": 34.95, "hod": 35.14, "lod": 34.55,
  "gapPct": 2.1
}
```

### 2.4 Lifecycle

```
detected ──► armed ──► triggered ──► (trade opened)
    │           │
    └───────────┴──► invalidated / expired
```

- `detected`: engine produced it; UI shows it; agent can comment.
- `armed`: passed tradebook gates and is being watched for entry trigger (e.g. pullback holds).
- `triggered`: entry condition met; drives order staging.
- `invalidated`: tradebook `invalidate` gates hit, or `expiresAfterSeconds` elapsed → `expired`.

Deduping: same `episodeKey` updates the existing row; `signal.updated` is emitted.

---

## 3. Daily plan

Files: `plans/YYYY-MM-DD/{SYMBOL}.md` (human/agent prose) + `{SYMBOL}.json` (structured sidecar).

```ts
interface DailyPlan {
  date: string;                    // YYYY-MM-DD (America/New_York)
  symbol: string;
  tradebookId?: string;            // selected setup
  status: "draft" | "active" | "invalidated" | "done";
  levels: KeyLevel[];
  zones: Zone[];
  scenarios: Scenario[];           // active + conditional branches
  contextSnapshot: MarketContext;  // frozen at plan time for audit
  notes?: string;
  createdBy: "human" | "agent" | "mixed";
  updatedAt: number;
}

interface KeyLevel { price: number; label: string; kind: "pdc" | "pmHigh" | "pmLow" | "hod" | "lod" | "vwap" | "custom" }
interface Zone { low: number; high: number; label: string; kind: "support" | "resistance" | "noTrade" }
interface Scenario {
  id: string;
  when: string;                    // prose: "price accepts above PM high"
  then: string;                    // prose: "watch offer_wall_breakout, target HOD+"
  tradebookId?: string;
  pattern?: string;                // Bookmap pattern to watch
}
```

Markdown format follows `Backtest/skills/trade-plan/SKILL.md` (daily/30m/premarket analysis lines,
active + conditional blocks). The sidecar is written by `cairo_plan_write` so charts and Bookmap
share exact levels.

---

## 4. Trade lifecycle

```ts
interface TradeRecord {
  id: string;                      // trd_...
  symbol: string;
  side: "long" | "short";
  status: "pending" | "open" | "closing" | "closed" | "canceled";
  tradebookId: string;
  signalId?: string;
  planRef?: { date: string; symbol: string };
  entry: { avgPrice: number; shares: number; ts: number };
  initialStop: number;
  currentStop: number;
  targets: { id: string; price: number; rMultiple: number; shares: number; filled: boolean }[];
  exits: { price: number; shares: number; ts: number; reason: string }[];
  rPerShare: number;
  rMultiple?: number;
  pnl?: number;
  mfe?: number; mae?: number;      // best-effort from quotes while open
  orderIds: string[];              // entry + bracket order ids
  modeAtEntry: "assistant" | "auto";
  notes?: string;
}
```

State machine:

```
pending (orders working)
  ├─ filled → open
  ├─ canceled/never triggered → canceled
open
  ├─ partial exits → open (updated)
  ├─ protected exit hit → closed
  └─ flatten/flat_by → closed
closed → journal JSON written → journaled (flag on record)
```

Reconciliation: on engine startup and every N minutes, read Schwab orders/fills for `today`;
reload open trades and brackets; never trust in-memory state across restarts.

---

## 5. Journal

`journal/YYYY-MM-DD/{SYMBOL}-{tradeId}.json`:

```ts
interface JournalEntry {
  tradeId: string; date: string; symbol: string; side: "long" | "short";
  tradebookId: string; signalId?: string;
  setups: string[];                 // free tags ("orb", "offer_wall_breakout")
  mistakes: string[];               // filled by the trader or agent, often empty at close
  entryPrice: number; exitPrice: number; size: number;
  returnDollar: number; returnPct: number; rMultiple: number;
  holdTimeSeconds: number;
  risk: number;
  mae?: number; mfe?: number;
  executions: { time: number; price: number; qty: number; action: string }[];
  planRef?: { date: string; symbol: string };
  notes?: string;
  reviewMarkdownPath?: string;      // set when /journal produces the .md
}
```

Field vocabulary intentionally matches `Backtest/data/processed/.../trade_data.json`
(`setups`, `mistakes`, `r_multiple`, `mae`, `mfe`, `holdtime`, `risk`) so aggregate analysis can
reuse that pipeline later.

---

## 6. Order DTOs

```ts
type OrderIntent =
  | { kind: "entry"; symbol: string; side: "long" | "short"; tradebookId: string; signalId?: string; qtyOverride?: number }
  | { kind: "exit"; symbol: string; percent?: number; qty?: number; reason: string }
  | { kind: "moveStop"; symbol: string; stop: number }
  | { kind: "flatten"; symbol: string };

interface OrderDraft {
  id: string;                       // draft_...
  intent: OrderIntent;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: { orderType: "market" | "stop_market" | "stop_limit" | "limit"; price?: number; bufferCents?: number };
  stop: number;
  targets: { id: string; price: number; rMultiple: number; shares: number }[];
  sizing: { rDollars: number; rPerShare: number; worstCaseLoss: number; cappedBy?: string };
  riskCheck: { verdict: "ok" | "warn" | "block"; reasons: string[] };
  createdAt: number;
  expiresAt: number;                // drafts expire (default 5 min) to avoid stale approvals
  title: string;                    // human one-liner for the approval card
}
```

`title` example:
`BUY 320 AAPL stop 172.10 · T1 176.15 (50%) · T2 179.30 · risk $1,000 (1R) · orb-1m`

Normalized broker DTOs (`PositionDto`, `OrderDto`, `ExecutionDto`) mirror `SchwabReadApi`'s
account projection: `{symbol, netQuantity, averagePrice, marketValue, unrealizedPnL}`,
`{orderId, role: ENTRY|STOP|LIMIT, orderType, quantity, isBuy, price?, stopPrice?, status,
parentOrderId?}`, `{orderId, price, quantity, isBuy, positionEffectIsOpen, timeMs}`.

---

## 7. Storage layout

### 7.1 Workspace (`%USERPROFILE%\Cairo\`)

```
Cairo/
  AGENTS.md                  # trading operating manual for the agent (adapted from Backtest)
  opencode.jsonc             # provider + agents + permissions + plugin entry
  cairo.config.yaml          # engine config: mode, risk, feeds, credentials, hotkeys
  recent-symbols.yaml        # last-used symbols (MVP: one active symbol at a time)
  secrets.json               # optional credential fallback; bmtrader's file is read first
  tradebooks/
    orb-1m.yaml
    bookmap-offer-wall-breakout.yaml
  plans/YYYY-MM-DD/
    {symbol}.md
    {symbol}.json
  journal/YYYY-MM-DD/
    {symbol}-{tradeId}.json
    {symbol}-{tradeId}.md
  research/YYYY-MM-DD-{topic}/
  .opencode/
    agents/*.md
    skills/<id>/SKILL.md (+ references/)
    commands/*.md
    plugins/cairo/          # or a packaged plugin referenced from opencode.jsonc
  .state/
    cairo.db
    runtime.json            # {port, token, pid, opencodePort}
    audit/YYYY-MM-DD.jsonl
    signals/YYYY-MM-DD.jsonl
    logs/
```

### 7.2 `cairo.config.yaml` (seed)

```yaml
mode: observer            # observer | assistant | auto
risk:
  rDollars: 1000
  dailyMaxLoss: 4000
  defaultRiskMultiplier: 1
  maxShares: 2000
feeds:
  massive:
    liveTrades: true      # false → REST polling only
    pollSeconds: 5
  bookmap:
    signalsFile: "%USERPROFILE%/Bookmap/bookmap-signals/pattern-signals.jsonl"
    wsUrl: "ws://localhost:8765"
    consumeWs: true       # fast path; file tail is the fallback/backfill
credentials:
  file: "%USERPROFILE%/bmtrader/secrets.json"       # read-only, maintained by bmtrader
  fallbackFile: "%USERPROFILE%/Cairo/secrets.json"  # optional
session:
  flatBy: "15:55"
  sound: true
```

### 7.3 SQLite tables (better-sqlite3, WAL)

| Table | Key columns |
| --- | --- |
| `signals` | `id PK, episode_key UNIQUE, source, symbol, side, pattern, status, price, strength, ts, tradebook_id, evidence_json` |
| `order_drafts` | `id PK, intent_json, symbol, qty, stop, targets_json, sizing_json, riskcheck_json, status(draft/approved/rejected/submitted/expired), created_at, expires_at` |
| `orders` | `id PK, broker_order_id, draft_id, symbol, role, type, side, qty, price, stop_price, status, parent_id, raw_json, updated_at` |
| `executions` | `id PK, broker_exec_id UNIQUE, order_id, symbol, price, qty, is_open, ts` |
| `trades` | `id PK, record_json, status, opened_at, closed_at` |
| `rule_evals` | `id PK, trade_id, rule_id, verdict, proposed_json, executed, ts` |
| `kv` | `key PK, value_json` (mode, kill switch, feed status, day PnL) |
| `journal_index` | `trade_id PK, json_path, md_path, created_at` |

### 7.4 JSONL contracts

**Audit line** (`audit/YYYY-MM-DD.jsonl`):

```json
{"ts":1760000000000,"mode":"assistant","actor":"agent|human|engine","sessionId":"ses_...","action":"cairo_order_submit","resource":"draft_01H...","permission":"ask","permissionReply":"once","result":"submitted","orderId":"1001","detail":"AAPL BUY 320 stop 172.10"}
```

**Signal archive** (`signals/YYYY-MM-DD.jsonl`): one `Signal` JSON per line (append on detect/update).

**Bookmap export consumed** (`%USERPROFILE%\Bookmap\bookmap-signals\pattern-signals.jsonl`): engine
tracks its byte offset in `kv` (`bookmap.signalOffset`) and handles truncation/rotation by resetting
when the file shrinks.
