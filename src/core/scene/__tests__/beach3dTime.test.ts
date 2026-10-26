import { describe, it, expect } from 'vitest';
import {
  computeSunDirection,
  computeTimeWeights,
  evaluateBeachPalette,
  resolveEffectiveHour,
  PALETTE_DAY,
  PALETTE_SUNSET,
  PALETTE_NIGHT,
} from '../beach3d/beach3dTime';
import { formatHourToString } from '../environmentTime';

describe('beach3dTime — 太阳轨迹与时段色彩系统', () => {
  it('0~24 小时每整点的太阳/月球光线方向向量均已严格归一化 (length ≈ 1.0)', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const dir = computeSunDirection(h);
      expect(dir.length()).toBeCloseTo(1.0, 5);
      expect(Number.isFinite(dir.x)).toBe(true);
      expect(Number.isFinite(dir.y)).toBe(true);
      expect(Number.isFinite(dir.z)).toBe(true);
    }
  });

  it('正午 (12:00) 太阳高度角显著高于地平线且位于偏右上方 (+X, +Y, +Z)', () => {
    const dirNoon = computeSunDirection(12);
    expect(dirNoon.y).toBeGreaterThan(0.5);
    expect(dirNoon.x).toBeGreaterThan(0.0);
    expect(dirNoon.z).toBeGreaterThan(0.0);
    // 接近经典写真光照方向 (0.36, 0.72, 0.60)
    expect(dirNoon.x).toBeCloseTo(0.3586, 1);
    expect(dirNoon.y).toBeCloseTo(0.7171, 1);
  });

  it('日落黄金时段 (17:45 ~ 18:00) 太阳接近海平线且正对大海深处 (-Z 轴向)', () => {
    const dirSunset = computeSunDirection(17.75);
    // 太阳已降至海平面附近
    expect(dirSunset.y).toBeLessThan(0.35);
    expect(dirSunset.y).toBeGreaterThan(0.02);
    // Z 轴朝向大海深处 (产生正对相机的逆光金波)
    expect(dirSunset.z).toBeLessThan(-0.5);
  });

  it('夜间 (22:00) 月光向量保持高空冷光 (y > 0.4)', () => {
    const dirNight = computeSunDirection(22);
    expect(dirNight.y).toBeGreaterThan(0.4);
  });

  it('全时段插值权重之和恒等于 1.0', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const w = computeTimeWeights(h);
      expect(w.day + w.sunset + w.night).toBeCloseTo(1.0, 5);
      expect(w.day).toBeGreaterThanOrEqual(0);
      expect(w.sunset).toBeGreaterThanOrEqual(0);
      expect(w.night).toBeGreaterThanOrEqual(0);
    }
  });

  it('正午 12:00 权重为 100% 白天，色彩与原始配置完全吻合 (0 视觉漂移)', () => {
    const w = computeTimeWeights(12);
    expect(w.day).toBe(1.0);
    expect(w.sunset).toBe(0.0);
    expect(w.night).toBe(0.0);

    const palette = evaluateBeachPalette(12);
    expect(palette.skyZenith.r).toBeCloseTo(PALETTE_DAY.skyZenith.r, 5);
    expect(palette.skyZenith.g).toBeCloseTo(PALETTE_DAY.skyZenith.g, 5);
    expect(palette.skyZenith.b).toBeCloseTo(PALETTE_DAY.skyZenith.b, 5);
    expect(palette.seaDeep.r).toBeCloseTo(PALETTE_DAY.seaDeep.r, 5);
    expect(palette.sandBase.r).toBeCloseTo(PALETTE_DAY.sandBase.r, 5);
  });

  it('日落 17:45 权重为 100% Sunset，云彩呈现暖金霞光，海面高光增强', () => {
    const w = computeTimeWeights(17.75);
    expect(w.sunset).toBe(1.0);
    expect(w.day).toBe(0.0);
    expect(w.night).toBe(0.0);

    const palette = evaluateBeachPalette(17.75);
    expect(palette.cloudsTint.r).toBeCloseTo(PALETTE_SUNSET.cloudsTint.r, 5);
    expect(palette.cloudsTint.g).toBeCloseTo(PALETTE_SUNSET.cloudsTint.g, 5);
    expect(palette.seaGlint).toBeGreaterThan(1.0); // 日落金光强化
  });

  it('夜间 22:00 权重为 100% Night，灯塔自发光升至最高', () => {
    const w = computeTimeWeights(22);
    expect(w.night).toBe(1.0);
    expect(w.day).toBe(0.0);
    expect(w.sunset).toBe(0.0);

    const palette = evaluateBeachPalette(22);
    expect(palette.lighthouseGlow).toBe(1.0);
    expect(palette.skyZenith.r).toBeCloseTo(PALETTE_NIGHT.skyZenith.r, 5);
  });

  it('时间格式化工具正确格式化小时与分钟', () => {
    expect(formatHourToString(12)).toBe('12:00');
    expect(formatHourToString(17.5)).toBe('17:30');
    expect(formatHourToString(6.25)).toBe('06:15');
    expect(formatHourToString(0)).toBe('00:00');
    expect(formatHourToString(23.75)).toBe('23:45');
  });

  it('resolveEffectiveHour 正确解析预设与数值', () => {
    expect(resolveEffectiveHour('day')).toBe(12.0);
    expect(resolveEffectiveHour('sunset')).toBe(17.75);
    expect(resolveEffectiveHour('night')).toBe(22.0);
    expect(resolveEffectiveHour(15.2)).toBeCloseTo(15.2, 5);
    expect(resolveEffectiveHour(26)).toBeCloseTo(2.0, 5);
  });
});

