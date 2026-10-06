---
name: manage-trade
description: Show the current trade's stop loss and targets in two short numbered lines.
metadata:
  includes:
    - set-stop-loss
    - set-targets
---

# Manage trade

Apply [set-stop-loss](../set-stop-loss/SKILL.md) and [set-targets](../set-targets/SKILL.md), which Cairo includes with this skill. Combine their conclusions into one answer without repeating their instructions.

Both workflows share the included [trade-context](../trade-context/SKILL.md) prerequisite; establish it once. Use the resolved tradebook, confirmed Bookmap pattern and attached guidance together with current broker state and source freshness. Historical conversation is not proof of current position size, fills or order state.

Read relevant broker facts and source freshness to ground the stop and targets. Do not assert a live stop/target trigger from a chart snapshot or unknown observations.

For an automatic review after a partial, show supported stop and target rules in the same two numbered lines. When either field is unsupported, replace bare `undefined` with `unavailable — <specific missing rule or input>`. Add at most one short next-step sentence naming how the trader can supply that missing context. This exception takes precedence over the bare invocation's format below. Never guess a rule, price or confirmed pattern to fill the gap.

For a bare `/manage-trade` invocation or an immediate live-management request, return exactly this two-line numbered format:

1. stop loss: <supported level or structural condition, or undefined>
2. targets: <supported T1, T2, etc. in order, or undefined>

Use level names, not action sentences. Aim for 2–4 words per value: for example, `stop loss: mini-bounce high` when supported by the selected pattern. Omit `exit above`, `the high of`, and other wording already implied by a stop loss for the known position side. Keep the selected pattern's exact before/after rule internally; show a compact qualifier such as `(pre-break)` or `(post-break)` only when needed to distinguish multiple possible bounce highs in the current context. Never collapse distinct levels or change the selected rule. Structural rules are valid answers without an exact price; never invent a price to fill the format. Distinguish confirmed targets from alternatives: label conditional targets as conditional instead of treating them as approved levels. If a field lacks enough evidence, write `undefined` in that field. Do not append a clarification question, introduction, explanation, position summary, protection-order status, warning, or follow-up offer. In particular, do not mention an absent protective order unless the trader explicitly asks about orders or protection.

This combined-response format takes precedence over included stop/target skills' requests to ask clarifying questions. Keep missing inputs as `undefined` so the trader can scan the answer immediately. If the trader explicitly asks for only one field, answer just that field. For strategy research or an explicit explanation request, give the requested detail using evidenced rules.

Suggestions do not activate guidance or authorize broker actions. Use Cairo's existing proposal and exact human-review mechanisms only when the trader asks for a change; do not open or increase positions.
