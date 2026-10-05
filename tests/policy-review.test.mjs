import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { positionEngine } from "./fixtures/positions.mjs"
import { TradebookStore } from "../src/engine/TradebookStore.mts"
import { GuidanceProposals } from "../src/engine/GuidanceProposals.mts"
import { PolicyReview } from "../src/engine/PolicyReview.mts"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
test("review CAS preserves position guidance wording and completed actions across renaming", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo-review-"))
  try {
    const engine = positionEngine(); const source = engine.getSnapshot().tradebooks[0]
    const setNotes = markdown => engine.updateSnapshot({ preparation: { markdown, date: null, symbol: null, revision: markdown, updatedAt: new Date().toISOString() } })
    engine.updateSnapshot({ tradebooks: [source] }); setNotes(source.markdown)
    const proposals = new GuidanceProposals(engine); const guidance = new PositionGuidance(engine); const monitor = new ManagementMonitor(engine, guidance)
    const store = new TradebookStore(root, path.join(root, "source")); const review = new PolicyReview(engine, guidance, monitor)
    const propose = (clauses = source.interpretation.clauses, management = source.interpretation.management) => proposals.propose({ tradebookId: source.id, expectedPreparationRevision: engine.getSnapshot().preparation.revision, expectedTradebookRevision: engine.getSnapshot().tradebooks[0]?.revision ?? null, clauses, management }, "owned")
    const first = propose(); await assert.rejects(review.accept(first.id, true), /tradebooks are read-only/); await review.accept(first.id, true, { accountId: "fixture", positionId: "position-0", factsRevision: 1, initialQuantity: 10, reviewed: true, carryInConfirmed: true })
    assert.equal(engine.getSnapshot().attachments[0].markdown, source.markdown)
    assert.deepEqual(engine.getSnapshot().tradebooks, [source])
    assert.equal(await store.loadTradebook(source.id), null)
    let attachment = engine.getSnapshot().attachments[0]; monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
    monitor.bindSubmittedOrder(engine.getSnapshot().recommendations[0].id, "exit")
    const facts = engine.getSnapshot().brokerFacts; facts.recentFills.push({ fillId: "f", orderId: "exit", symbol: "AAA", side: "sell", quantity: 5, price: 21, filledAt: new Date().toISOString() }); engine.updateSnapshot({ brokerFacts: facts }); monitor.cycle()
    const edited = source.markdown.replace("When I confirm", "Once I confirm"); setNotes(edited)
    const clauses = structuredClone(source.interpretation.clauses); clauses[0].sourceText = clauses[0].sourceText.replace("When I confirm", "Once I confirm"); clauses[0].clauseId = "renamed"
    const policy = structuredClone(source.interpretation.management); policy.rules[0].id = "renamed"; policy.rules[0].clauseId = "renamed"
    const second = propose(clauses, policy)
    assert.equal(engine.getSnapshot().attachments[0].markdown, source.markdown)
    await review.accept(second.id, true, { accountId: "fixture", positionId: "position-0", factsRevision: 1, initialQuantity: 10, reviewed: true, carryInConfirmed: true, attachmentId: attachment.id, expectedAttachmentRevision: attachment.revision })
    assert.deepEqual(engine.getSnapshot().tradebooks, [source])
    attachment = engine.getSnapshot().attachments[0]; monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
    assert.equal(engine.getSnapshot().management[0].status, "filled"); assert.equal(engine.getSnapshot().recommendations.length, 1)
    const stale = propose(clauses, policy); setNotes(edited + " changed")
    await assert.rejects(review.accept(stale.id, true), /narrative changed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

