import { describe, expect, it } from 'vitest';
import { CORNER_CURSOR, CORNER_HIT_SIZE, cornerAt } from '../corners';

describe('cornerAt: 四角缩放热区', () => {
  const W = 320, H = 480;
  it('默认热区 = 40px (与 Tauri TauriWindowFrame 一致)', () => {
    expect(CORNER_HIT_SIZE).toBe(40);
  });
  it('四个角各自命中', () => {
    expect(cornerAt(5, 5, W, H)).toBe('NW');
    expect(cornerAt(W - 5, 5, W, H)).toBe('NE');
    expect(cornerAt(5, H - 5, W, H)).toBe('SW');
    expect(cornerAt(W - 5, H - 5, W, H)).toBe('SE');
  });
  it('边界: 恰好 40px 内算, 41px 外不算; 视口边缘 (0 / W / H) 也算', () => {
    expect(cornerAt(40, 40, W, H)).toBe('NW');
    expect(cornerAt(41, 41, W, H)).toBeNull();
    expect(cornerAt(0, 0, W, H)).toBe('NW');
    expect(cornerAt(W, H, W, H)).toBe('SE');
    expect(cornerAt(W - 40, H - 40, W, H)).toBe('SE');
    expect(cornerAt(W - 41, H - 41, W, H)).toBeNull();
  });
  it('只贴一条边但不在角上 → 不命中 (边的中段不是热区)', () => {
    expect(cornerAt(5, H / 2, W, H)).toBeNull();
    expect(cornerAt(W / 2, 5, W, H)).toBeNull();
    expect(cornerAt(W / 2, H / 2, W, H)).toBeNull();
  });
  it('视口外 / 非法数值 / 零尺寸 → null', () => {
    expect(cornerAt(-1, 5, W, H)).toBeNull();
    expect(cornerAt(5, H + 1, W, H)).toBeNull();
    expect(cornerAt(NaN, 5, W, H)).toBeNull();
    expect(cornerAt(Infinity, 5, W, H)).toBeNull();
    expect(cornerAt(1, 1, 0, 0)).toBeNull();
  });
  it('视口窄到热区重叠: 按半区就近归属', () => {
    expect(cornerAt(10, 10, 60, 60)).toBe('NW');
    expect(cornerAt(50, 10, 60, 60)).toBe('NE');
    expect(cornerAt(10, 50, 60, 60)).toBe('SW');
    expect(cornerAt(50, 50, 60, 60)).toBe('SE');
  });
  it('自定义热区大小', () => {
    expect(cornerAt(20, 20, W, H, 16)).toBeNull();
    expect(cornerAt(10, 10, W, H, 16)).toBe('NW');
  });
  it('光标: NW/SE = nwse, NE/SW = nesw', () => {
    expect(CORNER_CURSOR).toEqual({ NW: 'nwse-resize', SE: 'nwse-resize', NE: 'nesw-resize', SW: 'nesw-resize' });
  });
});
