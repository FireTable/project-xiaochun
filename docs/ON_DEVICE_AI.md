# On-Device AI Runtime & Multi-Tier Memory Pipeline

> **Core Files**:  
> - [`src/llm/webLLMProvider.ts`](../src/llm/webLLMProvider.ts) (WebGPU WebWorker LLM inference engine)  
> - [`src/motion/sources/emageWorker.ts`](../src/motion/sources/emageWorker.ts) & [`emage.ts`](../src/motion/sources/emage.ts) (ONNX full-body gesture generation; `copyToPoseBuffer`)  
> - [`src/memory/`](../src/memory/) (Pure client-side IndexedDB multi-tier memory system)  
> - [`src/llm/chatWorkflow.ts`](../src/llm/chatWorkflow.ts) (Multi-provider dispatcher & workflow coordinator)
> - [`src/stt/`](../src/stt/) (Stream ASR ChatBar dictation — see [`STT.md`](STT.md))

---

## 1. Architectural Philosophy: Zero Backend Privacy

Project XiaoChun is built on a **100% browser-native** paradigm.
Inference for reasoning (LLM), bodily animation (EMAGE), and persistence (IndexedDB) runs entirely within the client's browser sandbox:

```mermaid
graph LR
    subgraph Browser Sandbox [Client Browser Sandbox (100% Local)]
        User[User Prompt] --> Memory[IndexedDB Context Retrieval]
        Memory --> WebLLM[WebLLM (WebGPU Inference)]
        WebLLM --> Text[Streaming Text]
        Text --> TTS[Edge-TTS Stream Pre-fetch]
        TTS --> Audio[PCM Audio Stream]
        Audio --> EMAGE[EMAGE Worker (ORT wasm + INT8, T=64)]
        EMAGE --> Pose[52-Bone Pose Sequence]
        Pose --> VRM[VRM 3D Rendering]
    end
```

---

## 1.1 ChatBar On-Device STT (Stream ASR)

Microphone dictation uses **`@firetable/stream-asr`** (WASM SIMD, single-pass streaming with neural VAD) in its own Worker, plus acoustic bleed gating. Model chunks load from CDN (`APP_CONFIG.stt.modelUrl`), WASM from `/wasm`. Details, UX states, and agent invariants: [`STT.md`](STT.md).

---

## 2. WebLLM Client-Side Inference (WebGPU + Web Worker)

### 2.1 Engine Architecture & Thread Isolation
- **Non-Blocking Render Thread**: WebLLM runs inside an isolated Web Worker (`src/llm/llmWorker.ts`, `WebWorkerMLCEngineHandler`). Prompt prefill and autoregressive decoding never block Three.js 60 FPS animation;
- **Thin Main-Thread Client & Workspace-Patched Runtime (`@firetable/web-llm` + `@firetable/web-runtime`)**:
  - The main thread never imports `@mlc-ai/web-llm` (a ~6.4 MB bundle that cannot be tree-shaken). [`src/llm/webllmThinClient.ts`](../src/llm/webllmThinClient.ts) (`ThinMLCEngine`) speaks the web-llm worker protocol (pinned to `0.2.88`, including `streamId` multiplexing and `completionStreamReturn` early-abort lock release; `webllmThinClient.test.ts` fails on a version change), plus `xcModelList` and `xcSetFramePacing`;
  - [`packages/web-runtime/`](../packages/web-runtime/) (`@firetable/web-runtime@0.28.0-dev2`, overriding `@mlc-ai/web-runtime`) and [`packages/web-llm/`](../packages/web-llm/) (`@firetable/web-llm@0.2.88`, overriding `@mlc-ai/web-llm`) implement **Device-Tier & Closed-Loop Cooperative WebGPU Frame Pacing** (`DESKTOP_WEBGPU_FRAME_PACING` vs `MOBILE_WEBGPU_FRAME_PACING` selected automatically by `resolveAdaptiveFramePacing` in `webLLMProvider.ts` from `detectGpuDeviceProfile()`, switching to `enabled: false` when `document.visibilityState === 'hidden'`). Weight upload, KV-cache bulk allocation, multi-submodule WGSL shader compilation, SigLIP2 ViT image encoding, and LLM prefill/decode up to `Qwen3-8B` (`5.7 GB`) share the browser's single GPU queue smoothly with foreground 60 FPS Three.js WebGL2 rendering. Empirical benchmarks (`0.5B`–`8B`) and roofline analysis: [`PERFORMANCE.md` §2.2](PERFORMANCE.md);
