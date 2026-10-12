# Immersive Onboarding Tour

This document is written for developers and AI Coding Agents. It specifies the design philosophy, state-machine architecture, stage choreography, and persistence mechanisms of the **Galgame-style immersive onboarding tour** in Project XiaoChun.

---

## 1. Core Architecture & Design Philosophy

The onboarding tour is designed to let first-time visitors familiarize themselves with XiaoChun's core capabilities in an atmosphere full of immersive, interactive charm. The system rests on three pillars:

1. **Schema-driven guided state machine (`onboardingSchema.ts`)**
   - All steps (including the pre-greeting entry `step_greet`) are declared through a single `createOnboardingSteps()` factory. Every step is driven by two pieces — a `dialogues` (lines list) and a `getChoices(ctx)` (dynamic option factory) — with no step-specific branching in the rendering component.
2. **Dedicated "void realm" stage (`src/core/scene/void/voidWorld.ts`)**
   - Strips away all extraneous world content: a solid deep-space background color (`0x0b0f19`, matching the engine's scene init) and nothing else. No ground, no props, and deliberately **no aura gradient texture** — the 3D stardust field is the only source of depth. Putting the character and the crystalline cards front and center.
3. **Synchronized audiovisual driver (`OnboardingTour.tsx`)**
   - Every line is wired through `vrmEngine.speakText()`, triggering local Edge-TTS streaming audio, RMS mouth-shape matching, and EMAGE full-body speaking gestures, while a live speech bubble above the character renders each line as it is delivered.

---

## 2. State Machine Flow & Step Definitions

| Step Index | Step ID | Core task & interaction form | Advance gating |
| :--- | :--- | :--- | :--- |
| **—** | `step_greet` | **Pre-greeting entry**: No dialogue; a single crystalline card "👋 诶？你是？" appears immediately, awaiting an active user click. The click doubles as the **browser AudioContext unlock gesture**, solving the silent-audio problem caused by the default `suspended` state on mobile / cold start. | Transitions to `step_intro` once the card is clicked. Not counted in progress numbering (not included in the TOUR_STEPS array). |
| **1** | `step_intro` | Character greets the user, introduces themselves, and asks for language preference (中文 / English / 日本語). | Wait for the line to finish, then three language cards appear. Clicking switches i18n and advances to the next step. |
| **2** | `step_tutorial_choice` | Asks whether the user wants the operation walkthrough (guided tutorial vs. free exploration). | Two-card choice. Clicking "skip" plays a farewell line and exits safely. |
| **3** | `step_camera_intro` | Camera 3D control task list (rotate the character, tilt the angle, scroll to zoom). | Tracks the user's drag in real time. Once all three tasks are checked off, the "Next" crystal card lights up; an "Skip exploration" option remains available. |
| **4** | `step_scene_choice` | Scene pick (Sunny Beach, Daytime Lineart, Nightfall Lineart, Transparent Background). | Media cards with previews; click instantly hot-swaps the scene and transitions to the next stage. |
| **5** | `step_outfit_choice` | Outfit try-on (Evening Gown, Qipao, Maid, Sailor Swimsuit). | Real-time atomic outfit swap. Trying things on does not interrupt speech or the guided flow. |
| **6** | `step_brain_choice` | Cognition core explanation (on-device WebLLM WebGPU ultra-fast experience vs. external custom API). | If the external API is chosen, the configuration window automatically pops open after the guided tour. |
| **7** | `step_finale` | Finale celebration and official launch. | The character thanks the user, the onboarding UI fades out, the camera resets to its default framing, and the completion flag is persisted. |

---

## 3. AudioContext Unlock Mechanism

On mobile browsers — and on some desktop cold-start scenarios — the Web Audio API's `AudioContext` starts in the `suspended` state. It must be unlocked by calling `ctx.resume()` from inside a **valid user gesture** (click/touch) handler.

`step_greet` is purpose-built as this pre-interaction gate:

```ts
// onboardingSchema.ts — step_greet.getChoices
onSelect: () => {
  try {
    const ctx = (vrmEngine as any).chatDirector?.ctx as AudioContext | undefined;
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  } catch { }
  ctx.goToStep('step_intro');
},
```

Because `step_greet`'s `dialogues: []`, the speech effect inside `OnboardingTour` skips it entirely (`dialogues.length === 0` → `isSpeaking = false`), so the card appears instantly without relying on any special state or component-level branching.

---

## 4. i18n Conventions

All onboarding-related strings are aggregated under the `onboarding.` prefix across three language files (`zh-CN.ts` / `en.ts` / `ja.ts`) and must be kept in sync. The full list of currently used keys:

| Key | Purpose |
| :--- | :--- |
| `onboarding.skip` | Skip button text in the top-right |
| `onboarding.skipTourTooltip` | Skip button tooltip (contains `{{current}}` / `{{total}}`) |
| `onboarding.revisitTutorial` | Settings entry: re-run tour button text |
| `onboarding.greetPrompt` | `step_greet` primary card title |
| `onboarding.greetPromptSub` | `step_greet` primary card subtitle |
| `onboarding.galIntro1` | `step_intro` line |
| `onboarding.galTutorialAsk` | `step_tutorial_choice` line |
| `onboarding.galChoiceStartTutorial` / `galChoiceStartTutSub` | Tutorial option |
| `onboarding.galChoiceSkipTutorial` / `galChoiceSkipTutSub` | Skip-tutorial option |
| `onboarding.galSkipEarly` | Early-exit line |
| `onboarding.galCameraAsk` | `step_camera_intro` line |
| `onboarding.cameraTaskListTitle` | Camera task panel title |
| `onboarding.cameraHoldPrefix` / `cameraHoldPrefixMobile` | Modifier-key prefix text |
| `onboarding.cameraDirectAction` | No-extra-key hint |
| `onboarding.mobileScreen` | Mobile-screen reference term |
| `onboarding.cameraTask*` / `camera*Sub` | Each camera task name and description |
| `onboarding.cameraDoneNext` / `cameraDoneNextSub` | Continue button after camera tasks |
| `onboarding.cameraSkipNext` / `cameraSkipNextSub` | Skip-camera-tasks button |
| `onboarding.galSceneAsk` | `step_scene_choice` line |
| `onboarding.scene*` | Scene names and subtitles |
| `onboarding.galOutfitAsk` | `step_outfit_choice` line |
| `onboarding.outfit*` | Outfit names and subtitles |
| `onboarding.galBrainAsk` | `step_brain_choice` line |
| `onboarding.brain*` | AI model option names and descriptions |
| `onboarding.galFinale` | `step_finale` line |
| `onboarding.startJourney` / `startJourneySub` | Finale launch button |

---

## 5. Liquid Glass Aesthetic

- **No jarring modal popups**: Avoid traditional black overlay modals. Use subtly blurred translucent crystalline panels (`backdrop-blur-md bg-white/[0.08]`).
- **Dynamic breathing light**: On hover/select, cards emit a soft theme-pink radial glow (`box-shadow: 0 0 24px rgba(234, 131, 119, 0.45)`).
- **HUD keycap visuals**: Long modifier keys (`Space` / `Cmd` / `Ctrl`) are rendered as skeuomorphic semi-transparent keycaps, precisely centered against their icons.
- **Seamless progress pill**: A borderless crystalline skip pill anchored top-right shows live progress (`1/7 跳过`) and lets the user exit any time. Note that `step_greet` is not counted toward progress; numbering starts at `1/7` only after the user clicks the greeting card.

---

## 6. Persistence & State Management

- **Completion flag**: As soon as the user finishes or skips the tour, immediately write `localStorage.setItem('xiaochun_onboarded', 'true')`.
- **Cold start & HMR**: When the root route `src/routes/index.tsx` mounts, check the flag; if absent and the environment is not an iframe embed, launch `OnboardingTour`.
- **Re-run & reset**: Re-test the entire flow at any time by running `localStorage.removeItem('xiaochun_onboarded'); location.reload()` in the console.