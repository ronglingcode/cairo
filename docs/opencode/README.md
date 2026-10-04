# cairo — plan (OpenCode session)

**copilot · ai · route** — an AI-native desktop trading platform for personal U.S. equity
intraday trading.

Status: **planning**. There is no implementation yet. This folder is the build plan produced in an
OpenCode session, written so that lower-capability AI coding agents can implement the MVP task by
task. Other agents may contribute sibling folders under `docs/`; this folder owns only its own
files.

Cairo is a Windows desktop app (Electron + TypeScript, the same stack as the OpenCode desktop
app) in which a trader and AI agents work on the same **tradebook**: the written definition of
a setup. Cairo watches the market against that tradebook, detects signals, helps manage live
trades, journals them afterwards, and supports strategy research.

Cairo is *not* a fork of OpenCode. It reuses OpenCode V2 as the **agent harness** (sessions,
streaming, tools, permissions, skills, providers) through its plugin/SDK surface, and builds a
trading-specific engine, tool catalog, data model, and UI on top.

---

## MVP scope (what we are building first)

Focus areas, in priority order — matching how the trader actually works:

1. **Live trade signal detection** (given the day's trading plan / tradebook)
2. **Live trade management** (once in a trade)
3. Premarket preparation / trade planning
4. Journaling (lightweight, automatic on trade close)
5. Strategy research / backtesting (post-MVP)

MVP = observer + assistant modes. Autopilot exits come immediately after.

**Decided MVP constraints (user):**

- One **active symbol** at a time; the trader types the symbol (no watchlist UI yet).
- One **preconfigured LLM model** shared by all agents (per-trader model choice is post-MVP).
- Cairo **never maintains a Schwab token**: it consumes the token bmtrader keeps valid and blocks
  broker calls when it is stale.
- The **bookmap-plugin exports pattern signals** (WS push + JSONL append); Cairo consumes push
  first with the file as backfill.

| Mode | Behavior | Order capability |
| --- | --- | --- |
| **observer** | Monitor + recommendations + alerts | none (read-only broker access) |
| **assistant** | Agent proposes, human approves in the UI | submit/modify/cancel after approval |
| **auto** | Entries stay assisted; management/exits run from pre-approved rules | engine executes rules; entries still `ask` |

### Explicit non-goals (MVP)

- No order-book heatmap rendering inside Cairo — Bookmap remains the heatmap, Cairo consumes its
  signals.
- No mobile, no cloud, no multi-user, no auth beyond a local token.
- No crypto, no futures, no options.
- No scalability or hardening work beyond what personal use requires.
- Cairo does not write to Firestore or to the `Backtest/` source data in the MVP.

---

## Architecture at a glance

```
┌──────────────────────── Cairo Desktop (Electron, Windows) ─────────────────────────┐
│  renderer (React + TS)                    Electron main (TS)                        │
│  ┌───────────────┐ ┌──────────────────┐   ┌───────────────┐  ┌───────────────────┐  │
│  │ charts        │ │ copilot chat     │   │ Cairo Engine  │  │ opencode sidecar  │  │
│  │ (lightweight- │ │ (@opencode/client│   │ (Node, HTTP + │  │ (bundled          │  │
│  │  charts)      │ │  sessions/SSE)   │   │  WS, SQLite)  │  │  opencode-cli.exe)│  │
│  ├───────────────┤ ├──────────────────┤   │ market data   │  │ sessions, tools,  │  │
│  │ signals rail  │ │ approvals inbox  │   │ signals, risk │  │ permissions, LLM  │  │
│  │ positions/    │ │ mode switch      │   │ orders, rules │  │ runtime           │  │
│  │ orders        │ │ tradebook editor │   │ journal, audit│  └─────────┬─────────┘  │
│  └───────┬───────┘ └────────┬─────────┘   └───────┬───────┘            │            │
└──────────┼──────────────────┼─────────────────────┼────────────────────┼────────────┘
           │ HTTP/WS          │ HTTP/SSE            │ HTTP/WS            │ plugin tools
           ▼                  ▼                     ▼                    ▼  (HTTP)
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │  Cairo workspace  %USERPROFILE%\Cairo                                            │
   │  tradebooks/*.yaml · plans/YYYY-MM-DD/ · journal/ · research/ · .opencode/       │
   │  (also the OpenCode "location": AGENTS.md, agents, skills, commands, cairo plugin)│
   └─────────────────────────────────────────────────────────────────────────────────┘
           ▲                                        ▲                    ▲
           │                                        │                    │
    Massive REST + WS                     Bookmap plugin (bmtrader)   ProxyServer :3000
    (market data)                         signal export JSONL / WS     Schwab pass-through
                                          Schwab tokens               (Schwab API)
```

---

## Planned repository layout

```
cairo/
  apps/desktop/            Electron app: main + preload + React renderer
  packages/protocol/       shared zod schemas/types: tradebook, signal, plan, order draft, events
  packages/engine/         Cairo trading engine: market data, signals, tradebooks, risk, orders,
                           trade lifecycle, journal, storage, local HTTP/WS API
  packages/trading-core/   logic vendored from ViteApp: Massive client, market state, Schwab
                           order payloads, risk sizing, market clock
  packages/cairo-plugin/   OpenCode plugin: cairo_* tools, agents, skills, commands, hooks
  workspace-template/      seed for %USERPROFILE%\Cairo (AGENTS.md, tradebooks, .opencode/)
  scripts/                 dev/verification helpers
  docs/opencode/           this plan (OpenCode session output)
```

---

## Documentation index

| Doc | Contents |
| --- | --- |
| [`architecture-diagram.md`](architecture-diagram.md) | Visual map: system context, signal flow, assistant order sequence, mode enforcement, trade lifecycle, build order. |
| [`ui-mockup/index.html`](ui-mockup/index.html) | Static, interactive mockup + screenshots of the three MVP screens (premarket · observer · assistant approval). |
| [`00-decisions.md`](00-decisions.md) | Architecture decision records (what & why). Do not relitigate these without the user. |
| [`01-architecture.md`](01-architecture.md) | Components, process model, interfaces, event flows, OpenCode mapping. |
| [`02-data-models.md`](02-data-models.md) | Tradebook YAML, signal model, plans, trade lifecycle, journal, storage layout. |
| [`03-agent-harness.md`](03-agent-harness.md) | The trading harness: agents, cairo tools, permission rules per mode, skills, prompts, guardrails. |
| [`04-integrations.md`](04-integrations.md) | Massive, Bookmap plugin, Schwab/ProxyServer, OpenAI via OpenCode, dev replay. |
| [`05-implementation-plan.md`](05-implementation-plan.md) | Milestones M0–M5, detailed tasks with acceptance criteria, risks, open questions. |

**For implementing agents:** read `00-decisions.md` and `01-architecture.md` first, then your
milestone in `05-implementation-plan.md`. Every task lists the files it touches and how it is
verified.

---

## Key decisions (summary)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Electron + TypeScript for the desktop app | Same stack as the OpenCode desktop app (`OpenCode.exe` + `app.asar` + bundled `resources/opencode-cli.exe`). |
| 2 | Reuse OpenCode V2 as the agent harness (bundled CLI sidecar + Cairo plugin) | Sessions, streaming, tools, permissions, skills, compaction and providers are already built and extensible; trading value is in the engine, tools, schema and UI, not the agent loop. |
| 3 | A separate local **Cairo Engine** owns all trading state and actions | Deterministic, testable, works when the LLM is slow or offline; the agent only proposes/explains. |
| 4 | Tradebook = human-readable YAML (structured rules + prose) | It is the shared artifact between trader and AI: the engine parses it, the agent reads/edits it. |
| 5 | Charting via TradingView `lightweight-charts` + custom overlays | Same library family ViteApp already uses; covers candles, VWAP, levels, markers. Bookmap stays the heatmap. |
| 6 | Schwab orders through the existing ProxyServer (:3000), consuming the token bmtrader maintains | No OAuth or token-rotation work in Cairo; assistant mode only in MVP. |
| 7 | Modes implemented as OpenCode permission rules + engine guardrails | `observer` = deny, `assistant` = ask, `auto` = allow for pre-validated management actions; entries always `ask`. |
| 8 | Bookmap signals enter Cairo via plugin WS push + JSONL append (T0) | Fast path for latency, file for durability/backfill; the plugin already serializes `bookmap_pattern_signal` JSON; the change is additive. |
| 9 | One active symbol at a time in the MVP UI | Matches the trader's actual workflow (one stock, full attention); keeps charts, prompts and alerts focused. |
| 10 | OpenCode runtime is pinned; updates are manual but available in-app | In-app check, staged download, compatibility smoke, one-click rollback; nothing updates silently (ADR-015). |

## Related repositories (read-only reference)

- `ViteApp/` — live-reference implementation of Massive feeds, Schwab orders, charts, risk sizing.
  Its `src/trading/**` is the headless, port-injectable core we vendor.
- `bookmap-plugin/` — Java addon that owns the Bookmap heatmap and already computes pattern signals.
- `Backtest/` — tradebook prose, Bookmap pattern catalog + scoring spec, trade plan/review skills,
  journal conventions, strategy-optimization pipeline. Cairo adapts these into the workspace.
- `ProxyServer/` — localhost broker proxy and market-data replay server used for dev and orders.

## Building with OpenCode (reference docs)

- Extend: <https://opencode.ai/v2/docs/build/plugins>
- Client: <https://opencode.ai/v2/docs/build/client>
- SDK: <https://opencode.ai/v2/docs/build/sdk>
- Agents / permissions / skills: <https://opencode.ai/v2/docs/agents>, `/permissions`, `/skills`
