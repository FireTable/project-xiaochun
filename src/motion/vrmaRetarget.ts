import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

// ponytail: 浏览器端 VRMA retarget + 反穿模限幅(JS 层版,不动 GLB 二进制)——
//
// SimpleText2Motion 的 motion_to_vrma 把 SMPL-H 22 关节的旋转直接套到目标 VRM,
// 不考虑骨骼长度差异 → 走路动作手臂缩进身体、悬空、穿模。
//
// 我们在 JS 拿到 clip 之后:
//   1) 按 VRM 自身 T-pose 骨骼长度重缩放旋转角度(适配比例差异)
//   2) 对肩膀/肘/腕/膝盖做"swing-twist"分解,锁住 swing 角度上限(防穿模)
//
// 反穿模的物理直觉:手臂绕 Y 轴转超过 ±90° 就会从身体前方绕到后方,
// AI 训出来的"走路"动作经常出现这种情况 — 我们在运行时把它拉回到合理范围。

// SMPL-H 标准 T-pose 骨骼长度(米,parent joint → child joint 距离)
const SMPLH_LENGTHS: Record<string, number> = {
  spine: 0.13, chest: 0.12, upperChest: 0.10,
  neck: 0.05, head: 0.10,
  leftShoulder: 0.10, leftUpperArm: 0.28, leftLowerArm: 0.25,
  rightShoulder: 0.10, rightUpperArm: 0.28, rightLowerArm: 0.25,
  leftUpperLeg: 0.42, leftLowerLeg: 0.40, leftFoot: 0.04, leftToes: 0.10,
  rightUpperLeg: 0.42, rightLowerLeg: 0.40, rightFoot: 0.04, rightToes: 0.10,
};

const LEG_BONES = new Set([
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]);

// ponytail: 哪些骨骼需要反穿模限幅 ——
// 只限上半身(肩/臂)。腿不限:腿的自然运动范围大(下蹲/踢腿/跪坐都能到 90-150°),
// 上限设小了反而把正常姿势弄怪。AI 的腿 bug 表现为"走路姿势奇怪"而非穿模。
const ANTI_CLIP_BONES: Record<string, number> = {
  leftShoulder:    Math.PI / 15,  // 12° — 限制锁骨过高抬升
  rightShoulder:   Math.PI / 15,
  leftUpperArm:    Math.PI / 3,   // 上臂 swing 限位
  rightUpperArm:   Math.PI / 3,
  leftLowerArm:    Math.PI / 2.5, // 72° — 肘弯曲合理范围
  rightLowerArm:   Math.PI / 2.5,
};

// ponytail: 旋转四元数按比例 factor 缩放 (用于衰减肩膀/锁骨异常旋转)
function scaleQuaternion(values: Float32Array, offset: number, factor: number) {
  const x = values[offset], y = values[offset + 1], z = values[offset + 2], w = values[offset + 3];
  if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(w)) return;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) return;
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
  const newAngle = angle * factor;
  const halfNew = newAngle / 2;
  const sNew = Math.sin(halfNew);
  const ax = x / len, ay = y / len, az = z / len;
  values[offset]     = ax * sNew;
  values[offset + 1] = ay * sNew;
  values[offset + 2] = az * sNew;
  values[offset + 3] = Math.cos(halfNew);
}

// ponytail: 测 VRM T-pose 下每根骨骼的"父→子世界距离"。
function measureVRMBoneLengths(vrm: VRM): Map<string, number> {
  const lengths = new Map<string, number>();
  const chains = [
    ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'],
    ['chest', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
    ['chest', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
    ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
    ['hips', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
  ];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      const parent = vrm.humanoid.getNormalizedBoneNode(chain[i - 1] as any);
      const child = vrm.humanoid.getNormalizedBoneNode(chain[i] as any);
      if (!parent || !child) continue;
      parent.getWorldPosition(tmpA);
      child.getWorldPosition(tmpB);
      const d = tmpA.distanceTo(tmpB);
      if (d > 0.01) lengths.set(chain[i], d);
    }
  }
  return lengths;
}

// ponytail: 反穿模 — 总旋转角度限幅(simple magnitude clamp)。
// 把 quaternion 转成 axis-angle,如果总角 > maxAngle,缩放到 maxAngle,轴不变。
// 比 swing-twist 分解简单可靠 — 牺牲一点精度(偶尔压制住自旋),
// 但永远不会破坏姿态。
function clampSwing(values: Float32Array, offset: number, maxAngle: number) {
  const x = values[offset], y = values[offset + 1], z = values[offset + 2], w = values[offset + 3];
  if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(w)) return;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) return;
  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
  if (angle <= maxAngle) return;
  // 缩放到 maxAngle,保留旋转轴
  const half = maxAngle / 2;
  const s = Math.sin(half);
  const ax = x / len, ay = y / len, az = z / len;
  values[offset]     = ax * s;
  values[offset + 1] = ay * s;
  values[offset + 2] = az * s;
  values[offset + 3] = Math.cos(half);
}

