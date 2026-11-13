# Cairo Live

Standalone advisory app in the Cairo repository. Run the commands below from this `live/` directory with Node.js 24 and npm.

```text
npm ci
npm run build
npm start
```

Run `npm run package` for an unpacked desktop release for the current platform. The macOS bundle includes the microphone usage description. From a packaged app, choose the Backtest checkout under **Session and settings** on first launch. In development the app finds the sibling Backtest checkout automatically. Start voice when ready and allow microphone access. Provide `OPENAI_API_KEY` in the process environment or the existing OpenAI entry in the workspace's `secrets/storeSecrets.js`.

Use **Ask Cairo** for typed questions, or **Start voice** to ask aloud in the same conversation. Try “Which Bookmap patterns do I use on the buy side?”, “What are the largest bids and offers on NVDA?”, or “Did that large bid reappear, and is it still there?” OpenCode can read the plan, Backtest tradebooks, and Cairo's Bookmap snapshots through a dedicated tool plugin. The packaged app bundles OpenCode 2.0.22. Its conversation database is in memory; plans, notes, and agent answers remain in local Markdown, JSON, and JSONL. OpenCode resets conversation context on session changes and replay rewinds.

Bookmap owns the live Schwab and Massive connections. Load the rebuilt `bookmap-plugin` JAR. Cairo subscribes to the Bookmap loopback feed on port 8765. The live panel starts in shadow mode, which records alerts in the local log. Turn it off to hear notices. App state is saved per session under the OS application data directory for Cairo Live in `state.json` and `alerts.jsonl`.

The current depth tool uses the rebuilt Bookmap add-on's read-only snapshot on that same socket. Earlier detector events are available through Bookmap's retained capture files under `~/bmtrader/patterns` when capture is enabled. Enable pattern evidence for the chart to query detected reappearances and bounded replay depth. Tools report snapshot times, gaps, and missing evidence. The agent can prepare an advisory alert for review. **Watch that** activates the alert inside Cairo.

On Windows, the desktop shortcut runs `launch-windows.vbs`. Each successful `npm run package` publishes the new executable path to `release/latest-windows.txt`. The shortcut reads that path when opened. Packaging leaves earlier build folders available, including any instance currently running.

## Replay

Say **“manage this trade”** or **“manage NVDA long”**, or click **Review management** on a position. Cairo uses Backtest's `tradebooks/trade-management.md`, the confirmed daily plan, and Bookmap position and market evidence. It shows target price, reason, and percentage of original opening shares, with the calculated whole-share count. Adds and partial exits change remaining shares. Reconciled fills refresh the advisory plan automatically. Shadow mode keeps automatic updates silent.

1. Open a recording in Bookmap Replay and attach bmtrader to the chart. Enable pattern evidence and the desired detectors in Bookmap if testing pattern alerts.
2. Open Cairo Live and play the recording. Cairo follows Bookmap's mode and detects the session date from the feed. It loads a single matching saved replay plan automatically. With no plan it uses a practice session, and with several plans it offers a picker. Click **Start voice** to talk.
3. Click **Buy (simulated)** in the replay Trade window once a recorded trade is available. After Cairo asks, give the exact pattern and intended stop. The position card also has text fields for that step. Review the management recommendation and say **“watch that”** or click **Watch that** to activate its suggested condition.
4. Enter the number of shares to exit and click **Sell (simulated)**. A partial exit triggers a fresh Cairo review. Selling all held shares closes the replay position. Continue replay and inspect the alert and feedback log. Rewinding invalidates the simulated position and its pending advice. Use a new replay run ID to compare results with a different confirmed plan or configuration.

## Plan format

Keep the human plan and its alert conditions in one Markdown file. This example is synthetic. Use verified tradebook and pattern names, and populate `conditions` only for conditions explicitly agreed in the planning conversation. An empty `watchlist` is valid. Use timestamps with offsets.

````markdown
# Synthetic replay plan

```cairo-plan
{
  "schemaVersion": 1,
  "sessionDate": "2025-12-04",
  "mode": "replay",
  "replayRunId": "practice-1",
  "revision": 1,
  "confirmedAt": "2026-11-11T15:00:00-08:00",
  "researchCutoff": "2025-12-04T06:30:00-08:00",
  "researchPath": "data/processed/2025/12/04/bookmap_replay/practice-1/inputs",
  "tradebookRevision": "fixture",
  "watchlist": [{
    "symbol": "META",
    "setups": [{
      "direction": "long",
      "tradebook": "Key Level Decision",
      "tradebookPath": "tradebooks/daily-chart/key-level-decision.md",
      "patterns": ["Bid Lift"],
      "decisionLevels": [{ "label": "Example level", "price": 100 }],
      "conditions": [{ "id": "example", "predicate": "crosses_above", "priceBasis": "bookmap_last", "level": 100, "label": "Example level crossed" }]
    }]
  }]
}
```
````

For an explicit detector alert, use `{ "id": "agreed-pattern", "predicate": "bookmap_event", "eventType": "BID_STEP_UP", "label": "Bid stepped up" }`. The event type is the detector's exported enum. A detector event by itself is a chart observation. Keep any judgment about a complete trading pattern in the written plan and your review.

```text
npm run plan -- validate BACKTEST_ROOT DRAFT.md
npm run plan -- publish BACKTEST_ROOT DRAFT.md 0
```

The last argument is the expected existing revision. Live uses `mode: "live"` and omits `replayRunId`. Publish writes today's live plan under `data/processed/YYYY/MM/DD/cairo-trading-plan.md`. Replay writes into that session's `bookmap_replay/<run-id>/` folder. The app watches for new valid revisions while it runs.
