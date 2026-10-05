import { createServer, type Server } from "node:http"

/** Deterministic local demonstration served to OpenCode. It makes no market judgment. */
export class FakeModelServer {
  private server: Server | undefined
  private readonly expectedKey: string
  constructor(expectedKey = "fixture-only") { this.expectedKey = expectedKey }
  async start(): Promise<string> {
    this.server = createServer(async (request, response) => {
      if (request.url !== "/v1/chat/completions" || request.method !== "POST") { response.writeHead(404).end(); return }
      if (request.headers.authorization !== `Bearer ${this.expectedKey}`) { response.writeHead(401).end(); return }
      let body = ""
      for await (const chunk of request) { body += chunk; if (body.length > 2_000_000) { response.writeHead(413).end(); return } }
      let input: { stream?: boolean }
      try { input = JSON.parse(body) } catch { response.writeHead(400).end(); return }
      const text = "Local fake model: Cairo supplied the saved preparation and timestamped one-minute chart snapshot. This fixture verifies chat only and provides no trading analysis. Configure an OpenAI model for an actual discussion."
      if (!input.stream) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] })); return }
      response.writeHead(200, { "content-type": "text/event-stream" })
      let offset = 0
      const timer = setInterval(() => {
        const content = text.slice(offset, offset + 20)
        offset += 20
        response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: { content }, finish_reason: offset >= text.length ? "stop" : null }] })}\n\n`)
        if (offset >= text.length) { clearInterval(timer); response.end("data: [DONE]\n\n") }
      }, 80)
      response.once("close", () => clearInterval(timer))
    })
    await new Promise<void>(resolve => this.server!.listen(0, "127.0.0.1", resolve))
    const address = this.server.address()
    if (!address || typeof address === "string") throw new Error("Fake model has no address")
    return `http://127.0.0.1:${address.port}/v1`
  }
  async stop(): Promise<void> { const server = this.server; this.server = undefined; if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
