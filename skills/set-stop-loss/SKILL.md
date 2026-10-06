---
name: set-stop-loss
description: Tag the current trade’s Bookmap pattern and route to that pattern’s stop-loss or invalidation rule.
metadata:
  includes:
    - trade-context
---

# Set stop loss

Apply the included [trade-context](../trade-context/SKILL.md) prerequisite. Read the confirmed `bookmapPattern` source Markdown returned by `cairo.read_trade_context` and use only that pattern's stop-loss logic.

If the source mapping is undefined or the source contains no stop-loss rule, say “Stop rule not defined for [pattern]” and ask for the missing rule. Do not substitute a similar pattern’s stop. Read the source again if context or the tag changes.

Compare the selected pattern’s rule with any rule attached to the position. Distinguish an existing protective order from a suggested stop and from an unactivated preparation rule. If these conflict, briefly flag the conflict instead of silently changing the plan.

Preserve the trader's exact structural condition, including whether a bounce occurs before or after a bid breakdown. A price requires evidence identifying that level. Do not invent a price, buffer, percentage or before/after alternative. Timestamped chart snapshots cannot establish a current live crossing.

For a live question, answer with the stop level or condition in a few words. Example, only when supported by the trader's rule: "Mini bounce high after bid breakdown."

If the required rule or position is ambiguous, ask one brief clarification. Explain reasoning when the trader requests research or detail. Advice does not place, replace or approve an order.

When a numerical bounce high is requested, inspect the frozen entry assessment via `cairo.read_entry_setup` for the entry fill when available. Compare the trader-confirmed tag with the measured before/after bounce identities. Use the selected measured high only when the rule and entry sequence agree; provisional or ambiguous highs remain undefined. Current developing bounces must not rewrite the original entry setup.
