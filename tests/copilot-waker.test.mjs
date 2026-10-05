import test from "node:test"
import assert from "node:assert/strict"
import { CopilotWaker } from "../src/copilot/CopilotWaker.mts"
import { positionEngine } from "./fixtures/positions.mjs"
test("meaningful changes coalesce, repeated polls do not wake, cancel/failure pauses", async () => {
  const engine = positionEngine(); let now = Date.now(); const inputs = []
  const chat = { snapshot: { connected: true, busy: false, outcome: null }, notify: async text => inputs.push(text) }
  const waker = new CopilotWaker(engine, chat, () => now); waker.setEnabled(true)
  const change = quantity => { const facts = engine.getSnapshot().brokerFacts; facts.positions[0].quantity = quantity; facts.asOf = new Date(now).toISOString(); engine.updateSnapshot({ brokerFacts: facts }); waker.cycle() }
  change(9); await new Promise(resolve => setImmediate(resolve)); assert.equal(inputs.length, 1)
  for (let i = 0; i < 100; i++) waker.cycle(); assert.equal(inputs.length, 1)
  chat.snapshot.busy = true; change(8); change(7); now += 15_000; waker.cycle(); assert.equal(inputs.length, 1)
  chat.snapshot.busy = false; waker.cycle(); await new Promise(resolve => setImmediate(resolve)); assert.equal(inputs.length, 2); assert.match(inputs[1], /"quantity":7/)
  chat.snapshot.outcome = "interrupted"; change(6); assert.equal(engine.getSnapshot().copilotWake.enabled, false)
  chat.snapshot.outcome = null; chat.notify = async () => { throw new Error("uncertain") }; waker.setEnabled(true); now += 15_000; change(5)
  await new Promise(resolve => setImmediate(resolve)); assert.equal(engine.getSnapshot().copilotWake.enabled, false); assert.equal(engine.getSnapshot().tickets.length, 0)
})
