import type { LoadingState } from '@/core/vrmEngine';

/**
 * Loading-progress store, outside React state of App.
 *
 * vrmEngine reports progress many times per second. Feeding that into App's useState re-rendered the whole App
 * (scene canvas host, header, dialogs ...) plus the overlay on every report: 70–150 ms tasks in dev that froze the
 * hero warp. The store coalesces updates (whole percent, ≤ 10 Hz, immediate for active / subtitle changes) and only
 * the overlay subscribes (useSyncExternalStore). App keeps just `active`.
 */
type Listener = () => void;

export const DEFAULT_LOADING_STATE: LoadingState = { active: true, subtitleKey: 'parsingModel', progress: 0 };
const MIN_INTERVAL_MS = 100;

let current: LoadingState = DEFAULT_LOADING_STATE;
let pending: LoadingState | null = null;
let lastFlush = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

const norm = (s: LoadingState): LoadingState => ({ ...s, progress: Math.round(Math.min(100, Math.max(0, s.progress || 0))) });
const same = (a: LoadingState, b: LoadingState) =>
  a.active === b.active && a.progress === b.progress && a.subtitleKey === b.subtitleKey &&
  JSON.stringify(a.subtitleVars ?? null) === JSON.stringify(b.subtitleVars ?? null);

function flush(): void {
  timer = null;
  if (!pending) return;
  const next = pending;
  pending = null;
  lastFlush = Date.now();
  if (same(next, current)) return;
  current = next;
  listeners.forEach((l) => l());
}

let breakStartHandler: (() => void) | null = null;

export const loadingStore = {
  /** App registers what to do when the overlay starts its exit (single-mount overlay has no App props). */
  setBreakStartHandler(fn: (() => void) | null): void { breakStartHandler = fn; },
  breakStart(): void { breakStartHandler?.(); },
  get: (): LoadingState => current,
  getServer: (): LoadingState => DEFAULT_LOADING_STATE,
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** Set immediately (initial state, no listeners notified unless changed). */
  init(s: LoadingState): void { current = norm(s); },
  set(raw: LoadingState): void {
    const s = norm(raw);
    pending = s;
    const urgent = s.active !== current.active || s.subtitleKey !== current.subtitleKey;
    const wait = MIN_INTERVAL_MS - (Date.now() - lastFlush);
    if (urgent || wait <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, wait);
    }
  },
};
