import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { APP_CONFIG } from '@/config';
import { POSTFX_STORAGE_KEY, SCENE_THEME_KEY } from '@/lib/constants';
import type { LineworkTheme } from '@/core/scene/lineworkWorld';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 统一获取渲染像素比 (VRMEngine / PostFX 通用)：
 * 严格限制在物理 devicePixelRatio 与 APP_CONFIG.renderer.maxPixelRatio 之间，
 * 杜绝无节制的超采样 (supersampling) 造成 GPU 显存与填充率浪费。
 */
export function getRenderPixelRatio(maxRatio: number = APP_CONFIG.renderer.maxPixelRatio): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, maxRatio);
}

/**
 * ponytail: postFX 总开关从 localStorage 读取。DevDrawer 折叠时 PostFxSection
 * 不 mount,React useEffect 不跑,vrmEngine init 仍要读到用户上次的选择,
 * 否则 refresh 后总是回到默认 enabled=true。
 */
export function loadPostFxEnabledFromStorage(): boolean | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(POSTFX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const enabled = parsed?.postfx?.enabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  }
}

/**
 * 解析场景线稿主题（light / dark）：
 * 1. 优先读取用户在 localStorage 中显式选择的持久化偏好 (SCENE_THEME_KEY)；
 * 2. 初次访问（localStorage 无记录）时，自适应探测用户设备系统的亮暗模式 (prefers-color-scheme: dark)；
 *    若设备处于深色模式，则默认切到极夜深蓝线稿 ('dark')，杜绝首屏白光刺眼；
 * 3. 兜底使用 APP_CONFIG.scene.theme（默认 'light'）。
 */
export function resolveInitialSceneTheme(): LineworkTheme {
  if (typeof window === 'undefined') return APP_CONFIG.scene?.theme ?? 'light';
  try {
    const stored = localStorage.getItem(SCENE_THEME_KEY) as LineworkTheme | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {}

  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {}

  return APP_CONFIG.scene?.theme ?? 'light';
}

/**
 * 智能分句与切段器 (Smart Speech Chunk Slicer)
 * 1. 统一各段语义完整度与抑扬顿挫 (约 25~65 个字，在句号、感叹号、问号或换行处自然切分)；
 * 2. 绝不在词语中硬切，严格在标点处分段；若长句超过 45~65 字无句号，则在逗号、分号处切分换气；
 * 3. 既支持流式增量提取 (extractNextSpeechChunk)，又支持全文离线数组切分 (splitIntoSpeechChunks)。
 */
const SENTENCE_DELIMS = /(?:[。！？!?\n]|\.(?:\s+|$))/g;
const COMMA_DELIMS = /(?:[，,；;]|,(?:\s+|$)|;(?:\s+|$))/g;

/**
 * 增量提取下一个符合语音停顿与动作时序的切片。
 * @param remaining 当前未结算的文本缓冲区
 * @param isStreamEnd 是否已是流的终点 (文本全部生成完毕)
 * @returns 提取出的 chunk 和剩余未消费文本，若当前不足以成句则返回 null
 */
export function extractNextSpeechChunk(
  remaining: string,
  isStreamEnd: boolean = false,
): { chunk: string; remaining: string } | null {
  const clean = remaining.trimStart();
  if (!clean) return null;

  // 流尚未结束且长度较短，继续等待更多 Token 汇聚
  if (!isStreamEnd && clean.length < 25) {
    return null;
  }

  // 流已结束且剩余内容很短，整段作为一个 chunk 发射
  if (isStreamEnd && clean.length <= 55) {
    return { chunk: clean, remaining: '' };
  }

  let cutIdx = -1;
  SENTENCE_DELIMS.lastIndex = 0;
  let match: RegExpExecArray | null;

  // 1. 优先在 [25, 65] 范围内的句号、感叹号、问号或换行处切分
  while ((match = SENTENCE_DELIMS.exec(clean)) !== null) {
    const idx = match.index + match[0].length;
    if (idx >= 25 && idx <= 65) {
      cutIdx = idx;
      break;
    }
    if (idx > 65) {
      break;
    }
  }

  // 2. 若超过 25 字无句号，且长度已超过 45，在逗号、分号处切分换气
  if (cutIdx === -1 && clean.length >= 45) {
    COMMA_DELIMS.lastIndex = 0;
    while ((match = COMMA_DELIMS.exec(clean)) !== null) {
      const idx = match.index + match[0].length;
      if (idx >= 25 && idx <= 60) {
        cutIdx = idx;
      }
    }
  }

  // 3. 宽松容错：在 [15, 75] 宽区间内寻找句号
  if (cutIdx === -1 && clean.length >= 50) {
    SENTENCE_DELIMS.lastIndex = 0;
    if ((match = SENTENCE_DELIMS.exec(clean)) !== null) {
      const idx = match.index + match[0].length;
      if (idx >= 15 && idx <= 75) {
        cutIdx = idx;
      }
    }
  }

  // 4. 超长仍无标点，按空格或安全长度硬截断
  if (cutIdx === -1 && clean.length >= 65) {
    const target = Math.min(50, clean.length);
    const lastSpace = clean.lastIndexOf(' ', target);
    if (lastSpace > 20) {
      cutIdx = lastSpace + 1;
    } else {
      cutIdx = target;
    }
  }

  if (cutIdx !== -1) {
    const chunk = clean.slice(0, cutIdx).trim();
    const nextRemaining = clean.slice(cutIdx).trimStart();
    if (chunk) {
      return { chunk, remaining: nextRemaining };
    }
  }

  // 流已结束但未命中任何断句标点，兜底输出全部
  if (isStreamEnd && clean) {
    return { chunk: clean, remaining: '' };
  }

  return null;
}

/**
 * 将整篇长文本静态切分为符合 TTS 与动作时序的切片数组
 */
export function splitIntoSpeechChunks(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  if (clean.length <= 45) {
    return [clean];
  }

  const chunks: string[] = [];
  let remaining = clean;

  while (remaining.length > 0) {
    const next = extractNextSpeechChunk(remaining, true);
    if (!next) break;
    chunks.push(next.chunk);
    remaining = next.remaining;
  }

  return chunks;
}

/**
 * 剥离不可读 emoji 与多余空白字符
 */
export function stripForTTS(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}


