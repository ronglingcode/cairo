# Cairo — UI mockups

Static design reference for the MVP screens. **Not production code** — one self-contained
`index.html` (no build, no dependencies) used to agree on layout and information hierarchy before
the Electron renderer is implemented.

Preview images: `screen-1-premarket.png`, `screen-2-observer.png`, `screen-3-assistant.png`
(captured from `index.html`; regenerate with any headless browser, e.g.
`msedge --headless=new --screenshot=out.png --window-size=1240,1680 "file:///.../index.html?tab=assistant"`).

Open `index.html` in any browser (or the OpenCode Review pane) and switch between the three tabs:

| Screen | State shown | What it proves |
| --- | --- | --- |
| [1 · Premarket planning](screen-1-premarket.png) | observer, 08:12 ET | one active symbol; plan file + sidecar written by the planner agent; levels on chart and strip |
| [2 · Live observer](screen-2-observer.png) | observer, 10:41 ET | Bookmap + candle signals in one rail; agent explanation grounded in engine numbers; read-only position card |
| [3 · Assistant approval](screen-3-assistant.png) | assistant, 10:42 ET | staged draft with engine sizing/guardrails; the OpenCode `ask` rendered as a trade approval card |

Design decisions reflected (see `../00-decisions.md`):

- **Single active symbol** (typed in with a recent list) — no watchlist/multi-chart UI.
- **Mode switch** in the app bar; observer shows zero order affordances beyond "stage draft".
- **Feed status chips**: Massive, Bookmap (`ws+file`), Schwab token freshness.
- **Approvals** are the only place an order can be released; cards expire with the draft.
- Chart overlays match the ported ViteApp patterns: candles, VWAP, premarket high/low, key levels,
  signal markers, staged entry/stop/target price lines.

When the renderer is implemented, map panels as:

| Mockup area | Renderer feature / component |
| --- | --- |
| App bar | `apps/desktop/src/features/appbar` |
| Chart + strip | `features/charts` (`lightweight-charts` wrapper) |
| Signals rail | `features/signals` |
| Copilot chat | `features/chat` (`@opencode/client`) |
| Approvals | `features/approvals` |
| Position / plan cards | `features/positions`, `features/plan` |
