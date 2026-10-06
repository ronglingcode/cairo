# 2026-10-05-PCVX

First after-hours management case: a **simulated** PCVX short assigned to the
active Gap and Crap tradebook, using the trader's supplied entry: 400 shares,
filled around $88.50, 7 minutes 30 seconds after market open on October 5, 2026
(9:37:30 a.m. Eastern / 6:37:30 a.m. Pacific). This is not historical trade replay.
The initial simulated mark is $88.50, seeded from entry rather than a market quote.
Position and entry metadata are editable in `scenario.json`.
The date identifies the case; it does not pretend the market is open.

## Run

Double-click `Launch-Test-Case.cmd` at the Cairo root, then open the printed
localhost URL. Or from PowerShell at the Cairo root:

```powershell
npm run build
npm run test:case -- 2026-10-05-PCVX
```

The launcher reads your saved Cairo model and secrets-file reference, without
changing the normal profile. `--model MODEL`, `--secrets-file PATH`, and
`--tradebooks-root PATH` override those references. `CAIRO_OPENAI_API_KEY` also
works. Real chat requests use your API account. `--fake` runs the UI with canned
responses; it cannot validate AI reasoning. `--smoke` checks startup and shuts
down using the fake provider, without paid inference.

Each launch creates a disposable isolated profile. Ctrl+C removes that profile;
restart the launcher to reset. Reloading the browser retains the current run.
The normal preparation documents, broker recovery and account remain untouched.
Only the simulation broker receives order requests. The first simulator supports
closing orders and manual complete fills/rejections; modifying/canceling protection,
partial broker fills, restart recovery and actual Schwab behavior are outside this case.
Manual fills use the scenario mark, regardless of order type; they do not model
matching, slippage or a market trigger.

## First pass: AI management context

Starting condition: **the trader has not tagged any Bookmap entry pattern**.
Each fresh launch starts without tags. Do not preload or automatically select a
pattern for this case.

1. Verify the yellow simulation banner and the simulated PCVX **short**, 400 shares at approximately $88.50. Preparation should include entry at 9:37:30 a.m. Eastern.
2. Verify Preparation → Tradebooks by stock and side resolves PCVX short to Gap and Crap.
3. Type only `/m` in chat. Choose `/manage-trade` from autocomplete (Enter or Tab),
   then press Enter to send. The submitted command is only `/manage-trade`; do not
   append a symbol, tradebook name, or question. Cairo should resolve the sole held
   PCVX short and its saved Gap and Crap assignment automatically.
4. The picker must ask you to choose the trade's short Bookmap pattern. Before
   selection, verify that no chat request reaches the model, no tag is saved, and
   no management advice or ticket is created. **Stop here for the untagged case**:
   leave the picker open and let the trader choose; do not assume `bid breakdown`.
   After an explicit trader selection, Cairo resumes the same request using that
   pattern's source. Missing stop logic must remain explicit. On later
   invocations for the same held/tagged trade, `/m` → autocomplete → send should
   proceed without another pattern selection. With multiple holdings, a trade
   picker may be necessary; typing a symbol is not an acceptance requirement.
5. After pattern selection, expect exactly two short numbered lines:
   `1. stop loss: <supported condition or undefined>` and
   `2. targets: <supported T1, T2, etc., or undefined>`.
   Missing inputs appear as `undefined`; no clarification question or unsolicited
   protective-order status is appended. Stop/key level, tier quantities, core
   target and runner trigger are initially unspecified.
   AI must not invent them, claim a fresh VWAP/candle signal, or activate guidance/orders.
6. Verify the shared three-tier rules are available in preparation: flexible scalp,
   core target/stop/reversal, and a runner requiring its own trigger and target.

## Second pass: reviewed guidance and simulated close

This is a separate setup/approval check, not the time-sensitive management shortcut.
Any longer narrative is prepared before the live invocation; it is not text the
trader must repeat each time they request management.

Add this deliberately synthetic test clause to preparation and save:

> When I explicitly confirm scalp relief, close 10 shares at market once. This is a human condition named scalp-relief.

Ask AI to propose an executable interpretation of that clause for PCVX, using the
existing proposal mechanism and leaving other discretionary clauses advisory.
Verify the proposal is unapplied. Review it, select the PCVX position, and accept
and attach only after inspecting the clause readback. If AI cannot produce a valid
proposal, record the error: that is an end-to-end finding, not a reason to silently
pre-attach a canned policy.

Confirm `scalp-relief` in management review. Expect a 10-share close recommendation.
Ask AI to stage that exact recommendation. Inspect BUY_TO_COVER, 10 shares, MARKET,
NORMAL/DAY and the synthetic account. Nothing submits before exact ticket approval.
Approve, then use **Simulate fill at mark** in the yellow banner. Expect 390 shares
remaining and a filled broker attempt; approval/acceptance alone is not a fill.
On a fresh run, use **Simulate rejection** instead and verify quantity stays 400.

## Record the result

Record model ID, tradebook revision, prompts, clarifications, proposal outcome,
ticket fields, approval outcome and remaining quantity. Mark checks pass/fail with
evidence. Real AI answers are variable; evaluate grounded behavior rather than exact
wording. This case has no chart or live Bookmap feed and makes no trading recommendation.
