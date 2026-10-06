import test from "node:test"
import assert from "node:assert/strict"
import { chatTimeline } from "../src/shared/ChatTimeline.mts"

test("one timeline interleaves independent chat histories and keeps streaming updates in place", () => {
  const message = (id, createdAt, text) => ({ id, createdAt, text, role: "assistant", tools: [] })
  const foreground = { messages: [message("same-id", 200, "Your answer"), message("later", 400, "Follow-up")] }
  const automatic = { messages: [message("earlier", 100, "Market observation"), message("same-id", 300, "Automatic answer")] }
  const merged = chatTimeline(foreground, automatic)
  assert.deepEqual(merged.map(item => item.text), ["Market observation", "Your answer", "Automatic answer", "Follow-up"])
  assert.equal(new Set(merged.map(item => item.key)).size, 4)
  assert.deepEqual(merged.map(item => item.automatic), [true, false, true, false])
  automatic.messages[1].text += " continued"
  assert.deepEqual(chatTimeline(foreground, automatic).map(item => item.key), merged.map(item => item.key))
  assert.equal(chatTimeline(foreground, automatic)[2].text, "Automatic answer continued")
  assert.equal(foreground.messages[0].text, "Your answer")
  assert.deepEqual(chatTimeline(null, null), [])
  const notice={text:"AMD: Reconfirm Bookmap pattern",at:"2026-10-06T15:08:51.000Z"}
  assert.equal(chatTimeline(null,null,null,null,notice)[0].text,notice.text)
  assert.equal(chatTimeline(null,null,null,null,notice)[0].createdAt,Date.parse(notice.at))
  const four = chatTimeline(foreground, automatic, { messages: [message("same-id", 250, "Account reply")] }, { messages: [message("same-id", 350, "Management reply")] })
  assert.equal(new Set(four.map(item => item.key)).size, 6)
  assert.deepEqual(four.map(item => item.label), ["Bookmap review", "", "Account review", "Bookmap review", "Trade management", ""])
  const bound = { messages: [{ id: "bound", role: "user", text: "/manage-trade\nSelected current trade: AMD long; positionId: account-hash:007903107:long. Use its saved Bookmap tag.", tools: [] }] }
  assert.equal(chatTimeline(bound, null)[0].text, "/manage-trade\nAMD long")
  assert.match(bound.messages[0].text, /positionId: account-hash:007903107:long/, "internal trade identity stays intact")
  bound.messages[0].text = "/set-targets\nSelected current trade: AMD long; positionId: account-hash:007903107:long. Bookmap pattern: bid step up (saved)"
  assert.equal(chatTimeline(bound, null)[0].text, "/set-targets\nAMD long · Bookmap: bid step up (saved)")
  assert.match(bound.messages[0].text, /positionId: account-hash:007903107:long/, "pattern display preserves internal trade identity")
})
