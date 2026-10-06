import type { PublicConfiguration } from "../engine/LocalConfiguration.mts"

declare global {
  interface Window {
    cairo?: {
      runtime: "desktop"
      mode: "fake"
      apiBaseUrl: string | null
      commandToken: string | null
      config: PublicConfiguration | null
      simulation?: { caseId: string; positionDescription: string }
      documentSettings?: {
        (action: "read" | "save", value?: string | { workspace_root_path: string; tradebooks_root_path: string; secretsFile: string }): Promise<{ config: PublicConfiguration; activeRoot: string; activeSecretsFile: string }>
        (action: "browse", field?: string): Promise<string | null>
        (action: "derive", value: string): Promise<{ workspace_root_path: string; tradebooks_root_path: string; secretsFile: string }>
      }
      onDocumentSettings?: (callback: (settings: { config: PublicConfiguration; activeRoot: string; activeSecretsFile: string }) => void) => () => void
      view?: "planning" | "chat"
      chatWindow?: (action: "detach" | "dock" | "state") => Promise<boolean>
      onChatDetached?: (callback: (detached: boolean) => void) => () => void
      chatDraft?: (draft?: string) => Promise<string>
      onChatDraft?: (callback: (draft: string) => void) => () => void
      onManagementAlert?: (callback: (symbol: string) => void) => () => void
    }
  }
}

export {}
