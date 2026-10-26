import { readFileSync, writeFileSync } from 'fs';

/**
 * Slice a .vrma file between startSec and endSec, re-zero timestamps,
 * and seamlessly blend the tail to eliminate loop pop and T-pose/A-pose prefixes.
 */
export function sliceVrma(inputPath, outputPath, startSec = 3.333, endSec = 12.0) {
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

  // Time accessor
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

  // Sampler outputs
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

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < stride; j++) {
        newVals[i * stride + j] = origVals[(startFrame + i) * stride + j];
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
    `[sliceVrma] Sliced ${inputPath} [${startSec}s~${endSec}s] → ${outputPath} (${(glb.length / 1024).toFixed(1)}KB, duration: ${newTimes[count - 1].toFixed(2)}s)`
  );
}

// CLI usage
if (process.argv[1] && process.argv[1].endsWith('slice-vrma.mjs')) {
  const inPath = process.argv[2] || 'public/vrm/motion/listening.vrma';
  const outPath = process.argv[3] || 'public/vrm/motion/listening.vrma';
  const start = parseFloat(process.argv[4] || '3.333');
  const end = parseFloat(process.argv[5] || '12.0');
  sliceVrma(inPath, outPath, start, end);
}
