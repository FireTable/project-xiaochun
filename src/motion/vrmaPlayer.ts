import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';
import { retargetClip } from './vrmaRetarget';

export interface VRMALoadResult {
  name: string;
  duration: number;
}

export interface VRMALoadResult {
  name: string;
  duration: number;
}

export class VRMAMotionPlayer {
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
    if (oldAction && oldAction !== newAction && oldAction.isRunning() && oldAction.getEffectiveWeight() > 0.05) {
      newAction.setEffectiveWeight(1.0);
      newAction.crossFadeFrom(oldAction, fadeDur, true);
      const toClean = oldAction;
      setTimeout(() => {
        if (this.action !== toClean) {
          toClean.stop();
        }
      }, fadeDur * 1000 + 100);
    } else {
      // 从待机无动作进入：action 保持 1.0 满权重，避免 Three.js 在 weight<1 时回退到裸 T-Pose
      // 依靠 idleWeight 从 1.0 平滑衰减到 0.0，从自然待机姿态 (Natural Idle) 丝滑过渡到新动作！
      newAction.setEffectiveWeight(1.0);
      this.idleWeight = 1.0;
    }

    newAction.play();
    this.action = newAction;
    this.isFadingToIdle = false;
    this.paused = false;
    this.clock.start();
    return newAction;
  }

  playLoop(clip: THREE.AnimationClip, vrm: VRM, fadeDur = 0.65): THREE.AnimationAction {
    const mixer = this.mixer ?? new THREE.AnimationMixer(vrm.scene);
    this.mixer = mixer;
    this.isSequenceMode = false;
    this.fadeDuration = fadeDur;

    const newAction = mixer.clipAction(clip);
    newAction.reset();
    newAction.setLoop(THREE.LoopRepeat, Infinity);
    newAction.clampWhenFinished = false;
    newAction.enabled = true;

    const oldAction = this.action;
    if (oldAction && oldAction !== newAction && oldAction.isRunning() && oldAction.getEffectiveWeight() > 0.05) {
      newAction.setEffectiveWeight(1.0);
      newAction.crossFadeFrom(oldAction, fadeDur, true);
      const toClean = oldAction;
      setTimeout(() => {
        if (this.action !== toClean) {
          toClean.stop();
        }
      }, fadeDur * 1000 + 100);
    } else {
      // 从待机进入思考循环：新动作保持 1.0 满权重，通过 idleWeight 从 1.0 平滑衰减，绝不闪现 T-Pose！
      newAction.setEffectiveWeight(1.0);
      this.idleWeight = 1.0;
    }

    newAction.play();
    this.action = newAction;
    this.isFadingToIdle = false;
    this.paused = false;
    this.clock.start();
    return newAction;
  }

  playSequence(clips: THREE.AnimationClip[], vrm: VRM, fadeDur = 0.65): void {
    if (!clips.length) return;

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
    firstAction.reset();

    if (oldAction && oldAction !== firstAction && oldAction.isRunning() && oldAction.getEffectiveWeight() > 0.05) {
      firstAction.setEffectiveWeight(1.0);
      firstAction.crossFadeFrom(oldAction, fadeDur, true);
      const toClean = oldAction;
      setTimeout(() => {
        if (this.action !== toClean) {
          try { toClean.stop(); } catch {}
        }
      }, fadeDur * 1000 + 100);
    } else {
      firstAction.setEffectiveWeight(1.0);
      this.idleWeight = 1.0;
    }

    firstAction.play();
    this.action = firstAction;

    this.name = `sequence (${clips.length} actions)`;
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
      const clipDur = this.action.getClip().duration;
      const fadeDur = Math.min(this.fadeDuration, clipDur * 0.35);

      if (this.action.time >= clipDur - fadeDur && !this.isFadingToIdle) {
        this.isFadingToIdle = true;
        this.action.fadeOut(fadeDur);
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

  fadeOutToIdle(duration = 0.85) {
    this.fadeDuration = duration;
    this.isFadingToIdle = true;
    if (this.action) {
      this.action.fadeOut(duration);
    }
    this.sequenceActions.forEach((act) => act.fadeOut(duration));
  }

  stop() {
    this.mixer?.stopAllAction();
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
