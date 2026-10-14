/// <reference lib="webworker" />
// OffscreenCanvas host for the key-visual warp. Draws the same frames as the main-thread
// warp (shared warpGL.ts), so main-thread long tasks during boot (VRM parse, shader links, React commits) no longer
// stall the hero. The main thread only flips opacities and forwards size / fade / run state.
import { createWarpGL, type WarpGL, type LoadingWarpConfig } from './warpGL';

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; img: ImageBitmap; mask: ImageBitmap; w: number; h: number; pad: number; fade: [number, number]; startEpoch: number; warm: boolean; warp: LoadingWarpConfig }
  | { type: 'resize'; w: number; h: number; pad: number; img: ImageBitmap }
  | { type: 'fade'; fade: [number, number] }
  | { type: 'shown' }
  | { type: 'run'; run: boolean };
export type FromWorker = { type: 'ready' } | { type: 'error'; message: string } | { type: 'gap'; ms: number };

let rampMs = 1200; // replaced by init.warp.rampMs (APP_CONFIG.loading.warp)
let canvas: OffscreenCanvas | null = null;
let W: WarpGL | null = null;
let fade: [number, number] = [0.8, 0.99];
let startEpoch = 0;
let warm = false;
let shownAt = -1;
let run = true;
let raf = 0;
let readyIn = -1; // frames left until the first frames are on screen; -1 = already reported

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
const now = () => (performance.timeOrigin + performance.now() - startEpoch) / 1000;
const draw = () => {
  if (!W) return;
  const k = warm ? 1 : shownAt < 0 ? 0 : Math.min(1, (performance.now() - shownAt) / rampMs);
  W.draw(now(), k);
};
let lastFrame = 0;
const frame = (ts: number) => {
  raf = 0;
  if (!W) return;
  // Dev diagnostics: report presented-frame gaps > 34 ms once the canvas is visible (measured in the worker).
  if (import.meta.env?.DEV && shownAt >= 0 && run && lastFrame && ts - lastFrame > 34) post({ type: 'gap', ms: Math.round(ts - lastFrame) });
  lastFrame = run ? ts : 0;
  draw();
  if (readyIn > 0 && --readyIn === 0) { readyIn = -1; post({ type: 'ready' }); }
  // Before the flip keep drawing (ka 0) so the canvas holds a presented frame; after it, only while running.
  if (run || shownAt < 0) raf = requestAnimationFrame(frame);
};
const kick = () => { if (!raf && W) raf = requestAnimationFrame(frame); };

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': {
        canvas = m.canvas;
        canvas.width = m.w;
        canvas.height = m.h;
        const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null;
        if (!gl) throw new Error('no webgl in worker');
        rampMs = m.warp.rampMs;
        W = createWarpGL(gl, m.img, m.mask, m.warp);
        m.img.close();
        m.mask.close();
        W.viewport(m.w, m.h, m.pad);
        fade = m.fade;
        W.setFade(fade[0], fade[1], m.h);
        startEpoch = m.startEpoch;
        warm = m.warm;
        draw();
        readyIn = 2; // two rAFs after the first draw, as on the main thread
        kick();
        break;
      }
      case 'resize':
        if (!W || !canvas) { m.img.close(); break; }
        canvas.width = m.w;
        canvas.height = m.h;
        W.viewport(m.w, m.h, m.pad);
        W.upload(m.img);
        m.img.close();
        W.setFade(fade[0], fade[1], m.h);
        draw();
        break;
      case 'fade':
        fade = m.fade;
        if (W && canvas) { W.setFade(fade[0], fade[1], canvas.height); draw(); }
        break;
      case 'shown':
        shownAt = performance.now();
        kick();
        break;
      case 'run':
        run = m.run;
        if (run) kick();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
