import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as THREE from 'three';
import { CameraDirector, DUTCH_TILT_RAD } from '../cameraDirector';

describe('CameraDirector cinematic movements (wind, dutch_tilt, hero_backlight_reveal)', () => {
  let camera: THREE.PerspectiveCamera;
  let controls: any;
  let director: CameraDirector;
  let setWind: Mock<(mult: number) => void>;
  let sun: THREE.Vector3;

  beforeEach(() => {
    vi.useFakeTimers();
    camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.2, 2.5);
    controls = {
      target: new THREE.Vector3(0, 1.2, 0),
      enabled: true,
      getAzimuthalAngle: () => 0,
      getPolarAngle: () => Math.PI / 2,
      update: vi.fn(),
    };
    const head = new THREE.Object3D();
    head.position.set(0, 1.45, 0);
    const vrm: any = { scene: new THREE.Scene(), humanoid: { getNormalizedBoneNode: (n: string) => (n === 'head' ? head : null) } };
    setWind = vi.fn<(mult: number) => void>();
    sun = new THREE.Vector3(0, 0.3, 1).normalize();
    director = new CameraDirector();
    director.bind({
      camera,
      getControls: () => controls,
      getVRM: () => vrm,
      getSunDirection: () => sun.clone(),
      onApplyGroundClamp: vi.fn(),
      setWindMultiplier: setWind,
    });
  });

  afterEach(() => {
    director.reset();
    vi.useRealTimers();
  });

  it('drives the wind multiplier while the move runs and releases it afterwards', async () => {
    const p = director.transitionTo({ shot: 'medium', movement: 'push_in', durationSec: 1, windMultiplier: 2.4 });
    expect(setWind).toHaveBeenCalledWith(2.4);
    vi.advanceTimersByTime(1100);
    await p;
    expect(setWind).toHaveBeenLastCalledWith(1);
  });

  it('does not raise the wind for a calm move', async () => {
    const p = director.transitionTo({ shot: 'medium', movement: 'push_in', durationSec: 0.5 });
    vi.advanceTimersByTime(700);
    await p;
    expect(setWind.mock.calls.every((c) => c[0] === 1)).toBe(true);
  });

  it('dutch_tilt rolls the camera by about -9 degrees and the next normal move levels it again', async () => {
    const p = director.transitionTo({ shot: 'close_up', movement: 'dutch_tilt', durationSec: 1, easing: 'linear' });
    vi.advanceTimersByTime(1100);
    await p;
    expect(director.getRoll()).toBeCloseTo(DUTCH_TILT_RAD, 5);

    // 渲染循环里 controls.update → lookAt 之后叠加滚转
    camera.lookAt(controls.target);
    const before = camera.quaternion.clone();
    director.applyRoll();
    expect(camera.quaternion.angleTo(before)).toBeCloseTo(Math.abs(DUTCH_TILT_RAD), 4);

    const p2 = director.transitionTo({ shot: 'medium', movement: 'push_in', durationSec: 0.6, easing: 'linear' });
    vi.advanceTimersByTime(800);
    await p2;
    expect(director.getRoll()).toBe(0);
  });

  it('reset() clears any leftover roll', async () => {
    const p = director.transitionTo({ shot: 'close_up', movement: 'dutch_tilt', durationSec: 0.4 });
    vi.advanceTimersByTime(600);
    await p;
    director.reset();
    expect(director.getRoll()).toBe(0);
  });

  it('hero_backlight_reveal ends opposite the sun, lower and tighter, and orbits around instead of cutting through the character', async () => {
    // 太阳在 +Z 方向、相机在 +Z：逆光机位需要走到 -Z，直线插值会穿过角色
    const p = director.transitionTo({ shot: 'medium', movement: 'hero_backlight_reveal', durationSec: 2, easing: 'linear' });
    vi.advanceTimersByTime(1000); // 中点
    const mid = camera.position.clone().sub(controls.target);
    expect(Math.hypot(mid.x, mid.z)).toBeGreaterThan(1.2); // 没穿过角色

    vi.advanceTimersByTime(1200);
    await p;
    const end = camera.position.clone().sub(controls.target);
    // 终点方位角 = 太阳反方向 (-Z)
    expect(end.z).toBeLessThan(-1.5);
    expect(Math.abs(end.x)).toBeLessThan(0.3);
    // 视角收窄
    expect(camera.fov).toBeLessThan(30);
  });

  it('alignSunBacklight alone also takes the short way around', async () => {
    const p = director.transitionTo({ shot: 'medium', movement: 'none', alignSunBacklight: true, durationSec: 2, easing: 'linear' });
    vi.advanceTimersByTime(1000);
    const mid = camera.position.clone().sub(controls.target);
    expect(Math.hypot(mid.x, mid.z)).toBeGreaterThan(1.2);
    vi.advanceTimersByTime(1200);
    await p;
    expect(camera.position.z).toBeLessThan(controls.target.z - 1.5);
  });

  describe('release / reset when the story ends', () => {
    it('release() frees the wind and any running move but leaves the camera and roll for the return tween', async () => {
      const p = director.transitionTo({ shot: 'close_up', movement: 'dutch_tilt', durationSec: 1, easing: 'linear', windMultiplier: 2 });
      vi.advanceTimersByTime(1100);
      await p;
      const roll = director.getRoll();
      expect(roll).toBeLessThan(0);
      const q = director.transitionTo({ shot: 'medium', movement: 'push_in', durationSec: 5, windMultiplier: 2.4 });
      expect(director.active).toBe(true);
      setWind.mockClear();
      director.release();
      expect(director.active).toBe(false);
      expect(setWind).toHaveBeenLastCalledWith(1);
      expect(controls.enabled).toBe(true);
      void q;
    });

    it('reset() levels the roll, restores the default FOV (host override aware) and releases the wind even when idle', () => {
      director.bind({
        camera,
        getControls: () => controls,
        getVRM: () => null,
        setWindMultiplier: setWind,
        getDefaultFov: () => 38,
      });
      director.setRoll(-0.15);
      camera.fov = 22;
      setWind.mockClear();
      director.reset();
      expect(director.getRoll()).toBe(0);
      expect(camera.fov).toBe(38);
      expect(setWind).toHaveBeenCalledWith(1);
    });

    it('reset() falls back to FOV 30 when the host gives no default', () => {
      camera.fov = 22;
      director.reset();
      expect(camera.fov).toBe(30);
    });
  });

  it('has presets for the new wide and medium_close_up shots, ordered by how tight they are', async () => {
    const { SHOT_PRESETS } = await import('../cameraDirector');
    expect(SHOT_PRESETS.wide.distance).toBeGreaterThan(SHOT_PRESETS.full.distance);
    expect(SHOT_PRESETS.medium_close_up.distance).toBeGreaterThan(SHOT_PRESETS.close_up.distance);
    expect(SHOT_PRESETS.medium_close_up.distance).toBeLessThan(SHOT_PRESETS.medium.distance);
    for (const shot of ['wide', 'medium_close_up'] as const) {
      const p = director.transitionTo({ shot, movement: 'none', durationSec: 0.3, easing: 'linear' });
      vi.advanceTimersByTime(500);
      await p;
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(SHOT_PRESETS[shot].distance, 1);
    }
  });

  describe('slow_push_in / orbit_to_front', () => {
    const azimuthOf = () => Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    const distOf = () => camera.position.distanceTo(controls.target);

    it('slow_push_in starts far away at the offset azimuth and glides in, never closer than the shot until the end', async () => {
      const p = director.transitionTo({ shot: 'full', movement: 'slow_push_in', startDistance: 6.5, startAzimuthOffsetDeg: 25, durationSec: 4, easing: 'linear' });
      // 起点在同步段内就位：远、斜后方
      expect(distOf()).toBeCloseTo(6.5, 1);
      expect(azimuthOf()).toBeCloseTo((25 * Math.PI) / 180, 2);
      vi.advanceTimersByTime(2000);
      const mid = distOf();
      expect(mid).toBeLessThan(6.5);
      expect(mid).toBeGreaterThan(2.95);
      expect(Math.abs(azimuthOf())).toBeLessThan((25 * Math.PI) / 180);
      vi.advanceTimersByTime(2200);
      await p;
      expect(distOf()).toBeCloseTo(2.95, 1);
      expect(azimuthOf()).toBeCloseTo(0, 2);
    });

    it('slow_push_in without an azimuth offset is a straight dolly along the line of sight', async () => {
      const p = director.transitionTo({ shot: 'full', movement: 'slow_push_in', startDistance: 5, durationSec: 2, easing: 'linear' });
      expect(azimuthOf()).toBeCloseTo(0, 3);
      vi.advanceTimersByTime(1000);
      expect(azimuthOf()).toBeCloseTo(0, 3);
      vi.advanceTimersByTime(1200);
      await p;
      expect(distOf()).toBeCloseTo(2.95, 1);
    });

    it('orbit_to_front sweeps to the direction she faces without ever passing through her, ending in the shot', async () => {
      // 她背对相机：相机在 +Z (方位 0)，她面朝 -Z → 正面方位 = π
      (director as any).ctx.getVRM().scene.rotation.y = Math.PI;
      camera.position.set(0, 1.2, 2.95);
      const p = director.transitionTo({ shot: 'medium_close_up', movement: 'orbit_to_front', durationSec: 2, easing: 'linear' });
      vi.advanceTimersByTime(1000);
      const mid = camera.position.clone().sub(controls.target);
      expect(Math.hypot(mid.x, mid.z)).toBeGreaterThan(1.2); // 走的是环绕弧，没穿过角色
      expect(Math.abs(mid.x)).toBeGreaterThan(1.0); // 中点在她侧面
      vi.advanceTimersByTime(1200);
      await p;
      expect(Math.abs(Math.abs(azimuthOf()) - Math.PI)).toBeLessThan(0.05);
      expect(distOf()).toBeCloseTo(1.8, 1);
    });

    it('orbit_to_front takes the short way when she is already half turned, and orbitAngleDeg < 0 picks the other side at 180°', async () => {
      controls.getAzimuthalAngle = azimuthOf; // 相机会移动，方位角要跟着实际位置走
      (director as any).ctx.getVRM().scene.rotation.y = Math.PI / 2; // 正面在 +X
      camera.position.set(0, 1.2, 2.95);
      let p = director.transitionTo({ shot: 'medium_close_up', movement: 'orbit_to_front', durationSec: 1, easing: 'linear' });
      vi.advanceTimersByTime(1200);
      await p;
      expect(azimuthOf()).toBeCloseTo(Math.PI / 2, 1);

      (director as any).ctx.getVRM().scene.rotation.y = -Math.PI / 2; // 此刻相机在 +X、正面在 -X：恰好 180°
      p = director.transitionTo({ shot: 'medium_close_up', movement: 'orbit_to_front', orbitAngleDeg: -1, durationSec: 1, easing: 'linear' });
      vi.advanceTimersByTime(500);
      expect(camera.position.z).toBeGreaterThan(0.5); // 负向 (方位角递减 π/2 → 0 → -π/2) = 经由 +Z 侧
      vi.advanceTimersByTime(700);
      await p;
    });
  });

  it('stopTransition settles the pending transitionTo promise (callers waiting on the camera are never left hanging)', async () => {
    let settled = false;
    const p = director.transitionTo({ shot: 'medium_close_up', movement: 'orbit_to_front', durationSec: 5 }).then(() => { settled = true; });
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(settled).toBe(false);
    director.stopTransition();
    await p;
    expect(settled).toBe(true);
  });

  it('a new move settles the previous one and a natural finish settles exactly once', async () => {
    const first = director.transitionTo({ shot: 'medium', movement: 'none', durationSec: 5 });
    const second = director.transitionTo({ shot: 'full', movement: 'none', durationSec: 0.5 });
    await first; // 被第二个运镜顶掉
    vi.advanceTimersByTime(700);
    await second;
  });
});
