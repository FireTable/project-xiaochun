import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import { readEmbedParams } from './params';
import { XC_CAMERA_RANGES, normalizeXcCamera, parseXcCameraParams } from '@firetable/project-xiaochun/protocol';

describe('camera 范围与主仓库配置一致', () => {
  it('XC_CAMERA_RANGES 与 APP_CONFIG.camera 同源', () => {
    expect([...XC_CAMERA_RANGES.fov]).toEqual([APP_CONFIG.camera.minFov, APP_CONFIG.camera.maxFov]);
    expect([...XC_CAMERA_RANGES.distance]).toEqual([APP_CONFIG.camera.defaultMinDistance, APP_CONFIG.camera.defaultMaxDistance]);
    expect([...XC_CAMERA_RANGES.height]).toEqual([-APP_CONFIG.camera.hostMaxYOffset, APP_CONFIG.camera.hostMaxYOffset]);
  });
  it('默认 fov / 取景距离在范围内', () => {
    const d = APP_CONFIG.camera.defaultShotExtent / (2 * Math.tan((APP_CONFIG.camera.defaultFov * Math.PI) / 360));
    expect(d).toBeGreaterThanOrEqual(XC_CAMERA_RANGES.distance[0]);
    expect(d).toBeLessThanOrEqual(XC_CAMERA_RANGES.distance[1]);
    expect(APP_CONFIG.camera.defaultFov).toBeGreaterThanOrEqual(XC_CAMERA_RANGES.fov[0]);
  });
});

describe('normalizeXcCamera (xc.setConfig / SDK 选项)', () => {
  it('合法值原样通过, null 表示清除', () => {
    expect(normalizeXcCamera({ fov: 40, distance: 3, height: 0.2, intro: false })).toEqual({ ok: true, camera: { fov: 40, distance: 3, height: 0.2, intro: false }, clamped: [] });
    expect(normalizeXcCamera({ fov: null, intro: null })).toEqual({ ok: true, camera: { fov: null, intro: null }, clamped: [] });
    expect(normalizeXcCamera({})).toEqual({ ok: true, camera: {}, clamped: [] });
  });
  it('越界夹到边界并报告', () => {
    const r = normalizeXcCamera({ fov: 5, distance: 99, height: -3 });
    expect(r).toEqual({ ok: true, camera: { fov: 15, distance: 15, height: -1 }, clamped: ['fov', 'distance', 'height'] });
  });
  it('非法类型 / 未知键 / 非对象 → 错误 (含 pitch: 不开放)', () => {
    for (const bad of [null, 1, 'x', [], { fov: '30' }, { fov: NaN }, { distance: Infinity }, { intro: 1 }, { pitch: 1 }, { zoom: 2 }]) {
      expect(normalizeXcCamera(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('?cameraFov= 等 URL 参数', () => {
  it('缺省 = 空对象 (不覆盖)', () => {
    const p = readEmbedParams('');
    expect(p.camera).toEqual({});
    expect(p.cameraWarnings).toEqual([]);
  });
  it('解析数值与 cameraIntro', () => {
    const p = readEmbedParams('?cameraFov=45&cameraDistance=3.5&cameraHeight=-0.25&cameraIntro=0');
    expect(p.camera).toEqual({ fov: 45, distance: 3.5, height: -0.25, intro: false });
    expect(readEmbedParams('?cameraIntro=true').camera).toEqual({ intro: true });
  });
  it('越界夹范围并 warn; 非法忽略并 warn', () => {
    const p = readEmbedParams('?cameraFov=100&cameraDistance=abc&cameraHeight=&cameraIntro=maybe');
    expect(p.camera).toEqual({ fov: 60 });
    expect(p.cameraWarnings).toHaveLength(4);
  });
  it('parseXcCameraParams 不吃空白 / 空值', () => {
    expect(parseXcCameraParams((n) => (n === 'cameraFov' ? ' 20 ' : null)).camera).toEqual({ fov: 20 });
  });
});
