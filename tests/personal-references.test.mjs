import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TradebookStore } from '../src/engine/TradebookStore.mts'
import { seedPersonalReferences } from '../src/engine/PersonalReferences.mts'
test('personal prose survives current reference import with unchosen policy and no overwrite', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cairo-reference-')); const store = new TradebookStore(root)
  try {
    await seedPersonalReferences(store, 'resources/references'); const book = await store.loadTradebook('personal-gap-give-go')
    for (const file of ['gap_give_and_go.md', 'bid_reappear.md', 'bid_step_up.md', '3-tier-live-trade-management.md']) assert.ok(book.markdown.includes(await readFile(`resources/references/${file}`, 'utf8')))
    assert.ok(book.markdown.includes("ok to be below vwap or above vwap")); assert.ok(book.markdown.includes("don't move stop loss")); assert.equal(book.interpretation.management, undefined)
    assert.ok(book.interpretation.clauses.some(clause => clause.coverage === 'unsupported'))
    await seedPersonalReferences(store, 'missing'); assert.equal((await store.loadTradebook(book.id)).revision, book.revision)
  } finally { await rm(root, { recursive: true, force: true }) }
})
