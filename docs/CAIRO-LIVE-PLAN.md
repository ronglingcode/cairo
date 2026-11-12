# Cairo Live project plan

- **Product name** Cairo Live
- **Repository** `cairo`, with a standalone app under `live/`
- **First release** An advisory-only desktop assistant for macOS and Windows that reads the day's confirmed plan, follows Bookmap's live data, and can start a voice conversation after a fill.

## How a trading day works

1. **Research.** The existing 5:15 a.m. Pacific weekday automation runs in a fresh Codex chat. It follows the existing market-closure check and saves cutoff-stamped research and draft plans under `Backtest/temp/premarket-research/`. The run's final reply links to those drafts and gives the candidate shortlist and key decisions to discuss.
2. **Discuss in the same chat.** Open that morning's run, give feedback on selection and location, and revise the plans using Backtest's `trade-plan` skill. Use `tradebooks/master_tradebooks.md` as the strategy root. The research and any plan drafts remain available as evidence for the discussion.
3. **Confirm the plan before the regular-session open.** When you say “Finalize today's plan” after the discussion, Codex follows the trade-plan skill's finalization instructions and saves `Backtest/data/processed/YYYY/MM/DD/cairo-trading-plan.md`. Cairo reads this file for the session. An intentionally empty watchlist is a valid plan. A later correction goes through the same review and save workflow.
4. **Trade with Cairo Live.** Cairo loads today's file, shows its revision and monitored symbols, and follows events from Bookmap. Start voice once to talk hands-free. Cairo can alert you during silence. The panel shows the next relevant condition, a pending question, or a feed problem affecting a held position.
5. **Manage an open position.** A reconciled opening fill prompts one question about your pattern and intended stop. Cairo uses your answer, the fill, the broker's working orders, and the plan to suggest what to watch. Cairo alerts on active conditions and asks before adopting a material new advisory recommendation. You operate the trading controls in Bookmap.

## Daily Markdown contract

Use one canonical file per U.S. market session in the date folder directly under `Backtest/data/processed/YYYY/MM/DD/`. Resolve Backtest from Cairo's workspace setting and use the exchange's New York session date. Show the evidence cutoff with an explicit offset. The body holds the human-readable plan, research links, rationale, and discretionary notes. A single fenced `cairo-plan` block contains JSON for conditions Cairo can monitor. The implementation will share a deterministic validator between the interactive save and Cairo import.

| Field | Purpose |
| --- | --- |
| `schemaVersion`, `sessionDate`, `revision`, `confirmedAt` | Identify the format and the exact confirmed revision. Record the local save's content hash in Cairo. |
| `mode`, `replayRunId` | Identify live or replay. A replay plan carries its run ID so Cairo can match it to the selected replay. |
| `researchCutoff`, `researchPath`, `tradebookRevision` | Identify the source snapshot and tradebook rules used to prepare the plan. |
| `watchlist` | List the selected symbols and the supported long and short setups, each with its tradebook reference, named Bookmap confirmations, and supported decision levels or zones. `[]` is a confirmed no-trade plan. |
| `conditions` on each setup | Identify rules with stable IDs, an explicit predicate, price basis and level when applicable, and a short alert label. Keep qualitative conditions such as an undefined “hold” in the prose until their meaning is defined. |

Render the live summary from the structured fields and validate them against the supported setup and pattern names. Include the current location rule only where defined by the active plan. A valid file can still contain a discretionary setup or an unresolved stop. Cairo displays those items without scheduling a condition it cannot evaluate. Use relative Markdown links inside Backtest.

The finalizer writes a temporary file in the same directory and replaces the canonical file after validation. It checks the expected revision before replacing an existing plan. Cairo loads valid same-session revisions as complete units and shows the active revision. A malformed revision leaves the last valid same-session plan in memory with a visible error. A missing plan at startup or the start of a new market session disables plan-based alerts. Account awareness and the fill prompt still work with the broker feed available, including for a symbol outside the watchlist. Open positions keep the management plan they were using until you confirm a change.

## Architecture and ownership

```text
Scheduled Codex chat → research drafts → same chat + user confirmation
                                               ↓
                    Backtest/data/processed/YYYY/MM/DD/cairo-trading-plan.md
                                               ↓
Schwab ───┐                         Cairo Live session and alert engine
          ├─ Bookmap plugin ──────────→ ↑           ↓             ↓
Massive ──┘        local read-only feed   voice tools      attention panel
                                              ↕
                                    OpenAI GPT-Live / Responses
```

