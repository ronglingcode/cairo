import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { CairoEngine } from "./CairoEngine.mts"
import type { BookmapPattern, BookmapPatternPicker, BookmapPatternTag } from "../shared/BookmapPatterns.mts"
import { requiresTradeContext, skillMentions } from "../shared/SkillCommands.mts"
import { tradeCandidates } from "./TradeContext.mts"

export function parseActivePatterns(markdown: string): BookmapPattern[] {
  const patterns: BookmapPattern[] = []
  let side: "long" | "short" | undefined
  for (const line of markdown.split(/\r?\n/)) {
    if (/^## Long\s*$/.test(line)) side = "long"
    else if (/^## Short\s*$/.test(line)) side = "short"
    else if (side && line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(cell => cell.trim())
      if (cells[0] === "ID" || cells[0]?.startsWith("---")) continue
      if (cells.length !== 3 || !/^[a-z][a-z0-9-]{0,62}$/.test(cells[0]) || !cells[1] || patterns.some(pattern => pattern.id === cells[0])) throw new Error("Invalid active Bookmap pattern row")
      const link = /^\[[^\]]+\]\(([a-zA-Z0-9_-]+\.md)\)$/.exec(cells[2])
      if (!link && cells[2] !== "—") throw new Error("Pattern tradebook must be a local Markdown filename or —")
      patterns.push({ id: cells[0], name: cells[1], side, sourceFile: link?.[1] ?? null })
    }
  }
  if (!patterns.length || patterns.length > 64) throw new Error("Active Bookmap catalog must contain 1–64 patterns")
  return patterns
}

/** Tags describe a trader-selected setup, independently of executable position guidance. */
export class BookmapPatterns {
  readonly directory: string
  readonly file: string
  private tags: BookmapPatternTag[] = []
  private loaded = false
  private operation: Promise<unknown> = Promise.resolve()
  private unsubscribe?: () => void
  private trades = new Map<string, string>()
  private tradeKey(accountId: string, position: { positionId: string; symbol: string; side: string }): string { return JSON.stringify([accountId, position.positionId, position.symbol, position.side]) }
  private observe(facts: import("../shared/contracts.mts").BrokerFacts): void {
    const held = new Set(facts.positions.filter(position => position.quantity > 0).map(position => this.tradeKey(facts.accountId, position)))
    for (const key of this.trades.keys()) if (JSON.parse(key)[0] === facts.accountId && !held.has(key)) this.trades.delete(key)
    for (const key of held) if (!this.trades.has(key)) this.trades.set(key, randomUUID())
  }
  private engine: CairoEngine
  private now: () => number
  constructor(engine: CairoEngine, userData: string, sourceRoot: string, now = Date.now) {
    this.engine = engine
    this.now = now
    this.directory = path.join(sourceRoot, "bookmap_patterns")
    this.file = path.join(userData, "bookmap-pattern-tags.json")
  }
  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"))
      if (data.version !== 1 || !Array.isArray(data.tags) || data.tags.length > 500) throw new Error("Invalid pattern tag store")
      const keys = new Set<string>()
      for (const tag of data.tags) {
        if (!tag || ["revision", "accountId", "positionId", "symbol", "patternId", "runtimeInstanceId", "tradeInstanceId"].some(key => typeof tag[key] !== "string" || !tag[key] || tag[key].length > 200) || !["long", "short"].includes(tag.side) || typeof tag.active !== "boolean" || !Number.isFinite(Date.parse(tag.taggedAt))) throw new Error("Invalid saved pattern tag")
        const key = JSON.stringify([tag.accountId, tag.positionId, tag.side])
        if (keys.has(key)) throw new Error("Duplicate saved pattern tag")
        keys.add(key)
      }
      this.tags = data.tags
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved Bookmap tags could not be read; resolve the file before tagging", { cause: error }) }
    this.loaded = true
    const snapshot = this.engine.getSnapshot()
    if (snapshot.brokerFacts) this.observe(snapshot.brokerFacts)
    const subscription = this.engine.subscribeFrom(snapshot.runtimeInstanceId, snapshot.sequence, event => {
      if (!event.changes.brokerFacts) return
      const facts = event.changes.brokerFacts
      const age = this.now() - Date.parse(facts.asOf)
      if (facts.source.state !== "connected" || !Number.isFinite(age) || age < 0 || age > 60_000) return
      this.observe(facts)
      // Position IDs can be reused by the broker after going flat. Never carry a tag into a new trade.
      const ended = this.tags.filter(tag => tag.active && tag.accountId === facts.accountId && !facts.positions.some(position => position.quantity > 0 && position.positionId === tag.positionId && position.symbol === tag.symbol && position.side === tag.side))
      if (!ended.length) return
      for (const tag of ended) tag.active = false
      this.publish()
      void this.serial(() => this.persist()).catch(() => this.engine.updateSnapshot({ bookmapPatternError: "Bookmap tag retirement could not be saved" }))
    })
    if (!subscription.resyncRequired) this.unsubscribe = subscription.unsubscribe
    this.publish()
  }
  stop(): void { this.unsubscribe?.() }
  async catalog(): Promise<BookmapPattern[]> {
    if (!this.loaded) throw new Error("Bookmap pattern storage is unavailable")
    return parseActivePatterns(await readFile(path.join(this.directory, "activePatterns.md"), "utf8"))
  }
  private facts() {
    const snapshot = this.engine.getSnapshot()
    const facts = snapshot.brokerFacts
    const age = facts ? this.now() - Date.parse(facts.asOf) : NaN
    if (!facts || snapshot.broker.state !== "connected" || facts.source.state !== "connected" || !Number.isFinite(age) || age < 0 || age > 60_000) throw new Error("Refresh the account before choosing a Bookmap pattern")
    return { snapshot, facts }
  }
  private tagFor(accountId: string, positionId: string, side: string) {
    return this.tags.find(tag => tag.accountId === accountId && tag.positionId === positionId && tag.side === side) ?? null
  }
  usable(tag: BookmapPatternTag | null): boolean { return Boolean(tag?.active && tag.runtimeInstanceId === this.engine.runtimeInstanceId && tag.tradeInstanceId === this.trades.get(this.tradeKey(tag.accountId, tag))) }
  async preflight(text: string, commandId: string): Promise<{ text: string; picker: BookmapPatternPicker | null }> {
    return this.serial(() => this.prepare(text, commandId))
  }
  private async prepare(text: string, commandId: string): Promise<{ text: string; picker: BookmapPatternPicker | null }> {
    const commands = skillMentions(text).map(mention => mention.name)
    const manual = commands.includes("bookmap-pattern")
    if (!manual && !requiresTradeContext(text)) return { text, picker: null }
    const { snapshot, facts } = this.facts()
    const catalog = await this.catalog()
    const current = this.facts()
    if (current.facts.accountId !== facts.accountId || current.snapshot.brokerFactsRevision !== snapshot.brokerFactsRevision) throw new Error("Account facts changed; invoke the skill again")
    const positions = tradeCandidates(text, facts.positions)
    const choices = positions.map(position => ({ position, tradeInstanceId: this.trades.get(this.tradeKey(facts.accountId, position))!, tag: this.tagFor(facts.accountId, position.positionId, position.side), candidates: catalog.filter(pattern => pattern.side === position.side) }))
    const savedPattern = choices.length === 1 && this.usable(choices[0].tag) ? choices[0].candidates.find(pattern => pattern.id === choices[0].tag!.patternId) : undefined
    if (!manual && savedPattern) return { text: this.bind(text, choices[0].position, savedPattern), picker: null }
    const picker: BookmapPatternPicker = { id: randomUUID(), text, commandId, accountId: facts.accountId, factsRevision: snapshot.brokerFactsRevision, manual, positions: choices }
    this.engine.updateSnapshot({ bookmapPatternPicker: picker, bookmapPatternError: null })
    return { text, picker }
  }
  async acceptSetup(input: Record<string, unknown>): Promise<void> {
    const snapshot = this.engine.getSnapshot()
    const status = Object.values(snapshot.bookmapEvidence.symbols).find(s => s.setups.some(c => c.id === input.setupId))
    const setup = status?.setups.find(c => c.id === input.setupId)
    const analysis = snapshot.bookmapEvidence.analyses.find(a=>a.setupId===input.setupId && a.revision===input.revision)
    const patternId = analysis?.patternId ?? setup?.patternId
    if (!status || !setup || setup.revision !== input.revision || !patternId || setup.state !== "candidate" || status.mode !== "live" || status.readiness !== "ready" || this.now()-Date.parse(status.receivedAt)>6000 || this.now()-Number(BigInt(setup.asOf)/1_000_000n)<0 || this.now()-Number(BigInt(setup.asOf)/1_000_000n)>10_000) throw new Error("Setup is stale, replaying, ambiguous or changed; review current evidence")
    const { facts } = this.facts()
    const position = facts.positions.find(p => p.positionId === input.positionId && p.symbol === setup.symbol && p.side === "short" && p.quantity > 0)
    if (!position) throw new Error("Select a current matching short trade")
    const result = await this.preflight(`/bookmap-pattern ${position.symbol}`, randomUUID())
    if (!result.picker) throw new Error("Pattern picker unavailable")
    const latest = this.engine.getSnapshot().bookmapEvidence.symbols[setup.symbol]
    if (!latest || latest.sourceInstanceId !== status.sourceInstanceId || latest.epoch !== status.epoch || latest.setups.find(c=>c.id===setup.id)?.revision !== setup.revision) { this.cancel(result.picker.id); throw new Error("Setup changed while opening confirmation; review again") }
    await this.select({ pickerId: result.picker.id, positionId: position.positionId, patternId })
  }
  async select(input: Record<string, unknown>): Promise<{ text: string; commandId: string; manual: boolean }> {
    return this.serial(async () => {
      const picker = this.engine.getSnapshot().bookmapPatternPicker
      if (!picker || picker.id !== input.pickerId) throw new Error("Pattern selection changed; invoke the skill again")
      const choice = picker.positions.find(item => item.position.positionId === input.positionId)
      if (!choice) throw new Error("Select one of the requested positions")
      const { snapshot, facts } = this.facts()
      if (facts.accountId !== picker.accountId || this.trades.get(this.tradeKey(facts.accountId, choice.position)) !== choice.tradeInstanceId || !facts.positions.some(position => position.positionId === choice.position.positionId && position.symbol === choice.position.symbol && position.side === choice.position.side && position.quantity > 0)) throw new Error("The selected trade is no longer held")
      const oldTag = this.tagFor(facts.accountId, choice.position.positionId, choice.position.side)
      if ((oldTag?.revision ?? null) !== (choice.tag?.revision ?? null)) throw new Error("Trade pattern changed in another window; invoke the skill again")
      const pattern = (await this.catalog()).find(pattern => pattern.id === input.patternId && pattern.side === choice.position.side)
      if (!pattern) throw new Error("Pattern is no longer active for this trade side")
      const tag: BookmapPatternTag = { revision: randomUUID(), accountId: facts.accountId, positionId: choice.position.positionId, symbol: choice.position.symbol, side: choice.position.side, patternId: pattern.id, taggedAt: new Date(this.now()).toISOString(), runtimeInstanceId: snapshot.runtimeInstanceId, tradeInstanceId: choice.tradeInstanceId, active: true }
      const next = [...this.tags.filter(item => item !== oldTag), tag].slice(-500)
      await this.persist(next)
      // An account update can arrive during the disk write. Keep the memory, but do not resume a closed trade.
      this.tags = next
      const latest = this.engine.getSnapshot().brokerFacts
      const stillHeld = latest?.accountId === tag.accountId && this.trades.get(this.tradeKey(tag.accountId, tag)) === tag.tradeInstanceId && latest.positions.some(position => position.positionId === tag.positionId && position.symbol === tag.symbol && position.side === tag.side && position.quantity > 0)
      if (!stillHeld) tag.active = false
      this.publish()
      this.engine.updateSnapshot({ bookmapPatternPicker: null })
      if (!stillHeld) { await this.persist(); throw new Error("Trade changed while saving the pattern; invoke the skill again") }
      this.facts()
      return { text: this.bind(picker.text, choice.position, pattern), commandId: picker.commandId, manual: picker.manual }
    })
  }
  cancel(pickerId: unknown): void {
    if (this.engine.getSnapshot().bookmapPatternPicker?.id === pickerId) this.engine.updateSnapshot({ bookmapPatternPicker: null })
  }
  async read(positionId: unknown) {
    const { facts } = this.facts()
    const position = facts.positions.find(position => position.positionId === positionId && position.quantity > 0)
    if (!position) throw new Error("Read a current position before routing its Bookmap pattern")
    const tag = this.tagFor(facts.accountId, position.positionId, position.side)
    const candidates = (await this.catalog()).filter(pattern => pattern.side === position.side)
    const pattern = this.usable(tag) ? candidates.find(pattern => pattern.id === tag!.patternId) : undefined
    const markdown = pattern?.sourceFile ? await readFile(path.join(this.directory, pattern.sourceFile), "utf8") : null
    if (markdown && markdown.length > 24_000) throw new Error("Pattern tradebook exceeds the supported context size")
    const current = this.facts()
    if (current.facts.accountId !== facts.accountId || !current.facts.positions.some(item => item.positionId === position.positionId && item.side === position.side && item.symbol === position.symbol && item.quantity > 0) || (this.tagFor(facts.accountId, position.positionId, position.side)?.revision ?? null) !== (tag?.revision ?? null) || pattern && !this.usable(tag)) throw new Error("Trade or Bookmap tag changed; read context again")
    return { position: current.facts.positions.find(item => item.positionId === position.positionId)!, tag, confirmed: Boolean(pattern), candidates, pattern: pattern ?? null, markdown, source: pattern?.sourceFile ? `bookmap_patterns/${pattern.sourceFile}` : null }
  }
  async managementRequest(positionId: string): Promise<string> {
    const context = await this.read(positionId)
    const text = `/manage-trade ${context.position.symbol} ${context.position.side}`
    if (context.pattern) return this.bind(text, context.position, context.pattern)
    return `${text}\nSelected current trade: ${context.position.symbol} ${context.position.side}; positionId: ${positionId}. Bookmap pattern: unconfirmed\nAutomatic review after a 30% partial. Use undefined for unsupported stop or targets; never infer a saved pattern from history.`
  }
  private bind(text: string, position: { positionId: string; symbol: string; side: string }, pattern: BookmapPattern): string {
    const bound = `${text}\nSelected current trade: ${position.symbol} ${position.side}; positionId: ${position.positionId}. Bookmap pattern: ${pattern.name} (saved)`
    if (bound.length > 8000) throw new Error("Message is too long to include the selected trade")
    return bound
  }
  private publish() { this.engine.updateSnapshot({ bookmapPatternTags: structuredClone(this.tags), bookmapPatternError: null }) }
  private async persist(tags = this.tags): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try { await writeFile(temp, JSON.stringify({ version: 1, tags }), { encoding: "utf8", flag: "wx" }); await rename(temp, this.file) }
    finally { await rm(temp, { force: true }) }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.catch(() => undefined).then(operation)
    this.operation = next
    return next
  }
}
