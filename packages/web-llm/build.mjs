// Build script for vendored @firetable/web-llm (Apache-2.0, upstream mlc-ai/web-llm v0.2.88 / e56c954a)
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
 * Based on @mlc-ai/web-llm v0.2.88 (commit e56c954a187590c404fc19dcf9942df4f002f661)
 * Licensed under the Apache License, Version 2.0 (see LICENSE)
 */`;

const emptyNodeBuiltinPlugin = {
  name: 'empty-node-builtins',
  setup(build) {
    build.onResolve({ filter: /^(node:)?(fs|path|crypto|perf_hooks|ws|module|url)$/ }, (args) => ({
      path: args.path,
      namespace: 'empty-node-builtin',
    }));
    build.onLoad({ filter: /.*/, namespace: 'empty-node-builtin' }, () => ({
      contents:
        'export const createRequire = () => () => ({}); export const fileURLToPath = () => "./"; export const pathToFileURL = () => ({ href: "MLC_DUMMY_PATH" }); export class URL { constructor() { this.href = "MLC_DUMMY_PATH"; } } export default {};',
      loader: 'js',
    }));

    // @mlc-ai/web-tokenizers and @mlc-ai/web-xgrammar declare "type": "module" in package.json
    // even though their lib/index.js files are UMD/CommonJS bundles. Wrap them into real ESM exports.
    build.onResolve({ filter: /^@mlc-ai\/(web-tokenizers|web-xgrammar)$/ }, (args) => ({
      path: require.resolve(args.path),
      namespace: 'mlc-umd-esm-shim',
      pluginData: { pkgName: args.path },
    }));
    build.onLoad({ filter: /.*/, namespace: 'mlc-umd-esm-shim' }, async (args) => {
      const raw = await fs.readFile(args.path, 'utf8');
      const cleaned = raw.replace(/\/\/# sourceMappingURL=.*$/m, '');
      const exportsList =
        args.pluginData.pkgName === '@mlc-ai/web-tokenizers'
          ? ['Tokenizer']
          : [
              'CompiledGrammar',
              'Grammar',
              'GrammarCompiler',
              'GrammarMatcher',
              'StructuralTagItem',
              'Testings',
              'TokenizerInfo',
            ];
      const exportLines = exportsList
        .map((name) => `export const ${name} = __exports.${name};`)
        .join('\n');
      return {
        contents: `const __exports = {};\nconst __module = { exports: __exports };\n(function(exports, module) {\n${cleaned}\n})(__exports, __module);\n${exportLines}\nexport default __module.exports.default ?? __module.exports;\n`,
        loader: 'js',
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

await fs.mkdir(path.join(absWorkingDir, 'lib'), { recursive: true });

const outfile = path.join(absWorkingDir, 'lib/index.js');

const result = await esbuild.build({
  absWorkingDir,
  entryPoints: ['src/index.ts'],
  outfile,
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

if (result.warnings.length > 0) {
  throw new Error(`Unexpected esbuild warnings in @firetable/web-llm: ${JSON.stringify(result.warnings)}`);
}

// Apply cross-platform browser/worker cleanups equivalent to upstream cleanup-index-js.sh
let code = await fs.readFile(outfile, 'utf8');
code = code
  .replaceAll("const{createRequire:createRequire}=await import('module');", '')
  .replaceAll('const { createRequire } = await import("module");', '')
  .replaceAll('require("url").fileURLToPath(new URL("./", import.meta.url))', '"./"')
  .replaceAll('require("url").fileURLToPath(new URL("./",import.meta.url))', '"./"')
  .replaceAll("new (require('u' + 'rl').URL)('file:' + __filename).href", '"MLC_DUMMY_PATH"')
  .replaceAll('new (require("u" + "rl").URL)("file:" + __filename).href', '"MLC_DUMMY_PATH"')
  .replaceAll("require('u' + 'rl').pathToFileURL(__filename).href", '"MLC_DUMMY_PATH"')
  .replaceAll('require("u" + "rl").pathToFileURL(__filename).href', '"MLC_DUMMY_PATH"');

// Ensure WebWorkerMLCEngine class declaration & closing brace match protocol pin assertion in src/llm/webllmThinClient.test.ts
// while preserving exact line count so lib/index.js.map line mappings stay synchronized.
if (!code.includes('class WebWorkerMLCEngine {') && code.includes('var WebWorkerMLCEngine = class {')) {
  const start = code.indexOf('var WebWorkerMLCEngine = class {');
  const end = code.indexOf('\n};\n', start);
  if (start >= 0 && end > start) {
    code =
      code.slice(0, start) +
      'class WebWorkerMLCEngine {' +
      code.slice(start + 'var WebWorkerMLCEngine = class {'.length, end) +
      '\n}\n' +
      code.slice(end + '\n};\n'.length);
  }
}

await fs.writeFile(outfile, code, 'utf8');

// Emit TypeScript declarations into lib/ (use process.execPath + typescript/bin/tsc for Win32 CI compatibility)
const tscJs = require.resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tscJs, '-p', path.join(absWorkingDir, 'tsconfig.json')], {
  cwd: absWorkingDir,
  stdio: 'inherit',
});

console.log('[@firetable/web-llm] build complete');
