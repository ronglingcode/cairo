import test from "node:test"
import assert from "node:assert/strict"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
test("positions freeze different reviewed policies and ignore chart/source edits", () => {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine)
  const partial = guidance.attach(attachmentRequest(engine))
  const whole = guidance.attach(attachmentRequest(engine, 1, "whole"))
  assert.notDeepEqual(partial.interpretation.management, whole.interpretation.management)
  const before = engine.getSnapshot().attachments
  engine.updateSnapshot({ tradebooks: [], chart: null, preparation: null }); guidance.reconcile()
  assert.deepEqual(engine.getSnapshot().attachments, before)
  assert.throws(() => guidance.pause(partial.id, "stale"), /changed/)
})
test("outside fills/adds/exits pause uncertain mapping, closed/fractional positions stay manual", () => {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine)
  const attachment = guidance.attach(attachmentRequest(engine))
  const facts = engine.getSnapshot().brokerFacts
  facts.positions[0].quantity = 11; engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions, brokerFactsRevision: 2 }); guidance.reconcile()
  assert.equal(engine.getSnapshot().attachments[0].state, "paused")
  const paused = engine.getSnapshot().attachments[0]
  guidance.reconfirm(paused.id, paused.revision, 2, 11, true)
  facts.positions.splice(0, 1); engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions, brokerFactsRevision: 3 }); guidance.reconcile()
  assert.equal(engine.getSnapshot().attachments[0].state, "closed")
  facts.positions[0].quantity = .5; engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions })
  assert.throws(() => guidance.attach(attachmentRequest(engine, 1, "whole")), /fractional/)
  assert.equal(engine.getSnapshot().tickets.length, 0)
})
