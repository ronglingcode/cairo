# Compact management format: 2026-10-05-PCVX

Verified with real model `cairo-model/gpt-6.1-sol`, the current 400-share short,
and the trader's existing `mini-bounce-then-bid-breakdown` pattern tag. The tag
was preserved; no pattern was automatically selected during this check.

Submitted only `/manage-trade`. Response:

1. stop loss: Exit above mini-bounce high before bid breakdown.
2. targets: undefined

Outcome: succeeded, no chat error. **PASS**: two numbered lines, exact structural
stop from the selected pattern, missing targets marked undefined, and no unsolicited
protective-order status or appended question.

Updated the management skill and shared response instructions to agree on this
format. Production build and seven existing skill/context checks passed.

After shortening values to level names, another real-model `/manage-trade` check
succeeded without a chat error and returned exactly:

1. stop loss: mini-bounce high
2. targets: undefined

The source's pre-break bounce rule remains unchanged. The shorter label applies
because the current confirmed pattern identifies that bounce; qualifiers are
retained when needed to distinguish candidate levels.
