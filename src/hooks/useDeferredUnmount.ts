/**
 * useDeferredUnmount — 延迟 unmount 让淡出动画跑完, 同时让首帧停在 hidden
 * 状态以触发 CSS transition 的 mount 入场动画。
 *
 * 返回两个状态:
 * - `mounted`: 组件是否在 DOM 中 (false 时应 return null)
 * - `animated`: 是否可以进入可见状态 (true 时 className 切到 opacity-100,
 *   CSS transition 才会触发淡入; false 时停在 opacity-0 供入场过渡起点)
 *
 * 时间线:
 *   active=false → true
 *     mounted=true 立刻
 *     animated=false 立刻 (渲染 opacity-0)
 *     requestAnimationFrame → animated=true (切到 opacity-100, transition 跑 300ms)
 *
 *   active=true → false
 *     animated=false 立刻 (渲染 opacity-0, transition 跑 300ms)
 *     setTimeout(delayMs) → mounted=false (unmount, Radix Tooltip 失去触发机会)
 *
 * ponytail: 之前 mounted 单一状态, mount 后立刻 className=opacity-100, CSS 没有
 * 起点可比对, transition 不会跑 — 入场动画缺席。拆成两段后, transition 双向都触发。
 */
import { useEffect, useState } from 'react';

export interface DeferredUnmountState {
  mounted: boolean;
  animated: boolean;
}

export function useDeferredUnmount(active: boolean, delayMs: number): DeferredUnmountState {
  const [mounted, setMounted] = useState(active);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      // 让浏览器先把 opacity-0 那一帧 paint 出来, 再切到 opacity-100 触发 transition
      const rafId = window.requestAnimationFrame(() => setAnimated(true));
      return () => window.cancelAnimationFrame(rafId);
    }
    setAnimated(false);
    const id = window.setTimeout(() => setMounted(false), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);

  return { mounted, animated };
}