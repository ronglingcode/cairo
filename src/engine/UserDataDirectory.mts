import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/** Like Bookmap's user.home/bmtrader, Cairo owns a folder under the user's home. */
export function prepareUserDataDirectory(legacyDirectory: string, override = process.env.CAIRO_USER_DATA, home = homedir()): string {
  if (override) return path.resolve(override)
  const directory = path.join(home, "cairo")
  if (!existsSync(directory) && existsSync(legacyDirectory)) {
    // Publish only a complete copy, including preparation and broker recovery state.
    const staging = mkdtempSync(path.join(home, ".cairo-migration-"))
    cpSync(legacyDirectory, staging, { recursive: true })
    renameSync(staging, directory)
  }
  mkdirSync(directory, { recursive: true })
  return directory
}
