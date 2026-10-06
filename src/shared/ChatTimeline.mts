import type { CopilotChat, CopilotChatMessage } from "./contracts.mts"

export function chatTimeline(chat: CopilotChat | null, automaticChat: CopilotChat | null, accountChat: CopilotChat | null = null, managementChat: CopilotChat | null = null, notice?: { text: string; at: string; positionId?: string }): Array<CopilotChatMessage & { automatic: boolean; label: string; key: string; tagPositionId?: string }> {
  const displayText = (message: CopilotChatMessage) => message.role === "user"
    ? message.text
      .replace(/(^|\n)Selected current trade: ([^;\r\n]+); positionId: [^\r\n]+?\. Bookmap pattern: ([^\r\n]+) \(saved\)(?=\r?$)/gm, "$1$2 · Bookmap: $3 (saved)")
      .replace(/(^|\n)Selected current trade: ([^;\r\n]+); positionId: [^\r\n]+?\. Bookmap pattern: unconfirmed(?=\r?$)/gm, "$1$2 · Bookmap: unconfirmed")
      .replace(/(^|\n)Selected current trade: ([^;\r\n]+); positionId: [^\r\n]+?\. Use its saved Bookmap tag\./g, "$1$2")
    : message.text
  return [
    ...(chat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: false, label: "", key: `foreground:${message.id}` })),
    ...(automaticChat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: true, label: "Bookmap review", key: `automatic:${message.id}` })),
    ...(accountChat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: true, label: "Account review", key: `account:${message.id}` })),
    ...(managementChat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: true, label: "Trade management", key: `management:${message.id}` })),
    ...(notice ? [{ id: `management-notice:${notice.at}`, key: `management-notice:${notice.at}`, role: "assistant" as const, text: notice.text, createdAt: Date.parse(notice.at), tools: [], automatic: true, label: "Management · tag pattern first", tagPositionId: notice.positionId }] : []),
  ].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}
