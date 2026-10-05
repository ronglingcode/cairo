export interface QuitEventPort {
  preventDefault(): void
}

export interface AppLifecyclePort {
  on(event: "before-quit", listener: (event: QuitEventPort) => void): void
  quit(): void
}

export interface StoppableEngine {
  stop(): Promise<void>
}

/** Stop engine-owned timers and listeners before allowing the desktop process to exit. */
export function installShutdownHook(app: AppLifecyclePort, engine: StoppableEngine): void {
  let stopping = false
  let stopped = false

  app.on("before-quit", (event) => {
    if (stopped) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    void engine.stop().finally(() => {
      stopped = true
      app.quit()
    })
  })
}
