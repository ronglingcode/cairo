# Trader-authored management guidelines

October 4, 2026. Planning only. The user confirmed that traders provide management guidelines in human language and Cairo enforces them, with different styles for different setups. This replaces choosing between personal scalp/core/runner presets and generic partial/breakeven presets. Read [PLAN-DECISIONS.md](PLAN-DECISIONS.md) for other confirmed and pending choices.

Use [CODING-PLAN.md](CODING-PLAN.md) for the final artifact/activation defaults and ordered implementation tasks. The discussion-stage format questions below are resolved there as Markdown narrative plus a reviewed internal JSON interpretation and explicit per-position attachment.

## Product contract

Each setup's tradebook contains the trader's management narrative. The trader can write it directly or develop it with the Cairo copilot. The original wording remains visible alongside Cairo's interpretation. Traders do not need to write YAML, JSON, code, or learn a rule language.

Cairo proposes a reviewed, executable interpretation of that narrative. At attachment/activation, bind it to the actual trade's symbol, side, position, levels, and account. The resulting per-trade snapshot governs management. A setup can use one position, partial exits, several allocations, time-based exits, price/indicator conditions, Bookmap events, or combinations where implemented. No strategy example supplies hidden defaults, and tiers or R multiples are required only when the trader asks for them.

The confirmed decisions are the source/flexibility of management policy and the MVP execution boundary: observer entries and exits up to assistant. The selected OpenCode copilot interprets guidelines; the live engine monitors supported, reviewed rules and stages exit proposals. The final handoff uses Markdown narrative, a clause-linked reviewed JSON interpretation, and explicit per-position attachment. Assisted entries and automated management are deferred.

## From language to an active policy

1. **Describe.** Read the management section for the selected setup and any explicit trade-specific instructions. Retain the original clauses; a model summary must not silently replace the trader's wording.
2. **Interpret.** The OpenCode copilot, through the Cairo plugin, proposes conditions and actions using the engine's available features/actions. Associate every proposed rule with its source clause. It can suggest alternatives but cannot invent a threshold, quantity, stop change, or default breakeven policy and activate it.
3. **Clarify.** Show material gaps in context. “Take some off” needs a quantity basis. “When it looks weak” needs an agreed observation, a trader confirmation, or an explicit advisory interpretation. “Below the low” needs which low, when it is bound, and whether a trade-price touch or candle close counts. Ask only for information needed by the requested behavior.
4. **Review.** Show the trader a concise readback: what will be watched, what Cairo will recommend or stage, and which clauses remain unresolved. Engine validation establishes whether the interpretation is supported; it does not establish that the interpretation matches the trader's intent. The trader confirms that intent before attaching it for monitoring. This confirmation grants no broker-action approval.
5. **Attach and enforce.** Bind the confirmed interpretation to the current position/plan. The engine evaluates it against current market, Bookmap, and broker facts and recommends or stages an exact exit/protection ticket. Human approval is required before each broker mutation.
6. **Revise.** A conversation or file edit creates a proposed change. Show the effect on the open trade, validate against current orders/quantity, and require review/rearm before replacing the active snapshot. Completed actions are not made eligible again simply because wording or a rule ID changed.

Editing a setup's guidelines changes future proposed attachments. It does not silently replace rules on existing positions. A trade-specific override is explicit and reviewed together with the setup guidance.

## Small enforcement representation

Keep this an internal contract rather than a trader-facing authoring format. Implement only fields needed by the actual guidelines and supported order shapes.

| Information | Purpose |
| --- | --- |
| Setup/revision, original clause, interpretation | Preserve which trader instructions govern the trade |
| Condition, observation source, timing | Define touch versus closed candle, relevant Bookmap event, freshness, and time window |
| Bound values | Establish named levels and whether they are fixed or intentionally updated; retain original risk only if used |
| Action and quantity basis | Identify stop change/partial/full exit and initial filled quantity versus current remaining quantity, with whole-share rounding where needed |
| Trigger state | Specify once-per-trade, recurrence/rearm, and pending/completed handling |
| Dependencies and precedence | Resolve conflicting clauses and order-dependent actions without exceeding available quantity |
| Coverage and mode | Show monitorable, human-confirmed, advisory, or unsupported clauses and whether an exact exit ticket can be staged for approval |

Coverage applies to each clause. Unresolved mandatory conditions prevent that dependent action from becoming an actionable ticket. Supported independent rules can still be reviewed and enabled for monitoring while remaining clauses stay visible. Never display the whole guideline as enforced if part of it is advisory or unsupported. Monitoring does not authorize submitting a request.

