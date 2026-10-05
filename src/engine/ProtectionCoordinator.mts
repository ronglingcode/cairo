import type { CairoEngine } from "./CairoEngine.mts"
import type { RecoveryStore } from "./RecoveryStore.mts"
import type { ExitIntent } from "./ExitEligibility.mts"
import { supportedProtection } from "./ExitEligibility.mts"
export interface ProtectionReadback { positionId: string; symbol: string; detail: string; proposal: Omit<ExitIntent, "commandId"> | null }
export class ProtectionCoordinator {
  private engine: CairoEngine; private recovery: RecoveryStore
  private saving = false
  constructor(engine: CairoEngine, recovery: RecoveryStore) { this.engine = engine; this.recovery = recovery }
  persist(rules: import("./RecoveryStore.mts").SavedRule[]): void {
    const attachments = this.engine.getSnapshot().attachments.filter(item => item.state !== "closed")
    const activeRules = rules.filter(rule => attachments.some(item => item.id === rule.attachmentId))
    const saved = this.recovery.snapshot
    if (this.saving || JSON.stringify(saved.attachments) === JSON.stringify(attachments) && JSON.stringify(saved.rules) === JSON.stringify(activeRules)) return
    this.saving = true
    void this.recovery.change(current => ({ ...current, attachments, rules: activeRules })).catch(() => this.engine.updateSnapshot({ recoveryError: "Attached-state checkpoint failed; review before new requests" })).finally(() => { this.saving = false })
  }
  cycle(): void {
    const snapshot = this.engine.getSnapshot(); const facts = snapshot.brokerFacts
    if (!facts || snapshot.broker.state !== "connected" || !facts.ordersComplete || Date.now() - Date.parse(facts.asOf) > 60_000) return
    let changed = false
    const attachments = snapshot.attachments.map(attachment => {
      if (attachment.state !== "active" || attachment.accountId !== facts.accountId || !attachment.baseline) return attachment
      const position = facts.positions.find(item => item.positionId === attachment.positionId && item.symbol === attachment.symbol)
      const newFills = facts.recentFills.filter(fill => fill.symbol === attachment.symbol && !attachment.baseline!.fillIds.includes(fill.fillId))
      if (!position || !newFills.length || position.side !== attachment.baseline.side || position.averagePrice !== attachment.baseline.averagePrice) return attachment
      const unique = new Map(newFills.map(fill => [fill.fillId, fill]))
      if (unique.size !== newFills.length) return attachment
      const matches = [...unique.values()].map(fill => ({ fill, attempt: this.recovery.snapshot.attempts.find(item => item.ticket.accountId === facts.accountId && item.ticket.positionId === position.positionId && item.brokerOrderId === fill.orderId && item.ticket.action !== "cancel-protection" && fill.side === (position.side === "long" ? "sell" : "buy") && Date.parse(fill.filledAt) >= Date.parse(item.attemptedAt) && Date.parse(fill.filledAt) <= Date.now()) }))
      if (matches.some(item => !item.attempt) || position.quantity !== attachment.baseline.quantity - matches.reduce((sum, item) => sum + item.fill.quantity, 0)) return attachment
      const remainingAllocations = { ...(attachment.remainingAllocations ?? Object.fromEntries(attachment.interpretation.management!.allocations.map(item => [item.id, item.shares]))) }
      for (const { fill, attempt } of matches) {
        if (!Number.isSafeInteger(fill.quantity)) return attachment
        if (Object.keys(remainingAllocations).length) {
          const recommendation = snapshot.recommendations.find(item => item.id === attempt!.ticket.recommendationId)
          const rule = attachment.interpretation.management!.rules.find(item => item.id === recommendation?.ruleId)
          const allocation = rule?.action.quantity.allocationId
          if (!allocation || remainingAllocations[allocation] === undefined || remainingAllocations[allocation]! < fill.quantity) return attachment
          remainingAllocations[allocation]! -= fill.quantity
        }
      }
      changed = true
      return { ...attachment, remainingAllocations, baseline: { ...attachment.baseline, quantity: position.quantity, fillIds: [...new Set([...attachment.baseline.fillIds, ...newFills.map(fill => fill.fillId)])].slice(-500) } }
    })
    if (changed) this.engine.updateSnapshot({ attachments })
    const plans: ProtectionReadback[] = facts.positions.map(position => {
      const working = facts.workingOrders.filter(item => item.symbol === position.symbol && !["filled", "canceled", "replaced", "rejected", "expired"].includes(item.status))
      const prior = this.recovery.snapshot.attempts.filter(item => item.ticket.accountId === facts.accountId && item.ticket.symbol === position.symbol)
      const pending = prior.some(item => !["filled", "rejected", "canceled"].includes(item.state))
      const base = { accountId: facts.accountId, positionId: position.positionId, symbol: position.symbol, positionSide: position.side, factsRevision: snapshot.brokerFactsRevision, quantity: position.quantity }
      if (!Number.isSafeInteger(position.quantity) || pending) return { positionId: position.positionId, symbol: position.symbol, detail: "Wait for broker confirmation or resolve uncertain attempt before changing protection", proposal: null }
      const order = working[0]
      if (working.length > 1 || order && !supportedProtection(order, position)) return { positionId: position.positionId, symbol: position.symbol, detail: "Complex/OCO/unknown working protection requires manual resolution", proposal: null }
      if (order && order.quantity - (order.filledQuantity ?? 0) > position.quantity) {
        const orderType = order.orderType.toLowerCase().replace("_", "-") as ExitIntent["orderType"]
        const hasPrices = (orderType === "limit" ? order.limitPrice : orderType === "stop" ? order.stopPrice : order.limitPrice && order.stopPrice)
        return { positionId: position.positionId, symbol: position.symbol, detail: `Protection covers ${order.quantity - (order.filledQuantity ?? 0)} shares; only ${position.quantity} remain`, proposal: hasPrices ? { ...base, intent: "replace-protection", orderId: order.orderId, orderType, limitPrice: order.limitPrice ?? null, stopPrice: order.stopPrice ?? null, reason: "Reduce exact existing protection to remaining broker shares" } : null }
      }
      if (!order) {
        const oldStop = prior.filter(item => item.ticket.action === "cancel-protection" && item.state === "canceled").at(-1)?.ticket.affectedOrders?.find(item => item.orderType === "STOP" && item.stopPrice)
        return { positionId: position.positionId, symbol: position.symbol, detail: "No known working protection. Review the remaining position and an exact stop price", proposal: oldStop ? { ...base, intent: "close", orderType: "stop", stopPrice: oldStop.stopPrice!, reason: "Restore the previously reviewed stop price for remaining broker shares" } : null }
      }
      return { positionId: position.positionId, symbol: position.symbol, detail: "Known standalone protection is within remaining quantity", proposal: null }
    })
    if (JSON.stringify(snapshot.protectionReadback) !== JSON.stringify(plans)) this.engine.updateSnapshot({ protectionReadback: plans })
  }
}
