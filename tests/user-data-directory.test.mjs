import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { prepareUserDataDirectory } from "../src/engine/UserDataDirectory.mts"

test("home-folder migration preserves settings and recovery without overwriting an existing profile", t => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cairo home "))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const legacy = path.join(home, "roaming", "cairo")
  mkdirSync(path.join(legacy, "copilot"), { recursive: true })
  writeFileSync(path.join(legacy, "config.json"), '{"provider":"openai"}')
  writeFileSync(path.join(legacy, "recovery.json"), 'pending broker attempt')
  writeFileSync(path.join(legacy, "copilot", "history.json"), 'saved history')
  const destination = prepareUserDataDirectory(legacy, "", home)
  assert.equal(destination, path.join(home, "cairo"))
  assert.equal(readFileSync(path.join(destination, "recovery.json"), "utf8"), 'pending broker attempt')
  assert.equal(readFileSync(path.join(destination, "copilot", "history.json"), "utf8"), 'saved history')
  assert.equal(existsSync(path.join(legacy, "config.json")), true)
  writeFileSync(path.join(destination, "config.json"), 'new settings')
  prepareUserDataDirectory(legacy, "", home)
  assert.equal(readFileSync(path.join(destination, "config.json"), "utf8"), 'new settings')
})

test("explicit profiles remain isolated and a fresh install creates its home folder", t => {
  const home = mkdtempSync(path.join(os.tmpdir(), "cairo isolated "))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const legacy = path.join(home, "missing")
  const override = path.join(home, "private")
  assert.equal(prepareUserDataDirectory(legacy, override, home), override)
  assert.equal(existsSync(path.join(home, "cairo")), false)
  assert.equal(prepareUserDataDirectory(legacy, "", home), path.join(home, "cairo"))
  assert.equal(existsSync(path.join(home, "cairo")), true)
})
