# VRMEngine & vrmWorker — Main-Thread Rendering Facade and Background Binary Synthesis

> **Core Files**:  
> - [`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) (Main-thread 3D lifecycle orchestrator and render loop facade)  
> - [`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) (Dedicated Web Worker binary assembly and WASM patch engine)  
> - [`src/lib/idb-vrm-cache.ts`](../src/lib/idb-vrm-cache.ts) (L1/L2 2-tier IndexedDB cache persistence layer)  
> - [`src/core/outfitSwap.ts`](../src/core/outfitSwap.ts) (Atomic pose snapshot capture and in-memory pre-restoration)

---

## 1. Architecture & Threading Model

In a browser-native high-performance 3D web application, the main thread operates under an exacting **16.67ms (60 FPS)** frame-time budget. However, downloading models, decompressing zip containers, executing `bspatch` differential synthesis, and copying multi-megabyte `TypedArray`s are heavy CPU/IO operations.

To guarantee sub-second outfit swapping without inducing frame drops or UI hitching, Project XiaoChun adopts a decoupled dual-core architecture: the **Main Rendering Bus (`VRMEngine`)** and the **Background Synthesis Worker (`vrmWorker`)**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Main UI Thread                                   │
│                                                                             │
│   [React 19 / UI] ──(TopHeader Swap Request)──┐                              │
│                                               │                             │
│                                        [VRMEngine.ts]                       │
│                                               │ (Sends URL + SHA metadata)  │
│   ┌───────────────────────────────────────────┼──────────────────────────┐  │
│   │ 3D Render Loop (60 FPS, 16.6ms Strict Order)│                          │  │
│   │  ├─ 1. Motion Pose Evaluation             │                          │  │
│   │  ├─ 2. FootIK Barefoot Sink               ▼                          │  │
│   │  ├─ 3. Smootherstep Crossfade         [ensureBspatchWorker()]        │  │
│   │  ├─ 5. BodyTurn Stepping Locomotion       │                          │  │
│   │  ├─ 7. GazeController LookAt & Blink     │ postMessage(req)         │  │
│   │  ├─ 8. vrm.update() Bones & Physics       │ (Transferable Zero-Copy) │  │
│   │  ├─ 9. VRMBodyMorph 28 Proportions        │                          │  │
│   │  └─ 10. PostFx Bloom & Tone Pipeline      ▼                          │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │ IPC (Web Worker API)
┌───────────────────────────────────────────────┼─────────────────────────────┐
│                    Background Thread (Dedicated Worker: vrmWorker.ts)       │
│                                               │                             │
│   ┌───────────────────────────────────────────▼──────────────────────────┐  │
│   │ Pipeline Stages                                                      │  │
│   │  1. Check L2 Cache (idbGetComposed) ──[Hit]──> Return Instant (10ms)  │  │
│   │  2. [Miss] Check L1 Base Cache / fetch_base (5.9MB .vrmbase)         │  │
│   │  3. fetch_addon (1~4MB .vrmaddon diff payload)                       │  │
│   │  4. fflate.unzipSync decompress patch & target.json                  │  │
│   │  5. bsdiff-wasm executes bspatch differential synthesis              │  │
│   │  6. packRawGLB (Package JSON + BIN Chunks, 4-byte aligned)           │  │
│   │  7. Async write to L1 base & L2 composed cache (idbPutComposed)      │  │
│   │  8. postMessage(composedGLB, [transferable]) to Main Thread          │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. VRMEngine Lifecycle & Subsystem Architecture

