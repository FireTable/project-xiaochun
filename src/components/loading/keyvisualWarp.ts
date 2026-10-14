// Key-visual "Live2D-lite" warp for the loading overlay.
// Raw WebGL1 (no three.js): a 48x80 grid draws the hero image with one draw call, and the fragment shader applies
// small inverse-UV offsets that a UV-space mask texture gates (warp-mask.webp, 248x400: R hair, G arms, B skirt,
// A = 255 - torso/mouth gate*127). The coordinates below are key-visual pixels in the 991x1600 master. The 619w
// source has the same aspect ratio, so the mask and coordinates fit both srcset candidates.
// The caller keeps the <img> as the static fallback. The canvas fades in only after the first frame has drawn.

import { canvasSizeFor, snapToPixel } from './pixelSnap';
import { createWarpGL } from './warpGL';
import { PERF_FLAGS } from '@/perfFlags';
import { APP_CONFIG } from '@/config';
import type { FromWorker, ToWorker } from './keyvisualWarp.worker';

export interface KeyvisualWarp {
  /** Stop or restart animation. A paused warp keeps its last frame. */
  setPaused(paused: boolean): void;
  /** Free GL resources and observers, remove the canvas, and show the <img> again. */
  dispose(): void;
}

const NOOP: KeyvisualWarp = { setPaused() {}, dispose() {} };

// The overlay can be remounted during boot (router pending component -> App overlay, StrictMode, HMR). Time
// therefore uses a module-level origin so the motion stays continuous, and a remount within WARM_MS of a live
// warp skips the fade-in. A remount then looks seamless instead of snapping back to t=0 and fading in again.
let timeOrigin = 0;
let lastAliveAt = -Infinity;
const WARM_MS = APP_CONFIG.loading.warp.warmMs;
/** True while a warp was alive within WARM_MS, i.e. a remount should take over without showing the static img. */
export function isWarpWarm(): boolean {
  return performance.now() - lastAliveAt < WARM_MS;
}
const restoreTimers = new WeakMap<HTMLCanvasElement, number>();
const maskCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = maskCache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
  maskCache.set(src, p);
  p.catch(() => maskCache.delete(src));
  return p;
}

/**
 * Mounts the warp canvas over `img`, filling `host`, which should be a positioned box with the same size as the img.
 * Resolves to a no-op handle when WebGL is unavailable or reduced motion is on, so the static img stays.
 */
