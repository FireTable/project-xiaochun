/**
 * A/B switches for the loading-time performance work. Flip a value and reload; each one is independent.
 */
export const PERF_FLAGS = {
  /** Hero key-visual warp renders in a Web Worker via OffscreenCanvas (falls back to the main thread if unsupported). */
  warpInWorker: true,
  /** Main scene: compile shaders with renderer.compileAsync (KHR_parallel_shader_compile) and yield between VRM setup steps. */
  asyncSceneInit: true,
  /** LoadingOverlay is rendered once by the index route (survives the App mount); App drives it via loadingStore. */
  singleMountOverlay: true,
  /** Create the chat AudioContext during the loading overlay (its ~150 ms constructor otherwise hits mid-chat). */
  prewarmAudioContext: true,
  /** Memoise heavy always-mounted panels (DevDrawer) so App re-renders skip them. */
  memoHeavyPanels: true,
  /** WebLLM prefill chunk size in tokens (0 = model default, typically 1024). Smaller = less GPU contention at send. */
  llmPrefillChunk: 0, // OFF: unverified with the cs1k MiniCPM5 build and not needed (0 send-time gaps measured)
  /** Outfit swap: prewarm the new model's textures / programs before the swap frame (old model keeps animating). */
  asyncOutfitSwap: true,
  /** Precompile beach3d (hidden) before a live switch to it; the old scene keeps rendering meanwhile. */
  prewarmSceneSwitch: true,
  /** Main thread talks to the LLM worker through webllmThinClient.ts; @mlc-ai/web-llm (~6.5 MB) loads only in the worker. */
  thinLLMClient: true,
} as const;
