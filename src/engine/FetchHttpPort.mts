import type { HttpPort } from "../shared/contracts.mts"

export class FetchHttpPort implements HttpPort {
  async request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    const response = await fetch(url, { ...init, redirect: "error" })
    const body = await response.text()
    let parsed: unknown = body
    try { parsed = JSON.parse(body) } catch { /* reader reports a structured parse error */ }
    return { status: response.status, body: parsed }
  }
}
