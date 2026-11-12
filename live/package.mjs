import { packager } from '@electron/packager';

const builds = await packager({
  dir: '.', name: 'Cairo Live', appBundleId: 'local.cairolive.app',
  out: 'release', overwrite: true, asar: true,
  ignore: /^\/(src|tests|release)(\/|$)/,
  ...(process.platform === 'darwin' ? { extendInfo: 'mac.plist' } : {}),
});
console.log(builds.join('\n'));