[`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) serves as the top-level Facade, aggregating and orchestrating all underlying specialized systems.

### 2.1 The Eight Specialized Subsystems

| Subsystem | Instance / Path | Core Responsibility |
| :--- | :--- | :--- |
| **LineworkWorld** | `this.lineworkWorld` (`./scene/lineworkWorld.ts`) | Procedural sun rays, 19 skyline buildings, ground grid, 5 tree archetypes; supports `linework-light` and `linework-dark` dual themes with device auto-detection. |
| **StudioLighting** | `this.studioLighting` (`./lighting/studioLighting.ts`) | 3-channel studio lighting (dir 1.00 key with 2048 shadow map, hemi 0.95 ambient sky, fill 1.40 backlight contour). |
| **VRMMaterialManager** | `this.materialManager` (`./material/vrmMaterialManager.ts`) | Mesh classification (skin / hair / eyes / clothing), `uMatSaturation` uniform injection, and component visibility toggle. |
| **VRMBodyMorph** | `this.bodyMorph` (`./morph/vrmBodyMorph.ts`) | 28-parameter bone morphing, posterior boundary anchoring, cosine falloff abdominal vertex morphing, and dynamic crown measurement. |
| **GazeController** | `this.gazeController` (`@/motion/gazeController.ts`) | Eye contact, micro-saccades, biological limits (Yaw $\pm 45^\circ$, Pitch $-20^\circ \sim +30^\circ$), and thinking head tilts. |
| **BubbleTracker** | `this.bubbleTracker` (`./ui/bubbleTracker.ts`) | Projects head 3D world coordinates to screen 2D positions; applies 1.5px deadzone smoothing and directly updates DOM Transforms. |
| **UniversalMotion** | `this.motionPipeline` (`@/motion/pipeline/motionPipeline.ts`) | 5-layer blend graph (Layer 0 Idle, Layer 1 Action/Speech, Layer 2 Locomotion), Quintic Smootherstep crossfade. |
| **PostFxPipeline** | `postFxPipeline` (`./postfx/postFxPipeline.ts`) | Anime bloom (UnrealBloomPass with background bypass), tone mapping selection, and single-pass BC/HS color grading. |

### 2.2 The 10-Step Render Loop Order & Delta Clamping

Driven by `requestAnimationFrame`, each frame executes a strict 10-step sequence:

```typescript
// Clock clamp protection: prevents delta blowout when waking background tabs
let delta = this.clock.getDelta();
if (delta > 0.1) delta = 0.016; // Clamped to ~60 FPS single step
```

1. **Step 1 (Motion)**: Evaluates active motion source (Idle / Think / Speech / Universal) into pre-allocated pose buffers;
2. **Step 2 (FootIK Sink)**: Computes barefoot sink (`updateBarefoot`) and updates `scene.position.y` to align with the ground plane;
3. **Step 3 (Transition)**: Evaluates Quintic Smootherstep interpolation ($6t^5 - 15t^4 + 10t^3$);
4. **Step 4 (Sync)**: Non-destructive pose snapshot sampling (`sampleFromVRM`);
5. **Step 5 (BodyTurn)**: Locomotion stepping FSM and critically damped spring yaw tracking;
6. **Step 6 (FootIK Leveling)**: Ground sole leveling and contrapposto weight-shift (yields during stepping);
7. **Step 7 (Gaze)**: Companion eye gaze interpolation, saccades, and natural blinking;
8. **Step 8 (VRM Internal)**: Calls `vrm.update(delta)` to propagate normalized humanoid bones and drive secondary SpringBone physics;
9. **Step 9 (BodyMorph)**: Applies 28-parameter bone scaling and vertex deformation (**never overwrites bone quaternions here!**);
10. **Step 10 (PostFx)**: Renders via `postFxPipeline.render()` when enabled, or straight-through `renderer.render()` when disabled.

### 2.3 Camera Framing & Frustum Adaptation

- **Frustum Adaptation (`computeDefaultCameraPosition`)**:
  Calculates camera distance based on character shot extent (`defaultShotExtent = 1.4m`) and vertical FOV:
  $$\text{distance} = \frac{\text{extent}}{2 \cdot \tan\left(\frac{\text{FOV}}{2}\right)}$$
- **Cinematic Entrance (`cinematicIntro`)**:
  On cold start, initiates camera position at $3.3 \times \text{distance}$ and tweens back via `easeOutCubic` over 1100ms in sync with loading overlay dismissal.

### 2.4 Resource Disposal & Memory Leak Prevention (`dispose`)

When reloading models or unloading the engine:
1. Recursively traverses `scene` to release all mesh `BufferGeometry` instances;
2. Disposes all material textures (`map`, `normalMap`, `roughnessMap`, etc.) via `texture.dispose()`;
3. Calls `vrm.dispose()` and `VRMUtils.deepDispose(vrm.scene)`;
4. Cleans up `PostFxPipeline` intermediate `WebGLRenderTarget`s.

---

## 3. vrmWorker Binary Pipeline & IPC Protocol

[`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) runs isolated inside a Dedicated Web Worker.

