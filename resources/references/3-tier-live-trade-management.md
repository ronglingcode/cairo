# 3-Tier Live Trade Management

Shared rule: every trade is managed with 3 tiers.

Each tradebook must define its own:
- reversal / invalidation signals
- runner trigger condition
- runner target

## Before Entry

Define:
- scalp: x%
- core: y%
- runner: z%
- stop
- core main target
- runner trigger condition
- runner target
- reversal / invalidation signals

## Profit Targets
Common profit targets are in the order of
1. other levels from higher timeframe (daily chart)
2. levels from intraday charts: cam pivots, premarket high/low, previous day high/low, after hour high/low.
3. other big walls from bookmap

Use the above for setting core targets and runner targets. 

## 1. Scalp

Purpose: emotion relief.

Rules:
- can exit anytime
- no strict signal required
- use this tier to reduce pressure, not the core

## 2. Core

Purpose: capture the tradebook thesis.

Default action: hold to the core main target.

Core exits only by:
- stop out
- limit fill at core main target, or slightly before it
- setup-specific reversal / invalidation signal

Actions to take if seeing reversal / invalidation signal
- trim more partials: not sure whether it will get worse, reduce some shares to allow more tolerance.
- fully exit: if seeing a very strong reversal signal.
- adjust stop: if we come to a condition that's going to make it or break it.

## 3. Runner

Purpose: capture extension after the core move.

Runner needs a tradebook-specific trigger condition that says the trade is starting to extend toward the runner target. That's usually the breakout/breakdown of 
* all time high
* high/low from a previous key event
* high/low from news to open
* final tareget of the core tier

When price approaches core targets, it's ok to partial the core tire while holding the runner tier. If seeing strong signal of core targets holding, all out on both core and runner tier. If price easiy go beyond targets or made a mini consolidation and breakout, move the stop loss of the runner to the consolidation edge and hold it to the final runner target. 

Runner exits if:
- runner trigger condition fails
- setup-specific reversal signal appears
- a large wall from bookmap that holds or price reverse after clearing that wall
- trailing structure breaks

## Simple Live Rule

Scalp is flexible.
Core follows stop / core target / reversal.
Runner follows trigger condition / runner target / reversal.
