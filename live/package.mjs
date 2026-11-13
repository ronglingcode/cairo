import { packager } from '@electron/packager';
import { resolve } from 'node:path';

const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';

const builds = await packager({
  dir: '.', name: 'Cairo Live', appBundleId: 'local.cairolive.app',
  out: process.env.CAIRO_LIVE_RELEASE_DIR ?? 'release', overwrite: true, asar: true,
  ignore: /^\/(?:src|tests|release)(?:\/|$)/,
  extraResource: [resolve('node_modules', '@opencode', 'cli', 'bin', binaryName)],
  ...(process.platform === 'darwin' ? { extendInfo: 'mac.plist' } : {}),
});
console.log(builds.join('\n'));