- **Tiered Device Adaptation & Multimodal Vision**:
  - **High-Tier Default**: `MiniCPM5-2B-q4f16_1-MLC` (OpenBMB 2B parameter edge model on WebGPU, striking optimal balance of conversational depth, bilingual proficiency, and low latency; `@firetable/web-runtime` + `@firetable/web-llm` transparently run both legacy `0.2.84` and modern `0.2.88` `mlc.model-package` WASM ABIs);
  - **Multimodal Vision Option (`VISION_LLM_MODEL` · Built-in `4x` High-Res Runtime & Adaptive `<slice>` Tiling)**:
    - `MiniCPM-V-4.7-1B-q4f16_1-MLC` ships its compiled `downsample_mode = "4x"` WebGPU runtime and manifest built-in under `public/wasm/MiniCPM-V-4.7-1B-q4f16_1-4x-8378eafa-*` (`256` visual tokens per `448×448` tile instead of upstream `16x` `64` tokens), while matching `parameter_schema_id` (`sha256:35686906...`) 1:1 with `m070122/MiniCPM-V-4.7-1B-q4f16_1-MLC` so zero weight shards need re-downloading (`1.54 GB`);
    - `@firetable/web-llm` (`computeSlicedGrid` + `getSlicedRGBTilesFromURL` + `LLMChatPipeline.getArtifactPrefillChunks`) automatically slices wide, tall, and HD images (`1024×503` → `1×2`, `2200×550` → `1×4`, `750×2250` → `3×1`, `1920×1080` → `2×3` desktop / `1×2` mobile, `image_url.detail?: "auto" | "low" | "high"`) into `1` overview + `rows×cols` `<slice>...</slice>` tiles, yielding between every tile's `embed_image` pass and auto-capping slices to fit remaining `context_window_size`;
  - **Model-Gated Vision UI (`ChatBar` + `visionDropBus`)**: `ChatBar` exposes `#chatAttachImage`, composer/window image drag-and-drop (distinct from `.vrm` outfit drops in `App.tsx`), and clipboard screenshot paste (`Cmd/Ctrl + V`) strictly when `isVisionModelId()` matches the active WebLLM or Custom OpenAI-compatible model, preserving lossless PNG sharpness up to `1792px` max edge (`≤3 MB`, falling back to `#ffffff`-backed `0.92` JPEG if larger, up to 4 attachments);
  - **Low-VRAM Fallback**: Automatically downgrades to `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` on mobile or memory-constrained GPUs (automatically stripping `image_url` parts if falling back from a vision request);
- **Multi-Round KV Cache Reuse**: Eliminates unconditional chat resets; ensures exact message prefix alignment between turns so WebLLM's internal `compareConversationObject` hits cache reuse, cutting subsequent turn Prefill time from ~1.5s to <50ms;
- **Background Shader JIT Warmup** (opt-in): `preloadWebLLM({ warmup: true })` runs a `max_tokens: 2` dry run after the engine is ready (covering both `prefill` and `decodeStep`, plus a `1x1` PNG `artifactImageAdapter` pass on vision models), pre-specializing driver ISA pipelines and TVM memory pools. **Defaults to `warmup: false`** — background preload already prebuilds all WGSL compute pipelines asynchronously across every TVM WebGPU sub-module during `reload()`;
- **Streaming Execution & Thinking Isolation**: Uses asynchronous streaming iterators (`stream: true`) to yield GPU execution windows to Three.js every token; shields `<think>...</think>` tokens in real-time to prevent thought leakage into audio or UI;
- **Cache Storage Persistence**: Weights stream directly through the browser's native Cache Storage API (`cacheBackend: 'cache'`, falling back to `'indexeddb'` only where `caches` is unavailable), avoiding 64 MB `ArrayBuffer` structured-clone spikes during shard ingestion.

