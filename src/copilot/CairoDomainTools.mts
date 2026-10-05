import { GuidanceProposals } from "../engine/GuidanceProposals.mts"
import type { ExitTickets } from "../engine/ExitTickets.mts"
import type { ExitIntent } from "../engine/ExitEligibility.mts"
import { randomUUID } from "node:crypto"
import { CairoEngine } from "../engine/CairoEngine.mts"
import { validateContent, type PreparationContent } from "../engine/PreparationStore.mts"

export interface NoteProposal {
  id: string
  sessionId: string
  expectedRevision: string | null
  content: PreparationContent
  expiresAt: string
}

export class CairoDomainTools {
  private drafts: NoteProposal[] = []
  private readonly engine: CairoEngine
  private readonly verifySession: (id: string) => Promise<boolean>
  private readonly now: () => number
  private tickets: ExitTickets | undefined
  setExitTickets(tickets: ExitTickets): void { this.tickets = tickets }

  constructor(engine: CairoEngine, verifySession: (id: string) => Promise<boolean>, now: () => number = Date.now) {
    this.engine = engine
    this.verifySession = verifySession
    this.now = now
  }

  get proposals(): NoteProposal[] {
    this.drafts = this.drafts.filter(value => Date.parse(value.expiresAt) > this.now())
    return structuredClone(this.drafts)
  }
  removeProposal(id: string): void { this.drafts = this.drafts.filter(item => item.id !== id); this.engine.updateSnapshot({ noteProposals: this.proposals }) }

  async execute(operation: unknown, input: unknown, sessionId: unknown): Promise<unknown> {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200 || !await this.verifySession(sessionId)) {
      throw new Error("Cairo tool session is unavailable or belongs to another location")
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool input must be an object")
    const value = input as Record<string, unknown>
    const snapshot = this.engine.getSnapshot()
    if (["read_context", "read_preparation", "read_positions"].includes(String(operation))) {
      if (Object.keys(value).length) throw new Error("This read tool takes no parameters")
      if (operation === "read_context") return this.context()
      if (operation === "read_preparation") return this.context().preparation
      return this.context().broker
    }
    if (operation === "propose_notes") {
      if (Object.keys(value).some(key => !["markdown", "date", "symbol", "expectedRevision"].includes(key))) throw new Error("Unexpected note proposal field")
      const content = validateContent(value)
      if (value.expectedRevision !== (snapshot.preparation?.revision ?? null)) throw new Error("Preparation revision changed; read the current notes before proposing edits")
      if (snapshot.preparationError) throw new Error("Saved preparation must be repaired before proposing edits")
      const draft: NoteProposal = { id: randomUUID(), sessionId, expectedRevision: value.expectedRevision as string | null, content, expiresAt: new Date(this.now() + 5 * 60_000).toISOString() }
      this.drafts = [...this.proposals, draft].slice(-20)
      this.engine.updateSnapshot({ noteProposals: this.proposals })
      return { available: true, proposal: draft, applied: false, review: "Proposal only. Notes have not been saved and no position guidance has changed." }
    }
    if (operation === "propose_guidance") return { available: true, applied: false, proposal: new GuidanceProposals(this.engine, this.now).propose(value, sessionId) }
    if (operation === "stage_exit") {
      if (!["close", "cancel-protection", "replace-protection"].includes(String(value.intent))) throw new Error("Cairo permits exit/protection proposals only; opening, increasing, and reversing are rejected")
      if (this.tickets) return { available: true, submitted: false, ticket: this.tickets.stage(value as unknown as ExitIntent, "copilot") }
      if (typeof value.symbol !== "string" || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(value.symbol)) throw new Error("Exit symbol is invalid")
      if (value.quantity !== undefined && (typeof value.quantity !== "number" || !Number.isSafeInteger(value.quantity) || value.quantity <= 0)) throw new Error("Exit quantity must be positive whole shares")
      return { available: false, reason: "Exact exit tickets and approvals are not implemented yet. No broker request was staged or sent." }
    }
    throw new Error("Unknown Cairo tool")
  }

  context() {
    const snapshot = this.engine.getSnapshot()
    const facts = snapshot.brokerFacts
    return {
      asOf: new Date(this.now()).toISOString(),
      runtimeInstanceId: snapshot.runtimeInstanceId,
      sequence: snapshot.sequence,
      preparation: snapshot.preparation ? {
        ...snapshot.preparation, markdown: snapshot.preparation.markdown.slice(0, 12_000),
        truncated: snapshot.preparation.markdown.length > 12_000, error: snapshot.preparationError,
      } : { available: false, error: snapshot.preparationError },
      chart: snapshot.chart ? {
        symbol: snapshot.chart.symbol, interval: "1m", fetchedAt: snapshot.chart.fetchedAt,
        latestBarAt: snapshot.chart.latestBarAt, source: snapshot.chart.source,
        snapshotOnly: true, livePriceAvailable: false,
        totalBars: snapshot.chart.bars.length, bars: snapshot.chart.bars.slice(-120),
        truncated: snapshot.chart.bars.length > 120,
      } : { available: false, snapshotOnly: true, livePriceAvailable: false },
      broker: {
        status: snapshot.broker, factsRevision: snapshot.brokerFactsRevision,
        accountId: facts?.accountId ?? null, asOf: facts?.asOf ?? null, ordersComplete: facts?.ordersComplete ?? false,
        positions: snapshot.positions.slice(0, 20), workingOrders: facts?.workingOrders.slice(0, 40) ?? [],
        recentFills: facts?.recentFills.slice(-20) ?? [],
        truncated: snapshot.positions.length > 20 || (facts?.workingOrders.length ?? 0) > 40 || (facts?.recentFills.length ?? 0) > 20,
      },
      attachments: snapshot.attachments.slice(0, 10).map(attachment => ({
        id: attachment.id, accountId: attachment.accountId, positionId: attachment.positionId,
        symbol: attachment.symbol, state: attachment.state, tradebookRevision: attachment.tradebookRevision,
        narrativeHash: attachment.narrativeHash, revision: attachment.revision, initialQuantity: attachment.initialQuantity,
        markdown: attachment.markdown?.slice(0, 4000), interpretation: attachment.interpretation,
      })),
      recommendations: snapshot.recommendations.slice(-20),
      capabilities: { noteProposals: true, guidanceAttachment: true, exitStaging: Boolean(this.tickets), brokerWrites: false, bookmap: "planned-final-phase" },
    }
  }
}

