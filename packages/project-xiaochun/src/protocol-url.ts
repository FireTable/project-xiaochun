/**
 * protocol-url.ts — `xiaochun://` OS 级 deep link 与 `xc.*` postMessage 的对照工具。
 *
 * 两者是「同一语义的两个传输层」:
 *   - xiaochun://  : 只在 Tauri 桌面壳里由 OS 分发 (open "xiaochun://speak?text=…"), iframe / 浏览器里的 /embed 不会响应;
 *   - xc.*         : iframe 与宿主页之间的 postMessage, 只在 /embed 里生效。
 * 两边在主应用里最终进同一个 handler (src/core/protocol/handler.ts), 动作对象是同一套 (speak / motion / expression / group / stop)。
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

/** `xiaochun://motion` 的参数。 */
export interface XiaochunMotionAction {
  action: 'motion';
  /** 动作标识符 (如 waving, joyfulJump, handHeart 等) */
  name?: string;
  /** .vrma 文件路径或外部 URL */
  url?: string;
  /** 动作组名 (若指定则从该组随机抽选) */
  group?: string;
  /** 是否循环播放 */
  loop?: boolean;
  /** 五次平滑淡入淡出秒数 (默认 0.75s) */
  fadeDuration?: number;
  /** 播放速率倍率 (默认 1.0) */
  timeScale?: number;
  /** 动作骨骼遮罩 ('all' | 'upperBody') */
  mask?: 'all' | 'upperBody';
  /** 是否立即平滑停止当前动作 */
  stop?: boolean;
}

/** `xiaochun://motion-group` (或兼容 `xiaochun://group`) 的参数。 */
export interface XiaochunMotionGroupAction {
  action: 'motion-group' | 'group';
  /** 动作组名 (如 greeting, idleFlavor, listening, thinking, praiseCute, playfulSulking, dancePerformance, outfitShowcase) */
  name: string;
  loop?: boolean;
  fadeDuration?: number;
  timeScale?: number;
}

/** @deprecated 推荐使用 XiaochunMotionGroupAction */
export type XiaochunGroupAction = XiaochunMotionGroupAction;

/** `xiaochun://expression` 的参数。 */
export interface XiaochunExpressionAction {
  action: 'expression';
  /** 表情标识符 (如 happy, gentle_smile, playful, surprised, hesitant, shy 等) */
  name: string;
  /** 表情强度 (0.0 ~ 1.0) */
  intensity?: number;
}

/** `xiaochun://camera` 的参数。 */
export interface XiaochunCameraAction {
  action: 'camera';
  /** 镜头景别 ('extreme_close_up' | 'close_up' | 'medium' | 'full' | 'dramatic_low' 等) */
  shot?: string;
  /** 运镜轨迹动势 ('none' | 'push_in' | 'pull_out' | 'hero_spiral_orbit' | 'hero_backlight_reveal' | 'dutch_tilt' | 'arc_sweep' | 'orbit_subtle' | 'pedestal_up' 等) */
  movement?: string;
  /** 运镜持续时间 (秒，默认 1.2s) */
  durationSec?: number;
  /** 目标视野角 (15 ~ 65) */
  targetFov?: number;
  /** 水平环绕旋转角度 (度数，例如 +45, -90, 180, 360) */
  orbitAngleDeg?: number;
  /** 插值缓动曲线 ('quintic_smooth' | 'ease_out_dramatic' | 'linear') */
  easing?: 'quintic_smooth' | 'ease_out_dramatic' | 'linear';
  /** 是否重置为默认自由机位 */
  reset?: boolean;
  /** 是否执行自下而上缓缓打量人物的电影级升降运镜 */
  panUp?: boolean;
}

/** `xiaochun://stop` 的参数。立即停止语音与动作。 */
export interface XiaochunStopAction {
  action: 'stop';
}

export type XiaochunProtocolAction =
  | XiaochunSpeakAction
  | XiaochunMotionAction
  | XiaochunMotionGroupAction
  | XiaochunExpressionAction
  | XiaochunCameraAction
  | XiaochunStopAction;

