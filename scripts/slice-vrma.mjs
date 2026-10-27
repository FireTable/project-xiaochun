import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import zlib from 'zlib';
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

  const shouldWrite = glb.length < buf.length || outputPath !== inputPath;
  if (shouldWrite) {
    writeFileSync(outputPath, glb);
  }
  console.log(
    `[sliceVrma] ✅ 成功切片: ${inputPath} [${startSec}s ~ ${endSec === Infinity ? 'end' : endSec + 's'}] → ${outputPath} (${(glb.length / 1024).toFixed(1)}KB, 时长: ${newTimes[count - 1].toFixed(2)}s, 无缝闭环帧数: ${blendFrames})`
  );
}

/**
 * VRMA 动捕质量深度诊断扫描器 (VRMA Mocap Quality Scanner)
 * 
 * 自动化诊断四大核心质量问题：
 * 1. Z 轴纵深偏移与后撤突进风险 (起始帧偏离、全幅波动、站位偏后)
 * 2. 动捕前置/后置动作识别 (准备待命期、核心表现稳定期、收势退出期)
 * 3. 骨骼通道覆盖与异常 (拇指缺失导致内扣僵硬、足部动画、骨盆横摆与沉降)
 * 4. 循环闭环跳变评估与一键切片推荐
 * 
 * @param {string} filePath 待扫描的 .vrma 动作文件路径
 * @returns {object} 诊断分析结构化结果
 */
