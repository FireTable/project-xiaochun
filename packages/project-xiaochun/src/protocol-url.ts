/**
 * protocol-url.ts — `xiaochun://` OS 级 deep link 与 `xc.*` postMessage 的对照工具。
 *
 * 两者是「同一语义的两个传输层」:
 *   - xiaochun://  : 只在 Tauri 桌面壳里由 OS 分发 (open "xiaochun://speak?text=…"), iframe / 浏览器里的 /embed 不会响应;
 *   - xc.*         : iframe 与宿主页之间的 postMessage, 只在 /embed 里生效。
 * 两边在主应用里最终进同一个 handler (src/core/protocol/handler.ts), 动作对象是同一套 (speak / audio)。
 * 这个文件只提供「拼 / 解析 deep link 字符串」的纯函数 (给桌面端脚本、文档示例、<a href> 用), 零运行时依赖。
 */

/** `xiaochun://speak` 的参数。至少给 text / audioUrl / file 之一。 */
export interface XiaochunSpeakAction {
  action: 'speak';
  /** 台词文本; 与 audioUrl 同时给时只作气泡文字, 不再 TTS。URL 里会自动 encode。practical 上限约 1000~3000 汉字。 */
  text?: string;
  /** 预合成音频 URL (https), 绕过 TTS ⇒ 等价于 `xc.audio` 的 URL 形式。 */
  audioUrl?: string;
  /** 本机文本文件路径 (超长文本)。仅桌面壳可读, 在 iframe 里没有对应物。 */
  file?: string;
}

export const XIAOCHUN_PROTOCOL_SCHEME = 'xiaochun';

/** 拼出 `xiaochun://speak?...`。参数都缺时抛错; audioUrl 必须是 http(s)。 */
export function toProtocolUrl(a: XiaochunSpeakAction): string {
  if (a.action !== 'speak') throw new Error(`[project-xiaochun] unsupported action: ${String(a.action)}`);
  if (!a.text && !a.audioUrl && !a.file) throw new Error('[project-xiaochun] speak needs text, audioUrl or file');
  if (a.audioUrl && !/^https?:\/\//i.test(a.audioUrl)) throw new Error('[project-xiaochun] audioUrl must be http(s)');
  const q = new URLSearchParams();
  if (a.text) q.set('text', a.text);
  if (a.audioUrl) q.set('audioUrl', a.audioUrl);
  if (a.file) q.set('file', a.file);
  // URLSearchParams 把空格编成 '+', 而桌面壳按 %20 解码更稳 → 统一成 %20
  return `${XIAOCHUN_PROTOCOL_SCHEME}://speak?${q.toString().replace(/\+/g, '%20')}`;
}

/** 反向解析 (只认 speak; 不认识的返回 null)。支持 `xiaochun://speak?…`、`xiaochun:///speak?…`、`xiaochun://action?action=speak&…`。 */
export function parseProtocolUrl(url: string): XiaochunSpeakAction | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${XIAOCHUN_PROTOCOL_SCHEME}:`) return null;
  const name = u.hostname || u.pathname.replace(/^\/+/, '');
  const action = name === 'action' ? u.searchParams.get('action') : name;
  if (action !== 'speak') return null;
  const out: XiaochunSpeakAction = { action: 'speak' };
  const text = u.searchParams.get('text');
  const audioUrl = u.searchParams.get('audioUrl');
  const file = u.searchParams.get('file');
  if (text) out.text = text;
  if (audioUrl) out.audioUrl = audioUrl;
  if (file) out.file = file;
  return out.text || out.audioUrl || out.file ? out : null;
}
