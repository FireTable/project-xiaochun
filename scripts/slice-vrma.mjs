import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as THREE from 'three';

/**
 * Quintic Smootherstep 曲线：6t^5 - 15t^4 + 10t^3
 * 保证一阶导数（速度）与二阶导数（加速度）在 t=0 与 t=1 处完美归零连续，杜绝机械顿挫与物理冲量。
 */
function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Slice a .vrma file between startSec and endSec, re-zero timestamps,
 * seamlessly blend loop boundaries with Quintic Smootherstep,
 * stabilize excessive lateral hip sway (filter out violent 26cm swing),
 * preserve natural mocap hips/foot ground clearance, and ensure relaxed thumb channels.
 */
export function sliceVrma(
  inputPath,
  outputPath,
  startSec = 6.6,
  endSec = 12.4,
  hipsYOffset = 0.0,
  stabilizeLateral = true,
  seamlessDuration = 0.75
) {
  const buf = readFileSync(inputPath);
  const jsonLen = buf.readUInt32LE(12);
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const binBuf = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  const anim = gltf.animations[0];
  const timeAcc = gltf.accessors[anim.samplers[0].input];
  const timeBv = gltf.bufferViews[timeAcc.bufferView];
  const origTimes = new Float32Array(
    binBuf.buffer,
    binBuf.byteOffset + (timeBv.byteOffset || 0) + (timeAcc.byteOffset || 0),
    timeAcc.count
  );

  let startFrame = -1;
  let endFrame = -1;
  for (let i = 0; i < origTimes.length; i++) {
    if (origTimes[i] >= startSec && startFrame === -1) startFrame = i;
    if (origTimes[i] <= endSec) endFrame = i;
  }
  if (startFrame === -1) startFrame = 0;
  if (endFrame === -1 || endFrame <= startFrame) endFrame = origTimes.length - 1;

  const count = endFrame - startFrame + 1;
  const t0 = origTimes[startFrame];
  const newTimes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    newTimes[i] = origTimes[startFrame + i] - t0;
  }

  const newBuffers = [];
  let currentOffset = 0;
  const newGltf = JSON.parse(JSON.stringify(gltf));

  // 1. Time accessor
  const timeBytes = new Uint8Array(newTimes.buffer, newTimes.byteOffset, newTimes.byteLength);
  newBuffers.push(timeBytes);
  newGltf.bufferViews[timeAcc.bufferView] = {
    buffer: 0,
    byteOffset: currentOffset,
    byteLength: timeBytes.byteLength,
  };
  newGltf.accessors[anim.samplers[0].input] = {
    ...timeAcc,
    count: count,
    min: [newTimes[0]],
    max: [newTimes[count - 1]],
  };
  currentOffset += timeBytes.byteLength;
  while (currentOffset % 4 !== 0) {
    newBuffers.push(new Uint8Array([0]));
    currentOffset++;
  }

  // 2. Existing Sampler outputs (with lateral stabilization & Quintic loop blend)
  const fps = count / (newTimes[count - 1] - newTimes[0]);
  const blendFrames = Math.max(4, Math.min(Math.round(seamlessDuration * fps), Math.floor(count * 0.35)));
  const blendStart = count - blendFrames;

  for (let sIdx = 0; sIdx < anim.samplers.length; sIdx++) {
    const s = anim.samplers[sIdx];
    const outAcc = gltf.accessors[s.output];
    const outBv = gltf.bufferViews[outAcc.bufferView];
    const stride = outAcc.type === 'VEC4' ? 4 : (outAcc.type === 'VEC3' ? 3 : 1);

    const origVals = new Float32Array(
      binBuf.buffer,
      binBuf.byteOffset + (outBv.byteOffset || 0) + (outAcc.byteOffset || 0),
      outAcc.count * stride
    );
    const newVals = new Float32Array(count * stride);

    const isRootTranslation = anim.channels.some(
      (c) => c.sampler === sIdx && c.target.path === 'translation' && gltf.nodes[c.target.node]?.name === 'Root_M'
    );

    // Copy sliced frame range
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < stride; j++) {
        let val = origVals[(startFrame + i) * stride + j];
        if (isRootTranslation && j === 1 && hipsYOffset) {
          val += hipsYOffset;
        }
        newVals[i * stride + j] = val;
      }
    }

    // 过滤动捕原始数据中骨盆横摆近 30cm 的异常物理位移
    // 消除大腿骨骼横切导致的下摆/裙摆被大腿碰撞体剧烈推挤外翻（狂甩）的根本原因
    if (isRootTranslation && stabilizeLateral) {
      let sumX = 0, sumZ = 0;
      for (let i = 0; i < count; i++) {
        sumX += newVals[i * 3];
        sumZ += newVals[i * 3 + 2];
      }
      const meanX = sumX / count;
      const meanZ = sumZ / count;

      for (let i = 0; i < count; i++) {
        // X 轴：保留约 12% 自然生理有机微摆（约 ±1.5cm 细微重心起伏，杜绝 26cm 巨大平移滑步）
        const xOffset = newVals[i * 3] - meanX;
        newVals[i * 3] = meanX * 0.2 + xOffset * 0.12;
        // Y 轴：保持动捕原生高度，绝不下压骨盆砸向大腿碰撞体
        // Z 轴：居中微量呼吸进深
        const zOffset = newVals[i * 3 + 2] - meanZ;
        newVals[i * 3 + 2] = meanZ + zOffset * 0.3;
      }
    }

    // 五次平滑循环缝合（Quintic Seamless Loop Blend）：末尾 blendFrames 帧平滑重定向回 frame 0
    if (stride === 4) {
      const q0 = [newVals[0], newVals[1], newVals[2], newVals[3]];
      const qCur = [0, 0, 0, 0];
      const qOut = [0, 0, 0, 0];
      for (let k = 0; k < blendFrames; k++) {
        const frameIdx = blendStart + k;
        const alpha = (k + 1) / blendFrames;
        const w = quintic(alpha);
        qCur[0] = newVals[frameIdx * 4];
        qCur[1] = newVals[frameIdx * 4 + 1];
        qCur[2] = newVals[frameIdx * 4 + 2];
        qCur[3] = newVals[frameIdx * 4 + 3];
        THREE.Quaternion.slerpFlat(qOut, 0, qCur, 0, q0, 0, w);
        newVals[frameIdx * 4] = qOut[0];
        newVals[frameIdx * 4 + 1] = qOut[1];
        newVals[frameIdx * 4 + 2] = qOut[2];
        newVals[frameIdx * 4 + 3] = qOut[3];
      }
    } else if (stride === 3) {
      const p0 = [newVals[0], newVals[1], newVals[2]];
      for (let k = 0; k < blendFrames; k++) {
        const frameIdx = blendStart + k;
        const alpha = (k + 1) / blendFrames;
        const w = quintic(alpha);
        for (let j = 0; j < 3; j++) {
          newVals[frameIdx * 3 + j] = newVals[frameIdx * 3 + j] * (1 - w) + p0[j] * w;
        }
      }
    }

    const min = new Array(stride).fill(Infinity);
    const max = new Array(stride).fill(-Infinity);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < stride; j++) {
        const v = newVals[i * stride + j];
        if (v < min[j]) min[j] = v;
        if (v > max[j]) max[j] = v;
      }
    }

    const valBytes = new Uint8Array(newVals.buffer, newVals.byteOffset, newVals.byteLength);
    newBuffers.push(valBytes);

    newGltf.bufferViews[outAcc.bufferView] = {
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: valBytes.byteLength,
    };
    newGltf.accessors[s.output] = {
      ...outAcc,
      count: count,
      min,
      max,
    };
    currentOffset += valBytes.byteLength;
    while (currentOffset % 4 !== 0) {
      newBuffers.push(new Uint8Array([0]));
      currentOffset++;
    }
  }

  // 3. Add explicit thumb tracks if missing so thumbs don't stay curled from idle
  const thumbNodes = [28, 29, 30, 54, 55, 56]; // ThumbFinger1/2/3_R and ThumbFinger1/2/3_L
  const targetTimeInput = anim.samplers[0].input;

  for (const nodeIdx of thumbNodes) {
    const hasChannel = anim.channels.some((c) => c.target.node === nodeIdx && c.target.path === 'rotation');
    if (hasChannel) continue;

    const node = gltf.nodes[nodeIdx];
    if (!node) continue;
    const restRot = node.rotation || [0, 0, 0, 1];

    const thumbVals = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      thumbVals[i * 4] = restRot[0];
      thumbVals[i * 4 + 1] = restRot[1];
      thumbVals[i * 4 + 2] = restRot[2];
      thumbVals[i * 4 + 3] = restRot[3];
    }

    const valBytes = new Uint8Array(thumbVals.buffer, thumbVals.byteOffset, thumbVals.byteLength);
    newBuffers.push(valBytes);

    const bvIdx = newGltf.bufferViews.length;
    newGltf.bufferViews.push({
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: valBytes.byteLength,
    });

    const accIdx = newGltf.accessors.length;
    newGltf.accessors.push({
      bufferView: bvIdx,
      byteOffset: 0,
      componentType: 5126,
      count: count,
      type: 'VEC4',
      min: [...restRot],
      max: [...restRot],
    });

    const samplerIdx = newGltf.animations[0].samplers.length;
    newGltf.animations[0].samplers.push({
      input: targetTimeInput,
      output: accIdx,
      interpolation: 'LINEAR',
    });

    newGltf.animations[0].channels.push({
      sampler: samplerIdx,
      target: {
        node: nodeIdx,
        path: 'rotation',
      },
    });

    currentOffset += valBytes.byteLength;
    while (currentOffset % 4 !== 0) {
      newBuffers.push(new Uint8Array([0]));
      currentOffset++;
    }
  }

  newGltf.buffers[0].byteLength = currentOffset;

  let newJsonStr = JSON.stringify(newGltf);
  while (Buffer.byteLength(newJsonStr) % 4 !== 0) {
    newJsonStr += ' ';
  }
  const newJsonBytes = Buffer.from(newJsonStr, 'utf8');
  const totalBin = Buffer.concat(newBuffers);

  const glbLen = 12 + 8 + newJsonBytes.length + 8 + totalBin.length;
  const glb = Buffer.alloc(glbLen);

  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glbLen, 8);

  glb.writeUInt32LE(newJsonBytes.length, 12);
  glb.write('JSON', 16);
  newJsonBytes.copy(glb, 20);

  const binStart = 20 + newJsonBytes.length;
  glb.writeUInt32LE(totalBin.length, binStart);
  glb.write('BIN\0', binStart + 4);
  totalBin.copy(glb, binStart + 8);

  writeFileSync(outputPath, glb);
  console.log(
    `[sliceVrma] Sliced ${inputPath} [${startSec}s~${endSec}s] → ${outputPath} (${(glb.length / 1024).toFixed(1)}KB, duration: ${newTimes[count - 1].toFixed(2)}s, blendFrames: ${blendFrames}, stabilizeLateral: ${stabilizeLateral})`
  );
}

// CLI usage
if (process.argv[1] && process.argv[1].endsWith('slice-vrma.mjs')) {
  // 智能寻找干净未切片的原始动捕文件作为源（避免在已切片的文件上反复二次切割）
  let defaultInPath = 'public/vrm/motion/raw/listening.vrma';
  if (!existsSync(defaultInPath)) {
    const clawatarPath = '/Users/FireTable/OpenClaw/Code/Clawatar/public/animations/dm_124.vrma';
    if (existsSync(clawatarPath)) defaultInPath = clawatarPath;
    else defaultInPath = 'public/vrm/motion/listening.vrma';
  }

  const inPath = process.argv[2] || defaultInPath;
  const outPath = process.argv[3] || 'public/vrm/motion/listening.vrma';
  const start = parseFloat(process.argv[4] || '6.6');
  const end = parseFloat(process.argv[5] || '12.4');
  const hipsYOffset = process.argv[6] !== undefined ? parseFloat(process.argv[6]) : 0.0;
  const stabilizeLateral = process.argv[7] !== undefined ? process.argv[7] !== 'false' : true;

  sliceVrma(inPath, outPath, start, end, hipsYOffset, stabilizeLateral);
}