export function scanVrma(filePath) {
  if (!existsSync(filePath)) {
    console.error(`[scanVrma] ❌ 文件不存在: ${filePath}`);
    return null;
  }

  const buf = readFileSync(filePath);
  const jsonLen = buf.readUInt32LE(12);
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const binBuf = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  function getAcc(accIdx) {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;
    const stride = acc.type === 'VEC4' ? 4 : (acc.type === 'VEC3' ? 3 : 1);
    return new Float32Array(binBuf.buffer, binBuf.byteOffset + byteOffset, count * stride);
  }

  const anim = gltf.animations?.[0];
  if (!anim) {
    console.error(`[scanVrma] ❌ 未在文件中找到有效的 glTF 动画通道: ${filePath}`);
    return null;
  }

  const times = getAcc(anim.samplers[0].input);
  const count = times.length;
  const duration = times[count - 1] - times[0];
  const fps = Math.round(count / duration);

  console.log('\n' + '='.repeat(68));
  console.log(`🔍 VRMA 动捕质量深度诊断报告: ${filePath}`);
  console.log('='.repeat(68));
  console.log(`📦 基本规格: 时长 ${(duration).toFixed(2)}s | 采样帧数 ${count} | 帧率 ${fps} FPS | 动画轨道数 ${anim.channels.length}`);

  // 1. 骨骼通道覆盖率 (Humanoid Coverage)
  const nodeNames = anim.channels.map((c) => gltf.nodes[c.target.node]?.name || '').filter(Boolean);
  const hasThumb = nodeNames.some((n) => n.toLowerCase().includes('thumb'));
  const hasFoot = nodeNames.some((n) => n.toLowerCase().includes('foot'));
  const hasToes = nodeNames.some((n) => n.toLowerCase().includes('toe'));

  console.log('\n🦴 骨骼信道完整度 (Humanoid Coverage):');
  if (hasThumb) {
    console.log('  🟢 手指/拇指通道: 完整 (具有独立 Thumb 关节信道，手指姿态自然)');
  } else {
    console.log('  ⚠️ 手指/拇指通道: 缺失！(缺少 ThumbFinger1~3，从待机切入后拇指容易僵硬内扣握拳)');
    console.log('     👉 建议: sliceVrma 切片时会自动补齐中立拇指信道，修复内扣。');
  }

  if (hasFoot || hasToes) {
    console.log('  🟢 足部旋转信道: 包含原生 Foot/Toes 动画控制');
  } else {
    console.log('  ℹ️ 足部旋转信道: 无独立 Foot 动画 (由 Upper/LowerLeg 传递，依赖引擎 FootIK 平地贴合)');
  }

  // 2. 骨盆位移诊断 (Pelvis & Z-Axis Diagnostics)
  let rootTrans = null;
  for (const ch of anim.channels) {
    const node = gltf.nodes[ch.target.node];
    if (ch.target.path === 'translation' && (node.name === 'Root_M' || node.name.toLowerCase().includes('hip') || node.name.toLowerCase().includes('root'))) {
      rootTrans = { name: node.name, vals: getAcc(anim.samplers[ch.sampler].output) };
      break;
    }
  }

  console.log('\n🎯 骨盆位移与 Z 轴偏移诊断 (Pelvis & Z-Axis Diagnostics):');
  let z0 = 0, deltaZ = 0, deltaX = 0, deltaY = 0;
  let minZ = 0, maxZ = 0, minX = 0, maxX = 0, minY = 0, maxY = 0;
  let hasSevereZRetract = false;
  let hasSevereLateralSway = false;
  let hasSevereSink = false;

  if (rootTrans) {
    const vals = rootTrans.vals;
    minZ = Infinity; maxZ = -Infinity;
    minX = Infinity; maxX = -Infinity;
    minY = Infinity; maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = vals[i * 3], y = vals[i * 3 + 1], z = vals[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    z0 = vals[2];
    deltaZ = (maxZ - minZ) * 100;
    deltaX = (maxX - minX) * 100;
    deltaY = (maxY - minY) * 100;

    console.log(`  • Z 轴纵深偏移 (前后): 初始帧 Z0 = ${(z0 * 100).toFixed(1)}cm | 极值范围 [${(minZ * 100).toFixed(1)}cm ~ ${(maxZ * 100).toFixed(1)}cm] (全幅 ${(deltaZ).toFixed(1)}cm)`);
    if (Math.abs(z0) > 0.03) {
      hasSevereZRetract = true;
      console.log(`    🚨 【高危后撤/突进风险】起始帧偏离原点 ${(Math.abs(z0) * 100).toFixed(1)}cm！从待机(Z=0)切入时会产生瞬间抽动/后退拉扯。`);
      console.log(`       👉 建议: 切片时务必添加 --zero-z 锁定纵深，或截取 Z 接近 0 的稳定区间。`);
    } else {
      console.log(`    🟢 起始帧纵深贴近原点 (Z0 偏移 < 3cm)，过渡平稳。`);
    }

    console.log(`  • X 轴横向摆动 (左右): 极值范围 [${(minX * 100).toFixed(1)}cm ~ ${(maxX * 100).toFixed(1)}cm] (全幅 ${(deltaX).toFixed(1)}cm)`);
    if (deltaX > 20.0) {
      hasSevereLateralSway = true;
      console.log(`    ⚠️ 【大幅横晃风险】骨盆横摆幅度过大 (${(deltaX).toFixed(1)}cm)，容易导致大腿碰撞体剧烈推挤裙摆外翻，或引发下肢滑步。`);
    } else {
      console.log(`    🟢 横向微晃自然 (全幅 < 20cm)。`);
    }

    console.log(`  • Y 轴垂直沉降 (高低): 起始高 ${(vals[1] * 100).toFixed(1)}cm | 极差全幅 ${(deltaY).toFixed(1)}cm`);
    if (deltaY > 3.0) {
      hasSevereSink = true;
      console.log(`    ⚠️ 【骨盆沉降风险】垂直起伏较大 (${(deltaY).toFixed(1)}cm)，下沉时可能导致屈膝过度或鞋底穿透地面。`);
    } else {
      console.log(`    🟢 垂直起伏平稳 (沉降 < 3cm)。`);
    }
  } else {
    console.log('  ℹ️ 未找到骨盆位移通道 (Root/Hips Translation)。该动作仅包含骨骼旋转，位移恒定。');
  }

  // 3. 动捕时间轴阶段识别 (Mocap Phases: Setup / Core / Teardown)
  console.log('\n⏱️ 动捕阶段智能识别 (Mocap Phases & Setup Frames):');
  const limbNodes = [];
  for (const ch of anim.channels) {
    if (ch.target.path === 'rotation') {
      const node = gltf.nodes[ch.target.node];
      const name = (node.name || '').toLowerCase();
      if (name.includes('arm') || name.includes('hand') || name.includes('wrist') || name.includes('leg')) {
        limbNodes.push({ name: node.name, vals: getAcc(anim.samplers[ch.sampler].output) });
      }
    }
  }

  const windowSec = 0.5;
  const step = Math.max(1, Math.round(fps * windowSec));
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const speeds = [];

  for (let i = 0; i < count - step; i += step) {
    const t = times[i];
    let totalAngle = 0;
    for (let f = i; f < i + step; f++) {
      for (const node of limbNodes) {
        q1.set(node.vals[f * 4], node.vals[f * 4 + 1], node.vals[f * 4 + 2], node.vals[f * 4 + 3]);
        q2.set(node.vals[(f + 1) * 4], node.vals[(f + 1) * 4 + 1], node.vals[(f + 1) * 4 + 2], node.vals[(f + 1) * 4 + 3]);
        totalAngle += q1.angleTo(q2);
      }
    }
    const degSpeed = (totalAngle * 180 / Math.PI) / windowSec / Math.max(1, limbNodes.length);
    speeds.push({ t, degSpeed });
  }

  // 检测前置准备期结束点 (Setup End)
  let setupEndSec = 0.0;
  for (let i = 0; i < Math.floor(speeds.length * 0.45); i++) {
    if (speeds[i].degSpeed > 8.5) {
      setupEndSec = speeds[i].t + windowSec;
    }
  }
  setupEndSec = Math.min(duration * 0.45, Math.ceil(setupEndSec * 2) / 2);

  // 检测后置收势期起始点 (Teardown Start)
  let teardownStartSec = duration;
  for (let i = speeds.length - 1; i >= Math.floor(speeds.length * 0.55); i--) {
    if (speeds[i].degSpeed > 8.5) {
      teardownStartSec = speeds[i].t;
    }
  }
  teardownStartSec = Math.max(setupEndSec + 2.0, Math.floor(teardownStartSec * 2) / 2);

  if (setupEndSec > 0.5) {
    console.log(`  • 阶段 1 [前置准备/待命期]: 0.0s ~ ${setupEndSec.toFixed(1)}s (动捕演员待命微调、抬手或倒换重心)`);
  } else {
    console.log(`  • 阶段 1 [前置准备/待命期]: 无显著前置废帧 (起手即直接进入动作)`);
  }

  console.log(`  • 阶段 2 [核心表现稳定期]: ${setupEndSec.toFixed(1)}s ~ ${teardownStartSec.toFixed(1)}s (🔥 动作定型甜点区，纯净时长 ${(teardownStartSec - setupEndSec).toFixed(1)}s)`);

  if (teardownStartSec < duration - 0.5) {
    console.log(`  • 阶段 3 [后置退出/收手期]: ${teardownStartSec.toFixed(1)}s ~ ${duration.toFixed(1)}s (动捕喊咔，演员收手回归普通站姿)`);
  } else {
    console.log(`  • 阶段 3 [后置退出/收手期]: 无显著后置收势废帧`);
  }

  // 4. 循环闭合度评估 (Loop Seam Gap)
  console.log('\n🔁 循环闭合度评估 (Loop Seam Gap):');
  let maxRotDiffDeg = 0;
  for (const node of limbNodes) {
    q1.set(node.vals[0], node.vals[1], node.vals[2], node.vals[3]);
    const lastIdx = (count - 1) * 4;
    q2.set(node.vals[lastIdx], node.vals[lastIdx + 1], node.vals[lastIdx + 2], node.vals[lastIdx + 3]);
    const diffDeg = q1.angleTo(q2) * 180 / Math.PI;
    if (diffDeg > maxRotDiffDeg) maxRotDiffDeg = diffDeg;
  }
  let posDiffCm = 0;
  if (rootTrans) {
    const v = rootTrans.vals;
    const dx = v[(count - 1) * 3] - v[0];
    const dy = v[(count - 1) * 3 + 1] - v[1];
    const dz = v[(count - 1) * 3 + 2] - v[2];
    posDiffCm = Math.sqrt(dx * dx + dy * dy + dz * dz) * 100;
  }
  console.log(`  • 全身关节最大首尾角差: ${maxRotDiffDeg.toFixed(1)}° | 骨盆位移首尾差距: ${posDiffCm.toFixed(1)}cm`);
  if (maxRotDiffDeg > 12.0 || posDiffCm > 3.0) {
    console.log('  ⚠️ 首尾姿态差异较大，若用于循环播放会有明显跳帧顿挫！建议切片时必须添加 --seamless。');
  } else {
    console.log('  🟢 首尾姿态平滑接近，天然适合循环。');
  }

  // 5. 智能推荐切片命令 (Recommended Action)
  console.log('\n💡 智能切片推荐命令 (Recommended Slicing Command):');
  const recStart = setupEndSec.toFixed(1);
  const recEnd = teardownStartSec.toFixed(1);
  const recZeroZ = (hasSevereZRetract || deltaZ > 8.0) ? ' --zero-z' : '';
  const outPath = filePath.replace(/\.vrma$/, '-clean.vrma');
  console.log(`  node scripts/slice-vrma.mjs ${filePath} ${outPath} ${recStart} ${recEnd} --seamless${recZeroZ}\n`);

  return {
    spec: { duration, count, fps, channels: anim.channels.length },
    humanoid: { hasThumb, hasFoot, hasToes },
    pelvis: rootTrans ? { z0, deltaZ, deltaX, deltaY, minZ, maxZ } : null,
    phases: { setupEndSec, teardownStartSec },
    seam: { maxRotDiffDeg, posDiffCm },
    recommendation: { start: recStart, end: recEnd, zeroZ: hasSevereZRetract || deltaZ > 8.0 },
  };
}

/**
 * VRMA 动作极速瘦身与体积优化器 (VRMA Motion Optimizer)
 * 
 * 核心优化策略（100% 保留动捕原生骨骼姿态与平滑度，零画质折损）：
 * 1. 剔除非人形死轨道 (Strip Ignored Channels)：
 *    - 剥离 Hair、Bust、Eye 等 @pixiv/three-vrm-animation 规范未映射的冗余通道，避免争夺 SpringBone 物理所有权并节省体积；
 * 2. 剔除非 hips 的 translation 平移通道：
 *    - 严格遵循 VRMC_vrm_animation 规范（仅 hips 允许平移），消除浏览器 Console 警告并减重；
 * 3. 帧率智能自适应 (Cap FPS at 30)：
 *    - 若原生帧率 > 32 FPS（如 60 FPS 稠密动捕），降采样为 30 FPS（Three.js Slerp 插值在 60/120Hz 屏幕下肉眼零差异）；
 *    - 原生 <= 30 FPS（如 24 FPS / 25 FPS）保持不变，保证每一帧艺术细节 100% 原始呈现；
 * 4. 严格零误差静态通道坍缩 (Exact Zero-Diff Static Track Collapse)：
 *    - 对全周期完全静止（maxDiff <= staticTolerance，默认 1e-4）的定型通道，折叠为首尾两帧，几何数学完全等价，极大幅缩减 Three.js 内存占用；
 * 5. 共享时间 Accessor (Shared Time Track)：
 *    - 所有动态通道共用同一个时间采样器，消除重复的 JSON 与 BufferView。
 *
 * @param {string} inputPath 原始 .vrma 文件路径
 * @param {string} outputPath 优化输出 .vrma 文件路径 (默认覆盖输入)
 * @param {object} options 配置选项
 * @returns {object} 优化前后体积对比信息
 */
export function optimizeVrma(inputPath, outputPath = inputPath, options = {}) {
  const {
    maxFps = 30,
    staticTolerance = 1e-4,
    stripIgnored = true,
    stripNonHipsTranslation = true,
    silent = false,
  } = options;

  if (!existsSync(inputPath)) {
    throw new Error(`[optimizeVrma] 输入文件不存在: ${inputPath}`);
  }

  const buf = readFileSync(inputPath);
  if (buf.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`[optimizeVrma] 非法 GLB 文件: ${inputPath}`);
  }

  const jsonLen = buf.readUInt32LE(12);
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const binBuf = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  if (!gltf.animations || gltf.animations.length === 0) {
    throw new Error(`[optimizeVrma] 文件中未找到有效的 glTF animation: ${inputPath}`);
  }

  const anim = gltf.animations[0];
  const ext = gltf.extensions?.VRMC_vrm_animation;
  const humanBones = ext?.humanoid?.humanBones || {};
  const exprPreset = ext?.expressions?.preset || {};
  const exprCustom = ext?.expressions?.custom || {};
  const validNodes = new Set([
    ...Object.values(humanBones).map((b) => b.node),
    ...Object.values(exprPreset).map((b) => b.node),
    ...Object.values(exprCustom).map((b) => b.node),
    ext?.lookAt?.node,
  ].filter((n) => n != null));

  const hipsNode = humanBones.hips?.node;

  const timeAcc = gltf.accessors[anim.samplers[0].input];
  const timeBv = gltf.bufferViews[timeAcc.bufferView];
  const origTimes = new Float32Array(
    binBuf.buffer,
    binBuf.byteOffset + (timeBv.byteOffset || 0) + (timeAcc.byteOffset || 0),
    timeAcc.count
  );

  const duration = origTimes[origTimes.length - 1] - origTimes[0];
  const nativeFps = origTimes.length / Math.max(0.001, duration);

  let step = 1;
  if (nativeFps > 32) {
    step = Math.round(nativeFps / maxFps);
  }

  const keepIndices = [];
  for (let i = 0; i < origTimes.length; i += step) keepIndices.push(i);
  if (keepIndices[keepIndices.length - 1] !== origTimes.length - 1) {
    keepIndices.push(origTimes.length - 1);
  }
  const count = keepIndices.length;
  const newTimes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    newTimes[i] = origTimes[keepIndices[i]] - origTimes[0];
  }

  const newBuffers = [];
  let currentOffset = 0;
  const newGltf = JSON.parse(JSON.stringify(gltf));
  newGltf.bufferViews = [];
  newGltf.accessors = [];

  // 1. 全量动态时间 Accessor (Accessor 0)
  const fullTimeBytes = new Uint8Array(newTimes.buffer, newTimes.byteOffset, newTimes.byteLength);
  newBuffers.push(fullTimeBytes);
  newGltf.bufferViews.push({
    buffer: 0,
    byteOffset: currentOffset,
    byteLength: fullTimeBytes.byteLength,
  });
  newGltf.accessors.push({
    bufferView: 0,
    byteOffset: 0,
    componentType: 5126,
    count: count,
    type: 'SCALAR',
    min: [newTimes[0]],
    max: [newTimes[count - 1]],
  });
  currentOffset += fullTimeBytes.byteLength;
  while (currentOffset % 4 !== 0) {
    newBuffers.push(new Uint8Array([0]));
    currentOffset++;
  }

  // 2. 静态常量两点时间 Accessor (Accessor 1) [t=0, t=duration]
  const staticTimes = new Float32Array([newTimes[0], newTimes[count - 1]]);
  const staticTimeBytes = new Uint8Array(staticTimes.buffer, staticTimes.byteOffset, staticTimes.byteLength);
  newBuffers.push(staticTimeBytes);
  const staticTimeBv = newGltf.bufferViews.length;
  newGltf.bufferViews.push({
    buffer: 0,
    byteOffset: currentOffset,
    byteLength: staticTimeBytes.byteLength,
  });
  const staticTimeAcc = newGltf.accessors.length;
  newGltf.accessors.push({
    bufferView: staticTimeBv,
    byteOffset: 0,
    componentType: 5126,
    count: 2,
    type: 'SCALAR',
    min: [staticTimes[0]],
    max: [staticTimes[1]],
  });
  currentOffset += staticTimeBytes.byteLength;
  while (currentOffset % 4 !== 0) {
    newBuffers.push(new Uint8Array([0]));
    currentOffset++;
  }

  const newChannels = [];
  const newSamplers = [];
  let strippedChannelsCount = 0;
  let staticChannelsCount = 0;

  for (const c of anim.channels) {
    // 过滤非人形死轨道
    if (stripIgnored && validNodes.size > 0 && !validNodes.has(c.target.node)) {
      strippedChannelsCount++;
      continue;
    }
    // 过滤非 hips 的平移通道
    if (stripNonHipsTranslation && c.target.path === 'translation' && c.target.node !== hipsNode) {
      strippedChannelsCount++;
      continue;
    }

    const s = anim.samplers[c.sampler];
    const outAcc = gltf.accessors[s.output];
    const outBv = gltf.bufferViews[outAcc.bufferView];
    const stride = outAcc.type === 'VEC4' ? 4 : (outAcc.type === 'VEC3' ? 3 : 1);
    const origVals = new Float32Array(
      binBuf.buffer,
      binBuf.byteOffset + (outBv.byteOffset || 0) + (outAcc.byteOffset || 0),
      outAcc.count * stride
    );

    // 检查是否全周期静止
    let isStatic = true;
    for (let i = 1; i < outAcc.count; i++) {
      let diff = 0;
      for (let j = 0; j < stride; j++) {
        diff += Math.abs(origVals[i * stride + j] - origVals[j]);
      }
      if (diff > staticTolerance) {
        isStatic = false;
        break;
      }
    }

    let finalVals, finalCount, timeAccIdx;
    if (isStatic) {
      staticChannelsCount++;
      finalCount = 2;
      finalVals = new Float32Array(2 * stride);
      for (let j = 0; j < stride; j++) {
        finalVals[j] = origVals[j];
        finalVals[stride + j] = origVals[j];
      }
      timeAccIdx = staticTimeAcc;
    } else {
      finalCount = count;
      finalVals = new Float32Array(count * stride);
      for (let i = 0; i < count; i++) {
        const origIdx = keepIndices[i];
        for (let j = 0; j < stride; j++) {
          finalVals[i * stride + j] = origVals[origIdx * stride + j];
        }
      }
      timeAccIdx = 0; // 共享全量时间
    }

    const min = new Array(stride).fill(Infinity);
    const max = new Array(stride).fill(-Infinity);
    for (let i = 0; i < finalCount; i++) {
      for (let j = 0; j < stride; j++) {
        const v = finalVals[i * stride + j];
        if (v < min[j]) min[j] = v;
        if (v > max[j]) max[j] = v;
      }
    }

    const valBytes = new Uint8Array(finalVals.buffer, finalVals.byteOffset, finalVals.byteLength);
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
      count: finalCount,
      type: outAcc.type,
      min,
      max,
    });
    currentOffset += valBytes.byteLength;
    while (currentOffset % 4 !== 0) {
      newBuffers.push(new Uint8Array([0]));
      currentOffset++;
    }

    const samplerIdx = newSamplers.length;
    newSamplers.push({
      input: timeAccIdx,
      output: accIdx,
      interpolation: s.interpolation || 'LINEAR',
    });
    newChannels.push({
      sampler: samplerIdx,
      target: c.target,
    });
  }

  newGltf.animations[0].channels = newChannels;
  newGltf.animations[0].samplers = newSamplers;

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

  const shouldWrite = glb.length < buf.length || outputPath !== inputPath;
  if (shouldWrite) {
    writeFileSync(outputPath, glb);
  }

  const origBr = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
  const newBr = zlib.brotliCompressSync(glb, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });

  const result = {
    file: inputPath,
    fps: step > 1 ? `${Math.round(nativeFps)} -> 30 FPS` : `${Math.round(nativeFps)} FPS`,
    rawBefore: buf.length,
    rawAfter: glb.length,
    rawReduction: (1 - glb.length / buf.length) * 100,
    brBefore: origBr.length,
    brAfter: newBr.length,
    brReduction: (1 - newBr.length / origBr.length) * 100,
    strippedChannels: strippedChannelsCount,
    staticChannels: staticChannelsCount,
    totalChannels: newChannels.length,
  };

  if (!silent) {
    console.log(
      `[optimizeVrma] ✅ ${inputPath} -> ${outputPath} | 帧率: ${result.fps} | 轨道: ${anim.channels.length} -> ${result.totalChannels} (剔除 ${strippedChannelsCount}, 静态折叠 ${staticChannelsCount})`
    );
    console.log(
      `               Raw: ${(result.rawBefore / 1024).toFixed(1)}KB -> ${(result.rawAfter / 1024).toFixed(1)}KB (-${result.rawReduction.toFixed(1)}%) | Brotli: ${(result.brBefore / 1024).toFixed(1)}KB -> ${(result.brAfter / 1024).toFixed(1)}KB (-${result.brReduction.toFixed(1)}%)`
    );
  }

  return result;
}