export async function startKeyvisualWarp(
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  maskSrc: string,
): Promise<KeyvisualWarp> {
  if (typeof window === 'undefined') return NOOP;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return NOOP;
  const host = canvas.parentElement;
  if (!host) return NOOP;
  // The canvas is React-owned (rendered in LoadingOverlay from first paint, opacity 0). A dispose followed by a
  // restart on the SAME element (StrictMode, effect re-run) cancels the pending restore, so nothing flips back.
  const pending = restoreTimers.get(canvas);
  if (pending !== undefined) { clearTimeout(pending); restoreTimers.delete(canvas); }
  const live = canvas.style.opacity === '1';

  const session = workerSessions.get(canvas);
  if (session || (PERF_FLAGS.warpInWorker && canTransfer(canvas))) return startInWorker(img, canvas, host, maskSrc, session);

  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return NOOP;
  canvas.dataset.xcGl = '1';

  let disposed = false;
  let paused = false;
  let visible = true;
  let raf = 0;
  let swapRaf = 0;
  const cleanups: Array<() => void> = [];
  let kick = () => {};
  const showImg = () => { canvas.style.opacity = '0'; img.style.opacity = ''; };

  try {
    // Reuse the srcset candidate the browser already chose (currentSrc), which is a cache hit and not a second download.
    if (!img.complete || !img.naturalWidth) await img.decode();
    // The hero <img> is SSR'd with decoding="async", which lets Chrome commit a frame WITHOUT the image while it
    // re-decodes it for a new raster (the pixel snap below moves the host, the canvas insert re-layers it). That was
    // the ~100 ms character-less gap before the swap. Switch to sync decoding so the img is never painted blank.
    img.decoding = 'sync';
    await img.decode().catch(() => {});
    const mask = await loadImage(maskSrc);
    if (disposed) return NOOP;

    // The key visual is pre-downscaled to the exact drawing-buffer size with the browser's high-quality resampler,
    // so the ka=0 frame matches the browser-scaled <img> (plain bilinear minification of the 991 w source is visibly
    // sharper/aliased, and WebGL1 cannot mipmap the NPOT texture). Re-uploaded whenever the buffer size changes.
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d');
    const W = createWarpGL(gl, img, mask, APP_CONFIG.loading.warp);
    const uploadImg = (w: number, h: number) => {
      let src: TexImageSource = img;
      if (sctx && w < img.naturalWidth) {
        scratch.width = w;
        scratch.height = h;
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(img, 0, 0, w, h);
        src = scratch;
      }
      W.upload(src);
    };
    // Must match the .xc-hero-img mask in main.css: opaque to 52% then transparent at 64% (mobile), 80% to 99% (md+).
    const mq = window.matchMedia('(min-width: 768px)');
    const setFade = () => {
      const [f0, f1] = mq.matches ? [0.8, 0.99] : [0.52, 0.64];
      W.setFade(f0, f1, canvas.height);
    };
    if (!timeOrigin) timeOrigin = performance.now();
    const start = timeOrigin;
    const warm = performance.now() - lastAliveAt < WARM_MS;
    let shownAt = -1; // performance.now() when the canvas replaced the img; -1 = not shown yet
    const RAMP_MS = APP_CONFIG.loading.warp.rampMs;
    const draw = (s: number) => W.draw(s, warm ? 1 : shownAt < 0 ? 0 : Math.min(1, (performance.now() - shownAt) / RAMP_MS));
    // Size from the untransformed layout box, never getBoundingClientRect: the ancestor .xc-breathe scale animation
    // would otherwise bake a random breathing phase (up to 1.2 %) into the buffer and resample the frame at the swap.
    // Pixel-snap the host inside its (transformed) parent. A centred hero sits at a fractional x (e.g. 740.43 px);
    // Chrome rasterizes the <img> at that sub-pixel phase but places the canvas texture on whole pixels, so every
    // edge differed at the swap (mean |diff| 1.6 vs 0.6 when snapped). Translating the host by -frac aligns both.
    // (snapToPixel / canvasSizeFor live in pixelSnap.ts so LoadingOverlay can apply them before first paint.)
    let uploaded = false;
    const resize = () => {
      snapToPixel(host);
      const [w, h] = canvasSizeFor(host);
      if (canvas.width === w && canvas.height === h) {
        if (!uploaded) { W.viewport(w, h); uploadImg(w, h); setFade(); uploaded = true; }
        return false;
      }
      canvas.width = w; // clears the drawing buffer, so the caller redraws in the same task
      canvas.height = h;
      W.viewport(w, h);
      uploadImg(w, h);
      uploaded = true;
      setFade();
      return true;
    };
    const now = () => (performance.now() - start) / 1000;
    const frame = () => {
      raf = 0;
      if (disposed || paused || !visible || document.hidden || shownAt < 0) return;
      draw((performance.now() - start) / 1000);
      lastAliveAt = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kick = () => {
      if (!raf && !disposed && !paused && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    // Swap without touching the DOM: the canvas already sits over the img (same box, opacity 0, composited), so each
    // draw is presented while invisible. Two rAFs after the first draw the frame is on screen, and ONE task then draws,
    // sets canvas opacity 1 and img opacity 0. Opacity (not visibility) keeps the img's raster; no transitions. On a
    // cold start ka stays 0 until the flip, so the flipped frame matches the img.
    resize();
    draw(now());
    const flip = () => {
      swapRaf = 0;
      if (disposed) return;
      draw(now());
      canvas.style.opacity = '1';
      img.style.opacity = '0';
      shownAt = performance.now();
      kick();
    };
    const step = (fn: () => void) => { swapRaf = requestAnimationFrame(() => { if (!disposed) fn(); }); };
    if (live) {
      // Restart on the same, still-visible canvas (StrictMode / effect re-run): keep showing it, no swap.
      img.style.opacity = '0';
      shownAt = performance.now();
      kick();
    } else {
      step(() => { draw(now()); step(flip); });
    }
    const onMq = () => { setFade(); draw(now()); };
    mq.addEventListener('change', onMq);
    cleanups.push(() => mq.removeEventListener('change', onMq));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { if (resize()) draw(now()); });
      ro.observe(host);
      cleanups.push(() => ro.disconnect());
    } else {
      const onResize = () => { if (resize()) draw(now()); };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));
    }
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; kick(); });
      io.observe(host);
      cleanups.push(() => io.disconnect());
    }
    document.addEventListener('visibilitychange', kick);
    cleanups.push(() => document.removeEventListener('visibilitychange', kick));
    const onLost = (e: Event) => { e.preventDefault(); handle.dispose(); };
    canvas.addEventListener('webglcontextlost', onLost);
    cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));
    kick();
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('[keyvisualWarp] fallback to static image:', err);
    showImg();
    return NOOP;
  }

  const handle: KeyvisualWarp = {
    setPaused(p) {
      paused = p;
      if (!p) kick();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (canvas.style.opacity === '1') lastAliveAt = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      cancelAnimationFrame(swapRaf);
      cleanups.forEach((f) => f());
      // The canvas is React-owned, so it is never removed or its context lost here (a restart may reuse it). Restore
      // the img a moment later unless a new warp claims this canvas first (same-element restart).
      if (canvas.style.opacity === '1') restoreTimers.set(canvas, window.setTimeout(() => { restoreTimers.delete(canvas); showImg(); }, 250));
      else showImg();
    },
  };
  return handle;
}

