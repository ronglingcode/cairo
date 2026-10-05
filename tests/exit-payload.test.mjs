import test from "node:test"
import assert from "node:assert/strict"
import { buildExitPayload } from "../src/engine/ExitPayload.mts"
const position = { positionId: "p", symbol: "AAA", side: "long", quantity: 10, averagePrice: 20, markPrice: 21 }
const market = { orderType: "market", quantity: 5, limitPrice: null, stopPrice: null, duration: "DAY" }
test("partial/full long and short exit payloads use only closing instructions", () => {
  assert.equal(buildExitPayload(position, market).orderLegCollection[0].instruction, "SELL")
  assert.equal(buildExitPayload({ ...position, side: "short" }, { ...market, quantity: 10 }).orderLegCollection[0].instruction, "BUY_TO_COVER")
  assert.equal(buildExitPayload(position, { ...market, orderType: "limit", limitPrice: 21.1 }).price, "21.10")
  assert.equal(buildExitPayload(position, { ...market, orderType: "stop-limit", stopPrice: 20, limitPrice: 19.99 }).stopPrice, "20.00")
})
test("invalid prices, precision, quantities, sessions and entry-shaped fields reject", () => {
  for (const price of [NaN, Infinity, -1, 0, 20.001]) assert.throws(() => buildExitPayload(position, { ...market, orderType: "stop", stopPrice: price }))
  for (const quantity of [0, -1, 0.5, 11, NaN]) assert.throws(() => buildExitPayload(position, { ...market, quantity }))
  assert.throws(() => buildExitPayload(position, { ...market, duration: "GTC" }))
  assert.throws(() => buildExitPayload(position, market, "SEAMLESS"))
  assert.throws(() => buildExitPayload(position, { ...market, instruction: "BUY" }))
  assert.throws(() => buildExitPayload(position, { ...market, orderType: "trail" }))
})
