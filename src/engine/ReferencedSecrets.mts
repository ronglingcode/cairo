import { readFile } from "node:fs/promises"
import { runInNewContext } from "node:vm"

export interface ReferencedSecrets {
  openai?: { apiKey?: string }
  massive?: { apiKey?: string }
  schwab?: { accountId?: string }
}

/** Read the existing browser provisioning format in an isolated, bounded context. */
export async function readReferencedSecrets(file: string): Promise<ReferencedSecrets> {
  try {
    const source = await readFile(file, "utf8")
    if (Buffer.byteLength(source) > 1_048_576) throw new Error("oversized")
    const captured: unknown = JSON.parse(runInNewContext(`
      const __cairoCapturedSections = Object.create(null);
      const localStorage = Object.freeze({ setItem(key, value) {
        const section = String(key).split('.').at(-1);
        if (['openai', 'massive', 'schwab'].includes(section)) {
          __cairoCapturedSections[section] = JSON.parse(String(value));
        }
      }});
      ${source}
      JSON.stringify(__cairoCapturedSections);
    `, Object.create(null), { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } }))
    if (!captured || typeof captured !== "object" || Array.isArray(captured)) throw new Error("invalid")
    const values = captured as Record<string, unknown>
    const field = (section: string, name: string): string | undefined => {
      const object = values[section]
      if (!object || typeof object !== "object" || Array.isArray(object)) return undefined
      const value = (object as Record<string, unknown>)[name]
      return typeof value === "string" && value.trim() ? value.trim() : undefined
    }
    // Discard unrelated credentials and stale provisioning tokens.
    return { openai: { apiKey: field("openai", "apiKey") }, massive: { apiKey: field("massive", "apiKey") }, schwab: { accountId: field("schwab", "accountId") } }
  } catch {
    throw new Error("Cannot read secretsFile; expected a localStorage provisioning script")
  }
}
