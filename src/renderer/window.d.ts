declare global {
  interface Window {
    cairo?: {
      runtime: "desktop"
      mode: "fake"
      apiBaseUrl: string | null
    }
  }
}

export {}
