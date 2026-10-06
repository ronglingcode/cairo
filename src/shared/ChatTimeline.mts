import type { CopilotChat, CopilotChatMessage } from "./contracts.mts"

export function chatTimeline(chat: CopilotChat | null, automaticChat: CopilotChat | null): Array<CopilotChatMessage & { automatic: boolean; key: string }> {
  const displayText = (message: CopilotChatMessage) => message.role === "user"
    ? message.text
      .replace(/(^|\n)Selected current trade: ([^;\r\n]+); positionId: [^\r\n]+?\. Bookmap pattern: ([^\r\n]+) \(saved\)(?=\r?$)/gm, "$1$2 · Bookmap: $3 (saved)")
      .replace(/(^|\n)Selected current trade: ([^;\r\n]+); positionId: [^\r\n]+?\. Use its saved Bookmap tag\./g, "$1$2")
    : message.text
  return [
    ...(chat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: false, key: `foreground:${message.id}` })),
    ...(automaticChat?.messages ?? []).map(message => ({ ...message, text: displayText(message), automatic: true, key: `automatic:${message.id}` })),
  ].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}
