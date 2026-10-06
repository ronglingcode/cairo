# First run: 2026-10-05-PCVX

This records the initial placeholder run. The case was subsequently updated from
the trader's details to 400 shares short at approximately $88.50, entered at
9:37:30 a.m. Eastern / 6:37:30 a.m. Pacific. Results below describe the old inputs;
they are not a real-AI verification of the revised entry.

See [RESULT-shortcut.md](RESULT-shortcut.md) for the verified browser run with
the revised entry and only `/m` → `/manage-trade` autocomplete → send.

Model: `cairo-model/gpt-6.1-sol`.

Tradebook: `gap_and_crap`, revision
`0832f0d3dc2d2bfac7175f1205ae89b1fd02b4237b38b690bfe86a76f2743d4b`.

Input: synthetic PCVX short, 100 shares, entry/mark $86.80; no confirmed stop,
key level, allocation or targets. `bid-breakdown` was selected as a synthetic
scenario assumption through the normal pattern picker, not as a live observation.

Prompt:

> /manage-trade PCVX. Using my assigned Gap and Crap tradebook, what is the next management consideration?

Observed tool: `cairo_read_trade_context`, completed.

AI response:

> Stop rule not defined for bid breakdown. What stop condition should govern this trade?

Outcome: succeeded, no chat error. Position remained 100 shares. No guidance
attachment or exit ticket was created. **First management-context pass: PASS**.
The response identified missing stop logic and requested clarification rather
than inventing a level or activating a plan.

Verification: TypeScript and production build passed; fake startup smoke passed;
full automated suite passed 150/150. New simulator checks exercised exact approval,
BUY_TO_COVER, acknowledgment without a fill, idempotent submission, simulated
fill to 90 shares, rejection retaining 100 shares, and blocked non-simulator routes.

The full-suite run passed the existing complete-workflow check. An earlier isolated
run of that check failed with a missing recommendation; it was not changed in this
work, so that isolated failure remains an intermittent finding to investigate.

The real-AI guidance-proposal → attachment → recommendation → approval → fill
sequence in README's second pass has **not** been verified with the real model.
Only the deterministic approval/writer/fill transport was exercised automatically.
No actual broker requests were sent. This case provides no chart or live observations.
