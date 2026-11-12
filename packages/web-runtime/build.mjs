// Build script for vendored @firetable/web-runtime (Apache-2.0, upstream apache/tvm cbb1e12 / 0.28.0-dev2)
import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const absWorkingDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await fs.readFile(path.join(absWorkingDir, 'package.json'), 'utf8'));

const banner = `/*!
 * ${pkg.name} v${pkg.version}
 * Based on Apache TVM web runtime (@mlc-ai/web-runtime 0.28.0-dev2, commit cbb1e12)
 * Licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE)
 */`;

const emptyNodeBuiltinPlugin = {
  name: 'empty-node-builtins',
  setup(build) {
    build.onResolve({ filter: /^(node:)?(fs|path|crypto|perf_hooks|ws)$/ }, (args) => ({
      path: args.path,
      namespace: 'empty-node-builtin',
    }));
    build.onLoad({ filter: /.*/, namespace: 'empty-node-builtin' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

await fs.mkdir(path.join(absWorkingDir, 'lib'), { recursive: true });

await esbuild.build({
  absWorkingDir,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  sourcemap: true,
  banner: { js: banner },
  plugins: [emptyNodeBuiltinPlugin],
  logLevel: 'info',
});

// Emit TypeScript declarations into lib/ (use process.execPath + typescript/bin/tsc for Win32 CI compatibility)
const tscJs = require.resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tscJs, '-p', path.join(absWorkingDir, 'tsconfig.json')], {
  cwd: absWorkingDir,
  stdio: 'inherit',
});

// Provide ambient declaration for JS WASI helper if tsc skipped .js d.ts
await fs.writeFile(
  path.join(absWorkingDir, 'lib/tvmjs_runtime_wasi.d.ts'),
  'declare const EmccWASI: new () => any;\nexport default EmccWASI;\n',
  'utf8',
);

console.log('[@firetable/web-runtime] build complete');
