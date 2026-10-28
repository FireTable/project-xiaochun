# Interactive Scene Flow Development Log

> **Branch**: `feature/interactive-scene-flow`  
> **Baseline Commit**: `524af1c` (v0.1.39)  
> **Start Time**: 2026-10-26 11:30 (GMT+8)  
> **Target Scope**: Immersive full-duplex conversational voice interaction, orchestratable stage directives, and offline reproducible runtime closed-loop.

---

## Milestones & Execution Roadmap

- [x] **Task 1: Full-Duplex Interruption & Dedicated Listening State Machine**
- [ ] **Task 2: Structured Stage Directive Protocol**
- [ ] **Task 3: Pluggable Scenario Sandbox**
- [ ] **Task 4: Offline Mock Replay System & Verification**

---

## Task 1 Iteration Details

### Timeline & Changes
- **11:30 - Branch Initialization**
  - Checked out feature development branch `feature/interactive-scene-flow` from `main` (`524af1c`).
- **11:40 - Full-Duplex Voice Interruption Pipeline Established**
  - `src/stt/sttClient.ts`: Broadcasts `speech_start` event the moment real-time VAD voice activity is detected.
  - `src/core/vrmEngine.ts`: Enhanced `stopSpeaking()`, immediately triggering `chatDirector.stop()` while synchronously hiding overhead chat bubbles and subtitles via `bubbleTracker.hide()`.
  - `src/components/ChatBar.tsx`: Established multimodal listening lifecycle:
    - Input focus (`onFocus`), typing (`onInput`), mic listening start, and VAD speech recognition immediately interrupt character speech and activate the listening state;
    - Sending a message (`handleSend`) or blurring without a draft exits the listening state.
- **12:10 - Architectural Refactor for Listening System**
  - Corrected the preliminary scheme that erroneously mounted listening logic onto `gaze.ts` (constraint layer), eliminating violations of the Single Bone Writer principle.
  - Established proper placement within `src/motion/sources/`, creating an independent Layer-1 motion source `listening.ts` (`ListeningMotionSystem`) decoupled alongside `idle.ts`, `vrma.ts`, and `emage.ts`.
  - `motionPipeline.ts`: Holds `this.listening` as pipeline orchestrator, smoothly sampling into `basePose` in each frame's `tick`, gracefully yielding priority when speech or primary action clips activate.
- **12:35 - Aesthetic Upgrade to Listening Pose (One-Handed Chin-Rest Attentive Gaze)**
  - **Torso**: Center of gravity subtly shifts towards the resting hand, chest pitches forward gently, rising and falling in sync with natural breathing.
  - **Right Arm Kinematic Chain**: Upper arm (`rightUpperArm`) adducts against the chest, forearm (`rightLowerArm`) deeply flexes upward, wrist dorsiflexes, thumb cradles the mandibular base, index finger naturally rests against the cheek, and remaining fingers curl beneath the jawline.
  - **Left Arm**: Inverted VRM bone local Z-axis rotation sign to hang relaxed with a subtle elbow bend at the side.
  - **Head, Neck, and Gaze**: Head tilts gently toward the resting hand; `gaze.ts` listening weight locks eye focus directly onto the user in front of the screen (suppressing daydreaming glances), layered with a subtle playful smile.
- **12:45 - Automated Verification**
  - Authored `src/motion/listening.test.ts` for pose geometry and damping verification; all 153/153 unit tests pass cleanly.
- **12:55 - Ergonomic Separation of "Text Typing" vs. "Voice Speech" Interruption**
  - **Problem Analysis**: The preliminary scheme unconditionally called `stopSpeaking()` on input focus (`onFocus`) or keystrokes (`onInput`). When a user merely focused the input box to compose a thought while listening, the character's speech was rudely cut short.
  - **Ergonomic Solution**:
    1. **Text Composer Stream**:
       - Focusing the input box or typing **does not cut off character speech**, allowing XiaoChun to finish speaking naturally;
       - Once speech finishes (`isSpeaking` returns to `false`) while the user is still in the input field, the avatar smoothly transitions into the listening pose;
       - Only when the user explicitly clicks **Send** (`handleSend`) does the system forcefully interrupt any active speech and submit the new utterance.
    2. **Voice / STT Stream**:
       - Preserves full-duplex conversational immediacy: the moment VAD detects real user voice input (`speech_start`), it immediately interrupts character speech and enters attentive listening.
