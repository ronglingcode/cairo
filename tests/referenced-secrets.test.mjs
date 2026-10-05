import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readReferencedSecrets } from "../src/engine/ReferencedSecrets.mts"
import { LocalConfiguration } from "../src/engine/LocalConfiguration.mts"

test("references supply keys and account identity without persisting keys or modifying provisioning", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo secrets "))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, "storeSecrets.js")
  const provisioning = `const prefix = 'fixture.';
    const openai = { apiKey: 'synthetic-openai' };
    const massive = { apiKey: 'synthetic-massive' };
    const schwab = { accountId: 'acct-file', access_token: 'expired-provisioning-token' };
    localStorage.setItem(prefix + 'openai', JSON.stringify(openai));
    localStorage.setItem(prefix + 'massive', JSON.stringify(massive));
    localStorage.setItem(prefix + 'schwab', JSON.stringify(schwab));`
  await writeFile(source, provisioning)
  const store = new LocalConfiguration(path.join(root, "profile"))
  await store.load()
  const view = await store.save({ ...store.values, secretsFile: source })
  assert.equal(view.selectedAccountId, 'acct-file')
  assert.equal(store.values.selectedAccountId, 'acct-file')
  assert.equal(store.openAiApiKey, 'synthetic-openai')
  assert.equal(store.massiveApiKey, process.env.CAIRO_MASSIVE_API_KEY?.trim() || 'synthetic-massive')
  assert.equal(JSON.stringify(view).includes('synthetic-'), false)
  const saved = await readFile(store.configPath, 'utf8')
  assert.equal(saved.includes('synthetic-'), false)
  assert.equal(JSON.parse(saved).selectedAccountId, '')
  assert.equal(await readFile(source, 'utf8'), provisioning)
  assert.equal((await readReferencedSecrets(source)).schwab.access_token, undefined)
  await store.save({ ...store.values, selectedAccountId: 'acct-explicit' })
  assert.equal(store.values.selectedAccountId, 'acct-explicit')
})

test("referenced keys reload at restart and failures stay sanitized and usable", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cairo secrets errors "))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, "storeSecrets.js")
  const script = key => `localStorage.setItem('test.openai', JSON.stringify({apiKey: '${key}'}));`
  await writeFile(source, script('synthetic-first'))
  const store = new LocalConfiguration(root)
  await store.load()
  await store.save({ ...store.values, secretsFile: source })
  await writeFile(source, script('synthetic-rotated'))
  await store.load()
  assert.equal(store.openAiApiKey, 'synthetic-rotated')
  await writeFile(source, `throw new Error('secret-material');`)
  const view = await store.load()
  assert.equal(store.openAiApiKey, null)
  assert.match(view.secretsError, /Cannot read secretsFile/)
  assert.equal(JSON.stringify(view).includes('secret-material'), false)
  await assert.rejects(readReferencedSecrets(source), error => !error.message.includes('secret-material'))
  await writeFile(source, 'process.exit(0)')
  await assert.rejects(readReferencedSecrets(source), /Cannot read secretsFile/)
  await store.save({ ...store.values, secretsFile: '' })
  assert.equal((await store.load()).secretsError, null)
  await assert.rejects(store.save({ ...store.values, secretsFile: 'relative.js' }), /absolute path/)
})
