import test from "node:test"
import assert from "node:assert/strict"
import { TickMarkType } from "lightweight-charts"
import { localChartTime } from "../src/ui/ChartTime.mts"

test("chart labels use the local zone and handle Pacific daylight saving and date rollover", () => {
  const local = localChartTime("America/Los_Angeles", "en-US")
  const seconds = iso => Date.parse(iso) / 1000
  assert.equal(local.tickMarkFormatter(seconds("2026-10-05T16:00:00Z"), TickMarkType.Time), "09:00")
  assert.equal(local.tickMarkFormatter(seconds("2026-01-05T16:00:00Z"), TickMarkType.Time), "08:00")
  assert.equal(local.tickMarkFormatter(seconds("2026-10-05T01:00:00Z"), TickMarkType.DayOfMonth), "4")
  assert.match(local.timeFormatter(seconds("2026-10-05T16:00:00Z")), /09:00/)
  const otherZone = localChartTime("Asia/Tokyo", "en-US")
  assert.equal(otherZone.tickMarkFormatter(seconds("2026-10-05T16:00:00Z"), TickMarkType.Time), "01:00")
})
