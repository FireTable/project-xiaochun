# Outfit Swap Architecture & Seamless State Migration Specification

> **Status**: Production Standard (Plan A + Delta Packaging deployed).  
> **Core Source Files**:  
> - [`src/core/outfitSwap.ts`](../src/core/outfitSwap.ts) (Atomic pose snapshot capture and in-memory pre-restoration)  
> - [`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) (Lifecycle orchestrator and render loop facade)  
> - [`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) (Dedicated Web Worker WASM bspatch binary synthesis)  
> - [`src/lib/idb-vrm-cache.ts`](../src/lib/idb-vrm-cache.ts) (L1 base & L2 composed IndexedDB caching layer)  
> - [`src/components/TopHeader.tsx`](../src/components/TopHeader.tsx) (Main UI outfit switcher with persistent state)

---

## 1. Objectives & Performance Goals

The primary goal of the Outfit Swap subsystem is to enable instantaneous, seamless switching between full character wardrobe assets without tearing down the application, restarting the camera, or breaking the current emotional performance.

### Key Requirements:
1. **Motion Continuity**: Active motion sources (VRMA, EMAGE streaming speech, universal animations) continue uninterrupted (via seek/resume rather than reverting to rest pose);
2. **Facial & Gaze Retention**: Facial blendshapes, pupil gaze targets, and micro-saccades persist across model swaps;
3. **Secondary Dynamics Stability**: SpringBone physics buffers are preserved via best-effort position/velocity inheritance;
4. **Zero-Frame T-Pose & Zero Blank Flash**: The old model continues rendering at full 60 FPS while the new model is synthesized and parsed in the background; the new model is fully pre-posed in memory before being atomically swapped into the scene in a single frame;
5. **Camera Invariance**: Never triggers `fitCamera` or cinematic intro animations during in-session swaps;
6. **Sub-100ms Latency on Repeat Visits**: Leverages client-side IndexedDB caching to achieve instant 10~30ms swaps on subsequent outfit selections.

---

## 2. Geometric Divergence Analysis (Why Simple Mesh Swapping Fails)

Rigorous vertex and bounding box measurements between the naked base model (`xiaochun_base.vrm`) and clothed variants (`xiaochun_default.vrm`, etc.) revealed critical structural constraints:

| Metric | Base Model (Naked) | Clothed Variant | Delta | Cause |
| :--- | :---: | :---: | :---: | :--- |
| **Total Height (bbox Y)** | 1.575 m | 1.627 m | **+5.2 cm** | Sole thickness and sock geometry |
| **Total Centroid Y** | 0.950 m | 1.041 m | **+9.1 cm** | Clothing mesh volume expansion |
| **Head Centroid Y** | 1.474 m | 1.526 m | **+5.2 cm** | Elevated by foot sole thickness |
| **Hips Bounding Box Width**| 0.252 m | 0.310 m | **+23%** | Skirt/pants volumetric clearance |
| **Chest Bounding Box Width**| 0.226 m | 0.300 m | **+33%** | Jacket and fabric clearance |
| **Head Bounding Box** | $0.180 \times 0.234\text{ m}$ | $0.180 \times 0.234\text{ m}$ | **Identical** | Shared head/hair topology |

### Key Architectural Takeaways:
1. **Skeletal Hierarchy Compatibility**: Humanoid bone definitions and rest matrices are 100% identical; animations remain fully compatible across models;
2. **Mesh Incompatibility**: Attaching raw clothes `SkinnedMesh` primitives to a naked base causes severe Z-fighting, skin penetration, and ankle misalignment due to baked dress-up deformations in VRoid Studio;
3. **Conclusion**: Clean wardrobe swapping necessitates **complete GLB asset swapping combined with atomic in-memory state migration**, backed by delta diff distribution to keep payloads small.

---

## 3. Delta Packaging & Two-Tier Caching Architecture

To eliminate the network bottleneck of downloading multiple 20MB+ VRM models, Project XiaoChun implements a binary delta distribution pipeline:

```
[Source Models] xiaochun_base.vrm + official addons
                      ↓ (scripts/build-vrm/workflow.mjs)
[Distributed]   xiaochun_base.vrmbase (5.9MB) + 5 *.vrmaddon packages (0.7~4.7MB)
                      ↓ (Network savings: ~65% overall payload reduction)
[Web Worker]    WASM bspatch (src/core/vrmWorker.ts, 0 main-thread blocking)
                      ↓
[L1 Cache]      IndexedDB "base" store (Key: baseSha)
[L2 Cache]      IndexedDB "composed" store (Key: `${baseSha}:${addonSha}`, 10ms repeat swaps)
```

