import test from "node:test"
import assert from "node:assert/strict"
import { GuidanceProposals } from "../src/engine/GuidanceProposals.mts"
import { positionEngine } from "./fixtures/positions.mjs"
function setup(style = "partial") {
  const engine = positionEngine(); const book = engine.getSnapshot().tradebooks.find(book => book.id === style)
  engine.updateSnapshot({ preparation: { markdown: book.markdown, date: null, symbol: null, revision: "saved", updatedAt: new Date().toISOString() }, tradebooks: [] })
  return { engine, service: new GuidanceProposals(engine), input: { tradebookId: style, expectedPreparationRevision: "saved", expectedTradebookRevision: null, clauses: book.interpretation.clauses, management: book.interpretation.management } }
}
test("two authored styles produce review-only exact prose and bounded readback", () => {
  for (const style of ["partial", "whole"]) {
    const { engine, service, input } = setup(style); const proposal = service.propose(input, "owned")
    assert.equal(proposal.book.markdown, engine.getSnapshot().preparation.markdown)
    assert.equal(engine.getSnapshot().attachments.length, 0); assert.equal(engine.getSnapshot().tradebooks.length, 0)
  }
})
test("invented thresholds, missing quantity, partial output and stale prose fail closed", () => {
  const { service, input } = setup()
  const invented = structuredClone(input); invented.management.rules[0].condition = { kind: "compare", field: "broker.markPrice", operator: "gt", value: 99 }
  assert.throws(() => service.propose(invented, "owned"), /not present/)
  const missing = structuredClone(input); delete missing.management.rules[0].action.quantity
  assert.throws(() => service.propose(missing, "owned"))
  assert.throws(() => service.propose({ ...input, management: { version: 1 } }, "owned"))
  assert.throws(() => service.propose({ ...input, expectedPreparationRevision: "old" }, "owned"), /latest/)
  const advisory = structuredClone(input); advisory.clauses[0].coverage = "unsupported"; advisory.management.rules = []
  assert.ok(service.propose(advisory, "owned").issues.length)
})
