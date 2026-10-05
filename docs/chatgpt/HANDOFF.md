# Start or resume the Cairo coding checklist

Updated October 4, 2026. [CODING-PLAN.md](CODING-PLAN.md) is the authoritative checklist: **15 of 50 tasks complete (T01–T15); 35 remain.** Each completed task has verification notes and separate local commits.

## Current check-in

- T01 and T02 blockers are resolved. The pinned OpenCode Windows integration probe and Electron development-window smoke passed.
- T03–T15 are implemented and checked off. Provider/broker behavior was checked with fixtures; this is not a completed live trading integration.
- Work is paused before **T16 — Specify the observation envelope from installed APIs**, pending the user's review before the Bookmap phase. Do not start T16 or later tasks until the user resumes that phase.
- No commits were pushed. The working tree was clean after the T01 completion commit.

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

The [OpenCode probe instructions](opencode-v2-probe/README.md) include optional user verification with `npm run probe:manual`: enter `once`, then `reject`, and expect `ALL CHECKS PASSED`. Tool permission metadata alone did not pause the fake executor; the mock backend explicitly waits for the matching permission reply. Preserve that requirement when implementing production engine-ticket approval in T38–T46. Owned application-side lifecycle and distributed packaging remain T29/T48.

## Resume prompt

Give the following prompt to the coding agent:

> Resume Cairo in `C:/Users/lingr/trading/cairo` using `docs/chatgpt/CODING-PLAN.md` as the authoritative coding checklist. Read applicable AGENTS.md, this handoff's current check-in, and latest human instructions first. T01–T15 are complete. Work is paused before T16 pending the user's Bookmap-phase review; proceed only when the user resumes that phase, and follow the task limit they authorize. Then start at the first unchecked task whose dependencies are satisfied. Implement that task, run its verification, record actual results, check it off, and make its separate local task-ID commit before continuing. Record genuine blockers; do not reopen routine implementation defaults or silently expand scope. T17-T19 require scoped local code commits in bookmap-plugin and separate Cairo progress commits recording their hashes. ViteApp and Backtest are read-only references.
>
> The confirmed MVP has observer entries, exact-human-approved assistant exits, human-language per-setup management, Embedded OpenCode V2 plus a Cairo plugin, read-only Bookmap-maintained Schwab tokens with direct backend requests, and a stale-tolerant Massive REST one-minute chart. Cairo opens no Massive WebSocket. Keep live state in memory and only essential authored/recovery files. Do not implement assisted entries, automated management, raw-data sharing/live candles, SQLite, journal/research, or a custom model runner.
>
> Use fake provider/broker/model data for verification. Do not submit real orders or run paid inference merely to test. Never push commits or branches to any remote. At session end, report completed task IDs/local hashes, checks, blockers, and the next task. Preserve the checklist and task notes so another agent can resume without the previous chat.

If assigning a single task, name its ID explicitly and stop after its verified local commit. If continuing the entire MVP, the agent proceeds task by task; no extra permission is required for the routine local commits requested by this workflow. Required human approval for actual exit orders remains an application behavior, not authorization for a coding agent to place test trades.
