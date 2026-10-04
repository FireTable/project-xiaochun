#!/usr/bin/env node
/**
 * build-beach-strip.mjs — 把 3 张 AI 横图 (sky-top / mid-beach / ground-bottom, 各 1280×720) 烘焙成"海滩"场景用的竖长条 + 动态遮罩。
 *
 * 用法:  node scripts/build-beach-strip.mjs <素材目录> [输出目录=public/scene/beach]
 *   素材目录需含 sky-top.jpg / mid-beach.jpg / ground-bottom.jpg;  依赖本机的 ImageMagick (`magick`) 与 `cwebp`。
 *
 * 产物 (运行时 src/core/scene/beachBackdrop.ts 读取):
 *   beach-strip.webp  1280×1930 竖长条:  [天空(上下翻转) | 主景(海平线在第 BEACH_STRIP.horizonY 行) | 沙地], 接缝处做渐变过渡
 *   beach-mask.webp   同一坐标系的 640×965 遮罩:  R = 海面 (波光 / 水波微扰只作用在这里),  G = 可漂移的纯天空 (云飘动只作用在这里)
 *
 * 为什么 sky-top 要上下翻转:
 *   sky-top 自带"上深下浅"渐变 (顶部 #2E9FF5 → 底部近白 #F4FBFE), 是一张独立的完整天空; 主景 mid-beach 的天空顶部是深蓝 #48A9F1。
 *   直接把 sky-top 接在主景上方, 接缝处是"近白 → 深蓝", 平视时屏幕顶部会出现一条发白的亮带。翻转后接缝处是深蓝 → 深蓝 (色差 < 30), 接缝几乎看不出。
 *   代价: 云朵的明暗面上下颠倒 (赛璐璐云的阴影在上面), 只在大幅仰视时才出现在画面里。
 *
 * 这里的所有常量要与 beachBackdrop.ts 里的 BEACH_STRIP 保持一致 (脚本末尾会打印一份, 直接对照)。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [srcDir, outDir = 'public/scene/beach'] = process.argv.slice(2);
if (!srcDir) { console.error('usage: node scripts/build-beach-strip.mjs <srcDir> [outDir]'); process.exit(1); }

const W = 1280, IMG_H = 720;
const MID_Y = 620;            // 主景上缘在长条里的行号 (= 天空 720 − 与主景的重叠 100)
const SKY_MID_BLEND = 100;    // 天空 → 主景 渐变带高度
const GND_Y = 1210;           // 沙地上缘 (主景左右下角的棕榈叶从主景第 ~574 行 = 长条 1194 行开始)
const MID_GND_BLEND = 120;    // 主景 → 沙地 渐变带高度
const H = GND_Y + IMG_H;      // 1930
const MID_HORIZON = 398;      // 主景里海平线所在行 (实测: 中间列 397 行从近白天空变成海蓝)
const MID_SHORE = 545;        // 海岸线 (泡沫结束 / 沙滩开始) 所在行

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });
const readRGB = (file) => {
  const buf = run('magick', [file, '-depth', '8', '-colorspace', 'sRGB', 'rgb:-']);
  if (buf.length !== W * IMG_H * 3) throw new Error(`${file}: expected ${W}x${IMG_H} (got ${buf.length / 3} px)`);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
};
const sky = readRGB(path.join(srcDir, 'sky-top.jpg'));
const mid = readRGB(path.join(srcDir, 'mid-beach.jpg'));
const gnd = readRGB(path.join(srcDir, 'ground-bottom.jpg'));

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── 1. 天空: 上下翻转, 并把底部 (= 原图顶部) 的底色平滑地"拉"到主景天空顶部的底色, 抹掉残余色差 ──
const avgRow = (img, y, x0 = 400, x1 = 880) => {
  let r = 0, g = 0, b = 0;
  for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = x1 - x0; return [r / n, g / n, b / n];
};
const skyBottom = avgRow(sky, 0);       // 翻转后长条里天空最下面一行 = 原图第 0 行
const midTop = avgRow(mid, 0);
const dSky = midTop.map((v, i) => v - skyBottom[i]);

const strip = new Uint8Array(W * H * 3);
const put = (y, x, r, g, b) => { const i = (y * W + x) * 3; strip[i] = r; strip[i + 1] = g; strip[i + 2] = b; };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    // 天空层 (翻转): 长条第 y 行 = 原图第 719−y 行; 越靠近底部越向主景底色靠拢 (只在 y>420 起作用)
    let sr = 0, sg = 0, sb = 0;
    if (y < IMG_H) {
      const i = ((IMG_H - 1 - y) * W + x) * 3;
      const k = smooth(420, IMG_H - 1, y);
      sr = Math.min(255, Math.max(0, sky[i] + dSky[0] * k)); sg = Math.min(255, Math.max(0, sky[i + 1] + dSky[1] * k)); sb = Math.min(255, Math.max(0, sky[i + 2] + dSky[2] * k));
    }
    // 主景层
    const my = y - MID_Y;
    let mr = 0, mg = 0, mb = 0;
    if (my >= 0 && my < IMG_H) { const i = (my * W + x) * 3; mr = mid[i]; mg = mid[i + 1]; mb = mid[i + 2]; }
    // 沙地层
    const gy = y - GND_Y;
    let gr = 0, gg = 0, gb = 0;
    if (gy >= 0 && gy < IMG_H) { const i = (gy * W + x) * 3; gr = gnd[i]; gg = gnd[i + 1]; gb = gnd[i + 2]; }

    // 合成: 天空 → 主景 → 沙地
    const wMid = y < MID_Y ? 0 : smooth(MID_Y, MID_Y + SKY_MID_BLEND, y);
    const wGnd = y < GND_Y ? 0 : smooth(GND_Y, GND_Y + MID_GND_BLEND, y);
    r = sr * (1 - wMid) + mr * wMid; g = sg * (1 - wMid) + mg * wMid; b = sb * (1 - wMid) + mb * wMid;
    r = r * (1 - wGnd) + gr * wGnd; g = g * (1 - wGnd) + gg * wGnd; b = b * (1 - wGnd) + gb * wGnd;
    put(y, x, Math.round(r), Math.round(g), Math.round(b));
  }
}

// ── 2. 遮罩 ──
// R: 海面。条件 = 在海平线与海岸线之间的行, 且偏蓝青 (b − r 足够大; 棕榈叶偏绿、沙滩/泡沫偏暖白都被排除)
// G: 纯天空 (云漂移区)。叶子 (g > b) 膨胀 32px 再羽化, 保证漂移采样不会把棕榈叶"拖"出重影; 在主景海平线以上逐渐淡出。
const maskR = new Float32Array(W * H), maskG = new Float32Array(W * H), leaf = new Float32Array(W * H);
const horizonY = MID_Y + MID_HORIZON, shoreY = MID_Y + MID_SHORE;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, p = y * W + x;
    const r = strip[i], g = strip[i + 1], b = strip[i + 2];
    if (y >= horizonY + 2 && y <= shoreY + 10) {
      const blueish = Math.min(1, Math.max(0, (b - r - 12) / 40));
      const notLeaf = g - b > 6 ? 0 : 1;
      const rowIn = smooth(horizonY + 2, horizonY + 10, y) * (1 - smooth(shoreY - 6, shoreY + 10, y));
      maskR[p] = blueish * notLeaf * rowIn;
    }
    leaf[p] = (y >= MID_Y && (g - b > 10 || (r < 120 && g > 130 && b < 160))) ? 1 : 0;
  }
}
const maxFilter = (src, rad) => {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let k = Math.max(0, x - rad); k <= Math.min(W - 1, x + rad); k++) if (src[y * W + k] > m) { m = src[y * W + k]; if (m >= 1) break; } tmp[y * W + x] = m; }
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = 0; for (let k = Math.max(0, y - rad); k <= Math.min(H - 1, y + rad); k++) if (tmp[k * W + x] > m) { m = tmp[k * W + x]; if (m >= 1) break; } out[y * W + x] = m; }
  return out;
};
const boxBlur = (src, rad) => {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * rad + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let k = -rad; k <= rad; k++) s += src[y * W + Math.min(W - 1, Math.max(0, k))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = s / n; s += src[y * W + Math.min(W - 1, x + rad + 1)] - src[y * W + Math.max(0, x - rad)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x]; for (let y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x]; } }
  return out;
};
const leafSoft = boxBlur(boxBlur(maxFilter(leaf, 32), 8), 8);
for (let y = 0; y < H; y++) {
  const rowFade = 1 - smooth(MID_Y + 40, MID_Y + 220, y); // 主景上缘 +40 起淡出, +220 完全不漂
  for (let x = 0; x < W; x++) maskG[y * W + x] = (1 - Math.min(1, leafSoft[y * W + x] * 1.5)) * rowFade;
}
const maskSoftR = boxBlur(maskR, 2);

// 遮罩半分辨率输出 (640×965), RGB 三通道: R 海 / G 天空 / B 0
const MW = W / 2, MH = Math.ceil(H / 2);
const maskRGB = new Uint8Array(MW * MH * 3);
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
  const sx = x * 2, sy = Math.min(H - 1, y * 2), i = (y * MW + x) * 3;
  maskRGB[i] = Math.round(maskSoftR[sy * W + sx] * 255);
  maskRGB[i + 1] = Math.round(maskG[sy * W + sx] * 255);
}

// ── 3. 写出 ──
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'beach-'));
const toWebp = (rgb, w, h, outName, q, extra = []) => {
  const raw = path.join(tmp, outName + '.rgb');
  writeFileSync(raw, rgb);
  const png = path.join(tmp, outName + '.png');
  run('magick', ['-size', `${w}x${h}`, '-depth', '8', `rgb:${raw}`, png]);
  run('cwebp', ['-q', String(q), '-m', '6', ...extra, png, '-o', path.join(outDir, outName)], { stdio: 'ignore' });
};
toWebp(strip, W, H, "beach-strip.webp", 90, ['-sharp_yuv']);
toWebp(maskRGB, MW, MH, 'beach-mask.webp', 90);
rmSync(tmp, { recursive: true, force: true });
for (const f of ['beach-strip.webp', 'beach-mask.webp']) console.log(f, (statSync(path.join(outDir, f)).size / 1024).toFixed(0) + ' KB');
console.log('BEACH_STRIP =', JSON.stringify({ width: W, height: H, horizonY, shoreY, skyEndY: IMG_H, midY: MID_Y, groundY: GND_Y, maskWidth: MW, maskHeight: MH }));
