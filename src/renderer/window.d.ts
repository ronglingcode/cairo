import type { PublicConfiguration } from "../engine/LocalConfiguration.mts"

declare global {
  interface Window {
    cairo?: {
      runtime: "desktop"
      mode: "fake"
      apiBaseUrl: string | null
      commandToken: string | null
      config: PublicConfiguration | null
      view?: "planning" | "chat"
      chatWindow?: (action: "detach" | "dock" | "state") => Promise<boolean>
      onChatDetached?: (callback: (detached: boolean) => void) => () => void
      chatDraft?: (draft?: string) => Promise<string>
      onChatDraft?: (callback: (draft: string) => void) => () => void
    }
  }
}

export {}
