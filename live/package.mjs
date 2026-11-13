import { packager } from '@electron/packager';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const releaseRoot = resolve('release');
const outputRoot = resolve(process.env.CAIRO_LIVE_RELEASE_DIR ?? 'release');
const buildId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();

const builds = await packager({
  dir: '.', name: 'Cairo Live', appBundleId: 'local.cairolive.app',
  out: process.platform === 'win32' ? join(outputRoot, buildId) : outputRoot,
  overwrite: process.platform !== 'win32', asar: true,
  ignore: /^\/(?:src|tests|release)(?:\/|$)/,
  extraResource: [resolve('node_modules', '@opencode', 'cli', 'bin', binaryName)],
  ...(process.platform === 'darwin' ? { extendInfo: 'mac.plist' } : {}),
});
if (process.platform === 'win32') {
  if (builds.length !== 1) throw new Error('Expected one Windows build');
  const executable = resolve(builds[0], 'Cairo Live.exe');
  await Promise.all([access(executable), access(resolve(builds[0], 'resources', 'opencode.exe'))]);
  await mkdir(releaseRoot, { recursive: true });
  const pending = join(releaseRoot, buildId + '.tmp');
  await writeFile(pending, executable + '\r\n', 'utf16le');
  await rename(pending, join(releaseRoot, 'latest-windows.txt'));
}
console.log(builds.join('\n'));
