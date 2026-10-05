import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { parse } from "yaml"
import type { SkillSummary } from "../shared/SkillCommands.mts"
import { skillMentions } from "../shared/SkillCommands.mts"

export interface CairoSkill extends SkillSummary { id: string; path: string; content: string; includes: string[] }
const validName = /^[a-z][a-z0-9-]{0,62}$/

/** Read on each invocation so edits apply to the next request, without caching prompt text. */
export class SkillLibrary {
  readonly directory: string
  constructor(directory: string) { this.directory = path.resolve(directory) }
  async load(): Promise<CairoSkill[]> {
    const entries = (await readdir(this.directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && validName.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
    if (entries.length > 64) throw new Error("Skill library supports at most 64 skills")
    const skills: CairoSkill[] = []
    for (const entry of entries) {
      const file = path.join(this.directory, entry.name, "SKILL.md")
      let stat
      try { stat = await lstat(file) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error }
      if (!stat.isFile() || stat.size > 32_768) throw new Error(`Skill ${entry.name} must be a regular SKILL.md file under 32 KB`)
      const source = (await readFile(file, "utf8")).replace(/^\uFEFF/, "")
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source)
      if (!match) throw new Error(`Skill ${entry.name} needs YAML frontmatter`)
      let header: { name?: unknown; description?: unknown; metadata?: { includes?: unknown } }
      try { header = parse(match[1], { maxAliasCount: 0 }) } catch { throw new Error(`Skill ${entry.name} has invalid YAML frontmatter`) }
      if (!header || header.name !== entry.name || typeof header.description !== "string" || !header.description.trim() || header.description.length > 1000 || !match[2].trim()) throw new Error(`Skill ${entry.name} needs matching name, description and instructions`)
      const includes = header.metadata?.includes ?? []
      if (!Array.isArray(includes) || includes.length > 16 || includes.some(name => typeof name !== "string" || !validName.test(name))) throw new Error(`Skill ${entry.name} metadata.includes must be a list of skill names`)
      skills.push({ name: entry.name, description: header.description.trim(), path: file, content: match[2].trim(), includes,
        id: `cairo-skill-${entry.name}-${createHash("sha256").update(source).digest("hex").slice(0, 16)}` })
    }
    // Validate the entire catalog, including indirect dependencies and cycles.
    for (const skill of skills) resolveSkills(skills, [skill.name])
    return skills
  }
  async list(): Promise<SkillSummary[]> { return (await this.load()).map(({ name, description }) => ({ name, description })) }
  async forMessage(text: string): Promise<CairoSkill[]> {
    const names = skillMentions(text).map(mention => mention.name)
    return names.length ? resolveSkills(await this.load(), names) : []
  }
}

export function resolveSkills(catalog: CairoSkill[], names: string[]): CairoSkill[] {
  const byName = new Map(catalog.map(skill => [skill.name, skill]))
  const selected = new Map<string, CairoSkill>()
  const visiting = new Set<string>()
  function visit(name: string) {
    if (visiting.has(name)) throw new Error(`Skill dependency cycle at ${name}`)
    if (selected.has(name)) return
    const skill = byName.get(name)
    if (!skill) throw new Error(`Unknown skill /${name}; choose an available skill from the / menu`)
    visiting.add(name)
    for (const dependency of skill.includes) visit(dependency)
    visiting.delete(name)
    selected.set(name, skill)
  }
  for (const name of names) visit(name)
  const result = [...selected.values()]
  if (result.reduce((size, skill) => size + Buffer.byteLength(skill.content, "utf8"), 0) > 65_536) throw new Error("Selected skill instructions exceed 64 KB")
  return result
}
