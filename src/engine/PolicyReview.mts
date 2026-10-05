import type { CairoEngine } from "./CairoEngine.mts"
import { TradebookStore } from "./TradebookStore.mts"
import { PositionGuidance, type AttachRequest } from "./PositionGuidance.mts"
import { ManagementMonitor } from "./ManagementMonitor.mts"
export class PolicyReview {
  private engine: CairoEngine; private store: TradebookStore; private guidance: PositionGuidance; private monitor: ManagementMonitor
  private operation: Promise<unknown> = Promise.resolve()
  constructor(engine: CairoEngine, store: TradebookStore, guidance: PositionGuidance, monitor: ManagementMonitor) { this.engine = engine; this.store = store; this.guidance = guidance; this.monitor = monitor }
  reject(id: string): void { this.engine.updateSnapshot({ guidanceProposals: this.engine.getSnapshot().guidanceProposals.filter(item => item.id !== id) }) }
  accept(id: string, reviewed: boolean, request?: AttachRequest & { attachmentId?: string; expectedAttachmentRevision?: string }): Promise<void> {
    const result = this.operation.catch(() => {}).then(async () => {
      const snapshot = this.engine.getSnapshot(); const proposal = snapshot.guidanceProposals.find(item => item.id === id)
      if (!proposal || reviewed !== true || Date.parse(proposal.expiresAt) <= Date.now() || snapshot.preparation?.revision !== proposal.expectedPreparationRevision || (snapshot.tradebooks.find(book => book.id === proposal.book.id)?.revision ?? null) !== proposal.expectedTradebookRevision) throw new Error("Proposal expired or narrative changed; request a current interpretation")
      const attachment = request?.attachmentId ? snapshot.attachments.find(item => item.id === request.attachmentId && item.revision === request.expectedAttachmentRevision) : undefined
      if (request?.attachmentId && !attachment) throw new Error("Attached policy revision changed")
      const migrate = attachment ? this.monitor.prepareReplacement(attachment, proposal.book.interpretation!) : () => {}
      if (request) {
        const isolated = { getSnapshot: () => ({ ...snapshot, tradebooks: [...snapshot.tradebooks.filter(book => book.id !== proposal.book.id), proposal.book], attachments: snapshot.attachments.filter(item => item.id !== attachment?.id) }), updateSnapshot: () => {} } as unknown as CairoEngine
        new PositionGuidance(isolated).attach({ ...request, tradebookId: proposal.book.id, tradebookRevision: proposal.book.revision })
      }
      this.store.stageDraft({ ...proposal.book, interpretation: proposal.book.interpretation! })
      const book = await this.store.activateDraft(proposal.book.id, proposal.expectedTradebookRevision)
      // Disk I/O may overlap a broker/preparation refresh: preserve the artifact, never install stale policy.
      this.engine.updateSnapshot({ tradebooks: [...this.engine.getSnapshot().tradebooks.filter(item => item.id !== book.id), book] })
      if (this.engine.getSnapshot().preparation?.revision !== proposal.expectedPreparationRevision) throw new Error("Saved artifact; narrative changed during save. Review again before attaching")
      if (request) {
        const current = { ...request, tradebookId: book.id, tradebookRevision: book.revision }
        if (attachment) this.guidance.replace(attachment.id, request.expectedAttachmentRevision!, current)
        else this.guidance.attach(current)
        migrate(); this.monitor.cycle()
      }
      this.reject(id)
    }); this.operation = result; return result
  }
}
