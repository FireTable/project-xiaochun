# Project XiaoChun Technical Documentation & Agent Navigation Guide

Welcome to the **Project XiaoChun** engineering and architectural documentation repository.
This knowledge base is prepared specifically for developers and future **AI Coding Agents** to provide clear, rigorous mathematical specifications, execution lifecycles, and core architectural rules.

---

## 🗺️ Documentation Architecture & Sitemap

```
docs/
├── README.md                      # [Current Document] Documentation sitemap & agent fast-path index
├── INTERACTION_AND_CONTROLS.md    # User interaction, shortcuts, mouse gestures & platform difference guide
├── HYBRID_DESKTOP_APP.md          # Tauri 2.x hybrid desktop companion, 60Hz alpha bitmask click-through, in-app updater
├── PROTOCOL.md                    # Custom URL scheme (`xiaochun://`) IPC specification, actions, and limits
├── EMBED.md                       # iframe embed (`/embed` + npm `@firetable/project-xiaochun`): postMessage protocol, host audio, headers, SDK, React, styling, Lighthouse, publishing (Trusted Publishing)
├── AGENT_SKILL.md                 # Agent skill specification for autonomous agents controlling XiaoChun
├── INTERACTION_AND_3D_GUIDES.md   # 3D holographic guides (Turn, Pitch, CameraY), shared gesture core (src/core/gesture), shared guide style (guideStyle.ts), wind aerodynamics & pure quaternion morph
├── BONE_MORPH.md                  # 28-Parameter orthogonal skeletal decoupling & procedural vertex morphing
├── FOOT_IK.md                     # Analytical two-bone IK, physical ground anchors & contrapposto weight-shift
├── MOTION_PIPELINE.md             # Universal motion pipeline (Layered Graph), APIs & Quintic Smootherstep crossfade
├── ARCHITECTURE_AND_RULES.md      # Render loop lifecycle sequence, wardrobe system & 5 critical agent rules
├── BODY_TURN_AND_GAZE.md          # Critically damped spring yaw, 4-phase stepping state machine & companion gaze
├── CHAT_DIRECTOR.md               # Director scheduler, 30~60 chars slicer, parallel TTS & anti-spoil bubble rules
├── ON_DEVICE_AI.md                # WebLLM (WebGPU) + EMAGE ONNX Worker + Client-side multi-tier IndexedDB memory
├── STT.md                         # SenseVoice Small int8 ChatBar dictation (energy VAD + ORT Worker)
├── PERFORMANCE.md                 # (Chinese) v0.1.14 performance & size notes: EMAGE slimming (191.35 → 71.59 MB), parallel download, lazy web-llm, opt-in crossOriginIsolated; measured numbers, rejected options, unmeasured items
├── EMAGE_MODEL.md                 # EMAGE tip status + Worker PCM→chunk flowchart; limits (wasm/INT8, no WebGPU-EMAGE)
│   (pack) ../packages/emage-onnx/  # Offline EMAGE ONNX slim/quantize/optimize toolchain (slim step, INT8 Conv, layer removal, graph optimization, host-side seed): README.md / README-CN.md
├── OUTFIT_SWAP.md                 # Full-outfit swap (Delta .vrmaddon packages, 2-tier IDB caching, 0-frame pop-in)
├── POSTFX.md                      # Anime post-processing pipeline (UnrealBloom background bypass, ToneMapping & ColorGrading)
├── VRM_BUILD_WORKFLOW.md          # Offline VRM toolchain (.vrmbase + .vrmaddon extraction, oxipng & deterministic builds)
├── VRM_ENGINE_AND_WORKER.md       # Core architecture (Main VRMEngine orchestrator + background vrmWorker WASM synthesis)
└── MTOON.md                       # MToon NPR material extensions, uniforms & part presets
```

---

## 🧭 Task-Oriented Fast Path for Coding Agents

When tasked with modifications or refactoring, consult the dedicated technical guide before making code edits:

| Task Objective | Primary Guide | Core Invariants & Rules |
| :--- | :--- | :--- |
| **User interactions / Hotkeys / Platform differences / Gestures** | [`INTERACTION_AND_CONTROLS.md`](INTERACTION_AND_CONTROLS.md) | Long-press adjust mode (all platforms); Cmd/Ctrl instant 3D; Tauri short-drag window; 60Hz alpha click-through + guide passthrough capture. |
| **Desktop companion / Tauri 2.x / Alpha click-through / Window state / In-app updater** | [`HYBRID_DESKTOP_APP.md`](HYBRID_DESKTOP_APP.md) | Canvas alpha bitmask + DOM capture; window-state; corner handles; opacity pet chrome; official updater + opener; signing secrets. |
| **Embedding XiaoChun in third-party pages / iframe / postMessage / npm SDK / frame-ancestors** | [`EMBED.md`](EMBED.md) | `/embed` is a slim entry (no chrome, heavy models lazy); protocol constants live in `packages/project-xiaochun/src/protocol.ts` (single source); strict origin + MessageChannel after handshake; main site stays `X-Frame-Options: DENY`, `/embed` uses CSP `frame-ancestors`; SDK version is locked to the desktop app (`pnpm bump:patch|minor|major` bumps both; one `v*` tag triggers release-tauri + publish-npm in parallel; npm publishing uses Trusted Publishing/OIDC, no `NPM_TOKEN`); host-supplied audio (`speakAudio` / `xc.audio`, streaming), React bindings (`/react`), CSS variables / `::part` styling, and the `xc.*` ↔ `xiaochun://` mapping. |
| **External app control / URL scheme / IPC / speakText** | [`PROTOCOL.md`](PROTOCOL.md) | Custom `xiaochun://` protocol; safe query string limits; file paths for long text; single-instance; `audioUrl` (now implemented) and the `xc.*` ↔ `xiaochun://` transport mapping (§6). |
| **Autonomous AI Agent Skill / Tool Calling / Automation** | [`AGENT_SKILL.md`](AGENT_SKILL.md) | Tool schema definition; OS detection checks; short vs long text strategy; companion alerts. |
| **3D Holographic Guides / Camera elevation / Wind dynamics** | [`INTERACTION_AND_3D_GUIDES.md`](INTERACTION_AND_3D_GUIDES.md) | Long-press / modifier arming; shared gesture state machine for Tauri + `/embed` (`src/core/gesture`); TurnGuide3D; PitchGuide3D; CameraYGuide3D; shared white-UI style + soft shadow (`guideStyle.ts`); skirt wind / spring-bone tuning; passthrough capture while guides up. |
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
| **MToon material extensions / Shading presets / Skin moisture** | [`MTOON.md`](MTOON.md) | MToon NPR extensions + `materialType: MToonMaterial`; configure via `APP_CONFIG.mtoon.parts`. |
| **Latency tuning / Voice lag / Speech lip-sync** | [`CHAT_DIRECTOR.md`](CHAT_DIRECTOR.md) | Maintain 30~60 chars chunking; pre-fetch TTS in parallel; reveal text when speaking; EMAGE `motion_chunk` + A/V hold; **orchestration flowchart** in doc. |
| **EMAGE download size / ONNX slimming, quantization and optimization / emage_step outputs / host-side seed** | [`../packages/emage-onnx/README.md`](../packages/emage-onnx/README.md) | Slim step outputs only `cls_*`; `seed` is rebuilt in `emageSeed.ts` from the full-window argmax via `vq_*_idx` + `postprocess` with the jaw 6D fixed to identity (zero face gives a wrong jaw); `vq_*`/`postprocess` calls are serialized by `withVqLock`; keep `vqFace` disabled with the slim step; `emage-onnx-export` is read-only here. |
| **Upgrading LLM / Memory optimization / Custom APIs**| [`ON_DEVICE_AI.md`](ON_DEVICE_AI.md) | WebLLM runs in Web Worker (may use WebGPU); cap short-term turns (default 2); 100% zero-backend privacy for local path. |
| **ChatBar mic / SenseVoice STT / VAD / Worker** | [`STT.md`](STT.md) | Energy VAD auto-segment + SenseVoice int8 Worker; CDN `…/stt/…-2024-07-17`; no Zipformer; keep listening, insert at caret. |
| **Performance / bundle size / EMAGE download size / what was measured vs not** | [`PERFORMANCE.md`](PERFORMANCE.md) | Only measured numbers; EMAGE set 71.59 MB at `cdn.firetable.tech/xiaochun/emage/` (cache `emage-models-v2`); web-llm lazy chunk; `crossOriginIsolated` is opt-in; unmeasured items are listed. |
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

