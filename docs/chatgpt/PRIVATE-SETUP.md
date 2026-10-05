# Cairo private setup and supported behavior

October 5, 2026. Cairo 0.1.0, private Windows x64 build `39f4de0a0fe7`.

## Launch and prepare

Open `release/Cairo 0.1.0 39f4de0a0fe7/Cairo.exe`. Keep the whole directory together.
No global Node or Bun is needed. This is an unsigned unpacked private build; no
installer was available. [Build instructions](WINDOWS-PACKAGE.md) and
[packaged checks](PACKAGED-SMOKE.md) record the actual resources and verification.

The default provider is the local fake model. Write and save premarket notes;
date and symbol are optional. Select a symbol/date and manually refresh its
one-minute chart. Ask Cairo about your saved preparation, chart context and
positions. Chart bars retain fetch/latest-bar timestamps and failure/stale labels.
No Massive WebSocket, continuous quote feed or live ORB is created.

Configuration is `config.json` in Electron's user-data directory (normally
`%APPDATA%/cairo`). `CAIRO_USER_DATA` can select a separate private profile. Change
configuration and restart the app. Example fields:

```json
{
  "provider": "fake",
  "model": "",
  "selectedAccountId": "",
  "schwabTokenFile": "C:/Users/YOU/bmtrader/secrets.json",
  "bookmapEndpoint": "ws://127.0.0.1:8765",
  "chartSymbol": "SPY",
  "chartDate": "2026-10-05",
  "brokerPollIntervalMs": 30000
}
```

For actual OpenAI chat, set provider to `openai`, supply your exact available
OpenAI model ID in `model`, and provide `CAIRO_OPENAI_API_KEY` in Cairo's launch
environment. `CAIRO_MASSIVE_API_KEY` supplies REST chart authorization. Keys belong
in the local environment, not these documents, renderer, model context or source
control. Missing AI configuration leaves notes/chart/broker monitoring usable.
Restart AI explicitly after a runtime failure. Automatic AI event updates are
opt-in and pause after cancellation or uncertain delivery.

## Bookmap companion and broker ownership

The sibling bmtrader 1.31 observation work is recorded by commits `772b754`
(T17), `e5c25cb` (T18), and `2e1ca50` (T19). The full Gradle build, native compile,
tests and obfuscated release checks pass. Install the built
`bookmap-plugin/build/libs/lingrong1988_bmtrader_1.31.jar` using Bookmap's plugin
configuration, following its own README. Cairo never starts/stops Bookmap.

Copy `bookmap-plugin/config/cairo-observation.template.json` to
`%USERPROFILE%/bmtrader/cairo-observation.json`; set `enabled` true, name the symbols
to observe, and select only `BID_STEP_UP` and `BID_REAPPEAR`. Reattach the addon
to apply changes. Other detectors are neither broadcast nor consumed by Cairo.
V-shape removal was handled in the separate Bookmap chat before this phase.

`observerOnly: true` starts Bookmap observation without its native trading runtime
or credentials. This mode also omits that runtime's token renewal. When using the
existing Bookmap token keeper, retain its normal native companion configuration
(`observerOnly: false`); observation settings remain separate from native tradebook
eligibility. Cairo never enables native entries/exits or edits their configuration.

Select the exact Schwab account number in Cairo configuration. Bookmap owns the
credential file and token renewal; Cairo reads its access token/expiry, adopts
rotations and never writes or refreshes that file. A token within 60 seconds of
expiry cannot authorize a request. Broker refresh covers positions and complete
working-order topology including prior-day protection. An accepted order is not
a fill. External fills/quantity changes require guidance review when their mapping
cannot be established from Cairo's approved attempts.

### Current Bookmap limitation

Depth snapshot callbacks prove readiness, but the inspected 7.8.0.13 metadata and
callbacks do not yet establish a trusted live/replay mode at this adapter boundary.
The installed producer exports `mode: unknown`. Cairo displays its episodes as
context and blocks source-dependent actions. Do not configure a fabricated `live`
override or infer live mode from a wall timestamp, current clock or realtime-start
callback. Fake live-mode tests exercise the guarded algorithm; they do not prove
an installed live integration. Trusted installed source-mode evidence and its
adapter/checks remain necessary before closing full observer-entry acceptance.

## Narratives, observation and management

The personal Gap Give and Go/bid reappear/bid step up/shared management originals
are imported once as an unattached reference artifact. Their key-level condition,
either-side-of-VWAP allowance, patient low-of-day stop and discretionary tier
wording remain intact. No percentages, targets or breakeven rule are supplied.
Unsupported or ambiguous clauses are visible. Changing saved preparation or a
tradebook does not hot-swap a live position's frozen guidance.

Observer attempts require a current reviewed narrative, symbol/pattern and explicit
confirmation of mandatory discretionary clauses. They last five minutes. Fresh,
ready, proven-live episodes and fresh complete flat broker facts are hard gates.
One episode creates one recommendation; updates amend it. Reconnect snapshots and
historical events never create a fresh alert. Source resets invalidate attempts.
Rearm requires a new review. Entry recommendations have no broker submission path.

Enter externally. Review and attach guidance to the actual held position; confirm
carry-in/initial quantities and any authored allocations. Current broker scalar
comparisons, actual scoped fills, fresh scoped human confirmations, small all/any
groups and the two eligible Bookmap pattern predicates are supported. Candle
crossings, continuous bid/ask conditions, unexported offer patterns and live ORB
remain unknown/advisory. Human confirmations are scoped to runtime/position/policy/
broker revision and expire after five minutes; they grant no order approval.

## Exact exit review and uncertainty

Supported writes are whole-share equity closes and exact standalone closing
NORMAL/DAY market, limit, stop and stop-limit shapes, with SELL for a long holding
and BUY_TO_COVER for a short holding. Prices use positive exact cents. Fractional,
option, opening/increasing/reversing, unsupported session and OCO/complex topology
requests remain manual. Existing protection prevents an additional conflicting
close. A supported cancel/replace names one exact known closing order.

Review each ticket's account, position, shares, side, order type/prices and affected
protection. Approve that exact expiring card once. New protection after a partial
fill requires its own ticket and approval. Copilot permissions alone cannot send
requests. Material facts/policy changes, dismissal, cancellation or expiry
invalidate authority; renderer reload and AI failure do not stop the engine.

Before every attempted mutation, Cairo writes a minimal recovery checkpoint.
Timeout after send stays unknown and is never resent automatically. Reconciliation
reads broker IDs first. A missing ID needs exact reviewed broker identity; absent
or duplicate-looking orders never clear uncertainty. Review the broker account,
then bind only the matching identity using the recovery controls. Corrupt recovery
files block writes; preserve them and resolve the discrepancy, rather than deleting
them to retry. Restarts discard drafts/approvals and restore attached guidance
paused. Fresh holdings, quantities/allocations and explicit review are required to
resume; unresolved broker attempts block conflicting actions.

## Delivery evidence and remaining closure

All Cairo checks (124 runner checks), typecheck and production build pass. Build
`39f4de0a0fe7` passes two actual executable fake-network smoke runs, including
renderer/AI loss, missing sidecar, restart, observation resets, token rotation,
stale chart retention, zero external broker mutations and clean process teardown.
No real orders or paid inference were used. ViteApp/Backtest were read-only.

T01–T49 implementation/checklist deliverables are complete. T50's guide is written;
full checklist closure remains open for trusted installed Bookmap source-mode
evidence. Real-account read connectivity can be checked separately by the trader.
Automated entries/management, raw-data/live-candle relay, journals, backtesting,
database infrastructure and cloud deployment remain outside this scope.
