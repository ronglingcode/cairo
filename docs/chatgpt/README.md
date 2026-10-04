# Cairo planning package

October 4, 2026. Research and planning only; no application code or live integration has been implemented. All deliverables from this task are in this folder.

## Recommendation

Build Cairo in TypeScript with SolidJS and Electron, matching the current OpenCode desktop's main stack. Use a headless local Node runtime for Massive data, Bookmap observations, Schwab state/orders, deterministic trading rules, and a separate bounded OpenAI copilot loop.

Trader and Cairo collaborate on reusable versioned tradebooks. Daily plans bind symbols, levels, risk, tiers, and execution policy. Model interpretation and executable rules stay traceable to the same tradebook, with automation coverage shown per clause.

Support three modes:

1. **Observer:** monitor and recommend.
2. **Assistant:** submit a concrete order after human approval.
3. **Automated:** initially keep entries approved and automate only the specifically armed exit/management rules.

The personal workflow uses Bookmap's existing wall-pattern detector and a scalp/core/runner management preset. Tiers are configurable; the 1-minute opening-range breakout is a separate candle-based reference using one tier. Keep Bookmap's heatmap as an external observation surface for the MVP; show its pattern/wall evidence inside Cairo instead of attempting a complete heatmap rebuild.

## Reading order

| File | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, process/package boundaries, tradebook harness, data/broker/Bookmap design, interface |
| [MVP-SPEC.md](MVP-SPEC.md) | Journeys, typed contracts, two reference tradebooks, execution states, tools, acceptance cases |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | M0-M9 work packages, staged releases, later premarket/journal/backtesting work |
| [RESEARCH.md](RESEARCH.md) | Pinned OpenCode sources, local reuse map, official docs, evidence and uncertainties |
| [HANDOFF.md](HANDOFF.md) | A scoped starting prompt for the implementation model |
| [PLAN-COMPARISON.md](PLAN-COMPARISON.md) | Common ground, design differences, corrections, and recommendations after reviewing the other AI's plan |
| [HARNESS-AND-STORAGE.md](HARNESS-AND-STORAGE.md) | Why SQLite, the bounded copilot loop, a worked Bookmap example, and runner alternatives |

## Key research findings

The inspected OpenCode commit is `907b3bc518fa48e90e8ec24dd327d13eee71c36c`. Its current desktop is Electron, not the older Tauri implementation. Its main lesson for Cairo is headless runtime ownership plus typed UI/tool/event interfaces.

ViteApp has useful browser-independent Massive and Schwab modules. Backtest holds the active tradebooks and management rules. The sibling Bookmap plugin already detects eight wall patterns and serializes signals, but currently updates in-memory badges. It needs a JSONL exporter and live Cairo observation stream. This corrects the earlier claim that its JSONL writer was already implemented.

The main harness decision is to keep continuous deterministic evaluation and execution policy independent of LLM latency. AI coauthors tradebooks, asks about ambiguity, explains evidence, proposes actions, and reviews results. It does not infer every tick or issue discretionary broker writes from chat text.

## First delivery checkpoints

Observer is the first usable release: charts + Schwab positions + Bookmap evidence + collaborative tradebook + alerts + timeline/replay. Assistant and armed automated management follow through the same validated order-intent service. Deeper premarket research and historical backtesting follow the live workflow.

Open implementation questions are narrow: Bookmap's installed live/replay metadata and observation/config path, actual Massive entitlements, and verified Schwab order schemas. Exact strategy/tier parameters belong to tradebook/plan authoring, not hardcoded application assumptions.

No API keys were inspected, no paid inference or broker calls were made, and no repositories were pushed.

Document verification: local file links and code-fence balance are checked for the planning package. Application tests were not run because this task produced planning documents only.