- **13:05 - Fix Send Button Stuck in Disabled State During Speech**
  - **Root Cause**: `sendMessage()` remained pending throughout audio playback, keeping `isSending` at `true` and permanently disabling the button with `disabled={isSending}` while showing a spinner.
  - **Solution**:
    1. Added `onSpeakingChange` reactive state dispatching in `ChatDirector` and `VRMEngine`;
    2. **With text draft (`hasText`)**: Send button is unlocked and highlighted as an active send arrow (`➤`); clicking or pressing Enter immediately interrupts any ongoing speech and sends the new message;
    3. **Without text draft (`!hasText`)**:
       - While speaking: Button morphs into an elegant "Stop Speech" square icon (`Square`), allowing one-click mute and interruption;
       - While model is thinking: Retains loading spinner (`Loader2`);
       - Idle: Returns to normal inactive state.
- **13:20 - Listening Transition Duration Harmonized with Global MotionPipeline (0.75s Quintic Smootherstep)**
  - **Problem Analysis**: `ListeningMotionSystem` originally used exponential damping (`damp 4.5`), taking only ~0.35s to snap into listening, causing an abrupt arm raise that clashed with the pipeline's 0.75s graceful standard.
  - **Solution**:
    1. Standardized onto `SOURCE_FADE_DURATION = 0.75s` baseline;
    2. Adopted Ken Perlin's quintic smootherstep curve ($S(p) = 6p^5 - 15p^4 + 10p^3$), guaranteeing zero first and second derivatives at both ends;
    3. Added `crossfadeScale` multiplier support, maintaining 100% aesthetic and physical consistency with Thinking and Speaking transitions;
    4. All 153/153 unit tests pass.
- **13:25 - Adaptive [0.75s, 1.00s] Golden Transition Window with 0.75s Floor**
  - **Design Goal**: Uphold 0.75s as the absolute minimum transition floor (never speeding up downward to preserve the graceful anime posture of hair, skirt, and limbs), allowing large pose differences to adaptively expand upward to 1.00s.
  - **Implementation Architecture**:
    1. **Zero-GC Pose Distance Measurement (`PoseBuffer.distanceTo`)**: Weighted sum of 52 bone quaternion angular distances (torso and limbs 1.2x, phalanges 0.4x) plus pelvis displacement evaluation, executing in ~3 microseconds with zero memory allocations;
    2. **Adaptive Mapping Formula (`src/motion/pipeline/adaptiveFade.ts`)**:
       - Absolute minimum floor: `MIN_FADE_DURATION = 0.75s`;
       - Dynamic upward range: `[0.75s, 1.00s]`;
       - Micro-expressions (listening/subtle nodding, diff ≈ 0.1~0.2) $\to$ holds firm at 0.75s ~ 0.80s, preventing jitter;
       - Standard gestures (thinking/speaking, diff ≈ 0.4~0.5) $\to$ ~0.85s graceful flow;
       - Large-span actions (dances/sweeping arms, diff ≈ 0.8~1.0) $\to$ expands comfortably to 0.95s ~ 1.00s;
       - Standby return protection (Action $\to$ Idle): Enforces a strict 0.75s smooth floor to prevent pelvis snap-back;
    3. **Tuning Multiplier**: Connected `crossfadeScale` (default 1.0) to `MotionPipeline` and `ListeningMotionSystem`, exposed via `vrmEngine.setCrossfadeScale()`;
    4. **Automated Verification**: Authored `src/motion/pipeline/adaptiveFade.test.ts`; all 159/159 unit tests pass.
- **13:30 - Eliminate "Send ➔ Loading" Lockout State, Upgrading to Full-Duplex Interruption**
  - **Interaction Insight**: The traditional web form pattern ("Send ➔ Disable Button ➔ Spin Loader") breaks scene immersion and robs the user of the ability to cancel or interrupt.
  - **Implementation**:
    1. Removed `Loader2` locking and `disabled` states from the primary action button;
    2. **Send is Interruptible**: Whenever the system is busy (LLM generation or TTS audio playback), if the input box is empty, the button displays a red/pink "Stop" square (`■`); clicking immediately halts requests and returns to idle;
    3. **Instant Utterance Interruption**: If the user has typed text (`hasText`), the button displays "Send" (`➤`); clicking or pressing Enter immediately interrupts any ongoing speech/action and submits the new prompt.
- **13:45 - Architecture Convergence: SSOT `TurnState` Machine, Eradicating UI Button De-sync**
  - **Root Cause Investigation**:
    1. Frontend `ChatBar.tsx` relied on local `isSending` state; repeated submissions or early returns caused `finally` blocks to prematurely zero out `isSending`, displaying an idle send button while the character was still actively thinking (overhead bubble "Let me think..." + thinking posture);
    2. `ChatDirector` lacked external reactive thinking state dispatching; post-interruption asynchronous LLM milestones could inadvertently re-spawn an already dismissed bubble.
  - **Architectural Solution**:
    1. **SSOT Turn State (`TurnState = 'idle' | 'listening' | 'thinking' | 'speaking'`)**:
       - Defined `turnState` in `ChatDirector` lifecycle, strictly governing `handoff() ➔ thinking ➔ speaking ➔ idle` in `say()`;
       - `VRMEngine` reactively dispatches changes outward via `onTurnStateChange`;
    2. **Zombie Bubble Callback Guard**:
       - Wrapped `status` inside `guardedStatus` in `say()`; once an utterance is superseded or interrupted, lingering LLM async callbacks are strictly forbidden from reviving the bubble;
    3. **UI Decoupling**:
       - Completely removed redundant local `isSending` from `ChatBar.tsx`; `isBusy` is evaluated purely as `turnState !== 'idle'`, ensuring the stop button (`■`) is 100% reliably shown whenever the avatar is active.
