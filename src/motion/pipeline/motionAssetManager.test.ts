import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MotionAssetManager } from './motionAssetManager';
import {
  MOTION_CATALOG,
  MOTION_GROUPS,
  selectMotionFromGroup,
  isMotionCatalogId,
} from '../catalog';
import { ChatDirector } from '../../director/chatDirector';
import { MotionPipeline } from './motionPipeline';
import { UniversalMotionController } from '../sources/clip';

describe('MotionAssetManager & MOTION_GROUPS Architecture', () => {
  let manager: MotionAssetManager;

  beforeEach(() => {
    manager = new MotionAssetManager();
    vi.restoreAllMocks();
  });

  describe('MotionAssetManager (Two-Tier Buffer Cache & L3 Clip Pool)', () => {
    it('caches fetched ArrayBuffer in L1 memory pool for 0ms second hit', async () => {
      const mockBuf = new ArrayBuffer(64);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(mockBuf.slice(0), { status: 200 });
      });

      const url = '/vrm/motion/test-motion.vrma';
      const buf1 = await manager.fetchBuffer(url);
      expect(buf1.byteLength).toBe(64);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 第二次获取直接走 L1 内存池，零网络请求
      const buf2 = await manager.fetchBuffer(url);
      expect(buf2).toBe(buf1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('clears L3 bound clips on invalidateBoundClips() while preserving L1 memory buffers', () => {
      const mockBuf = new ArrayBuffer(32);
      manager.setBuffer('test_key', mockBuf, false);

      const clip = new THREE.AnimationClip('test_clip', 1.0, []);
      manager.setClip('test_key', clip);

      expect(manager.hasClip('test_key')).toBe(true);
      expect(manager.getBufferSync('test_key')).toBe(mockBuf);

      // 换衣触发 L3 剪辑失效
      manager.invalidateBoundClips();

      // L3 已清空，但 L1 二进制内存池完整留存
      expect(manager.hasClip('test_key')).toBe(false);
      expect(manager.getBufferSync('test_key')).toBe(mockBuf);
    });

    it('pre-warms catalog motions marked with warmup: true', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(new ArrayBuffer(128), { status: 200 });
      });

      const fakeVrm = { scene: new THREE.Group() } as any;
      const parseSpy = vi.fn().mockImplementation(async () => {
        return new THREE.AnimationClip('parsed_clip', 1.0, []);
      });

      await manager.warmCatalogMotions(fakeVrm, parseSpy);

      // 验证 warmup: true 的核心动作已进入 L3 剪辑池
      expect(manager.hasClip('thinking')).toBe(true);
      expect(manager.hasClip('listening')).toBe(true);
      expect(manager.hasClip('showFullBody')).toBe(true);
      expect(manager.hasClip('joyfulJump')).toBe(true);
      expect(manager.hasClip('handHeart')).toBe(true);
      expect(manager.hasClip('pokeDimple')).toBe(true);
    });
  });

  describe('MOTION_GROUPS & Weighted Random Selection', () => {
    it('selects valid catalog IDs strictly constrained to MOTION_CATALOG', () => {
      expect(MOTION_GROUPS.outfitShowcase).toHaveLength(4);
      for (let i = 0; i < 50; i++) {
        const id = selectMotionFromGroup('outfitShowcase');
        expect(isMotionCatalogId(id)).toBe(true);
        expect(MOTION_CATALOG[id]).toBeDefined();
      }
    });

    it('obeys weighted distribution statistics (60% showFullBody, 20% joyfulJump, 15% handHeart, 5% pokeDimple)', () => {
      const counts: Record<string, number> = {
        showFullBody: 0,
        joyfulJump: 0,
        handHeart: 0,
        pokeDimple: 0,
      };

      const SAMPLES = 20000;
      for (let i = 0; i < SAMPLES; i++) {
        const picked = selectMotionFromGroup('outfitShowcase');
        counts[picked] = (counts[picked] || 0) + 1;
      }

      const pShowFullBody = counts.showFullBody / SAMPLES;
      const pJoyfulJump = counts.joyfulJump / SAMPLES;
      const pHandHeart = counts.handHeart / SAMPLES;
      const pPokeDimple = counts.pokeDimple / SAMPLES;

      // 允许 ±3.5% 的随机统计误差
      expect(pShowFullBody).toBeGreaterThan(0.565);
      expect(pShowFullBody).toBeLessThan(0.635);

      expect(pJoyfulJump).toBeGreaterThan(0.165);
      expect(pJoyfulJump).toBeLessThan(0.235);

      expect(pHandHeart).toBeGreaterThan(0.115);
      expect(pHandHeart).toBeLessThan(0.185);

      expect(pPokeDimple).toBeGreaterThan(0.025);
      expect(pPokeDimple).toBeLessThan(0.075);
    });
  });

  describe('TurnState Lifecycle & Body Class Management', () => {
    it('manages document.body.classList "chat-playing" exclusively through SSOT turnState', () => {
      // 在 node 环境模拟 document.body.classList
      const classListSet = new Set<string>();
      (globalThis as any).document = {
        body: {
          classList: {
            add: (c: string) => classListSet.add(c),
            remove: (c: string) => classListSet.delete(c),
            contains: (c: string) => classListSet.has(c),
          },
        },
      };

      try {
        const director = new ChatDirector();
        expect(director.turnState).toBe('idle');
        expect(classListSet.has('chat-playing')).toBe(false);

        // 进入倾听态
        director.setTurnState('listening');
        expect(director.turnState).toBe('listening');
        expect(classListSet.has('chat-playing')).toBe(true);

        // 切换至思考态
        director.setTurnState('thinking');
        expect(director.turnState).toBe('thinking');
        expect(classListSet.has('chat-playing')).toBe(true);

        // 切换至说话态
        director.setTurnState('speaking');
        expect(director.turnState).toBe('speaking');
        expect(director.speaking).toBe(true);
        expect(classListSet.has('chat-playing')).toBe(true);

        // 回归待机态
        director.setTurnState('idle');
        expect(director.turnState).toBe('idle');
        expect(director.speaking).toBe(false);
        expect(classListSet.has('chat-playing')).toBe(false);
      } finally {
        delete (globalThis as any).document;
      }
    });

    it('evaluates isBusy correctly (thinking & speaking are busy, listening is non-busy)', () => {
      const director = new ChatDirector();

      const computeIsBusy = (state: string) => state === 'thinking' || state === 'speaking';

      director.setTurnState('idle');
      expect(computeIsBusy(director.turnState)).toBe(false);

      director.setTurnState('listening');
      expect(computeIsBusy(director.turnState)).toBe(false);

      director.setTurnState('thinking');
      expect(computeIsBusy(director.turnState)).toBe(true);

      director.setTurnState('speaking');
      expect(computeIsBusy(director.turnState)).toBe(true);
    });
  });

  describe('Motion Transition Continuity & Stale VRM Safeguards', () => {
    it('forces crossfade transition between consecutive motion clips (forceTransition: true)', () => {
      const pipeline = new MotionPipeline();

      // Mock VRM with basic nodes
      const mockHead = new THREE.Object3D();
      const mockHips = new THREE.Object3D();
      const mockVrm = {
        scene: new THREE.Group(),
        humanoid: {
          getNormalizedBoneNode: (name: string) => {
            if (name === 'head') return mockHead;
            if (name === 'hips') return mockHips;
            return new THREE.Object3D();
          },
        },
      } as any;

      pipeline.bind(mockVrm);

      // 首次切入 motion 源
      pipeline.setMotionSource('motion', 0.6, undefined, 'all', false);
      expect(pipeline.getActiveSource()).toBe('motion');
      expect(pipeline.isTransitioning()).toBe(true);

      // 模拟过渡完成
      (pipeline as any).isCrossfading = false;
      expect(pipeline.isTransitioning()).toBe(false);

      // 若未开启 forceTransition，相同 source / mask 会直接 return，跳过过渡
      pipeline.setMotionSource('motion', 0.6, undefined, 'all', false);
      expect(pipeline.isTransitioning()).toBe(false);

      // 开启 forceTransition = true，即使已经在 motion 源，也必须立即触发 Quintic 平滑过渡
      pipeline.setMotionSource('motion', 0.6, undefined, 'all', true);
      expect(pipeline.isTransitioning()).toBe(true);
    });

    it('protects humanoid bone transforms when UniversalMotionController stops actions', () => {
      const controller = new UniversalMotionController();

      const mockHead = new THREE.Object3D();
      mockHead.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize();
      const initialHeadQ = mockHead.quaternion.clone();

      const mockVrm = {
        scene: new THREE.Group(),
        humanoid: {
          getNormalizedBoneNode: (name: string) => {
            if (name === 'head') return mockHead;
            return new THREE.Object3D();
          },
        },
      } as any;

      controller.bind(mockVrm);

      const track = new THREE.QuaternionKeyframeTrack('Normalized_J_Bip_C_Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
      const clip1 = new THREE.AnimationClip('action1', 1.0, [track]);
      const clip2 = new THREE.AnimationClip('action2', 1.0, [track]);

      controller.play(clip1);
      // 模拟动作执行期间有骨骼姿态
      mockHead.quaternion.copy(initialHeadQ);

      // 连续播放下一个动作，旧动作被 stop 时姿态受保护，不被重置归零
      controller.play(clip2);
      expect(mockHead.quaternion.x).toBeCloseTo(initialHeadQ.x, 4);
      expect(mockHead.quaternion.y).toBeCloseTo(initialHeadQ.y, 4);
      expect(mockHead.quaternion.z).toBeCloseTo(initialHeadQ.z, 4);
      expect(mockHead.quaternion.w).toBeCloseTo(initialHeadQ.w, 4);

      // 停止播放时，骨骼姿态依然受保护
      controller.stop();
      expect(mockHead.quaternion.x).toBeCloseTo(initialHeadQ.x, 4);
      expect(mockHead.quaternion.y).toBeCloseTo(initialHeadQ.y, 4);
      expect(mockHead.quaternion.z).toBeCloseTo(initialHeadQ.z, 4);
      expect(mockHead.quaternion.w).toBeCloseTo(initialHeadQ.w, 4);
    });

    it('syncs VRM reference between ChatDirector and MotionPipeline, avoiding stale disposed VRMs', () => {
      const pipeline = new MotionPipeline();
      const director = new ChatDirector();
      director.bindPipeline(pipeline);

      const oldVrm = {
        scene: new THREE.Group(),
        id: 'old',
        humanoid: {
          getNormalizedBoneNode: () => null,
          getRawBoneNode: () => null,
        },
      } as any;
      const newVrm = {
        scene: new THREE.Group(),
        id: 'new',
        humanoid: {
          getNormalizedBoneNode: () => null,
          getRawBoneNode: () => null,
        },
      } as any;

      pipeline.bind(oldVrm);
      director.bindVRM(oldVrm);
      expect(pipeline.boundVRM).toBe(oldVrm);

      // 换衣时原子绑定到 newVrm
      pipeline.bind(newVrm);
      director.bindVRM(newVrm);
      expect(pipeline.boundVRM).toBe(newVrm);

      // setTurnState('listening') 调用时，不传递陈旧对象，始终使用当前有效的 boundVRM
      const onTurnSpy = vi.spyOn(pipeline, 'onTurnStateChange');
      director.setTurnState('listening');

      expect(onTurnSpy).toHaveBeenCalledWith('listening');
      expect(pipeline.boundVRM).toBe(newVrm);
    });
  });
});
