import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { PositionAttachment, Tradebook, TradebookInterpretation } from "../shared/contracts.mts"
import { validateManagementPolicy } from "./ManagementPolicy.mts"

export interface ActivePlan {
  revision: string
  attachment: PositionAttachment
}

export interface TradebookDraft {
  id: string
  title: string
  markdown: string
  interpretation: TradebookInterpretation
}

export class TradebookStore {
  readonly root: string
  private drafts = new Map<string, TradebookDraft>()
  private operations = new Map<string, Promise<unknown>>()

  constructor(userDataPath: string) { this.root = path.join(userDataPath, "tradebooks") }

  stageDraft(draft: TradebookDraft): void {
    const checked = validateDraft(draft)
    this.drafts.set(checked.id, structuredClone(checked))
  }

  getDraft(id: string): TradebookDraft | null {
    const value = this.drafts.get(id)
    return value ? structuredClone(value) : null
  }

  async loadTradebook(id: string): Promise<Tradebook | null> {
    const safeId = safeIdentifier(id)
    const markdownPath = path.join(this.root, `${safeId}.md`)
    const interpretationPath = path.join(this.root, `${safeId}.interpretation.json`)
    try {
      const [markdown, rawInterpretation] = await Promise.all([
        readFile(markdownPath, "utf8"), readFile(interpretationPath, "utf8"),
      ])
      const interpretation = validateInterpretation(JSON.parse(rawInterpretation), safeId, hash(markdown), markdown)
      return { id: safeId, title: titleFromMarkdown(markdown), markdown, revision: hash(`${markdown}\n${rawInterpretation}`), contentHash: hash(markdown), interpretation }
    } catch (error) {
      if (isMissing(error)) return null
      throw new Error(`Tradebook ${safeId} is incomplete or invalid; it cannot be activated`, { cause: error })
    }
  }

  async activateDraft(id: string, expectedRevision: string | null): Promise<Tradebook> {
    return this.serial(`tradebook:${safeIdentifier(id)}`, async () => {
      const draft = this.drafts.get(id)
      if (!draft) throw new Error("No in-memory draft is available")
      const existing = await this.loadTradebook(id)
      if (existing && expectedRevision !== existing.revision) throw new Error("Active tradebook changed; reload before replacing it")
      if (!existing && expectedRevision !== null) throw new Error("Expected active revision does not exist")

      const checked = validateDraft(draft)
      const markdown = checked.markdown.trimEnd() + "\n"
      const interpretation = validateInterpretation(checked.interpretation, checked.id, hash(markdown), markdown)
      const content = JSON.stringify(interpretation, null, 2) + "\n"
      await mkdir(this.root, { recursive: true })
      const nonce = randomUUID()
      const markdownTemp = path.join(this.root, `.${checked.id}.${nonce}.md.tmp`)
      const interpretationTemp = path.join(this.root, `.${checked.id}.${nonce}.interpretation.tmp`)
      const markdownTarget = path.join(this.root, `${checked.id}.md`)
      const interpretationTarget = path.join(this.root, `${checked.id}.interpretation.json`)
      try {
        await Promise.all([
          writeFile(markdownTemp, markdown, { encoding: "utf8", flag: "wx" }),
          writeFile(interpretationTemp, content, { encoding: "utf8", flag: "wx" }),
        ])
        await rename(interpretationTemp, interpretationTarget)
        await rename(markdownTemp, markdownTarget)
      } finally {
        await Promise.all([rm(markdownTemp, { force: true }), rm(interpretationTemp, { force: true })])
      }
      this.drafts.delete(id)
      return (await this.loadTradebook(id))!
    })
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

function validateDraft(input: TradebookDraft): TradebookDraft {
  if (!input || typeof input !== "object") throw new Error("Tradebook draft must be an object")
  const id = safeIdentifier(input.id)
  if (typeof input.title !== "string" || !input.title.trim() || typeof input.markdown !== "string" || !input.markdown.trim()) throw new Error("Tradebook draft needs a title and narrative")
  const markdown = input.markdown.trimEnd() + "\n"
  const interpretation = validateInterpretation(input.interpretation, id, hash(markdown), markdown)
  return { id, title: input.title.trim(), markdown, interpretation }
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
