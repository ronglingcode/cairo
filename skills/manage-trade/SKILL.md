---
name: manage-trade
description: Review an open trade's plan, stop loss and profit targets together, and identify the next relevant management consideration.
metadata:
  includes:
    - get-stop-loss
    - get-targets
---

# Manage trade

Apply [get-stop-loss](../get-stop-loss/SKILL.md) and [get-targets](../get-targets/SKILL.md), which Cairo includes with this skill. Combine their conclusions into one answer without repeating their instructions.

Identify the position from current Cairo context. If several positions could match, ask which one. Use the saved plan and attached guidance together with current broker state and source freshness. Historical conversation is not proof of current position size, fills or order state.

Consider the invalidation condition, next profit target, existing protection and any unresolved order attempt. Prioritize the trader's question and the most relevant supported issue. Do not assert a live stop/target trigger from a chart snapshot or unknown observations.

For a live request, return one brief management cue, or compact "Stop: …; next target: …" when both are requested. Do not narrate the entire checklist. If a decisive fact is missing, ask one short question. For strategy research, explain alternatives and tradeoffs using evidenced rules.

Suggestions do not activate guidance or authorize broker actions. Use Cairo's existing proposal and exact human-review mechanisms only when the trader asks for a change; do not open or increase positions.
