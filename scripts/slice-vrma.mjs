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

// ── 通用 CLI 命令行执行入口 ──
if (process.argv[1] && process.argv[1].endsWith('slice-vrma.mjs')) {
  const args = process.argv.slice(2);

  // 1. 诊断扫描模式 (Scan Mode)
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

  // 2. 切片模式 (Slice Mode)
  if (args.length < 2) {
    console.log(`
使用方式:
  # 诊断扫描：
  node scripts/slice-vrma.mjs --scan <输入文件>

  # 动作切片：
  node scripts/slice-vrma.mjs <输入文件> <输出文件> [开始秒数] [结束秒数] [--seamless] [--zero-z]

示例:
  # 1. 扫描动捕资产潜在问题（Z 轴偏移、准备动作、横晃沉降）：
  node scripts/slice-vrma.mjs --scan public/vrm/motion/touch-hair.vrma

  # 2. 通用动捕动作去废帧 (从 3.3s 截取到 12.0s):
  node scripts/slice-vrma.mjs public/vrm/motion/attentive-lean.vrma public/vrm/motion/listening.vrma 3.3 12.0

  # 3. 循环待机动作 (带尾首平滑循环闭环 + Z 轴归零防后撤):
  node scripts/slice-vrma.mjs public/vrm/motion/attentive-lean.vrma public/vrm/motion/listening.vrma 6.0 12.0 --seamless --zero-z
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
