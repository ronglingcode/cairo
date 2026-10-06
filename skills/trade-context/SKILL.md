---
name: trade-context
description: Establish the current broker trade, confirmed Bookmap pattern and assigned tradebook before stop, target or management advice.
---

# Current trade context

Cairo's shared preflight selects the current held trade and requires a trader-confirmed Bookmap pattern before `/set-stop-loss`, `/set-targets` or `/manage-trade`. With multiple matching positions, use the trade picker. Chart focus and historical chat do not identify a trade.

Call `cairo.read_trade_context` with the selected position ID (for targets, `cairo.read_target_context` supplies this same prerequisite plus sizing, fills, notes and liquidity in one call). Use its account, symbol, position side and fresh facts. Require `bookmapPattern.confirmed: true`; otherwise direct the trader to `/bookmap-pattern` and wait. Never infer a trader-confirmed Bookmap tag. Independent setup recognition is allowed through `cairo.read_setup_candidates` and `cairo.read_bookmap_timeline`; report it as inferred and use `cairo.interpret_bookmap_setup` for advisory explanations. Recognition questions do not require a confirmed tag. Replay evidence cannot establish a live trade trigger. Tags require reconfirmation after restart and are retired after observed flat or side changes.

Use the resolved tradebook assignment for the trade's symbol and broker side; there is at most one intended long and one short tradebook per stock. Assignments are saved in preparation's “Tradebooks by stock and side” controls. Do not ask the trader to choose between long and short when the position establishes the side. If unassigned, ask for an assignment only when the requested answer requires that book; a confirmed pattern's own stop rule can still answer a stop question. Ambiguous, conflicting or missing-source results must be stated rather than guessed. A Bookmap pattern's linked source and the stock's tradebook are distinct context. Attached guidance remains the frozen position plan; an assignment change does not replace it.

Read the context again when the trade or tag changes. Distinguish current attached guidance and protective orders from unactivated preparation or library narratives. Tagging and resolving a tradebook do not activate guidance or approve orders.
