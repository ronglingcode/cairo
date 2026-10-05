import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This private build supports Windows x64')
const root = process.cwd(), pkg = JSON.parse(await readFile('package.json', 'utf8')), lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) if (lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`Lockfile mismatch: ${name}`)
if (!process.argv.includes('--skip-build')) { const result = spawnSync('npm.cmd', ['run', 'build'], { shell: true, stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1) }
const digest = createHash('sha256'); const built = []
async function visit(directory) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) { const file = path.join(directory, entry.name); if (entry.isDirectory()) await visit(file); else { const bytes = await readFile(file); digest.update(file).update(bytes); built.push({ path: file.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') }) } } }
for (const directory of ['dist', 'dist-electron', 'dist-copilot', 'resources/references', 'skills']) await visit(directory)
digest.update(await readFile('package-lock.json')); const buildId = digest.digest('hex').slice(0, 12)
const destination = path.resolve(root, 'release', `Cairo ${pkg.version} ${buildId}`)
if (!destination.startsWith(path.resolve(root, 'release') + path.sep)) throw new Error('Invalid package output')
await mkdir(path.dirname(destination), { recursive: true }); await mkdir(destination, { recursive: false }); await cp('node_modules/electron/dist', destination, { recursive: true })
await rename(path.join(destination, 'electron.exe'), path.join(destination, 'Cairo.exe'))
const appRoot = path.join(destination, 'resources', 'app'); await mkdir(appRoot, { recursive: true })
await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'dist-electron/main.js' }, null, 2))
for (const directory of ['dist', 'dist-electron', 'resources/references', 'skills']) await cp(directory, path.join(appRoot, directory), { recursive: true })
await mkdir(path.join(destination, 'resources', 'opencode'), { recursive: true }); await mkdir(path.join(destination, 'resources', 'copilot'), { recursive: true })
await cp('node_modules/@opencode/cli/bin/opencode.exe', path.join(destination, 'resources', 'opencode', 'opencode.exe'))
await cp('dist-copilot/cairo-plugin.js', path.join(destination, 'resources', 'copilot', 'cairo-plugin.js'))
let notices = '# Third-party notices\n\nElectron LICENSE and LICENSES.chromium.html are included beside Cairo.exe.\n\n'
for (const key of Object.keys(lock.packages).sort()) {
  if (!key.startsWith('node_modules/')) continue
  try {
    const dependency = JSON.parse(await readFile(path.join(key, 'package.json'), 'utf8')); notices += `## ${dependency.name} ${dependency.version}\nLicense: ${dependency.license ?? 'See upstream repository'}\nRepository: ${typeof dependency.repository === 'object' ? dependency.repository.url : dependency.repository ?? ''}\n\n`
    const files = (await readdir(key)).filter(file => /^(license|copying|notice)(\.|$)/i.test(file))
    for (const file of files) notices += `${file}:\n\n${await readFile(path.join(key, file), 'utf8')}\n\n`
  } catch { /* Platform-specific dependencies absent from this lockfile installation are not bundled. */ }
}
await writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.md'), notices)
await writeFile(path.join(destination, 'BUILD-MANIFEST.json'), JSON.stringify({ version: pkg.version, buildId, platform: 'win32-x64', electron: pkg.devDependencies.electron, opencode: pkg.dependencies['@opencode/cli'], lockSha256: createHash('sha256').update(await readFile('package-lock.json')).digest('hex'), files: built }, null, 2))
console.log(`PACKAGE_PATH=${destination}`)