// ponytail: 从 track 名字 (如 "J_Bip_L_UpperArm.quaternion") 提取 VRM humanoid 骨骼名。
// 库生成的 track 名字后缀用的是 VRM 实际节点名("J_Bip_L_Shoulder"),
// 跟我们 ANTI_CLIP_BONES 的 humanoid 规范名("leftShoulder")对不上。
// 用 vrm.humanoid 反向查:遍历 humanoid 找到 name 匹配的节点,返回规范名。
function buildNodeToHumanoidMap(vrm: VRM): Map<string, string> {
  const map = new Map<string, string>();
  const names = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
  for (const hname of names) {
    const node = vrm.humanoid.getNormalizedBoneNode(hname as any);
    if (node) map.set(node.name, hname);
  }
  return map;
}

// ponytail: 主入口 —— 直接改 THREE.AnimationClip 的 tracks,不碰 GLB。
export function retargetClip(clip: THREE.AnimationClip, vrm: VRM): THREE.AnimationClip {
  // ponytail: 库生成的 track 名字用 VRM 实际节点名(例 "J_Bip_L_Shoulder"),
  // 我们 ANTI_CLIP_BONES 用 humanoid 规范名("leftShoulder"),需要个映射表。
  const nodeToHname = buildNodeToHumanoidMap(vrm);

  // 1) 测 VRM 骨骼长度,算每个骨骼的缩放比 ratio = smplh / vrm
  const vrmLengths = measureVRMBoneLengths(vrm);
  const ratios = new Map<string, number>();
  const legSamples: number[] = [];

  for (const [bone, vrmLen] of vrmLengths) {
    const smplhLen = SMPLH_LENGTHS[bone];
    if (!smplhLen) continue;
    const ratio = smplhLen / vrmLen;
    ratios.set(bone, ratio);
    if (LEG_BONES.has(bone)) legSamples.push(ratio);
  }
  const legRatio = legSamples.length > 0
    ? legSamples.reduce((a, b) => a + b, 0) / legSamples.length
    : 1;

  console.log('[Retarget] ratios (smplh/vrm):');
  for (const [bone, ratio] of ratios) {
    console.log(`  ${bone.padEnd(16)} ${ratio.toFixed(3)}`);
  }
  console.log(`[Retarget] leg avg ratio: ${legRatio.toFixed(3)}`);

  // ponytail: helper — 从 track 名字 ("J_Bip_L_UpperArm.quaternion") 拿到 humanoid 规范名。
  const hnameOf = (trackName: string): string | null => {
    const dot = trackName.lastIndexOf('.');
    if (dot < 0) return null;
    const nodeName = trackName.slice(0, dot);
    return nodeToHname.get(nodeName) ?? null;
  };

  // 2) 旋转角度按比例缩放 ——
  // 暂时禁用:测量到的骨长度不准(SMPL-H 链式定义 ≠ VRM humanoid bone),
  // ratio 离谱会导致角色姿态崩坏。先关掉,等重新校准测量方式再开。
  let rotScaled = 0, posScaled = 0;
  /*
  for (const track of clip.tracks) {
    const hname = hnameOf(track.name);
    if (!hname) continue;
    const ratio = ratios.get(hname);
    if (!ratio || Math.abs(ratio - 1) < 0.01) continue;

    if (track.name.endsWith('.quaternion')) {
      for (let i = 0; i < track.values.length; i += 4) {
        scaleQuaternion(track.values as unknown as Float32Array, i, ratio);
      }
      rotScaled++;
    } else if (track.name.endsWith('.position')) {
      if (hname === 'hips' && Math.abs(legRatio - 1) > 0.01) {
        for (let i = 1; i < track.values.length; i += 3) {
          (track.values as unknown as Float32Array)[i] *= legRatio;
        }
        posScaled++;
      }
    }
  }
  */

  console.log(`[Retarget] ratio-scaling disabled (bad bone measurements); ${rotScaled} rotation track(s), ${posScaled} position track(s)`);

  // 3) 肩膀/锁骨 (Shoulder) 旋转衰减 ——
  // 防止 AI 生成动作导致锁骨剧烈抬升与耸肩内缩 (彻底解决图一耸肩、恢复图二舒展状态)
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const hname = hnameOf(track.name);
    if (hname === 'leftShoulder' || hname === 'rightShoulder') {
      for (let i = 0; i < track.values.length; i += 4) {
        scaleQuaternion(track.values as unknown as Float32Array, i, 0.15);
      }
    }
  }

  // 过滤掉任何试图驱动眼球的动画轨道，确保眼球始终由 VRMLookAt 系统精确注视镜头
  clip.tracks = clip.tracks.filter((track) => {
    const hname = hnameOf(track.name);
    return hname !== 'leftEye' && hname !== 'rightEye' && !track.name.toLowerCase().includes('eye');
  });
  let clamped = 0;
  const clampedBones: string[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const hname = hnameOf(track.name);
    if (!hname) continue;
    const maxSwing = ANTI_CLIP_BONES[hname];
    if (maxSwing === undefined) continue;
    for (let i = 0; i < track.values.length; i += 4) {
      clampSwing(track.values as unknown as Float32Array, i, maxSwing);
    }
    clamped++;
    if (!clampedBones.includes(hname)) clampedBones.push(hname);
  }
  // 5) 轨迹 low-pass 四元数平滑滤波 (消除高频抖动，大幅提升动作丝滑度)
  for (const track of clip.tracks) {
    if (track.name.endsWith('.quaternion')) {
      smoothQuaternionTrack(track.values as unknown as Float32Array);
    }
  }

  console.log(`[Retarget] swing-clamped ${clamped} track(s): ${clampedBones.join(', ')}`);
  return clip;
}

