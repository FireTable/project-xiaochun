// Minimal esbuild for vendored @firetable/three-vrm-materials-mtoon
// (adapted from pixiv/three-vrm bin/build.mjs — MIT, (c) 2019-2026 pixiv Inc.)
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const absWorkingDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  await (await import('node:fs/promises')).readFile(path.join(absWorkingDir, 'package.json'), 'utf8'),
);

const copyright = '(c) 2019-2026 pixiv Inc.; FireTable XiaoChun fork';
const licenseUri = 'https://github.com/pixiv/three-vrm/blob/release/LICENSE';
const filename = 'three-vrm-materials-mtoon';

const banner = `/*!
 * ${packageJson.name} v${packageJson.version}
 * ${packageJson.description}
 *
 * Copyright ${copyright}
 * Distributed under MIT License
 * Upstream: ${licenseUri}
 */`;

const base = {
  banner: { js: banner },
  bundle: true,
  target: 'es6',
  loader: { '.frag': 'text', '.vert': 'text' },
  absWorkingDir,
  logLevel: 'info',
  external: ['three'],
};

async function build(format, minify) {
  const suffix = (format === 'esm' ? '.module' : '') + (minify ? '.min' : '');
  const outdir = 'lib';
  await esbuild.build({
    ...base,
    format,
    minify,
    sourcemap: minify ? false : 'inline',
    entryPoints: {
      [`${filename}${suffix}`]: 'src/index.ts',
      [`nodes/index${suffix}`]: 'src/nodes/index.ts',
    },
    outdir,
    outExtension: { '.js': format === 'esm' ? '.js' : '.cjs' },
  });
}

await build('esm', false);
await build('esm', true);
await build('cjs', false);
await build('cjs', true);
console.log('build complete');
