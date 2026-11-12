# Cairo Live

Standalone advisory app in the Cairo repository. Run the commands below from this `live/` directory with Node.js 24 and npm.

```text
npm ci
npm run build
npm start
```

Run `npm run package` for an unpacked desktop release for the current platform. The macOS bundle includes the microphone usage description. From a packaged app, choose the Backtest checkout under **Session and settings** on first launch. In development the app finds the sibling Backtest checkout automatically. Start voice when ready and allow microphone access. Provide `OPENAI_API_KEY` in the process environment or the existing OpenAI entry in the workspace's `secrets/storeSecrets.js`.

Bookmap owns the live Schwab and Massive connections. Load the rebuilt `bookmap-plugin` JAR. Cairo subscribes to the Bookmap loopback feed on port 8765. The live panel starts in shadow mode, which records alerts in the local log. Turn it off to hear notices. App state is saved per session under the OS application data directory for Cairo Live in `state.json` and `alerts.jsonl`.

## Replay

1. Prepare a historical Backtest plan with `--no-after-open` and finalize it for a named replay run. Open the matching recording in Bookmap Replay and attach bmtrader to the chart. Enable pattern evidence and the desired detectors in Bookmap if testing pattern alerts.
2. In Cairo Live select the recording date and replay run ID under **Session and settings**. Start voice. The replay date shown by Bookmap must match.
3. Click **Buy (simulated)** in the replay Trade window once a recorded trade is available. After Cairo asks, give the exact pattern and intended stop. The position card also has text fields for that step. Review the management recommendation and say **“watch that”** or click **Watch that** to activate its suggested condition.
4. Continue replay and inspect the alert and feedback log. Rewinding invalidates the simulated position and its pending advice. Use a new replay run ID to compare results with a different confirmed plan or configuration.

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