### 3.1 Five-Stage Worker Pipeline

```
[fetch_addon]  Fetch target outfit .vrmaddon (contains bin-patch.bin + target.json)
      ↓
[fetch_base]   Fetch base model xiaochun_base.vrmbase if L1 cache misses
      ↓
[unzip]        Invoke fflate.unzipSync to unpack patch binary and metadata
      ↓
[bspatch]      Execute WASM bspatch to synthesize complete binary chunk
      ↓
[pack]         packRawGLB wraps JSON Chunk + BIN Chunk into standard glTF 2.0 GLB
```

### 3.2 glTF 4-Byte Alignment Specification (`packRawGLB`)

glTF 2.0 strictly requires all chunk offsets and data lengths to be **4-byte aligned**. `vrmWorker` guarantees this constraint:

```typescript
function packRawGLB(jsonChunk: Uint8Array, binChunk: Uint8Array): ArrayBuffer {
  // 1. Calculate 4-byte padding
  const jsonPadding = (4 - (jsonChunk.length % 4)) % 4;
  const binPadding = (4 - (binChunk.length % 4)) % 4;
  const jsonPaddedLen = jsonChunk.length + jsonPadding;
  const binPaddedLen = binChunk.length + binPadding;

  // 2. Header (12 bytes) + Chunk 0 JSON (8 + padded) + Chunk 1 BIN (8 + padded)
  const totalByteLength = 12 + 8 + jsonPaddedLen + 8 + binPaddedLen;
  const out = new ArrayBuffer(totalByteLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  // Magic: 0x46546C67 ("glTF"), Version: 2
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalByteLength, true);

  // Chunk 0: JSON (0x4E4F534A "JSON"), padded with trailing space (0x20)
  view.setUint32(12, jsonPaddedLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonChunk, 20);
  for (let i = 0; i < jsonPadding; i++) bytes[20 + jsonChunk.length + i] = 0x20;

  // Chunk 1: BIN (0x004E4942 "BIN\0"), padded with trailing null (0x00)
  const binHeaderOffset = 20 + jsonPaddedLen;
  view.setUint32(binHeaderOffset, binPaddedLen, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  bytes.set(binChunk, binHeaderOffset + 8);
  for (let i = 0; i < binPadding; i++) bytes[binHeaderOffset + 8 + binChunk.length + i] = 0x00;

  return out;
}
```

### 3.3 Inter-Thread IPC Protocol

#### Main Thread $\to$ Worker Request:
```typescript
type ComposeRequest = {
  id: number;
  type: 'compose_outfit';
  baseUrl: string;      // Base model URL (/vrm/xiaochun_base.vrmbase)
  baseSha: string;      // Base model SHA-256 (L1 IDB key)
  addonUrl: string;     // Outfit addon URL (/vrm/addons/xiaochun_*.vrmaddon)
  addonSha: string;     // Outfit addon SHA-256 (L2 composite key)
};
```

#### Worker $\to$ Main Thread Response:
```typescript
// 1. Progress updates (drives UI spinner indicator)
type ComposeProgress = {
  id: number;
  type: 'compose_progress';
  phase: 'fetch_addon' | 'fetch_base' | 'unzip' | 'bspatch' | 'pack';
  pct: number;
};

// 2. Success response (composedGLB transferred via zero-copy)
type ComposeOk = {
  id: number;
  type: 'compose_ok';
  composedGLB: ArrayBuffer;
  elapsedMs: number;
};

// 3. Error response
type ComposeErr = {
  id: number;
  type: 'compose_err';
  error: string;
};
```

#### Console Log Proxying (`proxyConsole`):
Web Worker `console` statements are intercepted and proxied to the main thread console with a standardized `[vrmWorker]` prefix via `type: 'log'` IPC messages.

---

## 4. Two-Tier IndexedDB Caching Architecture (`src/lib/idb-vrm-cache.ts`)

To eliminate redundant network requests and CPU overhead, the client manages a local IndexedDB database `xiaochun-vrm-cache` (Version 2):

