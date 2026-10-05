// 相机选项 (camera) 的构建产物测试 (node --test, 不需要浏览器): 先 `pnpm build` 再跑。
// 行为级 (iframe 里 fov / 视距 / 高度真的生效、intro:false、运行时 setConfig) 见 test/browser/embed-e2e.mjs;
// SDK 把选项写进 iframe URL 见 test/browser/outfit-harness.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';

const esm = await import('../dist/index.js');
const protocol = await import('../dist/protocol.js');

test('XC_CAMERA_RANGES: fov 15–60 / distance 1–15 / height ±1', () => {
  assert.deepEqual([...protocol.XC_CAMERA_RANGES.fov], [15, 60]);
  assert.deepEqual([...protocol.XC_CAMERA_RANGES.distance], [1, 15]);
  assert.deepEqual([...protocol.XC_CAMERA_RANGES.height], [-1, 1]);
});

test('normalizeXcCamera: 合法通过 / null 清除 / 越界夹范围 / 非法与未知键(含 pitch)报错', () => {
  assert.deepEqual(protocol.normalizeXcCamera({ fov: 40, distance: 3, height: 0.2, intro: false }).camera, { fov: 40, distance: 3, height: 0.2, intro: false });
  assert.deepEqual(protocol.normalizeXcCamera({ fov: null }).camera, { fov: null });
  const r = protocol.normalizeXcCamera({ fov: 5, distance: 99, height: 7 });
  assert.deepEqual(r.camera, { fov: 15, distance: 15, height: 1 });
  assert.deepEqual(r.clamped, ['fov', 'distance', 'height']);
  for (const bad of [null, 3, [], { fov: '30' }, { fov: NaN }, { intro: 'no' }, { pitch: 1 }]) assert.equal(protocol.normalizeXcCamera(bad).ok, false, JSON.stringify(bad));
});

test('parseXcCameraParams: 数值 / intro / 越界 / 非法', () => {
  const get = (q) => (n) => (n in q ? q[n] : null);
  assert.deepEqual(protocol.parseXcCameraParams(get({ cameraFov: '45', cameraDistance: '3.5', cameraHeight: '-0.25', cameraIntro: '0' })).camera, { fov: 45, distance: 3.5, height: -0.25, intro: false });
  const bad = protocol.parseXcCameraParams(get({ cameraFov: '99', cameraDistance: 'x', cameraIntro: 'maybe' }));
  assert.deepEqual(bad.camera, { fov: 60 });
  assert.equal(bad.warnings.length, 3);
});

test('主入口导出 createXiaochun 且接受 camera 选项类型 (构建产物可加载)', () => {
  assert.equal(typeof esm.createXiaochun, 'function');
  assert.equal(typeof esm.normalizeXcCamera, 'function');
});
