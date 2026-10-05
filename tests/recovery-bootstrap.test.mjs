import test from "node:test"
import assert from "node:assert/strict"
import { writerFixture } from "./exit-writer.test.mjs"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { RecoveryBootstrap } from "../src/engine/RecoveryBootstrap.mts"
import { attachmentRequest } from "./fixtures/positions.mjs"
test("restart discards drafts/approvals and restores frozen guidance paused, with uncertainty blocking resume", async t => {
  const f = await writerFixture(t, new Error("timeout")); const guidance = new PositionGuidance(f.engine); const monitor = new ManagementMonitor(f.engine, guidance)
  const attachment = guidance.attach(attachmentRequest(f.engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  const ticket = f.tickets.stage(f.intent("restart-001"), "trader"); f.tickets.approve(ticket.id, ticket.reviewHash); await f.writer.submit(ticket.id, ticket.reviewHash)
  await f.recovery.change(current => ({ ...current, attachments: f.engine.getSnapshot().attachments, rules: monitor.checkpointState() }))
  const bootstrap = new RecoveryBootstrap(f.engine, f.recovery, monitor); bootstrap.cycle()
  assert.equal(f.engine.getSnapshot().tickets.length, 0); assert.equal(f.engine.getSnapshot().recommendations.length, 0); assert.equal(f.engine.getSnapshot().attachments[0].state, "paused")
  assert.throws(() => guidance.reconfirm(attachment.id, attachment.revision, 1, 10, true), /uncertain/)
  await f.recovery.updateAttempt(ticket.id, { state: "filled", filledQuantity: 5 }); f.engine.updateSnapshot({ brokerAttempts: f.recovery.snapshot.attempts })
  const facts = f.engine.getSnapshot().brokerFacts; facts.positions[0].quantity = 5; f.engine.updateSnapshot({ brokerFacts: facts, positions: facts.positions })
  guidance.reconfirm(attachment.id, attachment.revision, 1, 10, true); assert.equal(f.engine.getSnapshot().attachments[0].state, "active")
  assert.equal(f.writes.length, 1)
})
test("closed holdings stay closed and pending checkpoints remain observer-only", async t => {
  const f = await writerFixture(t); const guidance = new PositionGuidance(f.engine); const monitor = new ManagementMonitor(f.engine, guidance)
  guidance.attach(attachmentRequest(f.engine)); await f.recovery.change(current => ({ ...current, attachments: f.engine.getSnapshot().attachments, rules: [] }))
  const bootstrap = new RecoveryBootstrap(f.engine, f.recovery, monitor); const facts = f.engine.getSnapshot().brokerFacts; facts.positions = []; f.engine.updateSnapshot({ brokerFacts: facts, positions: [] }); bootstrap.cycle()
  assert.equal(f.engine.getSnapshot().attachments[0].state, "closed"); assert.equal(f.writes.length, 0)
})
