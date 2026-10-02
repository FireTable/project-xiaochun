// project-xiaochun 构建: esbuild (JS) + tsc (类型声明)。零运行时依赖, 不引入 three。
//   dist/index.js|cjs        ESM / CJS 主入口 (createXiaochun + 协议常量)
//   dist/element.js|cjs      副作用入口, 注册 <xiaochun-avatar>
//   dist/react.js|cjs        React 绑定 (子路径 /react, react 为 external optional peer, 带 'use client')
//   dist/protocol.js|cjs     协议常量/类型 (主仓库 /embed 同源码)
//   dist/loader.global.js    IIFE 一行 <script> 形态 (unpkg / jsDelivr), 全局 window.Xiaochun
//   dist/*.d.ts              类型声明
import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const banner = `/*! ${pkg.name} v${pkg.version} | MIT | https://github.com/FireTable/project-xiaochun */`;

const common = { absWorkingDir: root, bundle: true, target: 'es2020', platform: 'browser', banner: { js: banner }, logLevel: 'info' };
const entries = { index: 'src/index.ts', element: 'src/element.ts', protocol: 'src/protocol.ts', react: 'src/react.ts' };
// react 是 optional peerDependency: 绝不打进包里 (否则宿主会有两份 React → hooks 报错)
const external = ['react'];

rmSync(path.join(root, 'dist'), { recursive: true, force: true });

// ESM: splitting 让 index / element 共享同一份 client 代码
await esbuild.build({ ...common, format: 'esm', external, splitting: true, entryPoints: entries, outdir: 'dist', chunkNames: 'chunks/[name]-[hash]', sourcemap: true });
// CJS: 各入口独立打包
await esbuild.build({ ...common, format: 'cjs', external, entryPoints: entries, outdir: 'dist', outExtension: { '.js': '.cjs' }, sourcemap: true });
// IIFE loader (压缩)
await esbuild.build({ ...common, format: 'iife', globalName: 'Xiaochun', entryPoints: { 'loader.global': 'src/loader.ts' }, outdir: 'dist', minify: true, sourcemap: true });

// 类型声明
execFileSync(
  process.execPath,
  [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist'],
  { cwd: root, stdio: 'inherit' },
);
console.log(`[project-xiaochun] built v${pkg.version}`);
