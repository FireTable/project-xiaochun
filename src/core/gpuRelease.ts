// Explicit GPU-context release on page teardown.
//
// Why: on a reload Chrome keeps the old document's WebGL contexts alive in the GPU process until the old renderer
// is torn down, and the new document's first synchronous GL calls (getExtension, program links) queue behind it.
// A trace showed one gl.getExtension blocking the main thread ~11 s. Losing the contexts in `pagehide` hands the
// GPU memory back before the new document starts talking to the GPU process.
//
// bfcache: `pagehide` with `persisted === true` means the page may be restored as-is. A context that was explicitly
// lost via WEBGL_lose_context stays lost until restoreContext() is called, so releasing there would restore a dead
// canvas. We therefore SKIP the hard release when persisted (the engine still suspends its rAF loop), and only
// release on a real unload/reload (persisted === false). `beforeunload` is deliberately not used: it can be
// cancelled by the user ("Leave site?") and would leave a live page without GPU contexts, and it makes the page
// bfcache-ineligible in some browsers.

export type GpuReleaser = () => void;

const releasers = new Set<GpuReleaser>();
const lostGl = new WeakSet<object>();
let listening = false;

/** Minimal structural type: THREE.WebGLRenderer satisfies it, and tests can fake it. */
export interface DisposableRenderer {
  dispose(): void;
  forceContextLoss?(): void;
}

/**
 * Dispose a renderer and (optionally) lose its WebGL context. Idempotent per renderer for the context loss; safe to
 * call on an already-lost context. Never throws.
 */
export function releaseRendererGpu(renderer: DisposableRenderer, opts: { loseContext?: boolean } = {}): void {
  try { renderer.dispose(); } catch { /* already disposed */ }
  if (!opts.loseContext || lostGl.has(renderer)) return;
  lostGl.add(renderer);
  try { renderer.forceContextLoss?.(); } catch { /* no WEBGL_lose_context */ }
}

/** Lose a raw WebGL context (key-visual warp fallback). Idempotent, never throws. */
export function loseGlContext(gl: WebGLRenderingContext | null | undefined): void {
  if (!gl || lostGl.has(gl)) return;
  lostGl.add(gl);
  try {
    if (gl.isContextLost()) return;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* ignore */ }
}

/** Run every registered releaser once. Each releaser must itself be idempotent. */
export function releaseAllGpu(): void {
  for (const fn of [...releasers]) {
    try { fn(); } catch { /* keep releasing the rest */ }
  }
}

/** pagehide handler: release unless the page is entering the bfcache. Exported for tests. */
export function handlePageHide(e: { persisted?: boolean }): void {
  if (e.persisted) return;
  releaseAllGpu();
}

/** Register a releaser; the pagehide listener is installed lazily, once. Returns an unregister function. */
export function registerGpuReleaser(fn: GpuReleaser): () => void {
  releasers.add(fn);
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('pagehide', handlePageHide);
  }
  return () => { releasers.delete(fn); };
}

/** Test helper: drop all releasers and the listener flag. */
export function __resetGpuReleaseForTests(): void {
  releasers.clear();
  listening = false;
}
