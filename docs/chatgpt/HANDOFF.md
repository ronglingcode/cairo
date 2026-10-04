# Start or resume the Cairo coding checklist

October 4, 2026. The final implementation handoff is [CODING-PLAN.md](CODING-PLAN.md). It is self-contained, has 50 small tasks with dependencies/verification, and requires a separate local commit for every completed task. All tasks initially remain unchecked; this planning turn implements no application code.

Give the following prompt to the coding agent:

> Implement Cairo in `C:/Users/lingr/code/cairo` using `docs/chatgpt/CODING-PLAN.md` as the authoritative coding checklist. Read applicable AGENTS.md and latest human instructions first. Start at the first unchecked task whose dependencies are satisfied. Implement that task, run its verification, record actual results, check it off, and make its separate local task-ID commit before continuing. Continue through actionable tasks and record genuine blockers; do not reopen routine implementation defaults or silently expand scope. T17-T19 require scoped local code commits in bookmap-plugin and separate Cairo progress commits recording their hashes. ViteApp and Backtest are read-only references.
>
> The confirmed MVP has observer entries, exact-human-approved assistant exits, human-language per-setup management, Embedded OpenCode V2 plus a Cairo plugin, read-only Bookmap-maintained Schwab tokens with direct backend requests, and a stale-tolerant Massive REST one-minute chart. Cairo opens no Massive WebSocket. Keep live state in memory and only essential authored/recovery files. Do not implement assisted entries, automated management, raw-data sharing/live candles, SQLite, journal/research, or a custom model runner.
>
> Use fake provider/broker/model data for verification. Do not submit real orders or run paid inference merely to test. Never push commits or branches to any remote. At session end, report completed task IDs/local hashes, checks, blockers, and the next task. Preserve the checklist and task notes so another agent can resume without the previous chat.

If assigning a single task, name its ID explicitly and stop after its verified local commit. If continuing the entire MVP, the agent proceeds task by task; no extra permission is required for the routine local commits requested by this workflow. Required human approval for actual exit orders remains an application behavior, not authorization for a coding agent to place test trades.
