/**
 * domSample — DOM 事件 → 宿主无关的 PointerSample (适配器层, 允许碰 DOM 类型)。
 */
import type { PointerSample } from '../types';

/** PointerEvent / MouseEvent / React.MouseEvent 的共同字段 (结构化类型, 不依赖 React)。 */
interface MouseLike {
  button: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  pointerId?: number;
  pointerType?: string;
}

/**
 * 写入并返回 `out` (复用同一个对象, 避免高频 pointermove 里每次分配; GestureMachine 不会保留样本引用)。
 * @param modifier 平台主修饰键是否按下 (hasInteractionModifier(e))
 */
export function fillPointerSample(out: PointerSample, e: MouseLike, modifier: boolean): PointerSample {
  out.pointerId = e.pointerId ?? 1;
  out.pointerType = e.pointerType ?? 'mouse';
  out.button = e.button;
  out.x = e.clientX;
  out.y = e.clientY;
  out.screenX = e.screenX;
  out.screenY = e.screenY;
  out.modifier = modifier;
  return out;
}

export function newPointerSample(): PointerSample {
  return { pointerId: 0, pointerType: 'mouse', button: 0, x: 0, y: 0, screenX: 0, screenY: 0, modifier: false };
}
