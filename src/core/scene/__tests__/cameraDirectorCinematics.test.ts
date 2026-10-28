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
});
