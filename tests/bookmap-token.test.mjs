import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BookmapTokenProvider } from "../src/engine/BookmapTokenProvider.mts"

test("token reader handles BOM, expiry lead, malformed/missing files, and explicit account binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bookmap token "))
  const file = path.join(root, "secrets.json")
  const now = Date.parse("2026-10-04T16:00:00Z")
  const provider = new BookmapTokenProvider(() => ({ selectedAccountId: "acct-2", schwabTokenFile: file }), { now: () => now })
  try {
    assert.equal(await provider.readForSelectedAccount(), null)
    assert.equal(provider.status.state, "waiting")
    await writeFile(file, `\uFEFF${JSON.stringify({ schwab: { access_token: "synthetic-a", expires_at: now + 60_001 } })}`)
    const auth = await provider.readForSelectedAccount()
    assert.deepEqual(auth, { accessToken: "synthetic-a", accountId: "acct-2", expiresAt: now + 60_001 })
    assert.equal(provider.status.state, "connected")
    await writeFile(file, JSON.stringify({ schwab: { access_token: "synthetic-b", expires_at: now + 60_000 } }))
    assert.equal(await provider.readForSelectedAccount(), null)
    assert.equal(provider.status.state, "stale")
    await writeFile(file, "{bad json")
    assert.equal(await provider.readForSelectedAccount(), null)
    assert.match(provider.status.detail, /malformed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("token reader adopts rotations and replacement files without refreshing or writing them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bookmap token rotation "))
  const file = path.join(root, "secrets.json")
  const now = Date.parse("2026-10-04T16:00:00Z")
  const provider = new BookmapTokenProvider(() => ({ selectedAccountId: "acct-selected", schwabTokenFile: file }), { now: () => now })
  try {
    await writeFile(file, JSON.stringify({ schwab: { access_token: "rotation-1", expires_at: now + 120_000 } }))
    assert.equal((await provider.readForSelectedAccount()).accessToken, "rotation-1")
    await writeFile(file, JSON.stringify({ schwab: { access_token: "rotation-2", expires_at: now + 300_000 } }))
    assert.equal((await provider.readForSelectedAccount()).accessToken, "rotation-2")
    const replacement = path.join(root, "replacement.json")
    await writeFile(replacement, JSON.stringify({ schwab: { access_token: "replacement", expires_at: now + 300_000 } }))
    await writeFile(file, await (await import("node:fs/promises")).readFile(replacement))
    provider.invalidate()
    assert.equal(provider.status.state, "stale")
    assert.equal((await provider.readForSelectedAccount()).accessToken, "replacement")
    assert.equal(JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8")).schwab.access_token, "replacement")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("token cannot be used without an explicitly selected account", async () => {
  const provider = new BookmapTokenProvider(() => ({ selectedAccountId: "", schwabTokenFile: "unused" }))
  assert.equal(await provider.readForSelectedAccount(), null)
  assert.equal(provider.status.state, "waiting")
  assert.match(provider.status.detail, /Select/)
})