// ponytail: 四元数轨迹低通平滑滤波 (消除 AI 关键帧高频抖动)
function smoothQuaternionTrack(values: Float32Array) {
  const numFrames = values.length / 4;
  if (numFrames < 3) return;

  const qCur = new THREE.Quaternion();
  const qPrev = new THREE.Quaternion();
  const qNext = new THREE.Quaternion();

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < numFrames - 1; i++) {
      const idx = i * 4;
      qCur.set(values[idx], values[idx + 1], values[idx + 2], values[idx + 3]);
      qPrev.set(values[idx - 4], values[idx - 3], values[idx - 2], values[idx - 1]);
      qNext.set(values[idx + 4], values[idx + 5], values[idx + 6], values[idx + 7]);

      qCur.slerp(qPrev, 0.20);
      qCur.slerp(qNext, 0.20);

      values[idx]     = qCur.x;
      values[idx + 1] = qCur.y;
      values[idx + 2] = qCur.z;
      values[idx + 3] = qCur.w;
    }
  }
}

// 循环首尾无缝缝合 (将末尾 25% 帧平滑 Slerp/Lerp 到第 0 帧，确保 Loop 循环 100% 丝滑无跳跃、无瞬移)
export function makeClipSeamless(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    const isQuat = track.name.endsWith('.quaternion');
    const isPos = track.name.endsWith('.position');
    if (!isQuat && !isPos) continue;

    const values = track.values as unknown as Float32Array;
    const stride = isQuat ? 4 : 3;
    const numFrames = values.length / stride;
    if (numFrames < 8) continue;

    const blendCount = Math.max(4, Math.floor(numFrames * 0.25));
    const startFrame = numFrames - blendCount;

    if (isQuat) {
      const q0 = new THREE.Quaternion(values[0], values[1], values[2], values[3]);
      const qCur = new THREE.Quaternion();

      for (let i = startFrame; i < numFrames; i++) {
        const idx = i * 4;
        qCur.set(values[idx], values[idx + 1], values[idx + 2], values[idx + 3]);
        // 当 i = numFrames - 1 时，alpha 正好为 1.0，确保首尾完全重合
        const alpha = (i - startFrame + 1) / blendCount;
        const clampedAlpha = Math.min(1.0, Math.max(0.0, alpha));
        const easedAlpha = clampedAlpha * clampedAlpha * (3 - 2 * clampedAlpha); // Smoothstep S 曲线
        qCur.slerp(q0, easedAlpha);

        values[idx]     = qCur.x;
        values[idx + 1] = qCur.y;
        values[idx + 2] = qCur.z;
        values[idx + 3] = qCur.w;
      }
    } else if (isPos) {
      const p0 = new THREE.Vector3(values[0], values[1], values[2]);
      const pCur = new THREE.Vector3();

      for (let i = startFrame; i < numFrames; i++) {
        const idx = i * 3;
        pCur.set(values[idx], values[idx + 1], values[idx + 2]);
        const alpha = (i - startFrame + 1) / blendCount;
        const clampedAlpha = Math.min(1.0, Math.max(0.0, alpha));
        const easedAlpha = clampedAlpha * clampedAlpha * (3 - 2 * clampedAlpha);
        pCur.lerp(p0, easedAlpha);

        values[idx]     = pCur.x;
        values[idx + 1] = pCur.y;
        values[idx + 2] = pCur.z;
      }
    }
  }
  return clip;
}