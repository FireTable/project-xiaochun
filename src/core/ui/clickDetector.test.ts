import { describe, expect, it } from 'vitest';
import { CLICK_MAX_MOVE_PX, ClickDetector, type ClickSample } from './clickDetector';

const s = (x: number, y: number, extra: Partial<ClickSample> = {}): ClickSample => ({ x, y, screenX: x + 500, screenY: y + 300, button: 0, ...extra });

describe('ClickDetector', () => {
  it('按下抬起位移很小 = 单击', () => {
    const d = new ClickDetector();
    d.down(s(100, 100));
    d.move(s(102, 101));
    expect(d.up(s(102, 101))).toBe(true);
  });

  it('位移刚好等于阈值仍是单击, 严格大于才不是', () => {
    const d = new ClickDetector();
    d.down(s(0, 0));
    expect(d.up(s(CLICK_MAX_MOVE_PX, 0))).toBe(true);
    d.down(s(0, 0));
    expect(d.up(s(CLICK_MAX_MOVE_PX + 1, 0))).toBe(false);
  });

  it('拖远了再回到原点也不算单击', () => {
    const d = new ClickDetector();
    d.down(s(100, 100));
    d.move(s(160, 100));
    expect(d.up(s(100, 100))).toBe(false);
  });

  it('draggable: iframe 被宿主一起移动, client 坐标不变但 screen 变大 → 不算单击', () => {
    const d = new ClickDetector();
    d.down({ x: 200, y: 300, screenX: 700, screenY: 400, button: 0 });
    d.move({ x: 200, y: 300, screenX: 760, screenY: 410, button: 0 });
    expect(d.up({ x: 200, y: 300, screenX: 760, screenY: 410, button: 0 })).toBe(false);
  });

  it('非左键 / 非主指针 / 没有按下 / cancel 都不是单击', () => {
    const d = new ClickDetector();
    d.down(s(1, 1, { button: 2 }));
    expect(d.up(s(1, 1, { button: 2 }))).toBe(false);
    d.down(s(1, 1, { isPrimary: false }));
    expect(d.up(s(1, 1))).toBe(false);
    expect(d.up(s(1, 1))).toBe(false);
    d.down(s(1, 1));
    d.cancel();
    expect(d.up(s(1, 1))).toBe(false);
  });

  it('抬起后状态清空: 第二次抬起不再算', () => {
    const d = new ClickDetector();
    d.down(s(5, 5));
    expect(d.up(s(5, 5))).toBe(true);
    expect(d.up(s(5, 5))).toBe(false);
  });
});
