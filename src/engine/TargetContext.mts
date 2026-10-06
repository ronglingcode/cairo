import type { BrokerPosition, CairoSnapshot } from "../shared/contracts.mts"
import { positionTradebook } from "./TradeContext.mts"

/** Read-only arithmetic; fill prices are evidence, never inferred from quantity changes. */
export function targetPositionContext(snapshot: CairoSnapshot, position: BrokerPosition, now: number) {
  const facts = snapshot.brokerFacts!
  const { attachment } = positionTradebook(snapshot, position)
  const initial = attachment?.initialQuantity ?? null
  const remaining = position.quantity
  const recentFills = facts.recentFills.filter(f => f.symbol === position.symbol)
  // Broker fills lack position/round-trip IDs. Only post-review fills can be scoped to this baseline,
  // and even those need quantity reconciliation; older same-symbol fills are candidates only.
  const since = attachment?.reviewedAt ? Date.parse(attachment.reviewedAt) : NaN
  const seen = new Set<string>()
  const scoped = recentFills.filter(f => {
    if (seen.has(f.fillId)) return false
    seen.add(f.fillId)
    return Number.isFinite(since) && Date.parse(f.filledAt) > since && Date.parse(f.filledAt) <= Date.parse(facts.asOf) &&
      !attachment?.baseline?.fillIds.includes(f.fillId)
  })
  const exitSide = position.side === "long" ? "sell" : "buy"
  const exits = scoped.filter(f => f.side === exitSide)
  const adds = scoped.filter(f => f.side !== exitSide)
  const exitQuantity = exits.reduce((n,f) => n + f.quantity, 0)
  const initialKnown = Number.isSafeInteger(initial) && initial! >= remaining && Number.isSafeInteger(remaining) && remaining > 0
  const reduction = initialKnown ? initial! - remaining : null
  const baseline = attachment?.baseline
  const reconciled = baseline?.side === position.side && baseline.averagePrice === position.averagePrice &&
    baseline.quantity - exitQuantity === remaining && adds.length === 0
  const brokerAgeMs = now - Date.parse(facts.asOf)
  const fresh = facts.source.state === "connected" && snapshot.broker.state === "connected" && brokerAgeMs >= 0 && brokerAgeMs <= 60_000
  const allocationAvailable = fresh && initialKnown && reconciled && attachment?.state === "active"
  const reserve = allocationAvailable ? Math.ceil(initial! * .7) : null
  const maxEarly = allocationAvailable ? Math.floor(initial! * .3) : null
  return {
    initialQuantity: initial, remainingQuantity: remaining, netReductionFromInitial: reduction,
    allocationAvailable, brokerFresh: fresh, factsAsOf: facts.asOf,
    reason: allocationAvailable ? null : "Need fresh broker facts and an active reviewed initial-size baseline reconciled without adds or unexplained size changes",
    partials: { observedSince: attachment?.reviewedAt ?? null, fills: exits, quantity: exitQuantity,
      averagePrice: exitQuantity ? exits.reduce((n,f) => n + f.quantity * f.price, 0) / exitQuantity : null,
      reconciledToBaseline: reconciled, earlierSameSymbolFills: recentFills.filter(f => !scoped.some(s => s.fillId === f.fillId)).slice(-20),
      earlierFillScope: "Unverified current-trade association; never count these automatically" },
    earlyPartial: { basis: "initial", range: [.1, .3], minimumTotalShares: allocationAvailable ? Math.ceil(initial! * .1) : null,
      maximumTotalShares: maxEarly, alreadyReducedShares: reduction,
      additionalSharesToMinimum: allocationAvailable ? Math.max(0, Math.ceil(initial! * .1) - reduction!) : null,
      additionalSharesAllowed: allocationAvailable ? Math.max(0, Math.min(maxEarly! - reduction!, remaining - reserve!)) : null },
    plannedTargets: { minimumReservedShares: reserve, currentRemainingShares: remaining,
      allocation: "Keep exact T1/T2 quantities and their initial/remaining basis from notes; do not invent a split" },
    workingExitOrders: facts.workingOrders.filter(o => o.symbol === position.symbol && o.side === exitSide),
  }
}
