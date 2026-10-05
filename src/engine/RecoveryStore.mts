import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { PositionAttachment, ExitTicket } from "../shared/contracts.mts"
import { validateManagementPolicy } from "./ManagementPolicy.mts"
import { buildExitPayload } from "./ExitPayload.mts"
export type AttemptState = "checkpointed" | "accepted" | "working" | "partial" | "filled" | "rejected" | "unknown" | "canceled"
export interface BrokerAttempt {
  id: string; ticket: ExitTicket; attemptedAt: string; brokerOrderId: string | null; state: AttemptState
  filledQuantity: number; detail: string; accountHash?: string
}
export interface SavedRule { attachmentId: string; semanticKey: string; status: "waiting" | "recommended" | "awaiting-fill" | "filled" | "paused"; brokerOrderId?: string }
export interface RecoveryData { version: 1; attempts: BrokerAttempt[]; attachments: PositionAttachment[]; rules: SavedRule[] }
const empty = (): RecoveryData => ({ version: 1, attempts: [], attachments: [], rules: [] })
export class RecoveryStore {
  readonly file: string
  private data: RecoveryData = empty(); private loaded = false; private blocked = false
  private operation: Promise<unknown> = Promise.resolve()
  constructor(root: string) { this.file = path.join(root, "exit-recovery.json") }
  get snapshot(): RecoveryData { return structuredClone(this.data) }
  get available(): boolean { return this.loaded && !this.blocked }
  async load(): Promise<RecoveryData> {
    try { this.data = validateRecovery(JSON.parse(await readFile(this.file, "utf8"))); this.loaded = true; return this.snapshot }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.loaded = true; this.data = empty(); return this.snapshot }
      this.blocked = true; throw new Error("Recovery file is corrupt/incomplete. Resolve it manually before new broker writes.")
    }
  }
  change(operation: (current: RecoveryData) => RecoveryData): Promise<void> {
    const result = this.operation.catch(() => {}).then(async () => {
      if (!this.available) throw new Error("Recovery checkpoint is unavailable; broker writes blocked")
      const next = validateRecovery(operation(this.snapshot)); const content = JSON.stringify(next)
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("Recovery checkpoint size exceeded; broker writes blocked")
      await mkdir(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${randomUUID()}.tmp`
      try { await writeFile(temp, content, { encoding: "utf8", flag: "wx" }); await rename(temp, this.file) }
      finally { await rm(temp, { force: true }) }
      this.data = next
    }); this.operation = result; return result
  }
  async checkpoint(attempt: BrokerAttempt, attachments: PositionAttachment[], rules: SavedRule[]): Promise<void> {
    await this.change(current => {
      if (current.attempts.some(item => item.id === attempt.id)) throw new Error("Attempt was already checkpointed; never resend")
      const unresolved = current.attempts.filter(item => !["filled", "rejected", "canceled"].includes(item.state))
      const resolved = current.attempts.filter(item => ["filled", "rejected", "canceled"].includes(item.state)).slice(-20)
      const active = attachments.filter(item => item.state !== "closed")
      return { version: 1, attempts: [...resolved, ...unresolved, attempt], attachments: active, rules: rules.filter(rule => active.some(item => item.id === rule.attachmentId)) }
    })
  }
  updateAttempt(id: string, update: Partial<Pick<BrokerAttempt, "state" | "brokerOrderId" | "filledQuantity" | "detail" | "accountHash">>): Promise<void> {
    return this.change(current => { if (!current.attempts.some(item => item.id === id)) throw new Error("Unknown checkpoint attempt"); return { ...current, attempts: current.attempts.map(item => item.id === id ? { ...item, ...update } : item) } })
  }
}
function validateRecovery(input: unknown): RecoveryData {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid recovery")
  const value = input as RecoveryData
  if (value.version !== 1 || !Array.isArray(value.attempts) || value.attempts.length > 100 || !Array.isArray(value.attachments) || value.attachments.length > 100 || !Array.isArray(value.rules) || value.rules.length > 3000) throw new Error("Invalid bounded recovery")
  const ids = new Set<string>()
  for (const attempt of value.attempts) {
    if (!attempt || typeof attempt.id !== "string" || ids.has(attempt.id) || attempt.id !== attempt.ticket?.id || !["checkpointed", "accepted", "working", "partial", "filled", "rejected", "unknown", "canceled"].includes(attempt.state) || !Number.isFinite(Date.parse(attempt.attemptedAt)) || !Number.isSafeInteger(attempt.filledQuantity) || attempt.filledQuantity < 0 || typeof attempt.detail !== "string" || attempt.detail.length > 1000 || attempt.brokerOrderId !== null && (typeof attempt.brokerOrderId !== "string" || !attempt.brokerOrderId)) throw new Error("Invalid attempted broker request")
    const ticket = attempt.ticket
    if (!ticket.accountId || !ticket.positionId || !ticket.symbol || !Number.isSafeInteger(ticket.quantity) || ticket.quantity <= 0 || !["close", "cancel-protection", "replace-protection"].includes(ticket.action) || !["long", "short"].includes(ticket.positionSide) || ticket.action === "close" && !ticket.exactPayload || ticket.action !== "close" && !ticket.orderId || !ticket.factsFingerprint || !ticket.runtimeInstanceId) throw new Error("Incomplete exact attempted request")
    if (ticket.action !== "cancel-protection") {
      if (!ticket.request || ticket.request.quantity !== ticket.quantity || JSON.stringify(buildExitPayload({ positionId: ticket.positionId, symbol: ticket.symbol, side: ticket.positionSide, quantity: ticket.quantity, averagePrice: 1, markPrice: null }, ticket.request)) !== JSON.stringify(ticket.exactPayload)) throw new Error("Recovery payload is not a supported exact equity exit")
    } else if (ticket.request !== null || ticket.exactPayload !== null) throw new Error("Cancellation cannot contain a new order")
    ids.add(attempt.id)
  }
  for (const attachment of value.attachments) {
    if (!attachment.id || !attachment.accountId || !attachment.positionId || !attachment.symbol || !attachment.markdown || !attachment.revision || !Number.isSafeInteger(attachment.initialQuantity) || attachment.initialQuantity! <= 0 || createHash("sha256").update(attachment.markdown).digest("hex") !== attachment.narrativeHash || attachment.interpretation.narrativeHash !== attachment.narrativeHash) throw new Error("Invalid frozen recovery guidance")
    validateManagementPolicy(attachment.interpretation.management, attachment.interpretation, attachment.markdown)
  }
  for (const rule of value.rules) if (!rule.attachmentId || !/^[a-f0-9]{64}$/.test(rule.semanticKey) || !["waiting", "recommended", "awaiting-fill", "filled", "paused"].includes(rule.status)) throw new Error("Invalid essential rule state")
  return structuredClone(value)
}
