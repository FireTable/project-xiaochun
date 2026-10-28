#!/usr/bin/env node
/**
 * Report CJK (Chinese / Japanese kana) string literals, template literals and JSX text in .ts/.tsx
 * under src/ that are NOT routed through the i18n system. Comments are ignored (AST based).
 *
 * Allowed (not reported):
 *   - console.* arguments (developer logs, not UI)
 *   - src/i18n/**, tests, and story-line data files (listed in ALLOW_FILES)
 *   - the 2nd argument (default text) of t('key', '中文默认值'), i18n.t(...), getT(...)
 *   - the 2nd-4th arguments of L(zh, en, ja) trilingual helpers
 *   - object-literal values keyed by 'zh-CN' / zh / en / ja (inline localized tables)
 *   - properties named default* (defaultLabel / defaultText: i18n fallbacks next to a key)
 *   - lines (or the line right after) marked with a `i18n-ok` comment: intentional, e.g. native-language names
 *
 * With --latin it additionally reports hard-coded English UI text: string-literal JSX attributes
 * (aria-label / title / placeholder / alt) and JSX text made of 2+ English words, in src/components, src/App.tsx.
 *
 * --ui limits the scan to user-facing UI code (src/components except dev-drawer, src/App.tsx, src/routes, src/hooks, src/story/storyEngine.ts)
 * and ignores a few non-UI technical strings (see UI_IGNORE).
 *
 * Usage: node scripts/check-cjk-literals.mjs [--json] [--latin] [--ui]   (exit 1 when findings exist)
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
const ALLOW_DIRS = ['i18n'];
const ALLOW_FILES = new Set([
  'story/prologueStory.ts', // story-line data: every line is a trilingual L(zh, en, ja)
  'story/localize.ts',
]);
const T_CALLEES = new Set(['t', 'getT', 'tr']);
const L_CALLEES = new Set(['L']);
const LANG_KEYS = new Set(['zh-CN', 'zh', 'zhCN', 'en', 'ja']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'assets') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function calleeName(call) {
  const ex = call.expression;
  if (ts.isIdentifier(ex)) return ex.text;
  if (ts.isPropertyAccessExpression(ex)) return ex.name.text;
  return '';
}

function allowedByContext(node) {
  for (let n = node, parent = node.parent; parent; n = parent, parent = parent.parent) {
    if (ts.isCallExpression(parent)) {
      const name = calleeName(parent);
      if (ts.isPropertyAccessExpression(parent.expression) && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'console') return true; // dev logs are not UI
      const idx = parent.arguments.indexOf(n);
      if (T_CALLEES.has(name) && idx >= 1) return true;
      if (L_CALLEES.has(name)) return true;
    }
    if (ts.isPropertyAssignment(parent)) {
      const k = parent.name;
      const key = ts.isIdentifier(k) || ts.isStringLiteral(k) ? k.text : '';
      if (LANG_KEYS.has(key) || /^default[A-Z]/.test(key)) return true;
    }
    if (ts.isStatement(parent)) return false;
  }
  return false;
}

const LATIN = process.argv.includes('--latin');
const UI_ONLY = process.argv.includes('--ui');
const isUiFile = (rel) =>
  (rel.startsWith('components/') && !rel.startsWith('components/dev-drawer/')) ||
  rel === 'App.tsx' || rel.startsWith('routes/') || rel.startsWith('hooks/') || rel === 'story/storyEngine.ts';
/** non-UI technical strings that legitimately contain CJK (brand/SEO meta, punctuation regex replacements) */
const UI_IGNORE = [/^routes\/__root\.tsx$/];
const UI_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description']);
const findings = [];
const marked = (text, line) => { const ls = text.split('\n'); return /i18n-ok/.test(ls[line] ?? '') || /i18n-ok/.test(ls[line - 1] ?? ''); };
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (ALLOW_DIRS.some((d) => rel.startsWith(d + '/')) || ALLOW_FILES.has(rel)) continue;
  if (UI_ONLY && (!isUiFile(rel) || UI_IGNORE.some((r) => r.test(rel)))) continue;
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (node, value, kind) => {
    if (!CJK.test(value) || allowedByContext(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const lines = text.split('\n');
    if (/i18n-ok/.test(lines[line] ?? '') || /i18n-ok/.test(lines[line - 1] ?? '')) return;
    findings.push({ file: rel, line: line + 1, kind, text: value.trim().replace(/\s+/g, ' ').slice(0, 80) });
  };
  const isUi = rel.startsWith('components/') || rel === 'App.tsx';
  const visit = (node) => {
    if (LATIN && isUi && ts.isJsxAttribute(node) && UI_ATTRS.has(node.name.getText(sf)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]{2,}/.test(node.initializer.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (!marked(text, line))
      findings.push({ file: rel, line: line + 1, kind: 'attr-en', text: `${node.name.getText(sf)}="${node.initializer.text}"` });
    }
    if (LATIN && isUi && ts.isJsxText(node) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(node.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (!marked(text, line))
      findings.push({ file: rel, line: line + 1, kind: 'jsx-text-en', text: node.text.trim().replace(/\s+/g, ' ').slice(0, 80) });
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text, 'string');
    else if (ts.isTemplateExpression(node)) {
      const all = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('');
      report(node, all, 'template');
    } else if (ts.isJsxText(node)) report(node, node.text, 'jsx-text');
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
else {
  for (const f of findings) console.log(`${f.file}:${f.line} [${f.kind}] ${f.text}`);
  console.log(`\n[cjk-literals] ${findings.length} un-i18n'd CJK literal(s) in src/`);
}
process.exit(findings.length ? 1 : 0);