/**
 * 回归锁定: 夜 / 黄昏的画面曾经因为"着色器里写死了白天的白 / 沙色 / 道具色"而失真。
 * 这里把当时的每一条症状都钉成断言, 防止以后再改回去。
 */
describe('beach3dTime — 写死色改为随时间 (夜 / 黄昏画面回归)', () => {
  it('正午 12:00 所有乘子保持中性: 白天画面与改造前零差异', () => {
    const p = evaluateBeachPalette(12);
    expect(p.ambientMul.r).toBeCloseTo(1, 5);
    expect(p.ambientMul.g).toBeCloseTo(1, 5);
    expect(p.ambientMul.b).toBeCloseTo(1, 5);
    expect(p.highlight.r).toBeCloseTo(1, 5);
    expect(p.highlight.g).toBeCloseTo(1, 5);
    expect(p.highlight.b).toBeCloseTo(1, 5);
    expect(p.lightLevel).toBeCloseTo(1, 5);
    // 树干根部的沙色 = 原着色器里写死的 (0.95, 0.87, 0.74)
    expect(p.palmBase.r).toBeCloseTo(0.95, 2);
    expect(p.palmBase.g).toBeCloseTo(0.87, 2);
    expect(p.palmBase.b).toBeCloseTo(0.74, 2);
    // 远岛薄雾 = 原配置的贴海面白雾色
    expect(p.islandMist.r).toBeCloseTo(PALETTE_DAY.islandMist.r, 5);
    // 角色主光 = 引擎默认 (白色 1.0 倍, 半球 1.0 倍)
    expect(p.keyLightScale).toBeCloseTo(1, 5);
    expect(p.hemiScale).toBeCloseTo(1, 5);
    expect(p.fillScale).toBeCloseTo(1, 5);
  });

  it('夜间的近白高光 / 环境冷色 / 直射强度全部被压暗 (不再一片白点与白雾)', () => {
    expect(PALETTE_NIGHT.highlight.r).toBeLessThan(0.5);
    expect(PALETTE_NIGHT.highlight.b).toBeGreaterThan(PALETTE_NIGHT.highlight.r); // 偏冷
    expect(PALETTE_NIGHT.ambientMul.r).toBeLessThan(0.5);
    expect(PALETTE_NIGHT.ambientMul.b).toBeGreaterThan(PALETTE_NIGHT.ambientMul.r);
    expect(PALETTE_NIGHT.lightLevel).toBeLessThan(0.5);
  });

  it('树干根部的沙色不再是写死的白天浅沙色 (夜里不再一圈白袜子)', () => {
    const night = evaluateBeachPalette(22);
    const sunset = evaluateBeachPalette(17.75);
    expect(night.palmBase.r).toBeLessThan(0.3);
    expect(night.palmBase.g).toBeLessThan(0.3);
    // 由当前沙地色推出: 永远跟着沙滩走, 不会比沙滩还白
    expect(night.palmBase.r).toBeGreaterThan(night.sandBase.r);
    expect(sunset.palmBase.r).toBeCloseTo(sunset.sandBase.r * 1.0502, 4);
    expect(sunset.palmBase.r).not.toBeCloseTo(PALETTE_DAY.sandBase.r, 2);
  });

  it('沙堡与道具随时间重新上色 (夜里不再是一块白天色的粉白)', () => {
    const day = evaluateBeachPalette(12);
    const night = evaluateBeachPalette(22);
    const sunset = evaluateBeachPalette(17.75);
    // 沙堡的湿沙色由当前沙地色压暗推出 → 永远和沙滩是同一种沙
    expect(day.castleSand.r).toBeCloseTo(0.80698, 3);
    expect(day.castleSand.r).toBeLessThan(day.sandBase.r);
    expect(night.castleSand.r).toBeLessThan(night.sandBase.r);
    expect(sunset.castleSand.r).toBeLessThan(sunset.sandBase.r);
    expect(sunset.castleSand.r).not.toBeCloseTo(day.castleSand.r, 3);
    // 道具: 夜里沉稳入夜, 绝非白天的粉白
    expect(night.propCushion.r).toBeLessThan(day.propCushion.r * 0.5);
    expect(night.propCanopyA.r).toBeLessThan(day.propCanopyA.r * 0.5);
  });

  it('角色主光保持透亮 (夜间月光充分照明, 绝过度压暗看不清; 黄昏香槟柔光不染发色)', () => {
    // 夜间人物作为视觉焦点需通透可见 (0.85 ~ 1.0)
    expect(PALETTE_NIGHT.keyLightScale).toBeGreaterThanOrEqual(0.85);
    expect(PALETTE_NIGHT.keyLightScale).toBeLessThanOrEqual(1.0);
    expect(PALETTE_NIGHT.keyLightColor.b).toBeGreaterThan(PALETTE_NIGHT.keyLightColor.r); // 清冷月白色
    // 黄昏香槟暖光保持人物面部粉白通透
    expect(PALETTE_SUNSET.keyLightColor.r).toBeGreaterThan(PALETTE_SUNSET.keyLightColor.b);
    expect(PALETTE_SUNSET.keyLightScale).toBe(1.0);
  });

  it('24 小时光照方向平滑连续, 晨昏与暮色交接期无突变翻转', () => {
    let maxDelta = 0;
    let prev = computeSunDirection(0);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const curr = computeSunDirection(h);
      const delta = prev.distanceTo(curr);
      if (delta > maxDelta) maxDelta = delta;
      prev = curr;
    }
    // 3 分钟 (0.05h) 的方向变化极其微小 (不会发生瞬间 180° 翻转)
    expect(maxDelta).toBeLessThan(0.15);
  });

  it('远岛在夜间与黄昏有专属剪影与薄雾色, 绝不混入写死纯白', () => {
    expect(PALETTE_NIGHT.islandMist.r).toBeLessThan(0.2);
    expect(PALETTE_NIGHT.mountainsFar.r).toBeLessThan(0.2);
    expect(PALETTE_SUNSET.islandMist.r).not.toBeCloseTo(PALETTE_DAY.islandMist.r, 2);
  });

  it('灯塔在夜里彻底亮起, 但塔身 / 礁石沉进夜色 (只剩灯室发光)', () => {
    expect(PALETTE_NIGHT.lighthouseGlow).toBe(1.0);
    expect(PALETTE_NIGHT.lhBody.r).toBeLessThan(PALETTE_DAY.lhBody.r * 0.5);
    expect(PALETTE_NIGHT.lhGlass.r).toBeGreaterThan(PALETTE_NIGHT.lhBody.r); // 玻璃是画面里最亮的暖点
  });
});