### 2.2 Custom Provider Bridge
Besides local WebLLM execution, [`src/llm/customProvider/`](../src/llm/customProvider/) supports connecting external OpenAI-compatible endpoints:
- Local network servers: Ollama, vLLM, LM Studio, LocalAI;
- Cloud endpoints: DeepSeek, OpenAI, Claude, MiniMax;
- Activating a custom provider bypasses WebLLM preloading, saving 1–2 GB VRAM.

---

## 3. EMAGE Full-Body Gesture Generation (ONNX Runtime Web)

- **Execution provider**: **`wasm` only** + **INT8** (`useInt8`). **Does not use WebGPU** (int64 tensors; E3-① closed — see [`EMAGE_MODEL.md` §2](EMAGE_MODEL.md#2-why-emage-stays-on-wasm-e3--closed) for the investigation context). LLM WebGPU ≠ EMAGE.
- **Model Execution**: Dedicated Worker translates PCM into humanoid pose sequences; windows are fixed **T=64**.
- **Streaming `motion_chunk` + A/V sync**: Each successful `runStep` posts a transferable chunk for TTFA; first visible motion waits for TTS audio start.
- **P0b isolation**: COOP/COEP `credentialless` enables SAB / wasm threads when `crossOriginIsolated`.
- **Autoregressive Seed Inheritance**: Last-4-frame latent seed carryover across windows/segments.
- **Config**: Intensities, hop (`advanceFrames` 60..64), seams, and damping live under `APP_CONFIG.emage.motion`. `vqFace` / `vqGlobal` disabled by default.
- **Full status & limits**: [`EMAGE_MODEL.md`](EMAGE_MODEL.md) (no fabricated ms SLAs).

---

## 4. Multi-Tier Client Cognitive Memory System (`@firetable/client-memory`)

Located in [`packages/client-memory/`](../packages/client-memory/) and [`src/memory/`](../src/memory/), all context resides strictly in the client IndexedDB database `client-memory-db`:

```
IndexedDB: client-memory-db
├── store: turns      (Recent short-term dialog turns) -> { user, assistant, ts, summarized }
├── store: profile    (User identity & preference facts) -> { nickname, traits, facts, relationshipStage }
├── store: episodes   (Long-term narrative diary entries) -> { title, summary, entities, importance, recallCount }
└── store: lorebooks  (SillyTavern compatible knowledge base) -> { keys, constant, order, depth, content }
```

### 4.1 Memory Retrieval & Cognitive Ingestion Lifecycle

1. **Heuristic Fact & Persona Extraction (`IntentExtractor`)**:
   Post-turn regex parsers extract user identity, occupation, location, and likes/dislikes into the user profile with zero GPU overhead.
2. **Conflict Resolution & Cap (`ConflictResolver`)**:
   Single-value fields overwrite cleanly, preference facts are normalized, and profile facts are capped at a maximum of 60 items.
3. **Zero-GPU Episodic Consolidation (`EpisodicConsolidator`)**:
   Turns exceeding the short-term working window are consolidated into narrative episodic memory cards with entity tagging and importance rating.
4. **Stanford 3D Cognitive Retrieval (`scorer.ts` + `BM25Index`)**:
   Episodes are ranked by recency (exponential half-life decay, default 7 days), importance, and BM25 relevance score.
5. **SillyTavern (酒馆) Lorebook Knowledge Matching (`LorebookMatcher`)**:
   Keyword-triggered and constant worldbook entries are dynamically injected for rich conversational background.
6. **KV-Cache Deterministic Context Assembly (`ContextAssembler`)**:
   Memory components are assembled with deterministic prefix stability (`System Prompt -> Profile Facts -> Lorebooks -> Episodes -> Short-term Turns`), maximizing WebLLM KV-cache reuse and eliminating expensive prefill latency.

> 📖 **Full Specification & Architecture**: See [`CLIENT_MEMORY.md`](CLIENT_MEMORY.md) for detailed formulas, schemas, lock safety, and UI interaction specs.

---

## 5. Cross-Device Data Portability (Encrypted Sync)

To preserve privacy without locking data to a single browser:
- "Cross-Device Sync" exports all memories and custom providers into an AES-GCM encrypted string;
- Users paste the token directly into their target device without intermediary servers.
