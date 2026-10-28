import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { runViewReturn, easeInOutCubic, ViewReturner, VIEW_RETURN_MS, type ViewPose, type ViewReturnEnv, type ViewReturnDeps } from '../viewReturn';

const pose = (x: number, y: number, z: number, fov: number, roll = 0): ViewPose => ({
  position: new THREE.Vector3(x, y, z),
  target: new THREE.Vector3(0, y, 0),
  fov,
  roll,
});

/** 手动推进的时钟 + 帧队列 */
function fakeEnv() {
  let t = 0;
  let next: (() => void) | null = null;
  const env: ViewReturnEnv = {
    now: () => t,
    raf: (cb) => {
      next = cb;
      return 1;
    },
    caf: () => {
      next = null;
    },
  };
  return {
    env,
    advance(ms: number) {
      t += ms;
      const cb = next;
      next = null;
      cb?.();
    },
  };
}

describe('runViewReturn (smooth return to the default view)', () => {
  it('takes about a second, eases, and lands exactly on the target pose', async () => {
    const { env, advance } = fakeEnv();
    const seen: ViewPose[] = [];
    const from = pose(2, 1.5, 0.8, 22, -0.15);
    const to = pose(0, 0.95, 2.2, 30, 0);
    const h = runViewReturn(from, to, VIEW_RETURN_MS, (p) => seen.push({ ...p, position: p.position.clone(), target: p.target.clone() }), env);

    advance(100);
    expect(seen).toHaveLength(1);
    expect(seen[0].fov).toBeGreaterThan(22);
    expect(seen[0].fov).toBeLessThan(26); // ease-in: 起步慢
    advance(400);
    advance(400);
    expect(seen.length).toBe(3); // 还没到终点
    expect(seen[2].fov).toBeGreaterThan(seen[1].fov);
    advance(200);
    await expect(h.done).resolves.toBe(true);

    const last = seen.at(-1)!;
    expect(last.position.toArray()).toEqual(to.position.toArray());
    expect(last.target.toArray()).toEqual(to.target.toArray());
    expect(last.fov).toBe(30);
    expect(last.roll).toBe(0); // 荷兰角滚转回正
  });

  it('cancel stops the tween and reports false', async () => {
    const { env, advance } = fakeEnv();
    let frames = 0;
    const h = runViewReturn(pose(1, 1, 1, 22), pose(0, 1, 2, 30), 1000, () => frames++, env);
    advance(100);
    h.cancel();
    advance(100);
    advance(2000);
    await expect(h.done).resolves.toBe(false);
    expect(frames).toBe(1);
  });

  it('a zero duration snaps straight to the target', async () => {
    const { env } = fakeEnv();
    const to = pose(0, 1, 2, 30);
    let got: ViewPose | null = null;
    const h = runViewReturn(pose(1, 1, 1, 22), to, 0, (p) => (got = p), env);
    await expect(h.done).resolves.toBe(true);
    expect(got).toBe(to);
  });

  it('easing is monotonic from 0 to 1', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
});

describe('ViewReturner (what leaving the story resets)', () => {
  function setup() {
    const clock = fakeEnv();
    const camera = new THREE.PerspectiveCamera(22, 16 / 9, 0.1, 100);
    camera.position.set(0.9, 1.3, 1.2);
    const controls = { target: new THREE.Vector3(0.1, 1.4, 0), enabled: true, update: vi.fn() };
    let roll = -0.15;
    const calls: string[] = [];
    const hold: boolean[] = [];
    const deps: ViewReturnDeps = {
      camera,
      controls,
      director: {
        release: () => calls.push('release'),
        reset: () => {
          calls.push('reset');
          roll = 0;
          camera.fov = 30;
        },
        getRoll: () => roll,
        setRoll: (r) => {
          roll = r;
        },
      },
      computeView: () => ({ position: new THREE.Vector3(0, 1.2, 2.2), target: new THREE.Vector3(0, 1.2, 0), fov: 30 }),
      settle: () => calls.push('settle'),
      restoreFacing: () => calls.push('facing'),
      setHoldFacing: (h) => hold.push(h),
      cancelIntro: () => calls.push('cancelIntro'),
      env: clock.env,
    };
    const returner = new ViewReturner(() => deps);
    return { returner, deps, camera, controls, calls, hold, advance: clock.advance, getRoll: () => roll };
  }

  it('releases the director, eases for ~1s while holding bodyTurn, then settles exactly and restores the facing', async () => {
    const s = setup();
    const p = s.returner.run(1000);
    expect(s.calls.slice(0, 2)).toEqual(['release', 'cancelIntro']);
    expect(s.controls.enabled).toBe(false);
    expect(s.hold).toEqual([true]);
    expect(s.returner.active).toBe(true);

    s.advance(500);
    expect(s.camera.fov).toBeGreaterThan(22);
    expect(s.camera.fov).toBeLessThan(30);
    expect(s.getRoll()).toBeGreaterThan(-0.15);
    expect(s.getRoll()).toBeLessThan(0);

    s.advance(600);
    await p;
    expect(s.camera.position.toArray()).toEqual([0, 1.2, 2.2]);
    expect(s.controls.target.toArray()).toEqual([0, 1.2, 0]);
    expect(s.camera.fov).toBe(30);
    expect(s.getRoll()).toBe(0);
    expect(s.controls.enabled).toBe(true);
    expect(s.hold).toEqual([true, false]);
    expect(s.calls.slice(-3)).toEqual(['reset', 'settle', 'facing']); // 落点后才还原朝向
    expect(s.returner.active).toBe(false);
  });

  it('cancel() gives the camera back and the aborted run does not settle', async () => {
    const s = setup();
    const p = s.returner.run(1000);
    s.advance(200);
    s.returner.cancel();
    expect(s.controls.enabled).toBe(true);
    expect(s.hold.at(-1)).toBe(false);
    s.advance(2000);
    await p;
    expect(s.calls).not.toContain('settle');
    expect(s.calls).not.toContain('facing');
  });

  it('a new run supersedes one in flight', async () => {
    const s = setup();
    const first = s.returner.run(1000);
    s.advance(200);
    const second = s.returner.run(1000);
    s.advance(1100);
    await Promise.all([first, second]);
    expect(s.calls.filter((c) => c === 'settle')).toHaveLength(1);
  });

  it('without a model it still releases the director (roll, FOV, wind) and restores the facing', async () => {
    const s = setup();
    s.deps.computeView = () => null;
    await s.returner.run(1000);
    expect(s.calls).toEqual(['release', 'cancelIntro', 'reset', 'facing']);
    expect(s.camera.fov).toBe(30);
    expect(s.getRoll()).toBe(0);
  });
});
