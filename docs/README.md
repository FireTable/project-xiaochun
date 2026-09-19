# Project XiaoChun Technical Documentation & Agent Navigation Guide

Welcome to the **Project XiaoChun** engineering and architectural documentation repository.
This knowledge base is prepared specifically for developers and future **AI Coding Agents** to provide clear, rigorous mathematical specifications, execution lifecycles, and core architectural rules.

---

## 🗺️ Documentation Architecture & Sitemap

```
docs/
├── README.md                      # [Current Document] Documentation sitemap & agent fast-path index
├── INTERACTION_AND_CONTROLS.md    # User interaction, shortcuts, mouse gestures & platform difference guide
├── HYBRID_DESKTOP_APP.md          # Tauri 2.x hybrid desktop companion architecture, 60Hz alpha bitmask click-through
├── PROTOCOL.md                    # Custom URL scheme (`xiaochun://`) IPC specification, actions, and limits
├── AGENT_SKILL.md                 # Agent skill specification for autonomous agents controlling XiaoChun
├── INTERACTION_AND_3D_GUIDES.md   # 3D holographic guides (Turn, Pitch, CameraY), wind aerodynamics & pure quaternion morph
├── BONE_MORPH.md                  # 28-Parameter orthogonal skeletal decoupling & procedural vertex morphing
├── FOOT_IK.md                     # Analytical two-bone IK, physical ground anchors & contrapposto weight-shift
├── MOTION_PIPELINE.md             # Universal motion pipeline (Layered Graph), APIs & Quintic Smootherstep crossfade
├── ARCHITECTURE_AND_RULES.md      # Render loop lifecycle sequence, wardrobe system & 5 critical agent rules
├── BODY_TURN_AND_GAZE.md          # Critically damped spring yaw, 4-phase stepping state machine & companion gaze
├── CHAT_DIRECTOR.md               # Director scheduler, 30~60 chars slicer, parallel TTS & anti-spoil bubble rules
├── ON_DEVICE_AI.md                # WebLLM (WebGPU) + EMAGE ONNX Worker + Client-side multi-tier IndexedDB memory
├── EMAGE_MODEL.md                 # EMAGE tip status + Worker PCM→chunk flowchart; limits (wasm/INT8, no WebGPU-EMAGE)
├── OUTFIT_SWAP.md                 # Full-outfit swap (Delta .vrmaddon packages, 2-tier IDB caching, 0-frame pop-in)
├── POSTFX.md                      # Anime post-processing pipeline (UnrealBloom background bypass, ToneMapping & ColorGrading)
├── VRM_BUILD_WORKFLOW.md          # Offline VRM toolchain (.vrmbase + .vrmaddon extraction, oxipng & deterministic builds)
└── VRM_ENGINE_AND_WORKER.md       # Core architecture (Main VRMEngine orchestrator + background vrmWorker WASM synthesis)
```

---

## 🧭 Task-Oriented Fast Path for Coding Agents

When tasked with modifications or refactoring, consult the dedicated technical guide before making code edits:

| Task Objective | Primary Guide | Core Invariants & Rules |
| :--- | :--- | :--- |
| **User interactions / Hotkeys / Platform differences / Gestures** | [`INTERACTION_AND_CONTROLS.md`](INTERACTION_AND_CONTROLS.md) | Long-press adjust mode (all platforms); Cmd/Ctrl instant 3D; Tauri short-drag window; 60Hz alpha click-through + guide passthrough capture. |
| **Desktop companion / Tauri 2.x / Alpha click-through / Window state** | [`HYBRID_DESKTOP_APP.md`](HYBRID_DESKTOP_APP.md) | 60Hz alpha bitmask pass-through; window-state position/size; corner handles; deferred unmount. |
| **External app control / URL scheme / IPC / speakText** | [`PROTOCOL.md`](PROTOCOL.md) | Custom `xiaochun://` protocol; safe query string limits; file paths for long text; single-instance. |
| **Autonomous AI Agent Skill / Tool Calling / Automation** | [`AGENT_SKILL.md`](AGENT_SKILL.md) | Tool schema definition; OS detection checks; short vs long text strategy; companion alerts. |
| **3D Holographic Guides / Camera elevation / Wind dynamics** | [`INTERACTION_AND_3D_GUIDES.md`](INTERACTION_AND_3D_GUIDES.md) | Long-press / modifier arming; TurnGuide3D; PitchGuide3D; CameraYGuide3D; passthrough capture while guides up. |
| **VRMEngine facade / vrmWorker IPC / 2-tier IDB / Threading model** | [`VRM_ENGINE_AND_WORKER.md`](VRM_ENGINE_AND_WORKER.md) | Transferable ArrayBuffer zero-copy; 4-byte packRawGLB alignment; L1 base + L2 composed IDB keys; 0-freeze 60 FPS. |
| **New motions / Motion jitter / Blending artifacts** | [`MOTION_PIPELINE.md`](MOTION_PIPELINE.md) | Always `playMotion`; Quintic 0.75s; FootIK+Gaze on draft then `composeLayeredSmooth`; invert LookAt on `finalPose` snapshots. |
| **Foot floating / Shoe-off height / Ground skating** | [`FOOT_IK.md`](FOOT_IK.md) | Solve on draft VRM; fade `footIkMix`; `anchorToCurrentFeet` on speech start; `levelFeet` yields while stepping. |
| **Morph sliders / Mesh distortion / Head shearing** | [`BONE_MORPH.md`](BONE_MORPH.md) | Obey "Bone vs. Soft-Tissue Separation" (`belly` is vertex-only); never overwrite `quaternion` in morph updates. |
| **Camera turning / Stepping legs frozen / Gaze drift** | [`BODY_TURN_AND_GAZE.md`](BODY_TURN_AND_GAZE.md) | Overlay `LEGS_MASK` only (no spine yaw); gaze yaw $\pm 45^\circ$; bubble/ruler share `getHeadTopWorldPosition`. |
| **Wardrobe items / Clothing clipping / Lighting** | [`ARCHITECTURE_AND_RULES.md`](ARCHITECTURE_AND_RULES.md) | Respect VRoid material semantics; modify `src/config.ts` `wardrobe` as the single source of truth. |
| **DevDrawer sections / Slider drag perf / Collapse / Reset broadcast** | [`ARCHITECTURE_AND_RULES.md` §3](ARCHITECTURE_AND_RULES.md#3-devdrawer-architecture) | Per-section state isolation; `onTick` for engine, `onChange` for state+storage only; `liveValueRef` for per-frame display without re-render. |
| **Full-outfit swap / Delta addons / IDB cache / Swap sequence** | [`OUTFIT_SWAP.md`](OUTFIT_SWAP.md) | `.vrmbase` + `.vrmaddon` (Worker bspatch); 2-tier IDB; pre-restore pose in memory before atomic swap; 0-frame pop-in. |
| **Post-processing / Bloom fog / ToneMapping / Color grading** | [`POSTFX.md`](POSTFX.md) | Filter white background in LuminosityHighPass; use Linear ToneMapping for anime skin; zero-overhead bypass when disabled. |
| **Offline VRM build / Addon extraction / Model compression** | [`VRM_BUILD_WORKFLOW.md`](VRM_BUILD_WORKFLOW.md) | Run `node scripts/build-vrm/workflow.mjs`; check SHA-256 idempotency; fixed zip mtime UTC. |
| **Latency tuning / Voice lag / Speech lip-sync** | [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md) | Maintain 30~60 chars chunking; pre-fetch TTS in parallel; reveal text when speaking; EMAGE `motion_chunk` + A/V hold; **orchestration flowchart** in doc. |
| **Upgrading LLM / Memory optimization / Custom APIs**| [`ON_DEVICE_AI.md`](ON_DEVICE_AI.md) | WebLLM runs in Web Worker (may use WebGPU); cap short-term turns (default 2); 100% zero-backend privacy for local path. |
| **EMAGE EP / INT8 / WebGPU myths / hop & seams** | [`EMAGE_MODEL.md`](EMAGE_MODEL.md) | EMAGE = **wasm + INT8 only**; T=64; `emage.motion`; **Worker flowchart**; no fake ms. |

---

## 🚨 The Six Tenets of Truth for All Agents

1. ❌ **Never run `pnpm run build` for routine checks**: Daily verification must use exclusively:
   ```bash
   pnpm exec tsc --noEmit
   ```
2. ❌ **Never overwrite bone `quaternion`s in body morphing**: Rotations belong strictly to the motion and stepping pipelines;
3. ❌ **Never invent motion flags for the render loop**: `selectLiveMotionSource` inside `pipeline.tick()` picks the writer; ChatDirector only play/stop;
4. ❌ **Never hardcode avatar heights or world positions**: Always measure dynamically via `bodyMorph.getCurrentHeightCm()`;
5. ⚠️ **Respect the Single Source of Truth**: All global configuration parameters live centralized in [`src/config.ts`](../src/config.ts);
6. ❌ **Never branch motion generators for VRM 0.x vs 1.0**: All motion generators author strictly in VRM 1.0 coordinates ($+Z$ facing); coordinate translation is encapsulated at the pipeline boundary in `PoseBuffer`.

