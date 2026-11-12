import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DevHttpsResolution {
  https: { cert: Buffer; key: Buffer } | undefined;
  useBasicSsl: boolean;
  mode: 'http-forced' | 'mkcert-trusted' | 'https-forced-untrusted' | 'http-fallback';
}

export function collectLocalCertHosts(): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '::1']);
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.internal) continue;
      if (net.family === 'IPv4' && net.address) {
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

export function findMkcertBinary(): string | null {
  const candidates = ['mkcert', '/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

export function ensureMkcertLeafCert(rootDir: string, mkcertBin: string, hosts: string[]): {
  certPath: string;
  keyPath: string;
} {
  const certDir = path.join(rootDir, '.certs');
  const certPath = path.join(certDir, 'dev-cert.pem');
  const keyPath = path.join(certDir, 'dev-key.pem');
  const metaPath = path.join(certDir, 'hosts.json');

  let needsIssue = !fs.existsSync(certPath) || !fs.existsSync(keyPath);
  if (!needsIssue && fs.existsSync(metaPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { hosts?: string[] };
      const prevSet = new Set(prev.hosts ?? []);
      if (hosts.some((h) => !prevSet.has(h))) {
        needsIssue = true;
      }
    } catch {
      needsIssue = true;
    }
  } else if (!fs.existsSync(metaPath)) {
    needsIssue = true;
  }

  if (needsIssue) {
    fs.mkdirSync(certDir, { recursive: true });
    execFileSync(mkcertBin, ['-cert-file', certPath, '-key-file', keyPath, ...hosts], {
      stdio: 'ignore',
    });
    fs.writeFileSync(metaPath, JSON.stringify({ hosts, updatedAt: new Date().toISOString() }, null, 2));
  }

  return { certPath, keyPath };
}

export function isCertTrustedByOS(certPath: string): boolean {
  if (!fs.existsSync(certPath)) return false;
  if (process.platform === 'darwin') {
    try {
      execFileSync('security', ['verify-cert', '-c', certPath], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  // On Linux/Windows, consider present mkcert leaf cert usable if rootCA.pem exists
  return true;
}

let loggedFallbackHint = false;

export function resolveDevHttps(rootDir: string, isServe: boolean, isTauri: boolean): DevHttpsResolution {
  if (!isServe || isTauri || process.env.VITE_HTTP === '1' || process.env.VITE_HTTPS === '0') {
    return { https: undefined, useBasicSsl: false, mode: 'http-forced' };
  }

  const forceHttps = process.env.VITE_HTTPS === '1';
  const mkcertBin = findMkcertBinary();
  const certDir = path.join(rootDir, '.certs');
  let certPath = path.join(certDir, 'dev-cert.pem');
  let keyPath = path.join(certDir, 'dev-key.pem');

  if (mkcertBin) {
    try {
      const hosts = collectLocalCertHosts();
      ({ certPath, keyPath } = ensureMkcertLeafCert(rootDir, mkcertBin, hosts));
    } catch {
      // fall through to existing files or HTTP fallback
    }
  }

  const hasCertFiles = fs.existsSync(certPath) && fs.existsSync(keyPath);
  if (hasCertFiles && isCertTrustedByOS(certPath)) {
    return {
      https: {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      },
      useBasicSsl: false,
      mode: 'mkcert-trusted',
    };
  }

  if (forceHttps) {
    if (hasCertFiles) {
      return {
        https: {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        },
        useBasicSsl: false,
        mode: 'https-forced-untrusted',
      };
    }
    return { https: undefined, useBasicSsl: true, mode: 'https-forced-untrusted' };
  }

  if (!loggedFallbackHint) {
    loggedFallbackHint = true;
    console.info(
      '[dev-https] Local mkcert CA is not trusted in system keychain yet — serving plain HTTP (no cert warnings on localhost). Run `pnpm setup:https` once to enable green-lock HTTPS.',
    );
  }
  return { https: undefined, useBasicSsl: false, mode: 'http-fallback' };
}
