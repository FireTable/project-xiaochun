// /embed 界面语言偏好 (纯逻辑): pnpm test:embed
// 优先级: URL / SDK 显式 > iframe 自己 localStorage 里用户选的 > 浏览器语言 > zh-CN
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMBED_DEFAULT_LANG, langFromNavigator, readLangPref, resolveEmbedLang, writeLangPref } from '../registry.ts';

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), _m: m };
};

test('langFromNavigator: zh* → zh-CN, ja* → ja, en* → en, 取第一个能识别的; 都不认识 → null', () => {
  assert.equal(langFromNavigator(['zh-TW', 'en']), 'zh-CN');
  assert.equal(langFromNavigator(['zh-Hans-CN']), 'zh-CN');
  assert.equal(langFromNavigator(['ja-JP']), 'ja');
  assert.equal(langFromNavigator(['en-US', 'ja']), 'en');
  assert.equal(langFromNavigator(['fr-FR', 'ja']), 'ja');
  assert.equal(langFromNavigator(['fr-FR', 'de']), null);
  assert.equal(langFromNavigator([]), null);
  assert.equal(langFromNavigator(undefined), null);
  assert.equal(langFromNavigator(['english']), null, '只认 en / en-*');
});

test('resolveEmbedLang: 显式 > 存储 > 浏览器 > 默认', () => {
  assert.equal(resolveEmbedLang('ja', 'en', ['zh-CN']), 'ja');
  assert.equal(resolveEmbedLang(null, 'en', ['zh-CN']), 'en');
  assert.equal(resolveEmbedLang(null, null, ['ja-JP']), 'ja');
  assert.equal(resolveEmbedLang(null, null, ['fr']), EMBED_DEFAULT_LANG);
  assert.equal(EMBED_DEFAULT_LANG, 'zh-CN');
});

test('resolveEmbedLang: 显式值非法按没给处理 (不会盖掉存储)', () => {
  for (const bad of ['fr', '', 'EN', 'zh', '__proto__', 1, {}, undefined]) {
    assert.equal(resolveEmbedLang(bad, 'ja', ['en']), 'ja', String(bad));
  }
});

test('readLangPref / writeLangPref: 往返; 坏数据忽略并清掉; 存储不可用不抛错', () => {
  const st = mem();
  assert.equal(readLangPref(st, 'k'), null);
  writeLangPref(st, 'k', 'en');
  assert.equal(readLangPref(st, 'k'), 'en');
  st.setItem('k', 'klingon');
  assert.equal(readLangPref(st, 'k'), null);
  assert.equal(st._m.has('k'), false, '坏数据被清掉');
  assert.equal(readLangPref(null, 'k'), null);
  writeLangPref(null, 'k', 'ja');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readLangPref(broken, 'k'), null);
  assert.doesNotThrow(() => writeLangPref(broken, 'k', 'en'));
});
