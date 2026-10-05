export interface SkillSummary { name: string; description: string }
export interface SkillMention { name: string; start: number; end: number; text: string }

/** These workflows share the same current-trade and confirmed-pattern prerequisite. */
export const TRADE_CONTEXT_SKILLS = ["trade-context", "set-stop-loss", "set-targets", "manage-trade"] as const
export function requiresTradeContext(text: string): boolean {
  return skillMentions(text).some(mention => TRADE_CONTEXT_SKILLS.some(name => name === mention.name))
}

/** Slash commands are whitespace-delimited; URL and filesystem slashes are ordinary text. */
export function skillMentions(text: string): SkillMention[] {
  return [...text.matchAll(/(?:^|\s)(\/[a-z][a-z0-9-]*)(?=$|\s|[.,!?;:])/g)].map(match => {
    const start = match.index! + match[0].length - match[1].length
    return { name: match[1].slice(1), start, end: start + match[1].length, text: match[1] }
  })
}

export function skillQuery(text: string, caret: number): { query: string; start: number; end: number } | null {
  const match = /(?:^|\s)\/([a-z0-9-]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  const start = caret - match[1].length - 1
  const suffix = /^[a-z0-9-]*/.exec(text.slice(caret))![0]
  return { query: match[1], start, end: caret + suffix.length }
}

export function completeSkill(text: string, token: { start: number; end: number }, name: string): { text: string; caret: number } {
  const insertion = `/${name}` + (/^\s/.test(text.slice(token.end)) ? "" : " ")
  return { text: text.slice(0, token.start) + insertion + text.slice(token.end), caret: token.start + insertion.length }
}
