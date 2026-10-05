---
name: bookmap-pattern
description: Manually tag or change the Bookmap pattern for a current long or short trade using active side-filtered candidates.
---

# Bookmap pattern

Use current Cairo broker context to identify the account, position ID, symbol and side. `/bookmap-pattern` opens Cairo’s candidate picker; with multiple holdings the trader selects the trade first. Only active patterns for that side from `Backtest/tradebooks/bookmap_patterns/activePatterns.md` are offered.

The trader’s click saves the tag for that account and trade. Never infer or save a tag on the trader’s behalf. Existing tags can be changed using the same command. Saved tags require one-click reconfirmation after restart and are retired when Cairo observes the trade going flat or changing side.

Use `cairo.read_bookmap_pattern` to inspect the confirmed tag and linked source rules. If invoked without the picker, direct the trader to `/bookmap-pattern`. Tagging does not activate guidance or submit a broker order. `/set-stop-loss` routes to the confirmed pattern’s own stop rule; missing mappings and missing rules must be stated, never invented.
