import { readFile } from "node:fs/promises"
import path from "node:path"
import { GuidanceProposals } from "../engine/GuidanceProposals.mts"
import type { ExitTickets } from "../engine/ExitTickets.mts"
import type { ExitIntent } from "../engine/ExitEligibility.mts"
import type { TicketPermissions, ToolSource } from "./TicketPermissions.mts"
import { randomUUID } from "node:crypto"
import { CairoEngine } from "../engine/CairoEngine.mts"
import { validateContent, type PreparationContent } from "../engine/PreparationStore.mts"
import { positionTradebook } from "../engine/TradeContext.mts"

export interface NoteProposal {
  id: string
  sessionId: string
  expectedRevision: string | null
  content: PreparationContent
  expiresAt: string
}

export class CairoDomainTools {
  private bookmapEvidence?: import("../engine/BookmapEvidence.mts").BookmapEvidence
  setBookmapEvidence(evidence: import("../engine/BookmapEvidence.mts").BookmapEvidence): void { this.bookmapEvidence = evidence }
  private bookmapPatterns?: import("../engine/BookmapPatterns.mts").BookmapPatterns
  setBookmapPatterns(patterns: import("../engine/BookmapPatterns.mts").BookmapPatterns): void { this.bookmapPatterns = patterns }
  private drafts: NoteProposal[] = []
  private readonly engine: CairoEngine
  private readonly verifySession: (id: string) => Promise<boolean>
  private readonly now: () => number
  private tickets: ExitTickets | undefined
  setExitTickets(tickets: ExitTickets): void { this.tickets = tickets }
  private permissions: TicketPermissions | undefined
  setTicketPermissions(permissions: TicketPermissions): void { this.permissions = permissions }
  cancelSession(sessionId: string): Promise<void> { return this.permissions?.cancelSession(sessionId) ?? Promise.resolve() }

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

