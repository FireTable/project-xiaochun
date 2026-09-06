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
        Audio --> EMAGE[EMAGE Web Worker (ONNX Runtime Web)]
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

- **Model Execution**: Runs the Web-adapted EMAGE model inside a dedicated worker, translating PCM audio streams into continuous 52-bone humanoid pose sequences;
- **Autoregressive Seed Inheritance**:
  When evaluating chunk $i$, the worker absorbs the last 4 latent frames from chunk $i-1$, guaranteeing mathematical continuity across speech segments and eliminating twitching;
- **Gaussian Temporal Smoothing & Damping**:
  Configured in [`src/config.ts`](../src/config.ts):
  - `dampingStiffness = 4.2`: Mechanical inertia damping to prevent rapid jerks;
  - `temporalSmoothRadius = 12`: 12-frame Gaussian convolution filter for gentle, humanlike conversational gesturing.

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
