import type { BrokerPosition, CairoSnapshot } from "../shared/contracts.mts"
import { skillMentions, TRADE_CONTEXT_SKILLS } from "../shared/SkillCommands.mts"

/** Resolve only from held broker positions, never the chart focus or conversation history. */
export function tradeCandidates(text: string, positions: BrokerPosition[]): BrokerPosition[] {
  const held = positions.filter(position => position.quantity > 0)
  const mentions = skillMentions(text)
  const request = mentions.reduceRight((value, mention) => value.slice(0, mention.start) + " " + value.slice(mention.end), text).trim()
  const words = request.split(/\s+/).map(word => word.replace(/^[,!?;:]+|[.,!?;:]+$/g, ""))
  const relevant = mentions.some(mention => mention.name === "bookmap-pattern" || TRADE_CONTEXT_SKILLS.some(name => name === mention.name))
  if (relevant && /^[A-Z][A-Z0-9.-]{0,15}$/.test(request) && !held.some(position => position.symbol === request)) throw new Error(`No current ${request} position to tag`)
  const mentioned = held.filter(position => words.some(word => word.toUpperCase() === position.symbol))
  const side = words.some(word => word.toLowerCase() === "long") !== words.some(word => word.toLowerCase() === "short")
    ? words.some(word => word.toLowerCase() === "long") ? "long" : "short" : null
  const candidates = (mentioned.length ? mentioned : held).filter(position => !side || position.side === side)
  if (!candidates.length) throw new Error("No current matching position. Refresh the account after entry.")
  return candidates
}

/** An attached plan is evidence of an assignment only for this account, trade and side. */
export function positionTradebook(snapshot: CairoSnapshot, position: BrokerPosition) {
  const candidates = snapshot.attachments.filter(attachment => attachment.accountId === snapshot.brokerFacts?.accountId &&
    attachment.positionId === position.positionId && attachment.symbol === position.symbol && attachment.state !== "closed" &&
    attachment.baseline?.side === position.side)
  const assignments = snapshot.preparationError ? [] : snapshot.preparation?.tradebookAssignments?.filter(item => item.symbol === position.symbol && item.side === position.side) ?? []
  if (assignments.length > 1 || candidates.length > 1) return { status: "ambiguous", book: null, attachment: null }
  const attachment = candidates[0] ?? null
  const assignment = assignments[0] ?? null
  const tradebookId = assignment?.tradebookId ?? attachment?.tradebookId
  const book = snapshot.tradebooks.find(book => book.id === tradebookId) ?? null
  if (!tradebookId) return { status: "unassigned", book: null, attachment }
  if (assignment && attachment && assignment.tradebookId !== attachment.tradebookId) return { status: "conflict", book, attachment }
  return { status: book || attachment ? "resolved" : "missing-source", book, attachment }
}
