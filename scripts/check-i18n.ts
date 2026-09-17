import { zhCN } from '../src/i18n/zh-CN';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import fs from 'fs';
import path from 'path';

function getFlattenedKeys(obj: any, prefix = ''): string[] {
  let keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const nextKey = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys = keys.concat(getFlattenedKeys(obj[k], nextKey));
    } else {
      keys.push(nextKey);
    }
  }
  return keys;
}

const zhKeys = new Set(getFlattenedKeys(zhCN));
const enKeys = new Set(getFlattenedKeys(en));
const jaKeys = new Set(getFlattenedKeys(ja));

console.log(`[i18n] Total keys: zh-CN = ${zhKeys.size}, en = ${enKeys.size}, ja = ${jaKeys.size}`);

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
const missingInJa = [...zhKeys].filter((k) => !jaKeys.has(k));
const extraInEn = [...enKeys].filter((k) => !zhKeys.has(k));
const extraInJa = [...jaKeys].filter((k) => !zhKeys.has(k));

let hasError = false;

if (missingInEn.length > 0) {
  console.error('❌ Missing in EN:', missingInEn);
  hasError = true;
}
if (missingInJa.length > 0) {
  console.error('❌ Missing in JA:', missingInJa);
  hasError = true;
}
if (extraInEn.length > 0) {
  console.error('❌ Extra in EN:', extraInEn);
  hasError = true;
}
if (extraInJa.length > 0) {
  console.error('❌ Extra in JA:', extraInJa);
  hasError = true;
}

function getAllFiles(dir: string, exts: string[]): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'i18n' && e.name !== 'node_modules' && !e.name.startsWith('.')) {
        files = files.concat(getAllFiles(full, exts));
      }
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

const allSrc = getAllFiles(path.resolve('src'), ['.ts', '.tsx']);
const tCallRegex = /\bt\(\s*['"`]([^'"`]+)['"`]/g;
const usedKeys = new Set<string>();

for (const f of allSrc) {
  const content = fs.readFileSync(f, 'utf-8');
  let match;
  while ((match = tCallRegex.exec(content)) !== null) {
    const key = match[1];
    if (!key.includes('${') && key.trim()) {
      usedKeys.add(key);
    }
  }
}

console.log(`[i18n] Total unique static keys used in t(): ${usedKeys.size}`);
const unresolvedKeys = [...usedKeys].filter((k) => !zhKeys.has(k));

if (unresolvedKeys.length > 0) {
  console.error('❌ Unresolved keys called in codebase:', unresolvedKeys);
  hasError = true;
}

if (hasError) {
  console.error('\n💥 i18n parity check failed.');
  process.exit(1);
} else {
  console.log('\n✅ i18n check passed: 100% key parity across zh-CN, en, and ja with zero missing keys.\n');
}
