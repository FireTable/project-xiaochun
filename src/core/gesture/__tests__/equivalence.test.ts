/**
 * 差分测试: 抽取前的判定逻辑 (legacyReference.ts, 逐行搬自 main) vs 新的 GestureMachine + 控制器事件映射。
 * 随机输入序列 (固定种子, 可复现), 每一步比较:
 *   1) 副作用 token 序列 (updateCursor / 穿透同步 / 状态通知 / 指针捕获 / preventDefault / 原生拖窗 / 转身位移 / ...)
 *   2) 对外可读状态 (modifierActive / dragging / guideDragging / armed / pending / guideHovered)
 * 完全一致才算"行为不变"。
 */
import { describe, expect, it } from 'vitest';
import { GestureMachine } from '../gestureMachine';
import type { GestureEvent, PointerSample } from '../types';
import { FakeClock, sample } from './helpers';
import { LegacyRef } from './legacyReference';

const CFG = { armMs: 480, slopPx: 10, hideMs: 2800 };

/** 与 InteractionController.onGestureEvent / applyResponse 一致的事件 → token 映射。 */
class Harness {
  log: string[] = [];
  private captured = new Set<number>();
  readonly m: GestureMachine;

  constructor(clock: FakeClock, raycast: (x: number, y: number) => boolean, tauri: boolean) {
    this.m = new GestureMachine(
      { ...CFG, moveStrategy: () => (tauri ? 'native' : 'none') },
      { isGuideHit: raycast },
      clock,
    );
    this.m.on((ev) => this.onEvent(ev));
  }

  private onEvent(ev: GestureEvent) {
    switch (ev.type) {
      case 'move-start':
        if (ev.strategy === 'native') this.log.push('nativeDrag');
        break;
      case 'capture':
        if (ev.capture) { this.captured.add(ev.pointerId); this.log.push(`cap+${ev.pointerId}`); }
        else if (this.captured.has(ev.pointerId)) { this.captured.delete(ev.pointerId); this.log.push(`cap-${ev.pointerId}`); }
        break;
      case 'turn-start': this.log.push('turnStart'); break;
      case 'turn': this.log.push(`turn:${ev.dx},${ev.dy}`); break;
      case 'turn-end': this.log.push('turnEnd'); break;
      case 'guide-drag': this.log.push(`guideDy:${ev.dy}`); break;
      case 'state-changed':
        if (ev.cursor) this.log.push('cursor');
        if (ev.notify) {
          this.log.push(`passthrough:${this.m.capturing}`);
          this.log.push(`notify:${ev.dx},${ev.dy}`);
        } else if (ev.passthrough) {
          this.log.push(`passthrough:${this.m.capturing}`);
        }
        break;
      default: break;
    }
  }

