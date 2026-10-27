import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CameraDirector, SHOT_PRESETS } from '../cameraDirector';
import { CameraDirectiveSchema } from '@/story/schema';

describe('CameraDirector & Cinematic Orbit Orchestration', () => {
  let camera: THREE.PerspectiveCamera;
  let target: THREE.Vector3;
  let fakeControls: any;
  let fakeVrm: any;
  let headBone: THREE.Object3D;
  let director: CameraDirector;

  beforeEach(() => {
    vi.useFakeTimers();
    camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
    camera.position.set(0, 1.2, 2.5);

    target = new THREE.Vector3(0, 1.2, 0);
    fakeControls = {
      target,
      enabled: true,
      getAzimuthalAngle: () => 0,
      getPolarAngle: () => Math.PI / 2,
      update: vi.fn(),
    };

    headBone = new THREE.Object3D();
    headBone.position.set(0, 1.45, 0);

    fakeVrm = {
      scene: new THREE.Scene(),
      humanoid: {
        getNormalizedBoneNode: (name: string) => (name === 'head' ? headBone : null),
      },
    };

    director = new CameraDirector();
    director.bind({
      camera,
      getControls: () => fakeControls,
      getVRM: () => fakeVrm,
      onApplyGroundClamp: vi.fn(),
      setWindMultiplier: vi.fn(),
    });
  });

  afterEach(() => {
    director.stopTransition();
    vi.useRealTimers();
  });

  it('validates CameraDirectiveSchema with custom orbitAngleDeg', () => {
    const directive = CameraDirectiveSchema.parse({
      shot: 'medium',
      movement: 'arc_sweep',
      durationSec: 2.0,
      orbitAngleDeg: 45,
    });
    expect(directive.shot).toBe('medium');
    expect(directive.movement).toBe('arc_sweep');
    expect(directive.orbitAngleDeg).toBe(45);
  });

  it('performs subtle orbit (orbit_subtle) and updates camera spherical position', async () => {
    const transitionPromise = director.transitionTo({
      shot: 'medium',
      movement: 'orbit_subtle',
      durationSec: 1.0,
      easing: 'linear',
    });

    expect(director.active).toBe(true);

    // Advance halfway (0.5s = 500ms)
    vi.advanceTimersByTime(500);

    // Advance to end (1000ms)
    vi.advanceTimersByTime(600);
    await transitionPromise;

    expect(director.active).toBe(false);
    expect(fakeControls.enabled).toBe(true);
    expect(fakeControls.update).toHaveBeenCalled();
    // After subtle orbit (~21.6 deg), camera.position.x should have orbited from 0 to positive
    expect(camera.position.x).toBeGreaterThan(0.01);
  });

  it('performs full 360 degree hero spiral orbit (hero_spiral_orbit)', async () => {
    const transitionPromise = director.transitionTo({
      shot: 'medium',
      movement: 'hero_spiral_orbit',
      durationSec: 2.0,
      windMultiplier: 1.5,
    });

    expect(director.active).toBe(true);
    vi.advanceTimersByTime(2100);
    await transitionPromise;

    expect(director.active).toBe(false);
    expect(fakeControls.enabled).toBe(true);
  });

  it('honors custom orbitAngleDeg for precise camera staging', async () => {
    const transitionPromise = director.transitionTo({
      shot: 'medium',
      movement: 'none',
      orbitAngleDeg: 90,
      durationSec: 1.0,
      easing: 'linear',
    });

    vi.advanceTimersByTime(1100);
    await transitionPromise;

    expect(director.active).toBe(false);
    // At 90 deg horizontal rotation, x should be close to preset distance
    expect(camera.position.x).toBeGreaterThan(SHOT_PRESETS.medium.distance * 0.9);
  });
});