export const XIAOCHUN_PROTOCOL_SCHEME = 'xiaochun';

/** 拼出 `xiaochun://<action>?...`。参数缺失或格式非法时抛错。 */
export function toProtocolUrl(a: XiaochunProtocolAction): string {
  const q = new URLSearchParams();

  switch (a.action) {
    case 'speak': {
      if (!a.text && !a.audioUrl && !a.file) {
        throw new Error('[project-xiaochun] speak needs text, audioUrl or file');
      }
      if (a.audioUrl && !/^https?:\/\//i.test(a.audioUrl)) {
        throw new Error('[project-xiaochun] audioUrl must be http(s)');
      }
      if (a.text) q.set('text', a.text);
      if (a.audioUrl) q.set('audioUrl', a.audioUrl);
      if (a.file) q.set('file', a.file);
      break;
    }
    case 'motion': {
      if (!a.name && !a.url && !a.group && !a.stop) {
        throw new Error('[project-xiaochun] motion needs name, url, group or stop');
      }
      if (a.name) q.set('name', a.name);
      if (a.url) q.set('url', a.url);
      if (a.group) q.set('group', a.group);
      if (a.loop !== undefined) q.set('loop', String(a.loop));
      if (a.fadeDuration !== undefined) q.set('fadeDuration', String(a.fadeDuration));
      if (a.timeScale !== undefined) q.set('timeScale', String(a.timeScale));
      if (a.mask) q.set('mask', a.mask);
      if (a.stop !== undefined) q.set('stop', String(a.stop));
      break;
    }
    case 'motion-group':
    case 'group': {
      if (!a.name) {
        throw new Error('[project-xiaochun] motion-group needs name');
      }
      q.set('name', a.name);
      if (a.loop !== undefined) q.set('loop', String(a.loop));
      if (a.fadeDuration !== undefined) q.set('fadeDuration', String(a.fadeDuration));
      if (a.timeScale !== undefined) q.set('timeScale', String(a.timeScale));
      break;
    }
    case 'expression': {
      if (!a.name) {
        throw new Error('[project-xiaochun] expression needs name');
      }
      q.set('name', a.name);
      if (a.intensity !== undefined) q.set('intensity', String(a.intensity));
      break;
    }
    case 'camera': {
      if (!a.shot && !a.movement && !a.reset && !a.panUp) {
        throw new Error('[project-xiaochun] camera needs shot, movement, reset or panUp');
      }
      if (a.shot) q.set('shot', a.shot);
      if (a.movement) q.set('movement', a.movement);
      if (a.durationSec !== undefined) q.set('durationSec', String(a.durationSec));
      if (a.targetFov !== undefined) q.set('targetFov', String(a.targetFov));
      if (a.orbitAngleDeg !== undefined) q.set('orbitAngleDeg', String(a.orbitAngleDeg));
      if (a.easing) q.set('easing', a.easing);
      if (a.reset !== undefined) q.set('reset', String(a.reset));
      if (a.panUp !== undefined) q.set('panUp', String(a.panUp));
      break;
    }
    case 'stop': {
      return `${XIAOCHUN_PROTOCOL_SCHEME}://stop`;
    }
    default:
      throw new Error(`[project-xiaochun] unsupported action: ${String((a as { action?: unknown }).action)}`);
  }

  const qs = q.toString().replace(/\+/g, '%20');
  return qs ? `${XIAOCHUN_PROTOCOL_SCHEME}://${a.action}?${qs}` : `${XIAOCHUN_PROTOCOL_SCHEME}://${a.action}`;
}

