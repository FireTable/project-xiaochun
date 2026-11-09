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
- **Thin Main-Thread Client**: the main thread never imports `@mlc-ai/web-llm` (a ~6.5 MB file that cannot be tree-shaken). `webllmThinClient.ts` (`ThinMLCEngine`) speaks the web-llm worker protocol (pinned to 0.2.84; `webllmThinClient.test.ts` fails on a version change), and the model list comes from the worker via our `xcModelList` message. See [`PERFORMANCE.md` §2.1](PERFORMANCE.md);
- **Tiered Device Adaptation**:
  - **High-Tier Default**: `MiniCPM5-2B-q4f16_1-MLC` (OpenBMB 2B parameter edge model on WebGPU, striking optimal balance of conversational depth, bilingual proficiency, and low latency);
  - **Low-VRAM Fallback**: Automatically downgrades to `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` on mobile or memory-constrained GPUs;
- **Multi-Round KV Cache Reuse**: Eliminates unconditional chat resets; ensures exact message prefix alignment between turns so WebLLM's internal `compareConversationObject` hits cache reuse, cutting subsequent turn Prefill time from ~1.5s to <50ms;
- **Background Shader JIT Warmup** (opt-in): `preloadWebLLM({ warmup: true })` runs a 1-token dry run after the engine is ready, precompiling WebGPU WGSL pipelines so the user's first query does not pay the ~500ms–1s JIT cost. **Defaults to `warmup: false`** — background preload only downloads weights; today the opt-in fires when the user explicitly picks the on-device model in the onboarding tour (`step_brain_choice`). Without it the first turn compiles shaders inline;
- **Streaming Execution & Thinking Isolation**: Uses asynchronous streaming iterators (`stream: true`) to yield GPU execution windows to Three.js every token; shields `<think>...</think>` tokens in real-time to prevent thought leakage into audio or UI;
- **Cache API Persistence**: Weights cache directly via the browser's Cache API upon initial download, enabling instant startup on subsequent visits.

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