### 3.1 Dedicated Web Worker (`src/core/vrmWorker.ts`)
To keep the Three.js render loop running at a solid 60 FPS during downloads, decompressions, and diff calculations, the entire binary synthesis pipeline runs in a Dedicated Web Worker:
1. **Worker Offloading**: Network fetches (`fetch`), zip decompression (`fflate`), and binary reconstruction (`bsdiff-wasm`) execute off the main thread;
2. **Transferable Zero-Copy Return**: The synthesized `composedGLB` `ArrayBuffer` is passed to the main thread via `postMessage(ok, [composedGLB])`, avoiding multi-megabyte structured clone allocations;
3. **glTF 2.0 Compliance**: `packRawGLB` enforces strict 4-byte boundary padding (spaces for JSON, null bytes for binary data).

### 3.2 Two-Tier IndexedDB Caching (`src/lib/idb-vrm-cache.ts`)
- **L1 Store (`base`)**: Caches the decompressed base binary indexed by `baseSha`. The 5.9MB base is fetched only once per client device.
- **L2 Store (`composed`)**: Caches the fully synthesized GLB binary indexed by `${baseSha}:${addonSha}`. Subsequent swaps to previously loaded outfits resolve in **10~30ms from local disk**.

---

## 4. Atomic Swap & Zero-Frame T-Pose Elimination Protocol

### The Zero-Frame Pop-in Problem
Traditional model reloads stop current animations when download begins (causing a 150ms character freeze) and mount the new model before restoring poses, causing a visible 1-frame T-pose flash on screen.

### The Project XiaoChun Solution:
```
[Worker Synthesis] ──> [GLTFLoader Parse] ──> [preRestore in Memory] ──> [Atomic Swap & Deep Dispose]
   (Old model runs)      (Unmounted model)     (All bones posed)         (1-frame scene.remove/add)
```

1. **Continuous Old-Model Playback**: The active avatar continues playing animations and physics during download and WASM diffing;
2. **Deferred State Capture**: At the exact microsecond the new GLB buffer finishes parsing, `captureOutfitSwapState(oldVrm)` snapshots bone quaternions, `hips.position`, expression weights, and LookAt vectors;
3. **In-Memory Pre-Restoration**: Before adding the new model to the Three.js scene, `preRestoreOutfitSwapState(newVrm, snapshot)` pre-populates all 52 humanoid bone transforms in memory;
4. **Atomic Scene Swap**: In a single execution microtask, the engine removes the old avatar and adds the pre-posed new avatar (`scene.remove(old) + scene.add(new)`), followed by SpringBone reconnection (`postRestoreOutfitSwapState`).

### State Restoration Fidelity Matrix:
| State Dimension | Quality & Implementation Strategy |
| :--- | :--- |
| **VRMA Animation** | ✅ In-memory buffer reuse; resumes seamlessly via `seek(currentTime)` |
| **EMAGE Streaming Speech** | ✅ Pauses motion buffer without resetting seeds; rebinds to new armature and resumes |
| **Universal Animations** | ✅ Supports URL and ArrayBuffer channels with exact timestamp restoration |
| **Blendshapes / Facial** | ✅ Re-applies all active morph target values in memory before mounting |
| **Gaze & Eye Contact** | ✅ Focus target and micro-saccades (`glanceOffset`) restored instantly |
| **Scene Yaw Heading** | ✅ Preserves `sceneYaw` compensation, preventing sudden rotation snaps |
| **Visual Smoothness** | ✅ 0-frame T-pose flash, zero character blank-out, camera remains locked |
| **Secondary Load Latency** | ⚡ **10~30ms** via IndexedDB L2 composed cache |

---

## 5. Official Outfits Roster

1. **`xiaochun_default`** (Techwear, loaded by default)
2. **`xiaochun_cheongsam`** (Cheongsam)
3. **`xiaochun_bikini`** (Bikini)
4. **`xiaochun_maid`** (Maid)
5. **`xiaochun_swimsuit`** (One-piece swimsuit)

---

## 6. Architecture Decision Records (ADR)

| Date | Decision | Rationale |
| :--- | :--- | :--- |
| 2026-09-08 | Rejected direct mesh attachment | Baked VRoid mesh expansions cause severe clipping and seam holes |
| 2026-09-09 | Adopted full-model reloading | Guarantees pristine materials, shadows, and anatomical contours |
| 2026-09-10 | Implemented state migration (Plan A) | Snapshots and restores animations, expressions, and gaze across swaps |
| 2026-09-11 | Standardized `.vrmbase` + `.vrmaddon` | 65% payload reduction; 2-tier IndexedDB cache eliminates repeat downloads |
| 2026-09-12 | Eliminated 1-frame T-pose flash | Pre-restores bone transforms in memory prior to scene mounting; offloads diffing to `vrmWorker` |
