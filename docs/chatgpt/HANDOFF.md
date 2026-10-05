# Start or resume the Cairo coding checklist

Updated October 4, 2026. [CODING-PLAN.md](CODING-PLAN.md) is the authoritative checklist: **22 of 50 tasks complete (T01–T16, T21, T23, T29–T32); 28 remain.** Each completed task has verification notes and a separate local task commit.

## Current check-in

- T01 and T02 blockers are resolved. The pinned OpenCode Windows integration probe and Electron development-window smoke passed.
- T03–T16 are implemented and checked off. T16 defines and parses the normalized Bookmap observation contract; the producer stream is not implemented until T17–T19.
- T23's notes workspace and T29's owned runtime lifecycle are complete. T29 commit subject: `feat(T29): manage Cairo OpenCode sidecar lifecycle`.
- T30's restricted domain plugin is complete; see [verification](T30-VERIFICATION.md).
- T31's actual per-step context hook is complete; see [verification](T31-VERIFICATION.md).
- T32 completes the runnable notes/chart/chat milestone; see [verification and launch instructions](T32-VERIFICATION.md).
- T21's pure predicate evaluator is complete; see [verification](T21-VERIFICATION.md). All five tasks authorized after T23 (T29, T30, T31, T32, T21) are complete. **Next: T22**, clause-linked interpretation validation.
- Bookmap T17–T20 and pattern-specific T24–T25 move to the final feature phase after the other features; they remain required for the full MVP. No plugin changes now.
- No commits were pushed. T01–T16 completion commits are recorded below.

| Completed task | Local completion commit |
| --- | --- |
| T01 | `7a91fd5` |
| T02 | `765013b` (completes scaffold `e363aae`) |
| T03 | `9951f16` |
| T04 | `abbdacf` |
| T05 | `859cf34` |
| T06 | `a89f6cd` |
| T07 | `e5f8ba5` |
| T08 | `9a1430f` |
| T09 | `4141617` |
| T10 | `ccaef87` |
| T11 | `29f403c` |
| T12 | `e810354` |
| T13 | `9a12487` |
| T14 | `10fa827` |
| T15 | `9654181` |
| T16 | `6f6fad0` |
| T23 | `11801d5` |
| T29 | `3ef4d13` |
| T30 | `7f43dca` |
| T31 | `b5d06ae` |
| T32 | `dbbabf4` |
| T21 | See task commit `feat(T21): evaluate supported rules with source coverage` |

The [OpenCode probe instructions](opencode-v2-probe/README.md) include optional user verification with `npm run probe:manual`: enter `once`, then `reject`, and expect `ALL CHECKS PASSED`. Tool permission metadata alone did not pause the fake executor; the mock backend explicitly waits for the matching permission reply. Preserve that requirement when implementing production engine-ticket approval in T38–T46. Owned lifecycle is complete in T29; distributed packaging remains T48.

## Resume prompt

Give the following prompt to the coding agent:

> Resume Cairo in `C:/Users/lingr/trading/cairo` using CODING-PLAN.md and PREPARATION-MANAGEMENT-PHASE.md. Read applicable AGENTS.md and latest human instructions. T01–T16, T21, T23, and T29–T32 are complete. The requested five-task batch is complete. The next planned task is T22. Follow the revised order thereafter when authorized. The first runnable app supports freeform premarket notes, AI chat, and timestamped one-minute chart knowledge. Bookmap stays in the full MVP at the final feature phase; no plugin changes now. Preserve token ownership. Verify and commit each task separately. ViteApp and Backtest stay read-only.
>
> The confirmed MVP has observer entries, exact-human-approved assistant exits, human-language per-setup management, Embedded OpenCode V2 plus a Cairo plugin, read-only Bookmap-maintained Schwab tokens with direct backend requests, and a stale-tolerant Massive REST one-minute chart. Cairo opens no Massive WebSocket. Keep live state in memory and only essential authored/recovery files. Do not implement assisted entries, automated management, raw-data sharing/live candles, SQLite, journal/research, or a custom model runner.
>
> Use fake provider/broker/model data for verification. Do not submit real orders or run paid inference merely to test. Never push commits or branches to any remote. At session end, report completed task IDs/local hashes, checks, blockers, and the next task. Preserve the checklist and task notes so another agent can resume without the previous chat.

If assigning a single task, name its ID explicitly and stop after its verified local commit. If continuing the entire MVP, the agent proceeds task by task; no extra permission is required for the routine local commits requested by this workflow. Required human approval for actual exit orders remains an application behavior, not authorization for a coding agent to place test trades.
