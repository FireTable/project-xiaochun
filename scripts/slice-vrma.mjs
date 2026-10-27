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
 * 通用 VRMA 动捕动作切片与时间区间剥离工具 (Universal VRMA Motion Slicer)
 * 
 * 核心设计原则：
 * 1. 纯粹按时间区间 [startSec, endSec] 剥离头尾废帧/标定帧，重新归零时间戳；
 * 2. 100% 保留动捕原生骨盆（Root/Hips）位移与物理姿态，绝对不人为干预或压缩骨盆平移，杜绝滑步！
 * 3. 循环动作用 Quintic Smootherstep 对末尾平滑融合回起始帧，消除循环接缝跳变；
 * 4. 通用适配任意 .vrma 文件输入输出。
 * 
 * @param {string} inputPath 原始 .vrma 文件路径
 * @param {string} outputPath 切片输出 .vrma 文件路径
 * @param {number} startSec 起始有效时间（秒）
 * @param {number} endSec 结束有效时间（秒）
 * @param {object} options 配置选项
 * @param {boolean} options.seamless 是否执行末尾首帧五次平滑缝合（适合循环待机/站姿）
 * @param {number} options.seamlessDuration 缝合过渡时长（秒，默认 0.65s）
 */
export function sliceVrma(
  inputPath,
  outputPath,
  startSec = 0.0,
  endSec = Infinity,
  options = {}
) {
  const {
    seamless = false,
    seamlessDuration = 0.65,
    zeroZ = false,
  } = options;

  if (!existsSync(inputPath)) {
    throw new Error(`[sliceVrma] 输入文件不存在: ${inputPath}`);
  }

  const buf = readFileSync(inputPath);
  const jsonLen = buf.readUInt32LE(12);
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const binBuf = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  if (!gltf.animations || gltf.animations.length === 0) {
    throw new Error(`[sliceVrma] 文件中未找到有效的 glTF animation: ${inputPath}`);
  }

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

  // 1. Time accessor (时间轴重映射与归零)
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

  // 2. 动画采样轨道纯净切片（100% 保留动捕原生骨盆与关节数据）
  const duration = newTimes[count - 1] - newTimes[0];
  const fps = count / Math.max(0.001, duration);
  const blendFrames = seamless
    ? Math.max(4, Math.min(Math.round(seamlessDuration * fps), Math.floor(count * 0.35)))
    : 0;
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

    const isTranslation = anim.channels.some(
      (c) => c.sampler === sIdx && c.target.path === 'translation'
    );

    // 复制指定帧区间（若开启 zeroZ 则将位移的 Z 轴彻底置零）
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < stride; j++) {
        let val = origVals[(startFrame + i) * stride + j];
        if (isTranslation && stride === 3 && j === 2 && zeroZ) {
          val = 0.0;
        }
        newVals[i * stride + j] = val;
      }
    }

    // 仅在显式声明 seamless 时对末尾进行平滑闭环融合（平滑连接首帧）
    if (blendFrames > 0) {
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

  // 3. 补齐拇指等缺失信道，防止特定软件从待机切入后拇指内扣
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

  // 4. 打包并装配标准二进制 GLB
  const totalBinLen = newBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const totalBin = Buffer.alloc(totalBinLen);
  let writeOffset = 0;
  for (const b of newBuffers) {
    Buffer.from(b.buffer, b.byteOffset, b.byteLength).copy(totalBin, writeOffset);
    writeOffset += b.byteLength;
  }

  newGltf.buffers[0] = { byteLength: totalBinLen };
  let jsonString = JSON.stringify(newGltf);
  while (Buffer.byteLength(jsonString, 'utf8') % 4 !== 0) {
    jsonString += ' ';
  }
  const newJsonBytes = Buffer.from(jsonString, 'utf8');

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
    `[sliceVrma] ✅ 成功切片: ${inputPath} [${startSec}s ~ ${endSec === Infinity ? 'end' : endSec + 's'}] → ${outputPath} (${(glb.length / 1024).toFixed(1)}KB, 时长: ${newTimes[count - 1].toFixed(2)}s, 无缝闭环帧数: ${blendFrames})`
  );
}

// ── 通用 CLI 命令行执行入口 ──
if (process.argv[1] && process.argv[1].endsWith('slice-vrma.mjs')) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log(`
使用方式:
  node scripts/slice-vrma.mjs <输入文件> <输出文件> [开始秒数] [结束秒数] [--seamless]

示例:
  # 1. 通用动捕动作去废帧 (从 3.3s 截取到 12.0s):
  node scripts/slice-vrma.mjs public/vrm/motion/attentive-lean.vrma public/vrm/motion/listening.vrma 3.3 12.0

  # 2. 循环待机动作 (带尾首平滑循环闭环):
  node scripts/slice-vrma.mjs public/vrm/motion/attentive-lean.vrma public/vrm/motion/listening.vrma 3.3 12.0 --seamless

  # 3. 剔除 Z 轴纵深位移 (Z 轴强制归零):
  node scripts/slice-vrma.mjs public/vrm/motion/attentive-lean.vrma public/vrm/motion/listening2.vrma 6.0 12.0 --seamless --zero-z
`);
    process.exit(1);
  }

  const inPath = args[0];
  const outPath = args[1];
  const start = args[2] ? parseFloat(args[2]) : 0.0;
  const end = args[3] && !args[3].startsWith('--') ? parseFloat(args[3]) : Infinity;
  const isSeamless = args.includes('--seamless');
  const isZeroZ = args.includes('--zero-z');

  sliceVrma(inPath, outPath, start, end, { seamless: isSeamless, zeroZ: isZeroZ });
}
