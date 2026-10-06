import type { CopilotChat, CopilotChatMessage } from "./contracts.mts"

export function chatTimeline(chat: CopilotChat | null, automaticChat: CopilotChat | null): Array<CopilotChatMessage & { automatic: boolean; key: string }> {
  return [
    ...(chat?.messages ?? []).map(message => ({ ...message, automatic: false, key: `foreground:${message.id}` })),
    ...(automaticChat?.messages ?? []).map(message => ({ ...message, automatic: true, key: `automatic:${message.id}` })),
  ].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}