  async execute(operation: unknown, input: unknown, sessionId: unknown, source?: ToolSource): Promise<unknown> {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200 || !await this.verifySession(sessionId)) {
      throw new Error("Cairo tool session is unavailable or belongs to another location")
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool input must be an object")
    const value = input as Record<string, unknown>
    const snapshot = this.engine.getSnapshot()
    if (operation === "read_entry_setup") {
      if(typeof value.fillId!=="string" || Object.keys(value).some(k=>k!=="fillId")) throw new Error("Fill ID required")
      const entry=snapshot.bookmapEvidence.entries.find(e=>e.fillId===value.fillId && e.accountId===snapshot.brokerFacts?.accountId)
      if(!entry) throw new Error("Frozen entry evidence unavailable for this account/fill")
      return {entry, archived:true, currentLiveTrigger:false}
    }
    if (operation === "read_bookmap_timeline" || operation === "read_setup_candidates") {
      if (!this.bookmapEvidence) throw new Error("Bookmap evidence recorder unavailable")
      if (typeof value.symbol !== "string" || Object.keys(value).some(key => !["symbol", "start", "end"].includes(key))) throw new Error("Symbol and optional nanosecond range required")
      const result = this.bookmapEvidence.timeline(value.symbol, value.start as string | undefined, value.end as string | undefined)
      const catalog = await this.bookmapPatterns?.catalog()
      const rules = catalog ? await Promise.all(catalog.filter(p => p.side === "short").map(async p => ({...p, markdown: p.sourceFile ? await readFile(path.join(this.bookmapPatterns!.directory, p.sourceFile), "utf8") : null }))) : []
      return operation === "read_setup_candidates" ? { status: {...result.status, events: undefined}, rules, parameters: snapshot.bookmapEvidence.parameters } : { ...result, rules }
    }
    if (operation === "interpret_bookmap_setup") {
      if (!this.bookmapEvidence) throw new Error("Bookmap evidence unavailable")
      if (Object.keys(value).some(key => !["setupId", "revision", "patternId", "selectedBounceId", "explanation", "evidenceIds"].includes(key))) throw new Error("Unexpected interpretation field")
      this.bookmapEvidence.analyse(value as unknown as Omit<import("../engine/BookmapEvidence.mts").SetupAnalysis, "receivedAt">, this.now())
      this.engine.updateSnapshot({bookmapEvidence:this.bookmapEvidence.snapshot()})
      return {ok:true, advisory:true}
    }
    if (operation === "interpret_bookmap_observation") {
      if (!this.bookmapEvidence) throw new Error("Bookmap evidence unavailable")
      if (Object.keys(value).some(key=>!["observationId","revision","explanation","evidenceIds"].includes(key))) throw new Error("Unexpected observation interpretation field")
      this.bookmapEvidence.analyseObservation(value as unknown as Omit<import("../engine/BookmapEvidence.mts").ObservationAnalysis,"receivedAt">,this.now())
      this.engine.updateSnapshot({bookmapEvidence:this.bookmapEvidence.snapshot()})
      return {ok:true,advisory:true,observationOnly:true}
    }
    if (operation === "read_bookmap_pattern" || operation === "read_trade_context") {
      if (!this.bookmapPatterns) throw new Error("Bookmap pattern library unavailable")
      if (Object.keys(value).some(key => key !== "positionId")) throw new Error("Unexpected pattern field")
      const selected = await this.bookmapPatterns.read(value.positionId)
      const pattern = { ...selected, inferredEntries: snapshot.bookmapEvidence.entries.filter(e=>e.accountId===snapshot.brokerFacts?.accountId && e.symbol===selected.position.symbol).slice(-5) }
      if (operation === "read_bookmap_pattern") return pattern
      const current = this.engine.getSnapshot()
      return { accountId: current.brokerFacts!.accountId, factsRevision: current.brokerFactsRevision,
        position: pattern.position, bookmapPattern: pattern, tradebook: positionTradebook(current, pattern.position) }
    }
    if (["read_context", "read_preparation", "read_positions"].includes(String(operation))) {
      if (Object.keys(value).length) throw new Error("This read tool takes no parameters")
      if (operation === "read_context") return this.context()
      if (operation === "read_preparation") return this.context().preparation
      return this.context().broker
    }
    if (operation === "propose_notes") {
      if (Object.keys(value).some(key => !["markdown", "date", "symbol", "expectedRevision"].includes(key))) throw new Error("Unexpected note proposal field")
      // Note proposals edit narrative/date/symbol, preserving the trader's explicit routing assignments.
      const content = validateContent({ ...value, tradebookAssignments: snapshot.preparation?.tradebookAssignments })
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
      if (this.permissions) return this.permissions.stage(value as unknown as ExitIntent, sessionId, source!)
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
      bookmapPatterns: {
        tags: snapshot.bookmapPatternTags.filter(tag => tag.accountId === facts?.accountId).slice(-20).map(tag => ({ ...tag, confirmed: tag.active && tag.runtimeInstanceId === snapshot.runtimeInstanceId })),
        error: snapshot.bookmapPatternError,
        pickerOpen: Boolean(snapshot.bookmapPatternPicker),
      },
      bookmapEvidence: { parameters:snapshot.bookmapEvidence.parameters, entries:snapshot.bookmapEvidence.entries.slice(-5), analyses:snapshot.bookmapEvidence.analyses.slice(-5), observationAnalyses:snapshot.bookmapEvidence.observationAnalyses.slice(-8), symbols: Object.fromEntries(Object.entries(snapshot.bookmapEvidence.symbols).slice(-8).map(([symbol,status]) => [symbol,{...status,events:[],setups:status.setups.slice(-2)}])) },
      bookmap: { status: snapshot.bookmap, ...snapshot.bookmapProjection, episodes: snapshot.bookmapProjection.episodes.slice(-20) },
      observationAttempts: snapshot.observationAttempts.slice(-5),
      capabilities: { noteProposals: true, guidanceAttachment: true, exitStaging: Boolean(this.tickets), brokerWrites: false, bookmap: "observations-only; proven live mode required" },
    }
  }
}

