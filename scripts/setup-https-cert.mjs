#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findMkcert() {
  for (const bin of ['mkcert', '/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {}
  }
  return null;
}

function collectHosts() {
  const hosts = new Set(['localhost', '127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    if (!entries) continue;
    for (const net of entries) {
      if (!net.internal && net.family === 'IPv4' && net.address) {
        hosts.add(net.address);
      }
    }
  }
  const hostname = os.hostname()?.trim();
  if (hostname && /^[a-zA-Z0-9.-]+$/.test(hostname)) {
    hosts.add(hostname);
  }
  return Array.from(hosts);
}

function isTrusted(certPath) {
  if (!fs.existsSync(certPath)) return false;
  if (process.platform === 'darwin') {
    try {
      execFileSync('security', ['verify-cert', '-c', certPath], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

const mkcert = findMkcert();
if (!mkcert) {
  console.error('❌ mkcert 未安装。请先执行: brew install mkcert');
  process.exit(1);
}

const hosts = collectHosts();
const certDir = path.join(rootDir, '.certs');
const certPath = path.join(certDir, 'dev-cert.pem');
const keyPath = path.join(certDir, 'dev-key.pem');
const metaPath = path.join(certDir, 'hosts.json');

fs.mkdirSync(certDir, { recursive: true });
console.log(`📜 [1/2] 签发本地开发证书 (${hosts.join(', ')})...`);
execFileSync(mkcert, ['-cert-file', certPath, '-key-file', keyPath, ...hosts], { stdio: 'inherit' });
fs.writeFileSync(metaPath, JSON.stringify({ hosts, updatedAt: new Date().toISOString() }, null, 2));

let trusted = isTrusted(certPath);
if (!trusted && process.stdin.isTTY && !process.env.CI && process.env.NONINTERACTIVE !== '1') {
  console.log('🔐 [2/2] 正在将本地 mkcert 根证书写入系统钥匙串 (请输入本机开机密码授权一次)...');
  try {
    execFileSync(mkcert, ['-install'], { stdio: 'inherit' });
    trusted = isTrusted(certPath);
  } catch {
    // user cancelled or non-tty
  }
}

const caRoot = execFileSync(mkcert, ['-CAROOT'], { encoding: 'utf8' }).trim();
console.log(`🔍 系统信任状态: ${trusted ? '✅ 已受 macOS 系统信任（https://localhost:5185 绿锁生效！）' : '⏳ 证书已生成，尚未写入系统钥匙串（当前 pnpm dev 会自动优雅回退到免拦截 HTTP；在终端运行一次 `mkcert -install` 即可永久激活绿锁 HTTPS）'}`);
console.log(`   - 证书文件: ${certPath}`);
console.log(`   - 手机真机绿锁可选: 将 "${path.join(caRoot, 'rootCA.pem')}" AirDrop 到手机安装并在「设置 -> 通用 -> 关于本机 -> 证书信任设置」开启完全信任。`);
