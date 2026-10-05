---
name: set-stop-loss
description: Tag the current trade’s Bookmap pattern and route to that pattern’s stop-loss or invalidation rule.
---

# Set stop loss

Use current Cairo context to identify the intended symbol, position ID and long/short side. If several positions match, ask which trade; never use the chart symbol as proof of the intended position.

First establish the trader-confirmed Bookmap pattern. Cairo opens a side-filtered picker before sending `/set-stop-loss` (and `/manage-trade`) when a tag is missing or needs reconfirmation. The candidates come from `Backtest/tradebooks/bookmap_patterns/activePatterns.md`. Traders can also use `/bookmap-pattern` to tag or change the pattern manually. Never infer a tag from a chart or historical chat. If this skill is reached without a confirmed tag, ask the trader to use `/bookmap-pattern`; wait for selection before giving a pattern-specific stop.

Call `cairo.read_bookmap_pattern` with the current position ID. Require `confirmed: true`, then read the returned source Markdown and use only that pattern’s stop-loss logic. The saved tag belongs to the account and trade; it is retired after an observed flat position or side change and must be reconfirmed after restarting Cairo. A tag identifies a setup; it does not activate guidance.

If the source mapping is undefined or the source contains no stop-loss rule, say “Stop rule not defined for [pattern]” and ask for the missing rule. Do not substitute a similar pattern’s stop. Read the source again if context or the tag changes.

Compare the selected pattern’s rule with any rule attached to the position. Distinguish an existing protective order from a suggested stop and from an unactivated preparation rule. If these conflict, briefly flag the conflict instead of silently changing the plan.

Preserve the trader's exact structural condition, including whether a bounce occurs before or after a bid breakdown. A price requires evidence identifying that level. Do not invent a price, buffer, percentage or before/after alternative. Timestamped chart snapshots cannot establish a current live crossing.

For a live question, answer with the stop level or condition in a few words. Example, only when supported by the trader's rule: "Mini bounce high after bid breakdown."

If the required rule or position is ambiguous, ask one brief clarification. Explain reasoning when the trader requests research or detail. Advice does not place, replace or approve an order.
