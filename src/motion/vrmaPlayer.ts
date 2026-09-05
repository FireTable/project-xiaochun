import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';
import { retargetClip } from './vrmaRetarget';
import { VRM_ALL_HUMANOID_BONES, type MotionTransitionManager } from './motionTransition';

export interface VRMALoadResult {
  name: string;
  duration: number;
}

export class VRMAMotionPlayer {
  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private name = '';
  private clock = new THREE.Clock(false);
  private paused = false;
  private hipsRest: { x: number; y: number; z: number } | null = null;

  private sequenceActions: THREE.AnimationAction[] = [];
  private sequenceIdx = -1;
  private transitioningSequence = false;
  private isSequenceMode = false;

  private idleWeight = 1.0;
  private isFadingToIdle = false;
  private fadeDuration = 0.5;

  private transitionManager: MotionTransitionManager | null = null;

  bind(vrm: VRM): void {
    this.vrm = vrm;
  }

  bindTransitionManager(tm: MotionTransitionManager): void {
    this.transitionManager = tm;
  }

  async parseBufferToClip(buf: ArrayBuffer, vrm: VRM): Promise<THREE.AnimationClip> {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    const gltf = await loader.parseAsync(buf, '');
    const vrmAnim = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnim) throw new Error('No VRMAnimation in buffer');
    let clip = createVRMAnimationClip(vrmAnim, vrm);

    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      if (!this.hipsRest) {
        this.hipsRest = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
      }
      const { x: restX, y: restY, z: restZ } = this.hipsRest;
      clip.tracks.forEach((t) => {
        if (!t.name.endsWith('.position')) return;
        const offX = t.values[0] - restX;
        const offY = t.values[1] - restY;
        const offZ = t.values[2] - restZ;
        for (let i = 0; i < t.values.length; i += 3) {
          t.values[i]     -= offX;
          t.values[i + 1] -= offY;
          t.values[i + 2] -= offZ;
        }
      });
    }
    return retargetClip(clip, vrm);
  }

  private playClipOnMixer(clip: THREE.AnimationClip, vrm: VRM, fadeDur = 0.65): THREE.AnimationAction {
    this.vrm = vrm;
    const mixer = this.mixer ?? new THREE.AnimationMixer(vrm.scene);
    this.mixer = mixer;
    this.isSequenceMode = false;
    this.fadeDuration = fadeDur;

    const newAction = mixer.clipAction(clip);
    newAction.reset();
    newAction.setLoop(THREE.LoopOnce, 1);
    newAction.clampWhenFinished = true;
    newAction.enabled = true;
    newAction.setEffectiveWeight(1.0);
    newAction.setEffectiveTimeScale(1.0);

    const oldAction = this.action;
    if (oldAction && oldAction !== newAction) {
      oldAction.stop();
    }

    newAction.play();
    this.action = newAction;
    this.idleWeight = 0.0;
    this.isFadingToIdle = false;
    this.paused = false;
    this.clock.start();
    return newAction;
  }

  playLoop(clip: THREE.AnimationClip, vrm: VRM, fadeDur = 0.65): THREE.AnimationAction {
    this.vrm = vrm;
    const mixer = this.mixer ?? new THREE.AnimationMixer(vrm.scene);
    this.mixer = mixer;
    this.isSequenceMode = false;
    this.fadeDuration = fadeDur;

    const newAction = mixer.clipAction(clip);
    newAction.reset();
    newAction.setLoop(THREE.LoopRepeat, Infinity);
    newAction.clampWhenFinished = false;
    newAction.enabled = true;
    newAction.setEffectiveWeight(1.0);

    const oldAction = this.action;
    if (oldAction && oldAction !== newAction) {
      oldAction.stop();
    }

    newAction.play();
    this.action = newAction;
    this.idleWeight = 0.0;
    this.isFadingToIdle = false;
    this.paused = false;
    this.clock.start();
    return newAction;
  }

  playSequence(clips: THREE.AnimationClip[], vrm: VRM, fadeDur = 0.65): void {
    if (!clips.length) return;

    this.vrm = vrm;
    const mixer = this.mixer ?? new THREE.AnimationMixer(vrm.scene);
    this.mixer = mixer;
    this.isSequenceMode = true;
    this.sequenceActions = [];
    this.sequenceIdx = 0;
    this.transitioningSequence = false;
    this.isFadingToIdle = false;
    this.fadeDuration = fadeDur;



    clips.forEach((clip) => {
      const act = mixer.clipAction(clip);
      act.reset();
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
      act.enabled = true;
      act.setEffectiveWeight(1.0);
      act.setEffectiveTimeScale(1.0);
      this.sequenceActions.push(act);
    });

    const oldAction = this.action;
    const firstAction = this.sequenceActions[0];
    if (oldAction && oldAction !== firstAction) {
      oldAction.stop();
    }
    firstAction.play();
    this.action = firstAction;
    this.name = `sequence (${clips.length} actions)`;
    this.idleWeight = 0.0;
    this.paused = false;
    this.clock.start();
  }

  async loadVRMA(url: string, vrm: VRM): Promise<VRMALoadResult> {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    const gltf = await loader.loadAsync(url);
    const vrmAnim = gltf.userData.vrmAnimations?.[0];
    if (!vrmAnim) throw new Error(`No VRMAnimation found in ${url}`);
    let clip = createVRMAnimationClip(vrmAnim, vrm);

    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      if (!this.hipsRest) {
        this.hipsRest = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
      }
      const { x: restX, y: restY, z: restZ } = this.hipsRest;
      clip.tracks.forEach((t) => {
        if (!t.name.endsWith('.position')) return;
        const offX = t.values[0] - restX;
        const offY = t.values[1] - restY;
        const offZ = t.values[2] - restZ;
        for (let i = 0; i < t.values.length; i += 3) {
          t.values[i]     -= offX;
          t.values[i + 1] -= offY;
          t.values[i + 2] -= offZ;
        }
      });
    }

    clip = retargetClip(clip, vrm);
    this.playClipOnMixer(clip, vrm, 0.65);

    this.name = url.split('/').pop()?.replace(/\.vrma$/i, '') ?? 'vrma';
    return { name: this.name, duration: clip.duration };
  }

  async loadVRMAFromBuffer(buf: ArrayBuffer, vrm: VRM): Promise<VRMALoadResult> {
    const clip = await this.parseBufferToClip(buf, vrm);
    this.playClipOnMixer(clip, vrm, 0.65);
    this.name = this.name || 'history';
    return { name: this.name, duration: clip.duration };
  }

  update(delta: number) {
    if (!this.mixer || this.paused) return;
    const dt = delta > 0 ? delta : this.clock.getDelta();
    this.mixer.update(dt);

    if (this.isSequenceMode && this.sequenceActions.length > 0) {
      const curAction = this.sequenceActions[this.sequenceIdx];
      if (curAction) {
        const clipDur = curAction.getClip().duration;
        const fadeDur = Math.min(0.5, clipDur * 0.35);

        if (this.sequenceIdx < this.sequenceActions.length - 1) {
          if (!this.transitioningSequence && curAction.time >= clipDur - fadeDur) {
            this.transitioningSequence = true;
            const nextIdx = this.sequenceIdx + 1;
            const nextAction = this.sequenceActions[nextIdx];
            nextAction.reset();
            nextAction.enabled = true;
            nextAction.setEffectiveWeight(1.0);
            nextAction.play();
            nextAction.crossFadeFrom(curAction, fadeDur, true);
            this.sequenceIdx = nextIdx;
            this.action = nextAction;
            setTimeout(() => { this.transitioningSequence = false; }, 100);
          }
        } else {
          // 动作序列播完最后一段后直接顺滑淡出到待机，绝不重复播放
          if (!this.transitioningSequence && curAction.time >= clipDur - fadeDur && !this.isFadingToIdle) {
            this.transitioningSequence = true;
            curAction.fadeOut(fadeDur);
            this.isFadingToIdle = true;
          }
        }
      }
    } else if (this.action) {
      // 仅对非循环动作 (LoopOnce) 在接近尾声时自动淡出到待机；循环动作 (LoopRepeat，如思考动作 thinking.vrma) 持续播放，直至外部接管
      const isLoop = this.action.loop === THREE.LoopRepeat;
      if (!isLoop) {
        const clipDur = this.action.getClip().duration;
        const fadeDur = Math.min(this.fadeDuration, clipDur * 0.35);

        if (this.action.time >= clipDur - fadeDur && !this.isFadingToIdle) {
          this.isFadingToIdle = true;
          this.action.fadeOut(fadeDur);
        }
      }
    }

    // Update idle weight smoothly
    if (this.isFadingToIdle) {
      this.idleWeight = Math.min(1.0, this.idleWeight + dt / this.fadeDuration);
    } else if (this.action && this.action.isRunning()) {
      this.idleWeight = Math.max(0.0, this.idleWeight - dt / this.fadeDuration);
    }
  }

  getIdleWeight(): number {
    return this.idleWeight;
  }

  isPlaying(): boolean {
    if (this.paused || !this.action || !this.mixer) return false;
    return this.action.isRunning() && (!this.isFadingToIdle || this.idleWeight < 0.99);
  }

  fadeOutToIdle(duration = 0.85) {
    this.fadeDuration = duration;
    this.isFadingToIdle = true;
    if (this.action) {
      this.action.fadeOut(duration);
    }
    this.sequenceActions.forEach((act) => act.fadeOut(duration));
  }

  stop() {
    // 关键修正：Three.js 的 AnimationMixer.stopAllAction() 会默认触发 restoreOriginalState()，
    // 将受控骨骼粗暴重置回 T-Pose / Rest Pose（0），导致姿态闪现顿挫！
    // 在 stopAllAction 执行前后截获并完整保护当前姿态，确保处于自然连续的人体生理姿态，
    // 供全局 MotionTransitionManager 或下一段动作无缝接管！
    const boneTransforms: { node: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3 }[] = [];
    if (this.vrm?.humanoid) {
      for (const name of VRM_ALL_HUMANOID_BONES) {
        const node = this.vrm.humanoid.getNormalizedBoneNode(name as any);
        if (node) {
          boneTransforms.push({
            node,
            q: node.quaternion.clone(),
            p: name === 'hips' ? node.position.clone() : undefined,
          });
        }
      }
    }

    this.mixer?.stopAllAction();

    for (const item of boneTransforms) {
      item.node.quaternion.copy(item.q);
      if (item.p) item.node.position.copy(item.p);
    }

    this.action = null;
    this.mixer = null;
    this.paused = false;
    this.isSequenceMode = false;
    this.sequenceActions = [];
    this.sequenceIdx = -1;
    this.transitioningSequence = false;
    this.idleWeight = 1.0;
    this.isFadingToIdle = false;
    this.clock.stop();
  }

  resetHipsRest() { this.hipsRest = null; }

  getHipsRest(): { x: number; y: number; z: number } | null { return this.hipsRest; }

  setPaused(p: boolean) {
    this.paused = p;
    if (this.action) this.action.paused = p;
    if (!p) {
      this.clock.start();
    }
  }

  seek(time: number) {
    if (!this.action) return;
    const clip = this.action.getClip();
    const wasPaused = this.action.paused;
    this.action.paused = false;
    this.action.time = Math.max(0, Math.min(time, clip.duration - 0.001));
    this.mixer?.update(0);
    this.action.paused = wasPaused;
  }

  getPlayback(): { time: number; duration: number; running: boolean } | null {
    if (this.isSequenceMode) {
      if (!this.sequenceActions.length) return null;
      const curAction = this.sequenceActions[this.sequenceIdx];
      const isFinished = (this.sequenceIdx === this.sequenceActions.length - 1) && 
                         (this.idleWeight >= 0.99);
      return {
        time: curAction.time,
        duration: curAction.getClip().duration,
        running: !isFinished && !this.paused && (this.mixer !== null),
      };
    }
    if (!this.action) return null;
    const clip = this.action.getClip();
    if (!clip?.duration) return null;
    const isFinished = this.idleWeight >= 0.99 && (this.action.time >= clip.duration - 0.01);
    return {
      time: this.action.time,
      duration: clip.duration,
      running: !isFinished && !this.paused,
    };
  }

  getActiveMotionName(): string | null {
    return this.name || null;
  }
}
