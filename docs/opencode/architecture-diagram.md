# Cairo — Architecture Diagram

Visual map of the MVP as decided in `00-decisions.md` and specified in `01-architecture.md`.
All diagrams are [Mermaid](https://mermaid.js.org/): they render on GitHub, in VS Code (Mermaid
preview), and at <https://mermaid.live> when pasted.

**Decided constraints reflected here:** one active symbol at a time · one preconfigured LLM model ·
Cairo consumes the Schwab token maintained by bmtrader (never refreshes it) · Bookmap pattern
signals exported over WS push + JSONL append.

---

## 1. System context

```mermaid
flowchart TB
  subgraph EXT["External services"]
    SG["Massive API<br/>REST + WSS"]
    SB["Schwab API"]
    LLM["OpenAI API"]
  end

  subgraph BM["Bookmap (Java addon)"]
    BME["bmtrader plugin<br/>pattern engine + trading"]
    BMS["SignalWebSocketServer :8765"]
    BMF["pattern-signals.jsonl<br/>%USERPROFILE%/Bookmap/..."]
  end

  subgraph WS["Cairo workspace — %USERPROFILE%/Cairo"]
    TB["tradebooks/*.yaml"]
    PL["plans/YYYY-MM-DD/"]
    JN["journal/YYYY-MM-DD/"]
    AG["AGENTS.md + .opencode/<br/>agents · skills · commands · plugin"]
    ST[".state/<br/>cairo.db · runtime.json · audit/ · signals/"]
  end

  subgraph APP["Cairo Desktop (Electron, Windows)"]
    subgraph REN["Renderer (React + TS)"]
      CH["Chart<br/>lightweight-charts"]
      SR["Signals rail"]
      CP["Copilot chat"]
      APV["Approvals inbox"]
      PO["Positions and orders"]
      TBP["Tradebook and plan panels"]
    end
    subgraph MAIN["Electron main (Node)"]
      LIFE["window + sidecar lifecycle"]
    end
    subgraph ENG["Cairo Engine (127.0.0.1)"]
      MKT["market<br/>Massive REST/WS to candles,<br/>VWAP, premarket levels, context"]
      SIG["signals<br/>Bookmap source + candle detectors"]
      RISK["risk + guardrails"]
      ORD["orders<br/>stage, submit, modify, cancel, flatten"]
      RUL["rules<br/>breakeven, partials, invalidation, flat-by"]
      TRD["trades + journal"]
      API["HTTP + WS API"]
    end
    subgraph OC["OpenCode sidecar (opencode-cli.exe)"]
      SESS["sessions + streaming"]
      TOOLS["cairo_* tools"]
      PERM["permissions: allow / ask / deny"]
      SKL["agents + skills + commands"]
    end
  end

  PS["ProxyServer :3000<br/>/schwabApi pass-through"]
  CRED["%USERPROFILE%/bmtrader/secrets.json<br/>read-only: Massive key + Schwab token"]

  REN <-- "HTTP + WS" --> API
  CP <-- "@opencode/client" --> SESS
  TOOLS <-- "HTTP (local token)" --> API
  MAIN --> ENG
  MAIN --> OC
  MKT <--> SG
  ORD --> PS
  PS <--> SB
  CRED -. "read fresh, never refresh" .-> MKT
  CRED -. "read fresh, never refresh" .-> ORD
  BME --> BMS
  BME --> BMF
  BMS -. "WS push (fast path)" .-> SIG
  BMF -. "JSONL tail (fallback + backfill)" .-> SIG
  API --> SR
  API --> CH
  API --> PO
  API --> TBP
  RUL --> ORD
  TRD --> JN
  AG --> OC
  TB --> ENG
  PL <--> ENG
  ENG --> ST
  SESS <--> LLM
```

---

## 2. Signal ingestion and detection