- **14:25 - Listening Pose Evolution: 4-Dimensional Demure & Attentive Posture**
  - **Design Context**: The earlier "one-handed chin rest with playful smirk" posture could be visually interpreted as bored or flippant, and folding the forearm against the face caused clipping with the 11 SpringBone hair strands on the cheek. Refactored into a gentle, demure listening stance.
  - **4-Dimensional Visual System Implementation**:
    1. **Hand Posture (Hands Folded Behind Back)**: Both arms sweep gracefully back and down (`leftUpperArm` / `rightUpperArm` extension $X \approx +0.25$ rad), forearms gently bend, and hands lightly clasp near the lower back/sacrum. Leaves the chest and face unobstructed, completely preventing hair and sleeve clipping;
    2. **Torso & Posture (Forward Lean + Slow Drift)**: `spine` and `chest` lean forward by $\sim 3^\circ$ (reducing psychological distance with the speaker), yawing $\sim 2.5^\circ$ toward the interlocutor, layered with an 18-second ultra-low-frequency center-of-gravity micro-drift to eliminate rigidity;
    3. **Head & Neck (Subtle Tilt + Aizuchi Nodding FSM)**: Tilts $6.3^\circ$ to express warmth; injects a **2.85s cyclical Aizuchi nodding state machine** (nod down 0.25s ➔ hold 0.15s ➔ slow rebound 0.45s ➔ pause 2.0s), creating an organic sense of empathetic listening;
    4. **Facial Expression (Serene Attentiveness)**: Replaced `happy: 0.20` smirk with relaxed brow and eyes (`relaxed: 0.18`) and gently closed lips (`happy: 0.04`); daydreaming gaze frequency suppressed to 8% (92% steady gaze on user).
  - **Automated Verification**: Refactored `src/motion/listening.test.ts` to test forward lean, clasped arms, and aizuchi nodding dynamics; all 160/160 unit tests pass.
- **21:30 - High-Fidelity Human Mocap (`dm_124`) Listening Asset Ingestion**
  - Upgraded standby listening to high-precision human mocap asset `dm_124.vrma` (demure forward-leaning stance with hands gently resting over abdomen);
  - Implemented real-time physical chest-arm contact limiting in `src/core/contact/bustArmContact.ts`; all 178/178 unit tests pass.
- **22:30~23:05 - Mocap Slicing Seamless Boundary Sewing, Hips Y Native Height Conservation & SpringBone Flailing Remediation**
  - **Symptom**: Looping the listening motion caused XiaoChun's long dress skirt to violently inflate and flap continuously like a parachute.
  - **Root Causes**:
    1. `slice-vrma.mjs` erroneously injected a negative `hipsYOffset`. Depressing the pelvis forced the waistband directly into the thigh collision spheres (`UpperLeg` colliders encroaching into `Hips` skirt mesh), triggering explosive physics repulsion;
    2. Slicing script hard-cut frames at 6.6s and 12.4s, creating a single-frame boundary angle pop of up to $13.3^\circ$ (`Upper_Leg_R`); the mechanical impulse shockwave on every 5.75s loop cycle destabilized the skirt springs;
    3. The original mocap actor swayed laterally by nearly 26cm, forcing the thighs outward into the skirt volume.
  - **Engineering Solution**:
    1. **Conserve Native Pelvis Height**: Set `hipsYOffset = 0.0`, grounding soles while restoring safe clearance between the waistband and thigh colliders;
    2. **Quintic Seamless Loop Blend**: Applied $6t^5 - 15t^4 + 10t^3$ over the final 18 frames to smoothly retarget back to frame 0, reducing seam position delta to $0.0000\text{cm}$ and angular delta to $< 0.038^\circ$;
    3. **Center & Damp Lateral Sway**: Damped 26cm lateral translation down to natural $\pm 1.5\text{cm}$ micro-sway;
    4. **Idempotent Asset Toolchain**: Preserved pristine raw assets in `public/vrm/motion/raw/listening.vrma`, rebaked sliced assets, and bumped catalog cache query to `?v=10`;
  - **Verification**: Under collision simulation, peak skirt velocity dropped from $> 2150\text{ cm/s}$ to $0.21\text{ cm/s}$, completely eradicating skirt flailing; all 178/178 unit tests pass green.