| Component | Owns |
| --- | --- |
| **Backtest** | The research and planning skills, canonical strategy files, research drafts, and the confirmed Markdown plan. |
| **Bookmap plugin** | Schwab authentication and refresh, the single Schwab stream and broker reads, the single live Massive stream, order entry and management, Bookmap detectors, and a read-only local feed to Cairo. |
| **Cairo Live** | Plan import, a local projection of positions and market facts, alert evaluation, voice sessions, advisory management revisions, and the attention panel. |

### Bookmap data feed

Use Bookmap's loopback WebSocket and keep detector version 2. Add a versioned, allowlisted export of reconciled account and market state from the native runtime. `cairo_account_activity` currently signals that a refresh is needed. The plugin should publish the outcome of its own reconciliation, with positions, stable execution IDs, side, size, average fill, and working protective orders. Export the intended entry stop when the plugin can correlate the selection to the actual entry. Keep it distinct from any broker-confirmed working stop. For market data, export the freshest supported last price or quote, relevant levels, and source health for the symbols Bookmap covers. At startup, compare the confirmed watchlist with Bookmap's chart and stream coverage and show any symbol that needs to be loaded through the existing Bookmap setup.

Include a source ID, epoch, sequence, market timestamp, and data freshness per feed. On startup and reconnect, seed Cairo from a snapshot and mark previously observed fills and patterns as historical. Emit a prompt for a new reconciled position lifecycle, coalescing partial fills from the same entry. A position already open at startup gets a visible context card. A flat-to-open transition or confirmed reversal starts a new lifecycle. Deduplicate revisions and require current broker facts before making claims about fills or stops. For level-crossing alerts, identify the exact price source and whether updates can be coalesced. A gap in samples makes the crossing unknown until supported by evidence.

Cairo Live gets live account facts and prices from the Bookmap feed. Bookmap owns credentials, refresh, order execution, and both upstream streams. Audit the desktop launch paths and other live-capable clients before rollout to verify that ownership. Scheduled premarket research can continue using the existing historical or REST data workflow within its own scope.

### Cairo stack and voice

Build a new TypeScript, Electron, React, and Vite app under `cairo/live/`, with its own package manifest, lockfile, entry points, build, tests, and application data directory. The app must build and run with only that directory and its external dependencies, including when the old Cairo app is removed. Use the standalone voice prototype as a behavior reference. Keep the Bookmap subscriber, plan loader, and alert engine in the Node process. Keep audio capture and playback in the Electron renderer with a visible listening state and an end-voice control. Add macOS packaging and microphone permissions, and use platform adapters for local speech and startup.

Store Cairo's session state in simple local text files under its application data folder. For each market session, save the active plan revision, position notes, and alert deduplication state in a readable `state.json`. Replace it atomically when it changes. Append alert history one entry per line to `alerts.jsonl`. On restart, reload the day's notes and reconcile current fills, positions, and working orders from Bookmap before issuing new alerts. The confirmed Markdown plan stays in Backtest.

Implement the prototype's GPT-Live WebRTC flow in the new renderer. The Node process creates the session and uses the GPT-Live sideband to deliver application-initiated prompts and receive conversation events. Use the Responses API for requests that need trading interpretation, supplying the relevant approved plan, position, tradebook excerpt, and fresh observations. Validate proposed rule fields and recheck position ID, plan revision, and data freshness before showing or speaking a result. Keep OpenAI credentials in the Node process and Schwab credentials inside Bookmap.

Cairo's local rules decide when to notify. Play exact fill, level, and data-health notices with application-controlled speech, then let GPT-Live handle the conversation. Feed the notice into the voice session's context so “yes,” “why?” and “keep that” refer to the right event. Use one playback queue so system and model speech do not overlap. Coalesce repeat observations and let active-position issues take precedence over watchlist patterns. If voice drops, the panel and local notices remain available while their source feeds are current. Start with the same hands-free interaction as the prototype and make the microphone state visible throughout.

## Bookmap replay

Replay runs the same Cairo Live plan, alert, and voice workflows on a Bookmap recording, with simulated fills and an isolated run history.

