import { vrmEngine } from '@/core/vrmEngine';
import { type MotionGroupName, MOTION_GROUPS } from '@/motion/catalog';
import type { CameraDirective, CameraShotType, CameraTrajectoryType } from '@/story/schema';
import { resolveWholeAudio } from './audio';
import {
  ProtocolError,
  type AudioPayload,
  type CameraPayload,
  type ExpressionPayload,
  type MotionGroupPayload,
  type MotionPayload,
  type ProtocolMessage,
  type ProtocolRunHooks,
  type SpeakPayload,
} from './types';

/**
 * 等待 VRM 模型加载完毕（应对应用刚冷启动时立即收到协议调用的场景）
 */
async function waitForVRMReady(timeoutMs = 60000): Promise<boolean> {
  if (vrmEngine.currentVRM) return true;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (vrmEngine.currentVRM) {
      return true;
    }
  }
  return false;
}

async function requireVRM(): Promise<void> {
  if (!(await waitForVRMReady())) {
    throw new ProtocolError('not_ready', '等待 VRM 加载超时 (60s)，无法开始说话。冷启动较慢时请确认模型已加载后再重试。');
  }
}

/** 播放宿主音频: 解析输入 (与等模型就绪并行) → vrmEngine.speakAudio。speak+audioUrl 与 xc.audio 都走这里。 */
async function runAudio(payload: AudioPayload, hooks?: ProtocolRunHooks): Promise<void> {
  const [input] = await Promise.all([
    payload.stream ? Promise.resolve(payload.stream) : resolveWholeAudio(payload),
    requireVRM(),
  ]);
  const text = typeof payload.text === 'string' ? payload.text : '';
  // start 等到声音时钟起步再发。思考动作和 EMAGE 首窗都在那之前, 宿主才能把自家播放对齐。
  await vrmEngine.speakAudio(input, {
    motion: payload.motion !== false,
    lipsync: payload.lipsync !== false,
    audible: payload.audible !== false,
    playbackRate: payload.playbackRate,
    volume: payload.volume,
    hostClock: payload.hostClock === true,
    text: text || undefined,
    onAudibleStart: () => hooks?.onStart?.({ kind: 'audio', text }),
  });
}

function normalizeCameraDirective(payload: CameraPayload): CameraDirective {
  const rawShot = (payload.shot || '').toLowerCase().trim();
  let shot: CameraShotType = 'medium';
  if (rawShot === 'extreme_close_up' || rawShot === 'extremecloseup' || rawShot === 'face' || rawShot === 'eyes') {
    shot = 'extreme_close_up';
  } else if (rawShot === 'close_up' || rawShot === 'closeup' || rawShot === 'portrait') {
    shot = 'close_up';
  } else if (rawShot === 'medium' || rawShot === 'half' || rawShot === 'chest' || rawShot === 'default') {
    shot = 'medium';
  } else if (rawShot === 'full' || rawShot === 'fullbody' || rawShot === 'body') {
    shot = 'full';
  } else if (rawShot === 'dramatic_low' || rawShot === 'dramaticlow' || rawShot === 'low' || rawShot === 'lowangle') {
    shot = 'dramatic_low';
  }

  const rawMove = (payload.movement || '').toLowerCase().trim();
  let movement: CameraTrajectoryType = 'none';
  if (rawMove === 'push_in' || rawMove === 'pushin' || rawMove === 'push') {
    movement = 'push_in';
  } else if (rawMove === 'pull_out' || rawMove === 'pullout' || rawMove === 'pull') {
    movement = 'pull_out';
  } else if (rawMove === 'hero_spiral_orbit' || rawMove === 'spiral' || rawMove === 'orbit_spiral') {
    movement = 'hero_spiral_orbit';
  } else if (rawMove === 'hero_backlight_reveal' || rawMove === 'backlight' || rawMove === 'reveal') {
    movement = 'hero_backlight_reveal';
  } else if (rawMove === 'dutch_tilt' || rawMove === 'dutch') {
    movement = 'dutch_tilt';
  } else if (rawMove === 'arc_sweep' || rawMove === 'arc') {
    movement = 'arc_sweep';
  } else if (rawMove === 'orbit_subtle' || rawMove === 'orbit') {
    movement = 'orbit_subtle';
  } else if (rawMove === 'pedestal_up' || rawMove === 'pedestal') {
    movement = 'pedestal_up';
  }

  const rawDuration = payload.duration !== undefined ? payload.duration : payload.durationSec;
  const durationSec = rawDuration ? Number(rawDuration) : 1.2;
  const rawFov = payload.fov !== undefined ? payload.fov : payload.targetFov;
  const targetFov = rawFov ? Number(rawFov) : undefined;
  const rawOrbit = payload.orbit !== undefined ? payload.orbit : payload.orbitAngleDeg;
  const orbitAngleDeg = rawOrbit ? Number(rawOrbit) : undefined;
  const windMultiplier = payload.windMultiplier ? Number(payload.windMultiplier) : 1.0;

  return {
    shot,
    movement,
    durationSec: Number.isFinite(durationSec) ? Math.min(12, Math.max(0.2, durationSec)) : 1.2,
    easing: payload.easing || 'quintic_smooth',
    targetFov: Number.isFinite(targetFov) ? targetFov : undefined,
    orbitAngleDeg: Number.isFinite(orbitAngleDeg) ? orbitAngleDeg : undefined,
    windMultiplier: Number.isFinite(windMultiplier) ? windMultiplier : 1.0,
  };
}

