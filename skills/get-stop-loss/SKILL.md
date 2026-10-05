---
name: get-stop-loss
description: Identify the stop-loss level or invalidation condition for a trade from the trader's saved rules and available evidence.
---

# Get stop loss

Use current Cairo context to identify the intended symbol, position side and relevant preparation or attached position guidance. Read Cairo context again if anything is missing or has changed.

Prefer the rule attached to the position. Distinguish an existing protective order from a suggested stop and from an unactivated preparation rule. If these conflict, briefly flag the conflict instead of silently changing the plan.

Preserve the trader's exact structural condition, including whether a bounce occurs before or after a bid breakdown. A price requires evidence identifying that level. Do not invent a price, buffer, percentage or before/after alternative. Timestamped chart snapshots cannot establish a current live crossing.

For a live question, answer with the stop level or condition in a few words. Example, only when supported by the trader's rule: "Mini bounce high after bid breakdown."

If the required rule or position is ambiguous, ask one brief clarification. Explain reasoning when the trader requests research or detail. Advice does not place, replace or approve an order.