1. **Prepare the replay plan at the open.** Give `trade-plan` a ticker and historical session date in replay mode. Use Backtest's `--no-after-open` fetch for that date. Daily charts contain only completed prior sessions. The one-minute chart includes all available premarket bars through the 6:29 a.m. Pacific bar, which completes at 6:30. Exclude the 6:30 bar and all later market data, news published after the cutoff, and known trade outcomes. Record the cutoff with its time zone and check that prices use the recording's price scale. Store the confirmed replay plan under `Backtest/data/processed/YYYY/MM/DD/bookmap_replay/<run-id>/cairo-trading-plan.md`. Cairo loads it only for the matching replay session and selected run.
2. **Detect replay at Bookmap startup.** The plugin reads the Layer 1 `RunModeHelper` flags and uses `isLive()` for data mode and `isRealTrading()` for execution mode. The existing `sourceMode: "replay"` setting is a fallback for hosts without mode information. An unknown mode leaves native execution unavailable. Replay startup skips the live broker and market connections.
3. **Simulate the fill in Bookmap.** In Replay, expose a **Buy** control with a visible replay label. A click fills locally at the latest replayed trade price at or before Bookmap's cursor and records the chosen size, symbol, market timestamp, and simulated execution ID. Disable the control until a price from the current replay is available. Update the simulated position and publish it with the fill on the same local feed contract as live, explicitly marked `replay`. The replay order handler has no broker access. Cairo uses the simulated opening fill to ask for the pattern and intended stop and run the normal advisory workflow.
4. **Tune with repeatable runs.** Use Bookmap's market clock for setup and management conditions. Pausing freezes market-time rules. Rewinding or opening another recording resets simulated positions and starts a new event epoch. Discard pending advice from an old epoch. Keep replay state and alert logs in a separate local text directory per run. Log the fill, observed evidence, plan revision, alert decision, and user feedback so runs can be compared without feeding later observations into earlier decisions.

## Implementation and acceptance

| Order | Deliverable | Acceptance check |
| --- | --- | --- |
| 1. Standalone app and plan handoff | Set up `cairo/live/` and implement the Markdown validator and loader for confirmed live and replay files. | Build and run with the legacy Cairo app absent. Confirm a plan from the scheduled chat and load it. Check an empty watchlist, wrong session date, malformed edit, and valid same-day revision. A replay plan activates only in its matching replay run. |
| 2. Bookmap data and replay fills | Read pattern v2 in Cairo, publish reconciled live facts in Bookmap, and add replay mode detection, the simulated Buy control, and replay fill events. | Verify Bookmap mode flags, fill price and timestamp, deduplication, pause, rewind, and reconnect. Verify zero broker or live market connections in replay and exactly one stream per upstream service in live. |
| 3. Fill-to-alert voice | Implement voice and the attention panel with the standalone prototype as reference. Support a voice answer to the fill prompt and one monitored condition. | While replay runs and the mic is silent, click Buy and hear one opening prompt. Confirm the pattern and stop by voice, see the accepted condition on screen, and hear its alert when the replay crosses it. A disconnect or late AI response cannot report a stale position as current. |
| 4. Shadow and rollout | Record candidate alerts silently during several opens, then enable spoken alerts for verified fill prompts, agreed conditions, and held-position feed loss. | Review missed and noisy alerts with the user. Measure broker update to reconciled event, reconciled event to panel or speech, and voice response time separately. Review conflicting symbols, position reversals, feed gaps, and reopen after disconnect before adding broader pattern commentary. |

The first end-to-end milestone is one trade on a Bookmap recording, using a confirmed plan prepared at the historical open, a simulated fill initiated in Bookmap, and a full Cairo Live voice exchange and management alert.

## Source references

- [Existing scheduled research skill](../../../.codex/skills/premarket-research/SKILL.md) and [Backtest trade-plan skill](../../Backtest/skills/trade-plan/SKILL.md)
- [Backtest master tradebooks](../../Backtest/tradebooks/master_tradebooks.md)
- [Bookmap pattern version 2 contract](../../bookmap-plugin/docs/cairo-evidence.md) and [native runtime](../../bookmap-plugin/src/main/java/com/bookmap/plugin/rong/miniviteapp/runtime/TradingRuntime.java)
- [Backtest cutoff-aware market data fetcher](../../Backtest/scripts/fetchMassiveMarketData.mjs)
- [Working voice prototype](../../trading-voice-prototype/server.mts)