This is not arbitrary AI-generated JavaScript or a universal natural-language strategy compiler. New supported observations/actions are added when a trader's chosen guideline requires them; the supported set must not be confused with a fixed catalog of trading styles.

## Qualitative judgment and the agent harness

The OpenCode copilot performs interpretation, asks relevant clarification, explains live evidence, and proposes changes. A meaningful new event can prompt a fresh qualitative assessment. The engine supplies current bounded facts and validates any resulting action ticket.

For the first MVP, reviewed observable conditions are monitored continuously; qualitative judgments without agreed observable criteria produce advisory assessments or exit proposals for human review. Both paths require exact human approval before a broker mutation. A model saying “weakness confirmed”, an accepted guideline, or a fired deterministic rule is not an order approval. Automated management is deferred.

The deterministic monitoring path does not wait for OpenCode on each tick. If the model is unavailable, confirmed rules keep monitoring and can stage supported proposals; qualitative assessment is marked unavailable. Missing required feed evidence is unknown, not a satisfied condition. A stop adjustment still waits for exact human approval.

The MVP chart is a Massive REST one-minute snapshot and can be stale; Cairo has no independent Massive WebSocket. Keep chart-derived context tagged with fetch/bar times. It cannot prove a live target touch, candle crossing, or current quote. Bookmap event evidence and broker facts can support their own clauses, but a pattern's reference price is not a continuous price feed. If a guideline needs unavailable fresh data, show that gap rather than reporting it enforced. Supported explicit trader-requested exits based on current broker facts can still proceed through approval even when the chart is stale. Sharing raw market data from Bookmap is deferred.

## Different setups, different behavior

Illustrative language examples for the authoring workflow, not recommended trading strategies or installed defaults:

- **Setup A:** “At the first target, sell half of my initially filled shares once. After that exit fills, move the remaining stop to my entry price.” Cairo clarifies the target, quantity/rounding, meaning of entry price, and supported order transition. Reaching the target, accepting an order, and filling it are separate facts. In the MVP, the partial exit and subsequent fill-dependent stop change each require a separate exact approval; the guideline does not authorize automatic chaining.
- **Setup B:** “Keep the whole position while the bid support holds. Exit if the support breaks; do not move the stop to breakeven just because price advances.” Cairo clarifies support identity and the observable definition of a break. If Bookmap does not export the needed evidence, it shows that gap rather than replacing the condition with a candle or generic R rule.

These positions can coexist under different attached policies. Changing chart focus or the copilot's currently discussed setup cannot change either position's management style.

## Modes, broker state, and minimal persistence

Entries are observer-only: Cairo detects/recommends and traders enter through their existing platform. For existing positions, observer mode monitors the attached guideline and recommends; exit assistant prepares supported exact partial/full-close or protective exit-order tickets. Every submit/cancel/replace requires approval of that request. Confirming the interpretation grants no action authority. There are no assisted entries or automatic exits in this MVP.

Current Schwab quantity/working orders/fills remain authoritative. Reserve pending actions, account for outside fills, and understand existing stop/OCO relationships before changing orders. Engine checks reject opening/increasing/reversing requests regardless of approval or tool permission; exit classification uses the actual position, not BUY/SELL alone. A touched target is not a fill. An unknown submission is reconciled without a blind retry. These execution mechanics are shared across styles; they do not dictate the style.

Save the authored narrative and its accepted interpretation with the current tradebook/plan. Save the attached active snapshot and only essential nonrecoverable rule state in the existing small recovery checkpoint. Live evidence, drafts, and chat need no Cairo database. Restart returns unarmed and reviews attachments against fresh broker facts.

## Acceptance for the implementation handoff

- Two setups with different human-language guidelines produce different reviewed policies; no generic partial/breakeven/tier behavior is inserted.
- Every executable rule traces to a source clause; material ambiguity and unavailable observations are visible before arming.
- The same confirmed policy produces recommendations or approved exit/protection tickets according to mode; entry writes and automatic actions are rejected.
- A partial-exit instruction respects its declared quantity basis and fill-dependent follow-up; repeated evidence does not duplicate it.
- Edits, model stalls, chart focus changes, outside fills, and restart cannot silently change or rearm a position's policy.

Use small synthetic/fake feed and broker cases, not a recording/replay framework. Exact initial trader examples and added supported predicates are selected during setup coauthoring.
