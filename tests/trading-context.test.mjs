import test from "node:test"
import assert from "node:assert/strict"
import { injectTradingContext, CONTEXT_PREFIX, MAX_CONTEXT_CHARACTERS } from "../src/copilot/TradingContext.mts"

test("context hook replaces its prior injection and rejects slow/stale reads", async () => {
  const now = Date.parse("2026-10-04T00:00:00Z")
  const input = { sessionID: "owned", system: [{ type: "text", text: "Other instructions" }, { type: "text", text: CONTEXT_PREFIX + "old" }] }
  await injectTradingContext(input, async id => ({ asOf: new Date(now).toISOString(), session: id, preparation: { markdown: "current" } }), () => now)
  assert.equal(input.system.length, 2)
  assert.ok(input.system[1].text.includes("current"))
  assert.ok(!input.system[1].text.includes(CONTEXT_PREFIX + "old"))
  await assert.rejects(injectTradingContext(input, async () => ({ asOf: new Date(now - 20_000).toISOString() }), () => now), /unavailable/)
  await assert.rejects(injectTradingContext(input, async () => { throw new Error("foreign session") }), /foreign session/)
})

test("context budget retains timestamps and explicitly truncates detail", async () => {
  const input = { sessionID: "owned", system: [] }
  const asOf = new Date().toISOString()
  await injectTradingContext(input, async () => ({ asOf, chart: { fetchedAt: asOf, bars: Array(120).fill({ value: "x".repeat(500) }) }, preparation: { revision: "same", markdown: "x".repeat(12000) } }))
  assert.ok(input.system[0].text.length <= MAX_CONTEXT_CHARACTERS)
  assert.ok(input.system[0].text.includes('"truncated":true'))
  assert.ok(input.system[0].text.includes(asOf))
})
