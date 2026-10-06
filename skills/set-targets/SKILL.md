---
name: set-targets
description: Set remaining-share profit targets using actual Bookmap liquidity, a cumulative early partial, saved T1/T2 notes and the trade's fill history.
metadata:
  includes:
    - trade-context
---

# Set targets

Apply [trade-context](../trade-context/SKILL.md), using `cairo.read_target_context` with the selected position ID as the single preflight read. It supplies the same confirmed-pattern and assigned-tradebook context plus saved preparation, attached guidance, initial/remaining size, partial fill prices, working exits and code-calculated Bookmap levels/budgets. Use this computed result first; do not fetch long timelines, recalculate share arithmetic in prose or reread unchanged context. Refresh when facts or levels change. Missing evidence must remain explicit.

## Early partial at Bookmap liquidity

Take **10-30% of initial filled shares in total**, spread over the next few large displayed orders in the profit direction. This range is cumulative, not 10-30% at every wall or of each new remaining balance. Longs use offers above/current ask; shorts use bids below/current bid. Use the returned exact USD prices, current displayed sizes and plugin large-order thresholds. Select the nearest relevant levels first; skip levels on the loss side of entry and keep distant walls beyond T1/T2 from delaying the saved targets. Never invent a wall from a chart, historic peak, ended wall or setup trigger.

Use `sizing.earlyPartial.additionalSharesAllowed` as the cap across all further early partials. Choose within the allowed range based on the actual nearby liquidity and existing plan; 30% is a ceiling, not a requirement. Preserve at least 70% of initial shares for the planned targets (so a 10% early partial can leave 90%). Round early exits down and the reserve up to whole shares. Small positions may have no feasible early partial. Do not take another early partial once the cumulative budget is exhausted. Subtract already working early-target exit quantities before suggesting additional orders; stop protection is not an early partial. If working-order purpose or overlapping T1/T2 allocations are unclear, give price guidance without a new exact order size.

`liquidity.available` must be true for live wall advice. The feed contains observed large displayed levels, not every order or hidden liquidity. An empty level list means no qualifying observed level; stale/replay/gapped data means live levels unavailable. Keep evidenced T1/T2 guidance when Bookmap is unavailable, without substituting guessed prices. A displayed order can pull or change; refresh before claiming it remains present. Price crossing alone does not prove consumption or a fill.

## Keep the main position for T1/T2

Use exact T1/T2 levels and conditions in the current position's attached plan, then the matching symbol/side preparation notes when no attached target exists. Clearly label unactivated preparation suggestions. Preserve the notes' quantity basis, sequence and allocations; do not silently rescale them or invent a T1/T2 split. Account for targets already filled and only guide remaining shares. If early partials conflict with frozen allocations, describe the conflict before suggesting a plan change.

Keep the reserved position with T1/T2 **unless a very large observed order warrants an exception**. Evaluate current size relative to the plugin threshold, other nearby walls and any trader-defined very-large rule. The threshold multiple is evidence, not an automatic override. If no numeric exception rule exists, explain why the measured order is unusually large and present the earlier exit as an advisory exception with its price/size; do not silently replace T1/T2 or invent an approved threshold. Ordinary large orders alone should not divert the reserved shares.

## Account for the actual trade

Check initial quantity, current quantity, net reduction, individual partial fill quantities/prices, average partial price and working exits. `sizing.partials.fills` are post-review observations; older same-symbol fills are explicitly unverified, since broker fills have no round-trip ID. A size reduction establishes no execution price. Never count an acknowledgement, submitted order, historical fill or wall crossing as a partial. When initial size, adds/re-entry, history or baseline reconciliation is uncertain, use evidenced levels but ask only for the missing trade fact needed to size the remaining exit. If earlier reductions lack prices, say those prices are unknown; do not invent them or take the first partial again.

## Live response format

Default to a compact numbered list of remaining exit quantities and target prices, with no introduction or recap of fills. Use the initial size and partial history internally to calculate these quantities. For the mock case with 800 remaining, a 100-share early partial and 700 for the saved targets, respond:

1. 100 @ large orders 21.5-21.75
2. 700 @ T1 22 and T2 23

The first quantity is the total across the listed observed levels, not the quantity at each level. Use a price range only when it summarizes actual selected Bookmap levels. Add "large orders" as the brief inline reason when supported; avoid extra explanation of wall sizes or prior fills unless requested. Keep T1/T2 together when their individual share split is unspecified; never invent that split. Omit an exhausted early-partial line. Include a short qualifier or essential question only when missing evidence or a plan conflict changes the recommendation. If no target is evidenced, say "Target not defined". Expand reasoning or fill history only when requested.

This tool and skill are advisory; they do not activate guidance, stage, approve or submit orders.
