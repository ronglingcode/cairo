import type { PublicConfiguration } from "../engine/LocalConfiguration.mts"

declare global {
  interface Window {
    cairo?: {
      runtime: "desktop"
      mode: "fake"
      apiBaseUrl: string | null
    config: PublicConfiguration | null
    }
  }
}

export {}