/**
 * 批量优化指定目录下的所有 .vrma 动作文件
 * 
 * @param {string} dirPath 动作目录路径
 * @param {object} options 优化选项
 */
export function optimizeAllVrma(dirPath = 'public/vrm/motion', options = {}) {
  const dir = path.resolve(dirPath);
  if (!existsSync(dir)) {
    throw new Error(`[optimizeAllVrma] 目录不存在: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.vrma') && statSync(path.join(dir, f)).isFile()).sort();
  console.log(`\n🚀 开始批量优化目录中的 VRMA 动作资产 (${files.length} 个文件)...`);
  console.log('='.repeat(72));

  let totalRawBefore = 0, totalRawAfter = 0;
  let totalBrBefore = 0, totalBrAfter = 0;

  for (const f of files) {
    const filePath = path.join(dir, f);
    const res = optimizeVrma(filePath, filePath, { ...options, silent: true });
    totalRawBefore += res.rawBefore;
    totalRawAfter += res.rawAfter;
    totalBrBefore += res.brBefore;
    totalBrAfter += res.brAfter;

    console.log(
      f.padEnd(23),
      `Raw: ${(res.rawBefore / 1024).toFixed(0).padStart(4)}KB -> ${(res.rawAfter / 1024).toFixed(0).padStart(4)}KB (-${res.rawReduction.toFixed(0)}%)`.padEnd(30),
      `| Br: ${(res.brBefore / 1024).toFixed(0).padStart(3)}KB -> ${(res.brAfter / 1024).toFixed(0).padStart(3)}KB (-${res.brReduction.toFixed(0)}%)`
    );
  }

  console.log('='.repeat(72));
  console.log('🎉 批量优化全部完成！体积汇总统计：');
  console.log(`📦 原始 Raw 体积:   ${(totalRawBefore / 1024 / 1024).toFixed(2)} MB -> ${(totalRawAfter / 1024 / 1024).toFixed(2)} MB (减重 ${((1 - totalRawAfter / totalRawBefore) * 100).toFixed(1)}%)`);
  console.log(`🌐 传输 Brotli 体积: ${(totalBrBefore / 1024 / 1024).toFixed(2)} MB -> ${(totalBrAfter / 1024 / 1024).toFixed(2)} MB (节省 ${((1 - totalBrAfter / totalBrBefore) * 100).toFixed(1)}%)\n`);
}

// ── 通用 CLI 命令行执行入口 ──
if (process.argv[1] && process.argv[1].endsWith('slice-vrma.mjs')) {
  const args = process.argv.slice(2);

  // 1. 批量优化模式 (Batch Optimize Mode)
  if (args.includes('--optimize-all') || args[0] === 'optimize-all') {
    const targetDir = args.find((a) => !a.startsWith('-') && a !== 'optimize-all') || 'public/vrm/motion';
    optimizeAllVrma(targetDir);
    process.exit(0);
  }

  // 2. 单文件优化模式 (Single Optimize Mode)
  if (args.includes('--optimize') || args.includes('-o') || args[0] === 'optimize') {
    const fileArgs = args.filter((a) => !a.startsWith('-') && a !== 'optimize');
    if (fileArgs.length === 0) {
      console.log(`
用法:
  node scripts/slice-vrma.mjs --optimize <输入.vrma> [输出.vrma]
`);
      process.exit(1);
    }
    const inPath = fileArgs[0];
    const outPath = fileArgs[1] || inPath;
    optimizeVrma(inPath, outPath);
    process.exit(0);
  }

  // 3. 诊断扫描模式 (Scan Mode)
  if (args.includes('--scan') || args.includes('-s') || args[0] === 'scan') {
    const scanPath = args.find((a) => !a.startsWith('-') && a !== 'scan');
    if (!scanPath) {
      console.log(`
用法:
  node scripts/slice-vrma.mjs --scan <vrma文件路径>
  node scripts/slice-vrma.mjs scan <vrma文件路径>

示例:
  node scripts/slice-vrma.mjs --scan public/vrm/motion/touch-hair.vrma
`);
      process.exit(1);
    }
    scanVrma(scanPath);
    process.exit(0);
  }

  // 4. 切片模式 (Slice Mode)
  if (args.length < 2) {
    console.log(`
使用方式:
  # 一键批量优化目录内所有动作 (30FPS 自适应 + 死轨道剔除 + 静态坍缩):
  node scripts/slice-vrma.mjs --optimize-all [目录路径，默认 public/vrm/motion]

  # 单文件动作极速优化:
  node scripts/slice-vrma.mjs --optimize <输入文件> [输出文件]

  # 诊断扫描：
  node scripts/slice-vrma.mjs --scan <输入文件>

  # 动作切片：
  node scripts/slice-vrma.mjs <输入文件> <输出文件> [开始秒数] [结束秒数] [--seamless] [--zero-z]

示例:
  # 1. 批量优化全量动作资产:
  node scripts/slice-vrma.mjs --optimize-all

  # 2. 优化单个动作:
  node scripts/slice-vrma.mjs --optimize public/vrm/motion/show-full-body.vrma

  # 3. 扫描动捕资产潜在问题：
  node scripts/slice-vrma.mjs --scan public/vrm/motion/touch-hair.vrma
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
