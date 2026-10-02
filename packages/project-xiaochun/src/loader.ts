/**
 * loader.ts — 一行 <script> 形态 (IIFE, 经 unpkg / jsDelivr 使用):
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@firetable/project-xiaochun/dist/loader.global.js" defer></script>
 *   <xiaochun-avatar position="bottom-right" size="280"></xiaochun-avatar>
 *
 * 全局 `window.Xiaochun` = { createXiaochun, defineXiaochunElement, ... }。
 * 想连标签都不写: 给 script 加 `data-auto`, 并可用 data-* 传 element 同名属性:
 *   <script src=".../loader.global.js" data-auto data-position="bottom-right" data-size="280" data-lang="zh-CN" defer></script>
 */
import { defineXiaochunElement } from './avatar-element';
export * from './index';

defineXiaochunElement();

const s = document.currentScript as HTMLScriptElement | null;
if (s && s.hasAttribute('data-auto')) {
  const mount = () => {
    const el = document.createElement('xiaochun-avatar');
    for (const a of Array.from(s.attributes)) {
      if (a.name.startsWith('data-') && a.name !== 'data-auto') el.setAttribute(a.name.slice(5), a.value);
    }
    if (!el.hasAttribute('position')) el.setAttribute('position', 'bottom-right');
    document.body.appendChild(el);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}