  private apply(r: { preventDefault?: boolean; stopPropagation?: boolean }) {
    if (r.preventDefault) this.log.push('prevent');
    if (r.stopPropagation) this.log.push('stop');
  }
  pointerDown(s: PointerSample) { this.apply(this.m.pointerDown(s)); }
  pointerMove(s: PointerSample) { this.apply(this.m.pointerMove(s)); }
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 返回 legacy 的 token 序列 (两边已逐步断言一致)。 */
function dual(seed: number, tauri: boolean, steps: number): string[] {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const raycast = (x: number, y: number) => ((Math.round(x) * 31 + Math.round(y) * 17) % 5 + 5) % 5 === 0;
  const cl = new FakeClock();
  const cn = new FakeClock();
  const legacy = new LegacyRef(cl, { ...CFG, tauri }, raycast);
  const next = new Harness(cn, raycast, tauri);

  let x = 100, y = 100;
  const trace: string[] = [];
  const states = () => ({
    mod: [legacy.isModifierActive, next.m.modifierActive],
    drag: [legacy.isLeftDragging, next.m.dragging],
    guide: [legacy.isYGuideDragging, next.m.guideDragging],
    armed: [legacy.touchArmed, next.m.armed],
    pending: [legacy.touchPendingDrag, next.m.pending],
    hover: [legacy.yGuideHovered, next.m.guideHovered],
  });

  for (let i = 0; i < steps; i++) {
    const op = pick(['down', 'down', 'move', 'move', 'move', 'move', 'up', 'up', 'cancel', 'cancelNoArg', 'keyDown', 'keyUp', 'blur', 'wait', 'wait', 'wait'] as const);
    const pointerType = pick(['mouse', 'mouse', 'mouse', 'touch', 'touch', 'pen'] as const);
    const pointerId = pick([1, 1, 1, 2, 3] as const);
    const button = pick([0, 0, 0, 0, 1, 2] as const);
    const modifier = r() < 0.2;
    // 位移: 小步 (跨越 10px 阈值的概率适中) 或偶尔大跳
    const step = pick([0, 1, 3, 5, 8, 12, 25, 80] as const);
    x += (r() < 0.5 ? -1 : 1) * step * r();
    y += (r() < 0.5 ? -1 : 1) * step * r();
    if (r() < 0.05) { x = 100; y = 100; }
    const s = sample({ pointerId, pointerType, button, modifier, x, y, screenX: x + 300, screenY: y + 200 });
    const wait = pick([0, 16, 100, 300, 479, 480, 481, 1000, 2799, 2800, 2801, 6000] as const);

    trace.push(`${i}:${op} p${pointerId}/${pointerType} b${button} m${+modifier} (${x.toFixed(1)},${y.toFixed(1)}) wait${wait}`);
    switch (op) {
      case 'down': legacy.pointerDown(s); next.pointerDown(s); break;
      case 'move': legacy.pointerMove(s); next.pointerMove(s); break;
      case 'up': legacy.pointerUp(s); next.m.pointerUp(s); break;
      case 'cancel': legacy.pointerCancel(s); next.m.pointerCancel(s); break;
      case 'cancelNoArg': legacy.pointerCancel(); next.m.pointerCancel(); break;
      case 'keyDown': legacy.keyDown(modifier); next.m.keyDown(modifier); break;
      case 'keyUp': legacy.keyUp(modifier); next.m.keyUp(modifier); break;
      case 'blur': legacy.blur(); next.m.blur(); break;
      case 'wait': cl.advance(wait); cn.advance(wait); break;
    }
    const st = states();
    for (const [k, [a, b]] of Object.entries(st)) {
      if (a !== b) throw new Error(`seed ${seed} step ${i} state ${k}: legacy=${a} new=${b}\n${trace.slice(-8).join('\n')}`);
    }
    // preventDefault / stopPropagation 在新实现里由适配器在 machine 返回后调用 (同一个同步事件处理内, 与其余副作用无顺序依赖),
    // 所以分开比较: 其余副作用序列逐项相同, prevent/stop 序列逐项相同。
    const isFlag = (t: string) => t === 'prevent' || t === 'stop';
    const la = legacy.log.filter((t) => !isFlag(t)), na = next.log.filter((t) => !isFlag(t));
    const lf = legacy.log.filter(isFlag), nf = next.log.filter(isFlag);
    if (la.join('|') !== na.join('|') || lf.join('|') !== nf.join('|')) {
      const n = Math.max(la.length, na.length);
      let d = 0;
      while (d < n && la[d] === na[d]) d++;
      throw new Error(`seed ${seed} step ${i} log diverges at #${d}: legacy=${la[d]} new=${na[d]} flags legacy=${lf.length} new=${nf.length}\n${trace.slice(-8).join('\n')}\nlegacy tail: ${la.slice(-6).join(' ')}\nnew tail: ${na.slice(-6).join(' ')}`);
    }
  }
  return legacy.log;
}

describe('差分测试: 新 GestureMachine 与抽取前逻辑行为一致', () => {
  const kinds = new Set<string>();
  for (const tauri of [true, false]) {
    it(`随机序列 x300 x120 步 (tauri=${tauri})`, () => {
      let total = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const log = dual(seed * 7919 + (tauri ? 1 : 2), tauri, 120);
        total += log.length;
        for (const t of log) kinds.add(t.split(/[:+-]/)[0]);
      }
      // 防止测试空转: 必须真的产生了大量副作用
      expect(total).toBeGreaterThan(5000);
    });
  }

  it('随机序列覆盖到全部关键路径 (武装 / 转身 / 导轨 / 原生拖窗 / 捕获 / 状态通知)', () => {
    for (const k of ['nativeDrag', 'turnStart', 'turn', 'turnEnd', 'guideDy', 'cap', 'cursor', 'passthrough', 'notify', 'prevent', 'stop']) {
      expect(kinds.has(k), `token ${k} 未被随机序列覆盖; 已见: ${[...kinds].join(',')}`).toBe(true);
    }
  });
});
