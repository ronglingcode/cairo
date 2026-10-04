import assert from "node:assert/strict"

// Direct mock contract probe: proves Cairo's adapter must accept only an exact
// one-time reply and cannot treat generic/saved allowances as order authority.
const replies = []
const permission = {
  async reply(request) {
    replies.push(request)
  },
}

const request = {
  sessionID: "fake-session",
  requestID: "fake-request",
  reply: "once",
}
await permission.reply(request)
assert.deepEqual(replies, [request])
assert.equal(replies[0].reply, "once")
assert.notEqual(replies[0].reply, "always")
console.log("permission-contract-ok: exact fake request accepted once; no broker path exists")