/**
 * 协议指令执行器 (抛错版): 两个传输层共用。
 * - xiaochun:// deep link 通过 executeProtocolMessage (吞错 + 打日志)。
 * - iframe xc.say / xc.audio 通过 bridge 调用本函数, 把 ProtocolError 映射成 xc.error。
 */
export async function runProtocolAction(message: ProtocolMessage, hooks?: ProtocolRunHooks): Promise<void> {
  switch (message.action) {
    case 'speak': {
      const payload = message.payload as SpeakPayload;
      // 预合成音频: 绕过 TTS, 走和 xc.audio 同一条链路 (text 只作气泡文字)
      if (payload && typeof payload.audioUrl === 'string' && payload.audioUrl) {
        await runAudio({ source: payload.audioUrl, text: payload.text }, hooks);
        return;
      }
      if (!payload || !payload.text) {
        if (payload?.fileError) throw new ProtocolError('bad_request', `speak 指令读取文件失败: ${payload.fileError}`);
        if (payload?.file) throw new ProtocolError('bad_request', `speak 指令文件路径未解析出有效文本 (文件为空或路径不存在): ${payload.file}`);
        throw new ProtocolError('bad_request', 'speak 指令缺少 text 内容');
      }
      await requireVRM();
      hooks?.onStart?.({ kind: 'text', text: payload.text });
      console.log(`[Protocol] 执行 speakText (字数: ${payload.text.length}):`, payload.text);
      await vrmEngine.speakText(payload.text);
      return;
    }
    case 'audio': {
      await runAudio(message.payload as AudioPayload, hooks);
      return;
    }
    case 'motion': {
      await requireVRM();
      const payload = (message.payload || {}) as MotionPayload;
      if (payload.stop === true || payload.stop === 'true') {
        const fade = payload.fadeDuration ? Number(payload.fadeDuration) : 0.75;
        vrmEngine.stopMotion(Number.isFinite(fade) ? fade : 0.75);
        return;
      }
      const rawGroup = (payload.group || '') as MotionGroupName;
      if (rawGroup && rawGroup in MOTION_GROUPS) {
        await vrmEngine.playMotionGroup(rawGroup, {
          loop: payload.loop === true || payload.loop === 'true',
          fadeDuration: payload.fadeDuration ? Number(payload.fadeDuration) : 0.75,
          timeScale: payload.timeScale ? Number(payload.timeScale) : 1.0,
          mask: payload.mask === 'upperBody' ? 'upperBody' : 'all',
        });
        return;
      }
      const target = payload.url || payload.name;
      if (!target) {
        throw new ProtocolError('bad_request', 'motion 指令缺少 name, url 或 group 参数');
      }
      // 若 name 实为动作组名，自动智能分发至动作组抽取
      if (payload.name && payload.name in MOTION_GROUPS) {
        await vrmEngine.playMotionGroup(payload.name as MotionGroupName, {
          loop: payload.loop === true || payload.loop === 'true',
          fadeDuration: payload.fadeDuration ? Number(payload.fadeDuration) : 0.75,
          timeScale: payload.timeScale ? Number(payload.timeScale) : 1.0,
          mask: payload.mask === 'upperBody' ? 'upperBody' : 'all',
        });
        return;
      }
      await vrmEngine.playMotion(target, {
        loop: payload.loop === true || payload.loop === 'true',
        fadeDuration: payload.fadeDuration ? Number(payload.fadeDuration) : 0.75,
        timeScale: payload.timeScale ? Number(payload.timeScale) : 1.0,
        mask: payload.mask === 'upperBody' ? 'upperBody' : 'all',
      });
      return;
    }
    case 'motion-group':
    case 'group': {
      await requireVRM();
      const payload = (message.payload || {}) as MotionGroupPayload;
      const groupName = (payload.name || payload.group) as MotionGroupName;
      if (!groupName || !(groupName in MOTION_GROUPS)) {
        throw new ProtocolError(
          'bad_request',
          `motion-group 指令缺少有效组名，可用组: ${Object.keys(MOTION_GROUPS).join(', ')}`,
        );
      }
      await vrmEngine.playMotionGroup(groupName, {
        loop: payload.loop === true || payload.loop === 'true',
        fadeDuration: payload.fadeDuration ? Number(payload.fadeDuration) : 0.75,
        timeScale: payload.timeScale ? Number(payload.timeScale) : 1.0,
      });
      return;
    }
    case 'expression': {
      await requireVRM();
      const payload = (message.payload || {}) as ExpressionPayload;
      if (!payload.name) {
        throw new ProtocolError('bad_request', 'expression 指令缺少 name 参数');
      }
      const intensity = payload.intensity !== undefined ? Number(payload.intensity) : undefined;
      vrmEngine.setExpression(payload.name, Number.isFinite(intensity) ? intensity : undefined);
      return;
    }
    case 'camera': {
      await requireVRM();
      const payload = (message.payload || {}) as CameraPayload;
      if (payload.reset === true || payload.reset === 'true') {
        vrmEngine.resetCamera();
        return;
      }
      if (payload.panUp === true || payload.panUp === 'true') {
        const rawDur = payload.duration !== undefined ? payload.duration : payload.durationSec;
        const dur = rawDur ? Number(rawDur) : 2.2;
        await vrmEngine.panUpRevealCamera(Number.isFinite(dur) ? dur : 2.2);
        return;
      }
      const directive = normalizeCameraDirective(payload);
      await vrmEngine.transitionCamera(directive);
      return;
    }
    case 'stop': {
      vrmEngine.stopSpeaking();
      vrmEngine.stopMotion();
      return;
    }
    default:
      throw new ProtocolError('unsupported', `未知协议动作: ${String((message as { action?: unknown }).action)}`);
  }
}

/**
 * 协议指令路由执行器 (deep link 入口, 行为与改动前一致: 出错只打日志, 不抛)
 */
export async function executeProtocolMessage(message: ProtocolMessage): Promise<void> {
  console.log('[Protocol] 收到协议指令:', message);
  try {
    await runProtocolAction(message);
  } catch (err) {
    if (err instanceof ProtocolError && err.code === 'bad_request') console.warn(`[Protocol] ${err.message}`, message);
    else console.error('[Protocol] 协议指令执行失败:', err);
  }
}
