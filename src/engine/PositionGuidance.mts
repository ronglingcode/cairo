import { createHash, randomUUID } from "node:crypto"
import type { CairoEngine } from "./CairoEngine.mts"
import type { BrokerPosition, PositionAttachment } from "../shared/contracts.mts"
import { validateManagementPolicy } from "./ManagementPolicy.mts"

export interface AttachRequest {
  accountId: string; positionId: string; tradebookId: string; tradebookRevision: string
  factsRevision: number; initialQuantity: number; reviewed: boolean; carryInConfirmed: boolean
}
export class PositionGuidance {
  private readonly engine: CairoEngine
  private readonly now: () => number
  constructor(engine: CairoEngine, now: () => number = Date.now) { this.engine = engine; this.now = now }
  currentPosition(accountId: string, positionId: string, factsRevision: number): BrokerPosition {
    const snapshot = this.engine.getSnapshot()
    const facts = snapshot.brokerFacts
    const age = facts ? this.now() - Date.parse(facts.asOf) : Infinity
    if (!facts || facts.accountId !== accountId || snapshot.brokerFactsRevision !== factsRevision || snapshot.broker.state !== "connected" || facts.source.state !== "connected" || !Number.isFinite(age) || age < 0 || age > 60_000) throw new Error("Current matching broker facts are required; refresh and review again")
    const position = facts.positions.find(value => value.positionId === positionId)
    if (!position || !Number.isSafeInteger(position.quantity) || position.quantity <= 0) throw new Error("Position is absent or fractional; manage it manually")
    return position
  }
  attach(request: AttachRequest): PositionAttachment {
    if (request.reviewed !== true || request.carryInConfirmed !== true) throw new Error("Explicit guidance and current-position context review are required")
    const position = this.currentPosition(request.accountId, request.positionId, request.factsRevision)
    if (!Number.isSafeInteger(request.initialQuantity) || request.initialQuantity < position.quantity) throw new Error("Confirm the actual initial filled whole-share quantity")
    const snapshot = this.engine.getSnapshot()
    if (snapshot.attachments.some(value => value.accountId === request.accountId && value.positionId === position.positionId && value.state !== "closed")) throw new Error("Position already has guidance; review a position-policy replacement")
    const book = snapshot.tradebooks.find(value => value.id === request.tradebookId && value.revision === request.tradebookRevision)
    if (!book?.interpretation?.management) throw new Error("Current interpreted tradebook is required")
    const checked = validateManagementPolicy(book.interpretation.management, book.interpretation, book.markdown)
    if (!checked.monitorable) throw new Error("Mandatory guidance is unresolved or no supported rules exist")
    this.checkAllocations(checked.policy.allocations, position.quantity)
    const attachment: PositionAttachment = {
      id: randomUUID(), accountId: request.accountId, positionId: position.positionId, symbol: position.symbol,
      tradebookId: book.id, tradebookRevision: book.revision, narrativeHash: book.contentHash,
      interpretation: structuredClone(book.interpretation), markdown: book.markdown, state: "active",
      revision: randomUUID(), initialQuantity: request.initialQuantity, baseline: this.baseline(position),
      reviewedAt: new Date(this.now()).toISOString(), pauseReason: null,
    }
    this.engine.updateSnapshot({ attachments: [...snapshot.attachments, attachment] })
    return structuredClone(attachment)
  }
  pause(id: string, expectedRevision: string): void {
    this.change(id, expectedRevision, attachment => ({ ...attachment, state: "paused", pauseReason: "Paused by trader", revision: randomUUID() }))
  }
  reconfirm(id: string, expectedRevision: string, factsRevision: number, initialQuantity: number, reviewed: boolean): void {
    if (reviewed !== true) throw new Error("Current position and allocations must be reviewed")
    this.change(id, expectedRevision, attachment => {
      const position = this.currentPosition(attachment.accountId, attachment.positionId, factsRevision)
      if (!Number.isSafeInteger(initialQuantity) || initialQuantity < position.quantity) throw new Error("Initial quantity is invalid")
      const checked = validateManagementPolicy(attachment.interpretation.management, attachment.interpretation, attachment.markdown!)
      this.checkAllocations(checked.policy.allocations, position.quantity)
      return { ...attachment, state: "active", baseline: this.baseline(position), initialQuantity, revision: randomUUID(), pauseReason: null, reviewedAt: new Date(this.now()).toISOString() }
    })
  }
  reconcile(): void {
    const snapshot = this.engine.getSnapshot()
    if (!snapshot.brokerFacts || snapshot.broker.state !== "connected") return
    let changed = false
    const attachments = snapshot.attachments.map(attachment => {
      if (attachment.state !== "active" || attachment.accountId !== snapshot.brokerFacts!.accountId || !attachment.baseline) return attachment
      const position = snapshot.brokerFacts!.positions.find(value => value.positionId === attachment.positionId && value.symbol === attachment.symbol)
      const baseline = attachment.baseline
      const newFills = snapshot.brokerFacts!.recentFills.some(fill => fill.symbol === attachment.symbol && !baseline.fillIds.includes(fill.fillId))
      if (!position || position.quantity !== baseline.quantity || position.averagePrice !== baseline.averagePrice || position.side !== baseline.side || newFills) {
        changed = true
        return { ...attachment, state: position ? "paused" as const : "closed" as const, revision: randomUUID(), pauseReason: position ? "Broker position/fills changed; review quantity and allocation mapping" : "Position is no longer held" }
      }
      return attachment
    })
    if (changed) this.engine.updateSnapshot({ attachments })
  }
  private checkAllocations(allocations: Array<{ shares: number; remainder: boolean }>, quantity: number): void {
    if (allocations.length && allocations.reduce((sum, value) => sum + value.shares, 0) !== quantity) throw new Error("Reviewed allocation shares must sum to current broker quantity")
  }
  private baseline(position: BrokerPosition): NonNullable<PositionAttachment["baseline"]> {
    return { quantity: position.quantity, averagePrice: position.averagePrice, side: position.side, fillIds: this.engine.getSnapshot().brokerFacts!.recentFills.filter(fill => fill.symbol === position.symbol).map(fill => fill.fillId) }
  }
  private change(id: string, expectedRevision: string, apply: (value: PositionAttachment) => PositionAttachment): void {
    const snapshot = this.engine.getSnapshot()
    const attachment = snapshot.attachments.find(value => value.id === id)
    if (!attachment || attachment.revision !== expectedRevision || attachment.state === "closed") throw new Error("Position guidance changed; reload before reviewing")
    this.engine.updateSnapshot({ attachments: snapshot.attachments.map(value => value.id === id ? apply(value) : value) })
  }
}
export function policyRevision(attachment: PositionAttachment): string { return createHash("sha256").update(JSON.stringify(attachment.interpretation)).digest("hex") }