// ── Worker path (PERF_FLAGS.warpInWorker) ────────────────────────────────────────────────────────────────────────
// The canvas is transferred to a worker once (transferControlToOffscreen is one-shot), so a restart on the same
// element (StrictMode, effect re-run) re-attaches to the live session instead of creating a new one. A dispose keeps
// the worker for 250 ms for exactly that; after that it is terminated and the img restored.

interface WorkerSession {
  worker: Worker;
  ready: boolean;
  shown: boolean;
  failed: boolean;
  onReady: (() => void) | null;
  killTimer: number;
}
const workerSessions = new WeakMap<HTMLCanvasElement, WorkerSession>();

function canTransfer(canvas: HTMLCanvasElement): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' &&
    typeof canvas.transferControlToOffscreen === 'function' && typeof createImageBitmap === 'function' &&
    // A canvas that already has a main-thread context can no longer be transferred.
    !canvas.dataset.xcGl;
}

/** Key visual pre-downscaled to the buffer size with the browser's high-quality resampler (matches the <img>). */
function imgBitmap(img: HTMLImageElement, w: number, h: number): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = { premultiplyAlpha: 'premultiply' };
  if (w < img.naturalWidth) Object.assign(opts, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  return createImageBitmap(img, opts);
}

async function startInWorker(
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  maskSrc: string,
  existing: WorkerSession | undefined,
): Promise<KeyvisualWarp> {
  let disposed = false;
  let paused = false;
  let visible = true;
  const cleanups: Array<() => void> = [];
  const showImg = () => { canvas.style.opacity = '0'; img.style.opacity = ''; };
  const mq = window.matchMedia('(min-width: 768px)');
  const fadeFor = (): [number, number] => (mq.matches ? [0.8, 0.99] : [0.52, 0.64]);
  let size = canvasSizeFor(host);

  let s = existing;
  if (s) {
    clearTimeout(s.killTimer);
    if (s.failed) return NOOP;
  } else {
    try {
      if (!img.complete || !img.naturalWidth) await img.decode();
      img.decoding = 'sync'; // see the main-thread path: never let Chrome paint the img blank while re-decoding
      await img.decode().catch(() => {});
      snapToPixel(host);
      size = canvasSizeFor(host);
      const maskImg = await loadImage(maskSrc);
      const [bmp, maskBmp] = await Promise.all([
        imgBitmap(img, size[0], size[1]),
        createImageBitmap(maskImg, { premultiplyAlpha: 'none' }),
      ]);
      if (disposed) { bmp.close(); maskBmp.close(); return NOOP; }
      const worker = new Worker(new URL('./keyvisualWarp.worker.ts', import.meta.url), { type: 'module' });
      const off = canvas.transferControlToOffscreen();
      canvas.dataset.xcOffscreen = '1';
      s = { worker, ready: false, shown: false, failed: false, onReady: null, killTimer: 0 };
      workerSessions.set(canvas, s);
      const sess = s;
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.type === 'ready') { sess.ready = true; sess.onReady?.(); }
        else if (e.data.type === 'gap') ((window as any).__warpWorkerGaps ??= []).push(e.data.ms);
        else if (e.data.type === 'error') {
          if (import.meta.env?.DEV) console.warn('[keyvisualWarp] worker failed, static image stays:', e.data.message);
          sess.failed = true;
          showImg();
        }
      };
      worker.onerror = () => { sess.failed = true; showImg(); };
      if (!timeOrigin) timeOrigin = performance.now();
      const init: ToWorker = {
        type: 'init', canvas: off, img: bmp, mask: maskBmp, w: size[0], h: size[1], fade: fadeFor(),
        startEpoch: performance.timeOrigin + timeOrigin, warm: performance.now() - lastAliveAt < WARM_MS,
        warp: APP_CONFIG.loading.warp,
      };
      worker.postMessage(init, [off, bmp, maskBmp]);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[keyvisualWarp] worker setup failed, static image stays:', err);
      showImg();
      return NOOP;
    }
  }
  const sess = s!;
  const send = (m: ToWorker, transfer: Transferable[] = []) => sess.worker.postMessage(m, transfer);

  // Same swap as the main thread: the worker reports two rAFs after its first draw, and ONE main-thread task then
  // sets canvas opacity 1 and img opacity 0.
  const flip = () => {
    if (disposed || sess.shown || sess.failed) return;
    canvas.style.opacity = '1';
    img.style.opacity = '0';
    sess.shown = true;
    send({ type: 'shown' });
  };
  if (sess.shown) img.style.opacity = '0';
  else if (sess.ready) flip();
  else sess.onReady = flip;

  const sendRun = () => send({ type: 'run', run: !disposed && !paused && visible && !document.hidden });
  sendRun();
  const onMq = () => send({ type: 'fade', fade: fadeFor() });
  mq.addEventListener('change', onMq);
  cleanups.push(() => mq.removeEventListener('change', onMq));
  let sizing = 0;
  const onResize = () => {
    snapToPixel(host);
    const next = canvasSizeFor(host);
    if (next[0] === size[0] && next[1] === size[1]) return;
    size = next;
    const id = ++sizing;
    void imgBitmap(img, next[0], next[1]).then((bmp) => {
      if (disposed || id !== sizing) { bmp.close(); return; }
      send({ type: 'resize', w: next[0], h: next[1], img: bmp }, [bmp]);
    }).catch(() => {});
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    cleanups.push(() => ro.disconnect());
  } else {
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
  }
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; sendRun(); });
    io.observe(host);
    cleanups.push(() => io.disconnect());
  }
  document.addEventListener('visibilitychange', sendRun);
  cleanups.push(() => document.removeEventListener('visibilitychange', sendRun));

  return {
    setPaused(p) { paused = p; sendRun(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanups.forEach((f) => f());
      if (sess.onReady === flip) sess.onReady = null;
      if (sess.shown) lastAliveAt = performance.now();
      send({ type: 'run', run: false });
      sess.killTimer = window.setTimeout(() => {
        sess.worker.terminate();
        sess.failed = true; // the canvas was transferred; a later restart on it keeps the static img
        showImg();
      }, 250);
    },
  };
}
