import type { CairoEngine } from "./CairoEngine.mts"
import { PositionGuidance, type AttachRequest } from "./PositionGuidance.mts"
import { ManagementMonitor } from "./ManagementMonitor.mts"
export class PolicyReview {
  private engine: CairoEngine; private guidance: PositionGuidance; private monitor: ManagementMonitor
  private operation: Promise<unknown> = Promise.resolve()
  constructor(engine: CairoEngine, guidance: PositionGuidance, monitor: ManagementMonitor) { this.engine = engine; this.guidance = guidance; this.monitor = monitor }
  reject(id: string): void { this.engine.updateSnapshot({ guidanceProposals: this.engine.getSnapshot().guidanceProposals.filter(item => item.id !== id) }) }
  accept(id: string, reviewed: boolean, request?: AttachRequest & { attachmentId?: string; expectedAttachmentRevision?: string }): Promise<void> {
    const result = this.operation.catch(() => {}).then(async () => {
      const snapshot = this.engine.getSnapshot(); const proposal = snapshot.guidanceProposals.find(item => item.id === id)
      if (!proposal || reviewed !== true || Date.parse(proposal.expiresAt) <= Date.now() || snapshot.preparation?.revision !== proposal.expectedPreparationRevision || (snapshot.tradebooks.find(book => book.id === proposal.book.id)?.revision ?? null) !== proposal.expectedTradebookRevision) throw new Error("Proposal expired or narrative changed; request a current interpretation")
      if (!request) throw new Error("Select a position to attach preparation guidance; tradebooks are read-only")
      const attachment = request?.attachmentId ? snapshot.attachments.find(item => item.id === request.attachmentId && item.revision === request.expectedAttachmentRevision) : undefined
      if (request?.attachmentId && !attachment) throw new Error("Attached policy revision changed")
      const migrate = attachment ? this.monitor.prepareReplacement(attachment, proposal.book.interpretation!) : () => {}
      const book = proposal.book
      const current = { ...request, tradebookId: book.id, tradebookRevision: book.revision }
      if (attachment) this.guidance.replace(attachment.id, request.expectedAttachmentRevision!, current, book)
      else this.guidance.attachPolicy(current, book)
      migrate(); this.monitor.cycle()
      this.reject(id)
    }); this.operation = result; return result
  }
}
