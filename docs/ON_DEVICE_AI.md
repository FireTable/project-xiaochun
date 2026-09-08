# On-Device AI Runtime & Multi-Tier Memory Pipeline

> **Core Files**:  
> - [`src/llm/webLLMProvider.ts`](../src/llm/webLLMProvider.ts) (WebGPU WebWorker LLM inference engine)  
> - [`src/motion/emageWorker.ts`](../src/motion/emageWorker.ts) & [`emagePlayer.ts`](../src/motion/emagePlayer.ts) (ONNX full-body gesture generation)  
> - [`src/memory/`](../src/memory/) (Pure client-side IndexedDB multi-tier memory system)  
> - [`src/llm/chatWorkflow.ts`](../src/llm/chatWorkflow.ts) (Multi-provider dispatcher & workflow coordinator)

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

## 2. WebLLM Client-Side Inference (WebGPU + Web Worker)

### 2.1 Engine Architecture & Thread Isolation
- **Non-Blocking Render Thread**: WebLLM runs inside an isolated Web Worker via `@mlc-ai/web-llm` (`CreateWebWorkerMLCEngine`). Prompt prefill and autoregressive decoding never block Three.js 60 FPS animation;
- **Tiered Device Adaptation**:
  - **High-Tier Default**: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (strikes an optimal balance of conversational charm, roleplay depth, and low latency);
  - **Low-VRAM Fallback**: Automatically downgrades to `0.5B` on mobile or memory-constrained GPUs;
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

## 4. Multi-Tier IndexedDB Memory System

Located in [`src/memory/`](../src/memory/), all context resides in the client IndexedDB database `xiaochun-memory`:

```
IndexedDB: xiaochun-memory
├── store: turns (Recent dialog turns) -> { user, assistant, ts }
└── store: entities (Extracted user profile) -> { nickname, hobbies, relationship... }
```

### 4.1 Memory Retrieval & Injection Lifecycle

1. **Entity Extraction (`extract.ts`)**:
   Post-turn regex parsers extract user persona details (name, preferences, relationship nuance) into `entities`;
2. **Device-Adaptive Short-Term Window (`inject.ts`)**:
   Small models (0.5B ~ 1.5B) degrade quickly under lengthy contexts. The system caps short-term history (default 2 turns), preventing repetition, persona drift, and prefill delays;
3. **System Prompt Hydration (`applyRecall`)**:
   Entities format cleanly into the system prompt, while conversational history injects via standard ChatML messages (`[{system}, {user}, {assistant}, ...]`).

---

## 5. Cross-Device Data Portability (Encrypted Sync)

To preserve privacy without locking data to a single browser:
- "Cross-Device Sync" exports all memories and custom providers into an AES-GCM encrypted string;
- Users paste the token directly into their target device without intermediary servers.