- **2026-10-28 21:15 - Story Mode Interactive Scene Flow, Dialogue Persistence & ChatBubble Modernization**
  - **Interactive Scene Preview & Confirmation Flow**:
    - Guarded `change_scene` without `nextBeatId` in `StoryPlayer.tsx` (`handleSelectChoice`) as an in-beat preview (matching `swap_outfit`);
    - Eliminated accidental triggers of dynamic AI speech generators during scene exploration, keeping users within the beat and preserving the primary confirmation button ("就决定去这里了");
    - Reinforced `selected: true` active highlight state across consecutive previews in `storyEngine.ts`.
  - **Story Dialogue Persistence (Post-Speech Subtitle Stability)**:
    - Root cause: speech termination called `bubbleTracker.hide()`, setting `state.visible = false` and prematurely unmounting static dialogue bars;
    - Decoupled `isSpeaking` (driving pulsating audio bars) from text visibility in `ChatBubble.tsx` (formerly `HeadBubble.tsx`);
    - Character lines persist stably throughout the beat (`currentSpeechText = bubble.speechText || currentBeat?.actor.speechText`), allowing users to freely adjust camera angles, preview scenes, and try on outfits without dialogue flashing away.
  - **Non-Occluding Responsive Layout**:
    - Mobile: Choices group occupies full width (`w-full`), strictly stacked on top of the bottom cinematic bar within a flex container (`max-h-[55vh]`), ensuring 0 overlap;
    - PC: Choices column is positioned on the right and elevated (`bottom-28 sm:bottom-32`), strictly higher than the centered bottom dialogue bar (`bottom-6`), with `z-50` preventing collision and click blocking.
  - **Component Renaming & Modernization (`HeadBubble` ➔ `ChatBubble`)**:
    - Refactored `src/components/HeadBubble.tsx` to `src/components/ChatBubble.tsx` with `ChatBubble` and `ChatBubbleProps`;
    - Maintained full backward compatibility through re-export alias proxy in `HeadBubble.tsx`;
    - Upgraded all invocation sites (`App.tsx`, `EmbedApp.tsx`, `StoryPlayer.tsx`) and DOM selectors (`bubbleTracker.ts`);
    - Added unit test suite `src/components/__tests__/chatBubbleDialogue.test.ts`. 100% test suites green (47/47 suites, 375/375 tests).

- **2026-10-28 21:40 - Choice Card Hover Boundary De-clipping & Audible Speech Start Gating**
  - **Choice Card Hover Truncation Fix**:
    - Root cause: Choice cards utilized `hover:-translate-y-0.5` (-2px translation) and outer box shadows; in scrollable choice containers with `overflow-y-auto` and `p-0`, hovering the top card translated it beyond the top clipping boundary, cutting off its top border and glow;
    - Solution:
      1. Eliminated `-translate-y-0.5` in `StoryChoiceCard.tsx` across `list` and `media` variants, replacing vertical displacement with subtle, elegant border illumination and box shadow glows (`hover:border-[#f3d09a]/60 hover:shadow-[0_4px_20px_rgba(243,208,154,0.3)]`);
      2. In `StoryPlayer.tsx`, added `p-1.5 -m-1.5` padding breathing room to the choices scroll containers on both PC (`max-h-[calc(100vh-150px)]`) and Mobile (`max-h-[55vh]`), guaranteeing zero clipping of card outlines, borders, and rings.
  - **Audible Speech Start Gating for ChatBubble**:
    - Root cause: `StoryPlayer.tsx` previously latched `hasSpokenInBeat = true` via `storyState.isSpeaking`. Because `storyEngine.ts` sets `isSpeaking = true` synchronously at the start of TTS network synthesis (before audio chunk download and playback), the subtitle bar popped up prematurely 1~2 seconds before any voice came out of the speakers;
    - Solution:
      1. Strictly gated `hasSpokenInBeat` in `StoryPlayer.tsx` to latch only upon actual audio playback start (`bubble.statusKey === 'speaking' && Boolean(bubble.speechText)`) or explicit TTS offline fallback (`statusKey === 'ttsUnavailable'`);
      2. Refined `ChatBubble.tsx` cinematic mode (`variant === 'cinematic'`) to suppress rendering when text is empty during intermediate pre-audio states (`tts`, `emage`), rendering only when dialogue text is present, history is expanded, or active LLM thinking is underway;
      3. Preserved subtitle persistence after audio ends, ensuring lines remain readable throughout the beat while choices are pending;
    - Verified: Added contract tests in `src/components/__tests__/chatBubbleDialogue.test.ts`; 47/47 test suites pass (377/377 tests).
