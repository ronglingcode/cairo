import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import type { PreparationNotes, TradebookAssignment } from "../shared/contracts.mts"

export interface PreparationContent {
  tradebookAssignments?: TradebookAssignment[]
  markdown: string
  date: string | null
  symbol: string | null
}

export class PreparationConflictError extends Error {}
export class PreparationValidationError extends Error {}

export class PreparationStore {
  private readonly file: string
  private pending: Promise<unknown> = Promise.resolve()

  constructor(userDataPath: string) { this.file = path.join(userDataPath, "preparation.json") }

  /** Preserve legacy profile notes, and never replace documents in the selected root. */
  static async forTradebooksRoot(root: string, legacyProfile: string): Promise<PreparationStore> {
    const store = new PreparationStore(path.join(root, "preparation"))
    // Validate before copying; malformed legacy data must not enter the document root.
    if (await store.load()) return store
    const legacy = new PreparationStore(legacyProfile)
    if (await legacy.load()) {
      await mkdir(path.dirname(store.file), { recursive: true })
      try { await copyFile(legacy.file, store.file, constants.COPYFILE_EXCL) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
    }
    return store
  }

  async load(): Promise<PreparationNotes | null> {
    let raw: string
    try { raw = await readFile(this.file, "utf8") }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
    const value = JSON.parse(raw) as PreparationNotes
    const content = validateContent(value)
    if (value.revision !== revision(content) || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
      throw new Error("Saved preparation is invalid")
    }
    return { ...content, revision: value.revision, savedAt: value.savedAt }
  }

  save(input: unknown, expectedRevision: unknown): Promise<PreparationNotes> {
    const operation = this.pending.catch(() => undefined).then(async () => {
      const content = validateContent(input)
      if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
        throw new PreparationValidationError("Expected preparation revision is invalid")
      }
      const existing = await this.load()
      if ((existing?.revision ?? null) !== expectedRevision) {
        throw new PreparationConflictError("Saved preparation changed. Reload the saved notes before replacing them.")
      }
      const result: PreparationNotes = { ...content, revision: revision(content), savedAt: new Date().toISOString() }
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
        await rename(temporary, this.file)
      } finally { await rm(temporary, { force: true }) }
      return structuredClone(result)
    })
    this.pending = operation
    return operation
  }
}

export function validateContent(input: unknown): PreparationContent {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PreparationValidationError("Preparation must be an object")
  const value = input as Record<string, unknown>
  if (typeof value.markdown !== "string" || value.markdown.length > 65_536) throw new PreparationValidationError("Notes must be text of at most 65,536 characters")
  if (value.date !== null && (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(`${value.date}T00:00:00Z`)) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date)) {
    throw new PreparationValidationError("Preparation date must be a valid date or empty")
  }
  if (value.symbol !== null && (typeof value.symbol !== "string" || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(value.symbol))) {
    throw new PreparationValidationError("Preparation symbol must be an equity symbol or empty")
  }
  let assignments: TradebookAssignment[] | undefined
  if (value.tradebookAssignments !== undefined) {
    if (!Array.isArray(value.tradebookAssignments) || value.tradebookAssignments.length > 100) throw new PreparationValidationError("Tradebook assignments must contain at most 100 symbol/side pairs")
    const seen = new Set<string>()
    assignments = value.tradebookAssignments.map(item => {
      if (!item || typeof item.symbol !== "string" || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(item.symbol) || !["long", "short"].includes(item.side) || typeof item.tradebookId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.tradebookId)) throw new PreparationValidationError("Each assignment needs a symbol, long/short side and tradebook ID")
      const key = `${item.symbol}:${item.side}`
      if (seen.has(key)) throw new PreparationValidationError("Assign at most one tradebook per symbol and side")
      seen.add(key)
      return { symbol: item.symbol, side: item.side, tradebookId: item.tradebookId }
    })
  }
  return { markdown: value.markdown, date: value.date as string | null, symbol: value.symbol as string | null,
    ...(assignments === undefined ? {} : { tradebookAssignments: assignments }) }
}

function revision(content: PreparationContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex")
}
