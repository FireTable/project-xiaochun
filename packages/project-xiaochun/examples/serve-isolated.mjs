#!/usr/bin/env node
// 带跨源隔离响应头的最小静态服务 (仅本地验证 crossOriginIsolated 选项用)。
//   node packages/project-xiaochun/examples/serve-isolated.mjs [port=8081] [coep=credentialless|require-corp]
// 然后打开 http://localhost:8081/examples/embed-host.html?isolated=1
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8081;
const coep = process.argv[3] === 'require-corp' ? 'require-corp' : 'credentialless';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json' };

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, path.normalize(u));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', coep);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`isolated host (COOP same-origin + COEP ${coep}) → http://localhost:${port}/examples/embed-host.html?isolated=1`));
