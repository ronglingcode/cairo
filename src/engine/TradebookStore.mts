import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { PositionAttachment, Tradebook, TradebookInterpretation } from "../shared/contracts.mts"
import { validateManagementPolicy } from "./ManagementPolicy.mts"

export interface ActivePlan {
  revision: string
  attachment: PositionAttachment
}

export class TradebookStore {
  readonly root: string
  readonly sourceRoot: string
  private operations = new Map<string, Promise<unknown>>()

  constructor(userDataPath: string, sourceRoot?: string) {
    this.root = path.join(userDataPath, "tradebooks")
    this.sourceRoot = sourceRoot ?? path.join(homedir(), "code", "Backtest", "tradebooks")
  }
  async list(): Promise<Tradebook[]> {
    const entries = await readdir(this.sourceRoot, { withFileTypes: true })
    const books: Tradebook[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.toLowerCase() === "index.md") continue
      const book = await this.loadTradebook(entry.name.slice(0, -3))
      if (book) books.push(book)
    }
    return books
  }

  async loadTradebook(id: string): Promise<Tradebook | null> {
    const safeId = safeIdentifier(id)
    if (safeId.toLowerCase() === "index") return null
    let markdown: string
    try {
      markdown = await readFile(path.join(this.sourceRoot, `${safeId}.md`), "utf8")
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
    let rawInterpretation = ""
    let interpretation: TradebookInterpretation | null = null
    try {
      // Existing reviewed interpretations are read-only and valid only for this source text.
      rawInterpretation = await readFile(path.join(this.root, `${safeId}.interpretation.json`), "utf8")
      interpretation = validateInterpretation(JSON.parse(rawInterpretation), safeId, hash(markdown), markdown)
    } catch { rawInterpretation = "" }
    return { id: safeId, title: titleFromMarkdown(markdown), markdown, contentHash: hash(markdown), revision: hash(`${markdown}\n${rawInterpretation}`), interpretation }
  }

  async loadPlan(): Promise<ActivePlan | null> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.root, "active-plan.json"), "utf8")) as unknown
      return validatePlan(raw)
    } catch (error) {
      if (isMissing(error)) return null
      throw new Error("Active plan is invalid; it cannot be resumed", { cause: error })
    }
  }

  async savePlan(attachment: PositionAttachment, expectedRevision: string | null): Promise<ActivePlan> {
    return this.serial("active-plan", async () => {
      const current = await this.loadPlan()
      if (current && current.revision !== expectedRevision) throw new Error("Active plan changed; reload before replacing it")
      if (!current && expectedRevision !== null) throw new Error("Expected active plan revision does not exist")
      validateAttachment(attachment)
      const result: ActivePlan = { revision: hash(JSON.stringify(attachment)), attachment: structuredClone(attachment) }
      await mkdir(this.root, { recursive: true })
      const target = path.join(this.root, "active-plan.json")
      const temp = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
        await rename(temp, target)
      } finally { await rm(temp, { force: true }) }
      return result
    })
  }

  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.operations.set(key, current)
    try { return await current } finally { if (this.operations.get(key) === current) this.operations.delete(key) }
  }
}

function validateInterpretation(input: unknown, id: string, narrativeHash: string, markdown: string): TradebookInterpretation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Interpretation must be an object")
  const value = input as TradebookInterpretation
  if (value.tradebookId !== id || value.narrativeHash !== narrativeHash || !Array.isArray(value.clauses)) throw new Error("Interpretation does not match its narrative")
  const seen = new Set<string>()
  for (const clause of value.clauses) {
    if (!clause || typeof clause.clauseId !== "string" || !clause.clauseId || seen.has(clause.clauseId) || typeof clause.sourceText !== "string" || !clause.sourceText.trim() || typeof clause.explanation !== "string" || !["deterministic", "human", "advisory", "unsupported"].includes(clause.coverage)) throw new Error("Interpretation clause is invalid")
    if (!markdown.includes(clause.sourceText)) throw new Error("Interpretation clause is not linked to narrative text")
    seen.add(clause.clauseId)
  }
  if (value.management) validateManagementPolicy(value.management, value, markdown)
  return structuredClone(value)
}

function validateAttachment(value: PositionAttachment): void {
  if (!value || typeof value !== "object" || !value.id || !value.accountId || !value.symbol || !value.positionId || !value.tradebookId || !value.tradebookRevision || !value.narrativeHash || !value.interpretation || !["pending-confirmation", "active", "paused", "closed"].includes(value.state)) throw new Error("Position attachment is invalid")
  if (value.interpretation.tradebookId !== value.tradebookId || value.interpretation.narrativeHash !== value.narrativeHash) throw new Error("Position attachment interpretation does not match its narrative")
}

function validatePlan(input: unknown): ActivePlan {
  if (!input || typeof input !== "object") throw new Error("Plan must be an object")
  const value = input as ActivePlan
  validateAttachment(value.attachment)
  if (value.revision !== hash(JSON.stringify(value.attachment))) throw new Error("Plan revision does not match its attachment")
  return structuredClone(value)
}

function safeIdentifier(value: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error("Artifact id is invalid")
  return value
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex") }
function titleFromMarkdown(value: string): string { return value.split(/\r?\n/).find((line) => line.startsWith("# "))?.slice(2).trim() || "Untitled tradebook" }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT" }
