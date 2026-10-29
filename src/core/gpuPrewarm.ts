// Time-sliced GPU prewarm helpers (pure, no three import, so they are unit-testable in node).

/** Per-slice main-thread budget before yielding back to the event loop (a 60 Hz frame is ~16 ms). */
export const PREWARM_BUDGET_MS = 8;

/**
 * Extensions three queries lazily on texture upload / first render. Each gl.getExtension is a synchronous round trip
 * to the GPU process, so we touch them one per task up front (cached by WebGLExtensions) instead of letting the
 * first one stall inside an initTexture sequence.
 */
export const PREWARM_EXTENSIONS = [
  'OES_texture_float_linear',
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'EXT_texture_filter_anisotropic',
  'EXT_texture_norm16',
  'KHR_parallel_shader_compile',
  'WEBGL_multi_draw',
] as const;

export interface ExtensionSource { get(name: string): unknown }

export interface SliceOptions {
  budgetMs?: number;
  now?: () => number;
  yieldFn: () => Promise<void>;
  /** Stop early (renderer replaced / released). */
  aborted?: () => boolean;
  /** Called with the name and duration of any single step slower than `slowMs`. */
  onSlow?: (label: string, ms: number) => void;
  slowMs?: number;
}

/** Touch each extension once, yielding between them so no more than one sync GPU round trip runs per task. */
export async function warmExtensions(ext: ExtensionSource, names: readonly string[], o: SliceOptions): Promise<void> {
  const now = o.now ?? (() => performance.now());
  for (const name of names) {
    if (o.aborted?.()) return;
    const t0 = now();
    try { ext.get(name); } catch { /* unsupported / lost context */ }
    const dt = now() - t0;
    if (o.onSlow && dt >= (o.slowMs ?? 50)) o.onSlow(name, dt);
    await o.yieldFn();
  }
}

/**
 * Run `init` over `items`, yielding whenever the current slice has used `budgetMs`. Returns slice stats.
 * One item is never split: a single slow upload still blocks, but never together with its neighbours.
 */
export async function runTimeSliced<T>(
  items: Iterable<T>,
  init: (item: T) => void,
  o: SliceOptions,
): Promise<{ done: number; yields: number }> {
  const now = o.now ?? (() => performance.now());
  const budget = o.budgetMs ?? PREWARM_BUDGET_MS;
  let since = now();
  let done = 0;
  let yields = 0;
  for (const item of items) {
    if (o.aborted?.()) break;
    const t0 = now();
    try { init(item); } catch { /* first render uploads it instead */ }
    done++;
    const t1 = now();
    if (o.onSlow && t1 - t0 >= (o.slowMs ?? 50)) o.onSlow('texture', t1 - t0);
    if (t1 - since >= budget) {
      yields++;
      await o.yieldFn();
      since = now();
    }
  }
  return { done, yields };
}