/** 反向解析 (支持 speak, motion, group, expression, stop; 不认识的返回 null)。 */
export function parseProtocolUrl(url: string): XiaochunProtocolAction | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${XIAOCHUN_PROTOCOL_SCHEME}:`) return null;
  const name = u.hostname || u.pathname.replace(/^\/+/, '');
  const action = name === 'action' ? u.searchParams.get('action') : name;

  switch (action) {
    case 'speak': {
      const out: XiaochunSpeakAction = { action: 'speak' };
      const text = u.searchParams.get('text');
      const audioUrl = u.searchParams.get('audioUrl');
      const file = u.searchParams.get('file');
      if (text) out.text = text;
      if (audioUrl) out.audioUrl = audioUrl;
      if (file) out.file = file;
      return out.text || out.audioUrl || out.file ? out : null;
    }
    case 'motion': {
      const out: XiaochunMotionAction = { action: 'motion' };
      const mName = u.searchParams.get('name');
      const mUrl = u.searchParams.get('url');
      const mGroup = u.searchParams.get('group');
      const loop = u.searchParams.get('loop');
      const fade = u.searchParams.get('fadeDuration');
      const speed = u.searchParams.get('timeScale');
      const mask = u.searchParams.get('mask');
      const stop = u.searchParams.get('stop');

      if (mName) out.name = mName;
      if (mUrl) out.url = mUrl;
      if (mGroup) out.group = mGroup;
      if (loop !== null) out.loop = loop === 'true' || loop === '1';
      if (fade !== null && Number.isFinite(Number(fade))) out.fadeDuration = Number(fade);
      if (speed !== null && Number.isFinite(Number(speed))) out.timeScale = Number(speed);
      if (mask === 'upperBody' || mask === 'all') out.mask = mask;
      if (stop !== null) out.stop = stop === 'true' || stop === '1';

      return out.name || out.url || out.group || out.stop !== undefined ? out : null;
    }
    case 'motion-group':
    case 'motion_group':
    case 'motiongroup':
    case 'group': {
      const gName = u.searchParams.get('name') || u.searchParams.get('group');
      if (!gName) return null;
      const out: XiaochunMotionGroupAction = {
        action: action === 'group' ? 'group' : 'motion-group',
        name: gName,
      };
      const loop = u.searchParams.get('loop');
      const fade = u.searchParams.get('fadeDuration');
      const speed = u.searchParams.get('timeScale');
      if (loop !== null) out.loop = loop === 'true' || loop === '1';
      if (fade !== null && Number.isFinite(Number(fade))) out.fadeDuration = Number(fade);
      if (speed !== null && Number.isFinite(Number(speed))) out.timeScale = Number(speed);
      return out;
    }
    case 'expression':
    case 'expr': {
      const eName = u.searchParams.get('name');
      if (!eName) return null;
      const out: XiaochunExpressionAction = { action: 'expression', name: eName };
      const intensity = u.searchParams.get('intensity');
      if (intensity !== null && Number.isFinite(Number(intensity))) out.intensity = Number(intensity);
      return out;
    }
    case 'camera': {
      const out: XiaochunCameraAction = { action: 'camera' };
      const shot = u.searchParams.get('shot');
      const movement = u.searchParams.get('movement');
      const durationSec = u.searchParams.get('durationSec') || u.searchParams.get('duration');
      const targetFov = u.searchParams.get('targetFov') || u.searchParams.get('fov');
      const orbitAngleDeg = u.searchParams.get('orbitAngleDeg') || u.searchParams.get('orbit');
      const easing = u.searchParams.get('easing');
      const reset = u.searchParams.get('reset');
      const panUp = u.searchParams.get('panUp');

      if (shot) out.shot = shot;
      if (movement) out.movement = movement;
      if (durationSec !== null && Number.isFinite(Number(durationSec))) out.durationSec = Number(durationSec);
      if (targetFov !== null && Number.isFinite(Number(targetFov))) out.targetFov = Number(targetFov);
      if (orbitAngleDeg !== null && Number.isFinite(Number(orbitAngleDeg))) out.orbitAngleDeg = Number(orbitAngleDeg);
      if (easing === 'quintic_smooth' || easing === 'ease_out_dramatic' || easing === 'linear') out.easing = easing;
      if (reset !== null) out.reset = reset === 'true' || reset === '1';
      if (panUp !== null) out.panUp = panUp === 'true' || panUp === '1';

      return out.shot || out.movement || out.reset !== undefined || out.panUp !== undefined ? out : null;
    }
    case 'stop': {
      return { action: 'stop' };
    }
    default:
      return null;
  }
}
