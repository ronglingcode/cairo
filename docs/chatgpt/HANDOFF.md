# Cairo current handoff — October 5, 2026

**49/50 tasks complete.** [CODING-PLAN.md](CODING-PLAN.md) is authoritative.
T50's [private setup guide](PRIVATE-SETUP.md) is written. Final closure stays
unchecked for trusted installed Bookmap live/replay evidence. Never push.

## Current delivery

The private Windows app supports saved premarket notes, pinned OpenCode chat,
timestamped one-minute chart context, broker positions, frozen reviewed guidance,
exact approved whole-share equity closes and standalone protection changes,
uncertainty reconciliation and paused restart recovery. Bookmap owns tokens.
Only BID_STEP_UP and BID_REAPPEAR are broadcast/consumed. Unknown source mode
remains context only; entry recommendations have no broker submission path.

## Separate local task commits since 32/50

| Task | Cairo | bookmap-plugin |
| --- | --- | --- |
| T39 | b5e7380 | — |
| T40 | 7cebfa2 | — |
| T41 | 178bcec | — |
| T42 | e2962f1 | — |
| T43 | 38e3231 | — |
| T44 | 74b877e | — |
| T45 | b6276f7 | — |
| T46 | b3472f4 | — |
| T17 | 2036379 | 772b754 |
| T18 | 719c5a7 | e5c25cb |
| T19 | 70c20da | 2e1ca50 |
| T20 | 9f39def | — |
| T24 | 0a4e654 | — |
| T25 | 4ed9208 | — |
| T47 | 1817e86 | — |
| T48 | ca745d0 | — |
| T49 | dd68107 | — |

Focused Cairo repairs: 2b71121, ef9ab9d, 026af45, 610493a. Sibling preexisting
test repairs: b71de0a, 5aa7cd0. V-shape/wall-break removals were already present
(ec5888a, ee3ef7a). Earlier task commits are retrievable by task-ID subject.

## Verification and package

All 124 runner checks, typecheck and production build pass. Shared fixture imports
register some checks in multiple workers. Full sibling Gradle build/native compile/
obfuscated release tests pass using `C:/Users/lingr/trading/.tools/jdk-21.0.12.1+1`.
Current package: `release/Cairo 0.1.0 39f4de0a0fe7/Cairo.exe`. Both actual executable
[smoke runs](PACKAGED-SMOKE.md) pass after the latest runtime repair, including
missing sidecar, renderer/AI outages, restarts, Bookmap reset/reconnect, token
rotation and stale charts. Owned processes stopped cleanly. No real orders, paid
inference, global runtime dependency, shipped keys or pushed commits. ViteApp and
Backtest remained read-only. Existing nonfatal Rollup option warnings persist.

## Remaining task, in order

**T50 final closure:** Prove installed Bookmap live/replay mode at the adapter
boundary, wire the trusted evidence, add Java/receiver checks and rerun acceptance.
Do not guess live mode from event time, a realtime-start callback or a config
override. Inspected API 7.8.0.13 exposes Api.getProvider(), provider source/features
and instrument delay, but no trustworthy mode mapping was established here.
T19 allows unknown mode, so safe observation delivery is complete; full live
observer acceptance remains unproven. The preparation/exit-assistant app runs
independently. Installed Bookmap and real-account read connectivity were not tested.

Continue authorized coding without another routine confirmation. Preserve exact
approval per broker mutation, read-only Bookmap credentials, the two-pattern
allowlist and separate local commits. Never restore approvals from disk or add an
entry writer. The setup guide documents actual manual and deferred behavior.
