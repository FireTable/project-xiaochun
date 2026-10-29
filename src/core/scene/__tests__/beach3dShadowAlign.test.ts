import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Beach3DWorld } from '../beach3d/beach3dWorld';
import { computeSunDirection } from '../beach3d/beach3dTime';
import { SHADOW_SUN_Y_FLOOR } from '../beach3d/beach3dShaders';

/**
 * 回归锁定: 角色脚下落影 (引擎主光投的) 与场景道具落影 (着色器按太阳方向解析投的)
 * 曾经各走各的 —— 角色的光来自固定的摄影棚主光, 道具的影子来自场景自己的太阳,
 * 于是黄昏 / 夜里"椅子的光影和角色的光影对不上"。
 *
 * 现在角色主光跟随场景太阳, 且两边的落影都用同一个"有效太阳高度角下限"折算,
 * 所以影子方向与长度比例必须完全一致。
 */
describe('beach3d — 角色落影与场景道具落影对齐', () => {
  const world = new Beach3DWorld();

  it('正午的角色主光方向 = 引擎默认主光方向 (白天画面零变化)', () => {
    world.setEnvironmentTime(12);
    world.updateEnvironmentTime();
    const d = world.getEnvironmentLight().direction;
    // StudioLighting 的默认主光: 位置 (2.4, 5.8, 4.0), 目标 (0, 1, 0)
    const studio = new THREE.Vector3(2.4, 5.8, 4.0).sub(new THREE.Vector3(0, 1, 0)).normalize();
    expect(d.x).toBeCloseTo(studio.x, 4);
    expect(d.y).toBeCloseTo(studio.y, 4);
    expect(d.z).toBeCloseTo(studio.z, 4);
  });

  it('各时段下, 角色主光的落影投影与地面着色器的落影投影完全一致', () => {
    for (const h of [8, 12, 16.5, 17.75, 19, 22]) {
      world.setEnvironmentTime(h);
      world.updateEnvironmentTime();
      const d = world.getEnvironmentLight().direction;

      // 地面着色器 (GROUND_FRAG.propShadow / SHADOW_BAKE_VERT) 的落影偏移
      const sun = computeSunDirection(h);
      const floor = Math.max(sun.y, SHADOW_SUN_Y_FLOOR);
      const shaderX = sun.x / floor;
      const shaderZ = sun.z / floor;

      // 角色主光的落影偏移 (平行光: 偏移 = 方向.xz / 方向.y)
      expect(d.x / d.y).toBeCloseTo(shaderX, 4);
      expect(d.z / d.y).toBeCloseTo(shaderZ, 4);
    }
  });

  it('太阳贴到海平面时, 角色主光被折算到与场景道具同一个高度角下限', () => {
    world.setEnvironmentTime(17.75); // 太阳只有 8° 仰角
    world.updateEnvironmentTime();
    const sun = computeSunDirection(17.75);
    expect(sun.y).toBeLessThan(SHADOW_SUN_Y_FLOOR); // 真实太阳比下限更低
    const d = world.getEnvironmentLight().direction;
    expect(d.y).toBeGreaterThan(sun.y); // 主光被抬到下限
    expect(d.x / d.y).toBeCloseTo(sun.x / SHADOW_SUN_Y_FLOOR, 4);
  });

  it('角色主光方向始终是单位向量 (归一化后方向不变)', () => {
    for (const h of [6, 12, 17.75, 22]) {
      world.setEnvironmentTime(h);
      world.updateEnvironmentTime();
      const d = world.getEnvironmentLight().direction;
      expect(d.length()).toBeCloseTo(1, 5);
    }
  });
});
