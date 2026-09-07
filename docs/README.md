# Project XiaoChun Technical Documentation & Agent Navigation Guide

Welcome to the **Project XiaoChun** engineering and architectural documentation repository.
This knowledge base is prepared specifically for developers and future **AI Coding Agents** to provide clear, rigorous mathematical specifications, execution lifecycles, and core architectural rules.

---

## 🗺️ Documentation Architecture & Sitemap

```
docs/
├── README.md                      # [Current Document] Documentation sitemap & agent fast-path index
├── BONE_MORPH.md                  # 28-Parameter orthogonal skeletal decoupling & procedural vertex morphing
├── FOOT_IK.md                     # Analytical two-bone IK, physical ground anchors & contrapposto weight-shift
├── MOTION_PIPELINE.md             # Universal motion pipeline (Layered Graph), APIs & Quintic Smootherstep crossfade
├── ARCHITECTURE_AND_RULES.md      # Render loop lifecycle sequence, wardrobe system & 5 critical agent rules
├── BODY_TURN_AND_GAZE.md          # Critically damped spring yaw, 4-phase stepping state machine & companion gaze
├── CHAT_DIRECTOR.md               # Director scheduler, 30~60 chars slicer, parallel TTS & anti-spoil bubble rules
└── ON_DEVICE_AI.md                # WebLLM (WebGPU) + EMAGE ONNX Worker + Client-side multi-tier IndexedDB memory
```

---

## 🧭 Task-Oriented Fast Path for Coding Agents

When tasked with modifications or refactoring, consult the dedicated technical guide before making code edits:

| Task Objective | Primary Guide | Core Invariants & Rules |
| :--- | :--- | :--- |
| **New motions / Motion jitter / Blending artifacts** | [`MOTION_PIPELINE.md`](MOTION_PIPELINE.md) | Always call `vrmEngine.playMotion`; decouple LookAt via inverse quaternions; avoid naked `stopAllAction` calls. |
| **Foot floating / Shoe-off height / Ground skating** | [`FOOT_IK.md`](FOOT_IK.md) | Anchors operate in world space; `levelFeet` must yield during locomotion; auto-sink driven by `footIK.getSinkOffset()`. |
| **Morph sliders / Mesh distortion / Head shearing** | [`BONE_MORPH.md`](BONE_MORPH.md) | Obey "Bone vs. Soft-Tissue Separation" (`belly` is vertex-only); never overwrite `quaternion` in morph updates. |
| **Camera turning / Stepping legs frozen / Gaze drift** | [`BODY_TURN_AND_GAZE.md`](BODY_TURN_AND_GAZE.md) | Pass strictly `BODY_TURN_BONES` during stepping handoffs; respect biological gaze yaw ($\pm 45^\circ$) and pitch limits. |
| **Wardrobe items / Clothing clipping / Lighting** | [`ARCHITECTURE_AND_RULES.md`](ARCHITECTURE_AND_RULES.md) | Respect VRoid material semantics; modify `src/config.ts` `wardrobe` as the single source of truth. |
| **DevDrawer sections / Slider drag perf / Collapse / Reset broadcast** | [`ARCHITECTURE_AND_RULES.md` §3](ARCHITECTURE_AND_RULES.md#3-devdrawer-architecture) | Per-section state isolation; `onTick` for engine, `onChange` for state+storage only; `liveValueRef` for per-frame display without re-render. |
| **Latency tuning / Voice lag / Speech lip-sync** | [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md) | Maintain 30~60 chars chunking; pre-fetch all TTS chunks in parallel; reveal text only when speaking starts. |
| **Upgrading LLM / Memory optimization / Custom APIs**| [`ON_DEVICE_AI.md`](ON_DEVICE_AI.md) | WebLLM runs in Web Worker; cap short-term turns (default 2) to preserve attention; maintain 100% zero-backend privacy. |

---

## 🚨 The Five Tenets of Truth for All Agents

1. ❌ **Never run `pnpm run build` for routine checks**: Daily verification must use exclusively:
   ```bash
   pnpm exec tsc --noEmit
   ```
2. ❌ **Never overwrite bone `quaternion`s in body morphing**: Rotations belong strictly to the motion and stepping pipelines;
3. ❌ **Never mutate `activePlayer` inside async event handlers**: State machine flow is driven by the render loop;
4. ❌ **Never hardcode avatar heights or world positions**: Always measure dynamically via `bodyMorph.getCurrentHeightCm()`;
5. ⚠️ **Respect the Single Source of Truth**: All global configuration parameters live centralized in [`src/config.ts`](../src/config.ts).
