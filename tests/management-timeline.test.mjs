import test from "node:test"
import assert from "node:assert/strict"
import { PositionGuidance } from "../src/engine/PositionGuidance.mts"
import { ManagementMonitor } from "../src/engine/ManagementMonitor.mts"
import { ManagementTimeline } from "../src/engine/ManagementTimeline.mts"
import { positionEngine, attachmentRequest } from "./fixtures/positions.mjs"
test("repeated snapshots alert once and retain bounded visible management evidence", () => {
  const engine = positionEngine(); const guidance = new PositionGuidance(engine)
  const now = Date.parse(engine.getSnapshot().brokerFacts.asOf)
  const monitor = new ManagementMonitor(engine, guidance, () => now)
  const alerts = []; const timeline = new ManagementTimeline(engine, text => alerts.push(text))
  const attachment = guidance.attach(attachmentRequest(engine)); monitor.confirm(attachment.id, attachment.revision, 1, "trigger", true)
  for (let i = 0; i < 200; i++) { monitor.cycle(); timeline.capture() }
  assert.equal(alerts.length, 1); assert.equal(engine.getSnapshot().managementTimeline.length, 1)
  assert.equal(engine.getSnapshot().management[0].result.state, "satisfied")
})