```
IndexedDB: "xiaochun-vrm-cache"
├── ObjectStore: "base"      (L1: Cached uncompressed base BIN)
│   └── Key: baseSha         (Value: ArrayBuffer)
│
└── ObjectStore: "composed"  (L2: Cached synthesized complete GLB)
    └── Key: `${baseSha}:${addonSha}` (Value: ArrayBuffer)
```

### 4.1 Cache Resolution Flow

1. **First-Time Outfit Swap**:
   - Query L2 `composed` $\to$ **Miss**;
   - Query L1 `base` $\to$ **Miss**;
   - Download `xiaochun_base.vrmbase` (~5.9 MB) and store into L1;
   - Download target addon (e.g. `xiaochun_maid.vrmaddon`, ~4.1 MB);
   - Perform unzip and WASM `bspatch` synthesis (~400~800ms);
   - Store synthesized GLB into L2 `composed`.
2. **Subsequent Outfit Swap (or Page Reload)**:
   - Query L2 `composed` $\to$ **Hit!**
   - Reads `composedGLB` directly from local disk in **10~30ms**, completely bypassing network requests and WASM diffing.

---

## 5. End-to-End Atomic Swap Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User (TopHeader)
    participant Engine as VRMEngine (Main Thread)
    participant Swap as outfitSwap.ts
    participant Worker as vrmWorker.ts (Background)
    participant IDB as IndexedDB Cache
    participant Loop as Three.js RenderLoop

    User->>Engine: Select outfit (e.g. Maid)
    Engine->>Worker: postMessage(compose_outfit, addonUrl, addonSha)
    Note over Engine,Loop: Old model continues rendering animations seamlessly at 60 FPS
    
    alt L2 Cache Hit
        Worker->>IDB: idbGetComposed(`${baseSha}:${addonSha}`)
        IDB-->>Worker: Return cached GLB ArrayBuffer
    else Cache Miss
        Worker->>IDB: Read/Write L1 Base / Fetch Addon
        Worker->>Worker: fflate unzip + WASM bspatch + packRawGLB
        Worker->>IDB: idbPutComposed(new GLB)
    end

    Worker-->>Engine: postMessage(compose_ok, [composedGLB]) (Zero-Copy)
    
    rect rgb(240, 248, 255)
    Note over Engine,Swap: In-Memory Pre-Restoration Phase (0-Frame T-Pose Elimination)
    Engine->>Swap: captureOutfitSwapState(oldVrm) (Capture rotation, expressions, gaze)
    Engine->>Engine: GLTFLoader parses new GLB (unmounted in scene)
    Engine->>Swap: preRestoreOutfitSwapState(newVrm, snapshot) (Pre-populate bone quaternions)
    Engine->>Engine: Atomic Swap: scene.remove(oldVrm) + scene.add(newVrm)
    Engine->>Swap: postRestoreOutfitSwapState(newVrm, snapshot) (Rebind SpringBones)
    Engine->>Engine: Deep-dispose old model geometry and textures
    end

    Engine-->>User: Swap complete! Motion and expressions continue smoothly
```

---

## 6. Critical Engineering Invariants

1. ❌ **Never run `bsdiff` or `bspatch` on the main thread**:
   WASM diffing blocks the event loop for 200~500ms, causing severe frame drops and audio stuttering. All binary patching must be offloaded to `vrmWorker`.
2. ❌ **Never transfer large ArrayBuffers via structured cloning**:
   Always pass the buffer in the second `Transferable` array parameter (`[composedGLB]`) in `postMessage` to transfer ownership without memory copying.
3. ❌ **Never mount a new model before in-memory pre-restoration**:
   Mounting before restoring bone transforms causes a 1-frame visible T-pose flash. Follow the atomic order: `preRestoreOutfitSwapState` $\to$ `scene.add(newVrm)`.
4. ❌ **Never alter 4-byte padding logic in `packRawGLB`**:
   glTF chunks must strictly conform to 4-byte boundary padding (spaces for JSON, null bytes for BIN), otherwise `GLTFLoader` throws fatal `INVALID_GLTF` errors.
5. ⚠️ **Ensure cache key uniqueness**:
   L2 cache keys must use composite strings `${baseSha}:${addonSha}` to prevent stale reads when base models are updated.