```mermaid
flowchart LR
  BM["Bookmap pattern engine"] -- "WS broadcast :8765" --> SRC
  BM -- "append JSONL" --> FILE["pattern-signals.jsonl"]
  FILE -- "tail from byte offset" --> SRC["BookmapSignalSource<br/>dedupe by id + episodeKey"]

  MASS["Massive trades WSS"] --> MS["MarketState<br/>1m candles · VWAP · HOD/LOD · PM levels"]
  MS --> DET["Candle detectors<br/>ORB · premarket break · VWAP cross"]

  SRC --> EVAL["Tradebook evaluation<br/>direction · context gates · session window"]
  DET --> EVAL
  EVAL --> REG["Signal registry<br/>detected → armed → triggered → invalidated / expired"]

  REG --> UI["Signals rail + chart markers + sound"]
  REG --> AGENT["live-copilot<br/>(synthetic message)"]
  REG --> STAGE["order staging<br/>(assistant / auto modes)"]
```

---

## 3. Assistant order flow (human approval)

```mermaid
sequenceDiagram
  participant T as Trader
  participant UI as Cairo UI
  participant OC as OpenCode server
  participant P as Cairo plugin
  participant E as Cairo Engine
  participant PS as ProxyServer
  participant S as Schwab

  E-->>P: signal.detected (engine WS)
  P-->>OC: synthetic message
  OC->>P: tool call cairo_order_stage(signalId)
  P->>E: POST /orders/stage
  E->>E: size + guardrails (mode, R, buying power, session)
  E-->>P: draft (id, preview, risk, expiry)
  OC->>P: tool call cairo_order_submit(draftId)
  P->>E: POST /risk/validate (permission hook)
  E-->>P: verdict ok / warn / block
  OC-->>UI: permission request (ask) + reason
  UI->>E: GET draft preview
  UI-->>T: approval card: side, qty, entry, stop, targets, R
  T->>UI: Approve once
  UI->>OC: permission.reply "once"
  OC->>P: run tool execute
  P->>E: POST /orders/submit (idempotency key)
  E->>PS: POST /schwabApi/accounts/:hash/orders
  PS->>S: bracket order (TRIGGER -> OCO STOP + LIMIT)
  S-->>PS: Location -> orderId
  PS-->>E: { orderId }
  E-->>UI: order.submitted + position.updated
  OC-->>T: chat: entry working, stop and targets
```

---

## 4. Mode enforcement (defense in depth)

```mermaid
flowchart TD
  A["Agent calls<br/>cairo_order_submit / modify / flatten"] --> R1{"1. OpenCode permission rules<br/>observer: deny · assistant: ask · auto: allow*"}
  R1 -- deny --> D["Refused with reason<br/>+ audit line"]
  R1 -- ask --> AP{"UI approval<br/>(Approvals inbox)"}
  AP -- reject --> D
  AP -- approve --> R2
  R1 -- allow --> R2{"2. permission hook<br/>engine /risk/validate"}
  R2 -- block --> D
  R2 -- ok / warn --> R3{"3. Engine re-checks<br/>mode · token freshness · limits · kill switch"}
  R3 -- refuse --> D
  R3 -- accept --> X["Broker via ProxyServer<br/>+ SQLite + audit JSONL"]
```

\* auto mode `allow` applies only to pre-validated management/exits; **entries always ask**.

---

## 5. Trade lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending : bracket orders submitted
  pending --> open : entry filled
  pending --> canceled : canceled / never triggered
  open --> open : partial exit or stop move
  open --> closed : stop / target / flatten / flat_by / invalidation
  closed --> journaled : journal JSON written
  journaled --> [*]
```

Reconciliation: on startup and periodically, the engine reads Schwab orders/fills for the day and
rebuilds `pending/open` trades — it never trusts in-memory state across restarts.

---

## 6. MVP build order (what exists when)

```mermaid
flowchart LR
  T0["T0 · bookmap-plugin export<br/>WS + JSONL"] --> M0["M0 · scaffold, engine, plugin,<br/>Electron shell, chat with one tool"]
  M0 --> M1["M1 · Massive data, chart,<br/>tradebooks, premarket planner"]
  M1 --> M2["M2 · live signals, observer mode,<br/>read-only Schwab account"]
  M2 --> M3["M3 · assistant orders, approvals,<br/>lifecycle, rule recommendations, auto-journal"]
  M3 -. stretch .-> M4["M4 · auto exits + kill switch"]
  M4 -. post-MVP .-> M5["M5 · journaling quality, research,<br/>bookmap level push, mac packaging"]
```
