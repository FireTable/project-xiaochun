# Story Director (Story Mode Scripts, Cinematics & Audio)

> **Core Files**:
> - [`src/story/schema.ts`](../src/story/schema.ts) (zod schema: every field a script can use)
> - [`src/story/storyEngine.ts`](../src/story/storyEngine.ts) (`StoryDirectorEngine`: beat lifecycle, choices, interruption, auto-advance, transitions)
> - [`src/story/localize.ts`](../src/story/localize.ts) / [`src/story/transitions.ts`](../src/story/transitions.ts) (text resolution, transition timings)
> - [`src/story/audioDirector.ts`](../src/story/audioDirector.ts) (procedural BGM, ambience, SFX, ducking)
> - [`src/core/scene/cameraDirector.ts`](../src/core/scene/cameraDirector.ts) + [`src/core/wind/windForce.ts`](../src/core/wind/windForce.ts) (camera moves, gust wind)
> - [`src/components/story/`](../src/components/story) (`StoryPlayer`, `StoryCinematicOverlay`, choice cards)
> - [`src/story/prologueStory.ts`](../src/story/prologueStory.ts) (Act 0 "Prologue: Meeting XiaoChun": the reference script that uses every feature below)

A **script** is a graph of **beats**. A beat is one staged moment: camera, cinematics (letterbox / transition / grading / intertitle), actor (motion, expression, spoken line), audio, and then either a set of **choices**, free-text input, or an automatic jump to the next beat.

---

## 1. Beat lifecycle

`StoryDirectorEngine.goToBeat(id)` runs these phases. Every `await` is guarded by an execution sequence number, so entering another beat (or `finish()`) cancels whatever the previous beat was still doing.

1. **Resolve** the beat in the current story language ([§3](#3-multi-language-text)) and reset the "interrupted" flag.
2. **Cinematics**: sticky `letterbox` and `grading`; the `transition` cover ([§4](#4-transitions)); an optional `intertitle` card.
3. **Camera + expression** start (not awaited), the transition is revealed, then `leadInMotion` and the `audio` directive start.
4. After 350 ms: BGM is **ducked** if the beat has a line, `motion` starts, the line is spoken (`vrmEngine.speakText`, TTS + lip-sync + EMAGE gestures).
5. **Hand-over**: choices are published, the crystal chime plays if there are choices.
6. **Auto-advance** if `autoNextBeatId` is set ([§2](#2-flow-control-and-interruption)).

`beat_greet` is special: the engine hides the model behind the black intertitle and waits for the tap. Do not rename that id. With `autoNextBeatId` set (Act 0) it is a **wake-only** step: after the tap the engine covers the screen with the *next* beat's transition, removes the intertitle, and the next beat reveals the model under the cover. Without `autoNextBeatId` the legacy pan-up reveal + body turn runs.

Per-beat extras applied in step 2 (under the transition cover): `scene` (switch scene, not persisted), `cinematics.wind` (sticky ambient wind level 0 to 3, reset by `finish()`), `actor.facing` (`back` = instantly turned away, `front` = steps around via bodyTurn).

## 2. Flow control and interruption

| Field | Meaning |
| :--- | :--- |
| `choices[]` | Cards shown after the line ends. `actionType`: `next_beat`, `change_scene`, `swap_outfit`, `change_lang`, `open_provider_config`, `finish`, `custom`. A `custom` choice **must** carry a `nextBeatId` (otherwise `StoryPlayer` sends it to the LLM generator) and a function `actionPayload`. |
| `autoNextBeatId` | Go to this beat when the line has finished (or, for a silent beat, when its pause has elapsed) without any click. Mutually exclusive with `choices`. |
| `autoNextDelayMs` | Pause after the line before moving on (default 600). Use it for breathing room; a 1.4 s pause after a sad line lets it land. If TTS is unavailable or fails instantly the engine still waits long enough to read the subtitle (`1200 ms + 75 ms/char`, max 7 s). |
| `allowInput` / `inputPlaceholder` | Shows the chat input. Typing while she speaks is a full-duplex **interruption**. |
| `waitForCamera` | Camera first: the beat's camera move runs to the end before the performance starts (expression, `leadInMotion`, `sfx[].afterCamera`, the line / TTS). BGM, ambience and normal SFX still start with the camera. A camera that is stopped (skip, interrupt, next beat) releases the beat at once. The world-facing guard is unchanged: it holds while the director moves. Act 0 beat 2 uses it. |
| `cinematics.timeOfDay` | `{from?, to, durationSec}` tweens the environment hour (final frame only is saved). `{toNow: true, durationSec}` starts at the browser's local time minus `STORY_TIME_START_OFFSET_HOURS` (12, in `story/timeOfDay.ts`, wraps over midnight), sweeps forward 12 h to the real time, then calls `setEnvironmentTime('auto')` (the same real-time-follow mode as the settings option, persisted). Skipping or finishing mid-sweep jumps to `auto`. Act 0 beat 5 (beach) uses it. |
| `autoFinish` | Like `autoNextBeatId`, but ends the whole story after the line + `autoNextDelayMs`: `finish()` restores the view prefs and eases the camera back to the default view, then `StoryPlayer` calls `onComplete` (free chat). |
| `choices[].branch` / `variants` | A choice with `branch: 'x'` makes later beats use `variants.x` (a partial beat, merged one level deep: `cinematics`, `audio`, `camera`, `actor`...). Cleared on replay. |
| `choices[].scene` / `sceneHour` | Switches scene (persisted) under the next beat's transition cover; `sceneHour` sets a fixed environment time first; `sceneHourFromNow` instead sets the `toNow` start time (browser time − 12 h, not persisted) so a preview matches the sweep that follows. Time-aware scenes only (`beach3d`); `light` / `dark` / `void` ignore environment time. |
| `startLang: 'browser'` (script) | Start in the browser language (zh / en / ja, anything else en) instead of the UI language; the UI language is untouched until a `change_lang` choice. |
| `interaction: 'camera_drag'` | Shows the camera task card (orbit / pitch / zoom). `StoryPlayer` localizes the choice with id `camera_done` or `look_done` once all tasks are done. The three tasks (orbit, pitch, zoom) count only real user input: pointer `turn` gestures and `InteractionController.onUserZoom` (canvas wheel, pinch, middle-button drag; ignored while a director move owns the controls). They never diff camera state, so director moves, `fitCamera` and the return to the default view cannot tick them. Nothing is auto-detected: the beat waits for the user to press that button (Act 0 beat 3 uses it, with a `look_done` card). |

**Interruption** (`engine.interrupt()`): stops TTS, camera tween, and any delayed SFX, restores BGM, publishes the beat's choices, and **stops auto-advance**: the user has taken over, and the next beat comes from their choice or from the AI generator. The "interrupted" flag is reset at the start of every beat, so the lines after an interruption are spoken normally (previously they stayed silent).

**The one required tap.** The intertitle with `requireClick: true` (only `beat_greet` by default) shows "tap to wake". `skipIntertitle()` runs inside that user gesture and calls `storyAudioDirector.unlock()` (`Tone.start()` + `AudioContext.resume()`), so TTS, BGM and SFX can play for the rest of the story without further clicks. Intertitles with `requireClick: false` disappear after `durationSec`.

## 3. Multi-language text

Every text field accepts a plain string (same in all languages) or an object:

```ts
speechText: { 'zh-CN': '你好', en: 'Hello', ja: 'こんにちは' }
```

Resolved fields: `actor.speechText`, `choices[].text/subText`, `confirmChoice`, `cinematics.intertitle.text`, `inputPlaceholder`, `cinematics.intertitle.subtitle`, script `title/description`. A plain string is the same text in every language: Act 0 uses that for its language cards, each showing only its own language. `zh-CN` is required; a missing language falls back to it.

- Resolution happens **when the beat is entered** (`resolveBeat`), producing a plain-string beat. `StoryPlayer`, the history log and the LLM generator only ever see single-language strings.
- Because it is lazy, an object may use **getters** to vary text with story state (Act 0 does this for the ending line).
- **Language selection** is a choice with `actionType: 'change_lang'` and `actionPayload: 'zh-CN' | 'en' | 'ja'`. The engine stores the language synchronously (so the very next beat already uses it) and also calls `changeLang()` (UI language + `lang` cookie). `StoryDirectorEngine.getLang()` = story choice, else the i18n instance language, else the cookie.
- Fixed UI strings of the player (skip, recap, camera card, placeholders, "tap to wake", badges) live under the `story.*` keys of `src/i18n/*.ts`.
- **TTS voice follows the text script**, not the UI language: kana → Japanese voice, Latin-only text → `voices.en`, otherwise Chinese (see [`TTS.md`](TTS.md)). English lines therefore use the configured English voice; check it if the accent matters.

Authoring limits used by the Act 0 tests: one beat speaks its whole thought in a single `speechText` (≤ 50 characters zh-CN, ≤ 70 ja, ≤ 140 en) because every spoken beat is one TTS request. Lines contain no UI words (card titles / sub-lines carry the instructions). `en` text contains no CJK; `ja` text contains kana.

## 4. Transitions

`cinematics.transition`: `none` (default), `eye_blink`, `white_flash`, `fade_to_black`. Timings are shared with the overlay in `transitions.ts`:

| Kind | Cover | Hold | Reveal | Look |
| :--- | :--- | :--- | :--- | :--- |
| `eye_blink` | 600 ms | 450 ms | 800 ms | Black layer opens vertically (`scaleY`), first-person wake-up. Act 0 uses it only at the very end (beat 6); the wake tap into beat 1 uses `fade_to_black` (no blink) |
| `white_flash` | 140 ms | 60 ms | 1100 ms | Hard white hit that melts away: lights on, impact |
| `fade_to_black` | 650 ms | 300 ms | 900 ms | Classic cut through black: scene hops, time jumps |

When a **choice** leads to a beat that has a transition, `selectChoice` first covers the screen and only then runs the choice action (`change_scene`, `custom`, ...). Scene swaps and callbacks therefore happen under the cover and never flash on screen. The beat then positions camera and expression and reveals after `hold`. `StoryState` exposes `transitionKind` / `isTransitionCovered` (and the legacy `isEyeBlinkActive`) for the overlay.

## 5. Grading

`cinematics.grading` is **sticky**: it stays until another beat sets a value (`default` resets), and `finish()` resets it. It is a CSS `backdrop-filter` layer in `StoryCinematicOverlay` (the user's PostFX settings are not touched; presets cross-fade in about 0.7 s):

| Preset | Look |
| :--- | :--- |
| `sepia_memory` | warm sepia, slightly desaturated, vignette |
| `rainy_noir` | cold, desaturated, high contrast, dark vignette |
| `dream_bloom` | brighter, softer, pink-warm glow (screen blend) |

`letterbox` is rendered as gradient bars (top and bottom) and is sticky in the same way.

## 6. Camera

`camera: { shot, movement, durationSec, easing, targetFov, windMultiplier, alignSunBacklight, orbitAngleDeg, startDistance, startAzimuthOffsetDeg }`

Shots: `extreme_close_up`, `close_up`, `medium_close_up`, `medium`, `full`, `wide`, `dramatic_low`. Movements: `none`, `push_in`, `pull_out`, `pedestal_up`, `arc_sweep`, `orbit_subtle`, `hero_spiral_orbit` and:

- **`hero_backlight_reveal`**: the camera orbits (the short way, never through the character) to the side opposite the sun, drops to a slightly low angle and narrows the FOV by 3°. The character is a silhouette against the sun. Works best in `beach3d` at golden hour. `alignSunBacklight: true` on any other move uses the same short-way orbit.
- **`slow_push_in`**: a long dolly. At the start of the move (under the transition cover) the camera is placed `startDistance` metres away (default 1.7 × the shot distance) at `startAzimuthOffsetDeg` from where it already is, then glides along the line of sight to the shot distance while the azimuth eases back. The character's world facing is held (director moves never drive bodyTurn), so a `facing: 'back'` actor stays turned away while the camera approaches from behind. Act 0 beat 1: `full`, 6.5 m, 25°, 9 s (about one spoken line).
- **`orbit_to_front`**: the camera orbits the short way to the direction the character is *facing* (her world yaw), radius and pitch easing to the shot. At exactly 180° the sign of `orbitAngleDeg` picks the side (default positive). Because the world facing is held during the move, a character who faced away from the camera ends up facing it with no body turn; combine with `leadInMotion` and expression for the "caught" reaction. Do not set `facing: 'front'` on the same beat: that would first make her step around to where the camera used to be. Act 0 beat 2: `medium_close_up`, 2.4 s, with the whoosh SFX; the beat sets `waitForCamera: true`, so the angry stomp, the shock face, the heartbeat (`afterCamera`) and the line only start once the orbit has fully finished.
- **`dutch_tilt`**: rolls the camera −9° (`DUTCH_TILT_RAD`). The roll is applied after `controls.update()` in the engine's controls wrapper (`cameraDirector.applyRoll()`), so it survives the render loop. **Any later camera directive levels it again** (and `reset()` clears it); a beat without a `camera` keeps the tilt.
- Act 0 opens in the hidden `void` scene (beat 1 `scene: 'void'`) and offers three destinations in beat 4 (beach, line-art day, line-art night), each with its own beat 5 `variants` (scene, grading, wind, BGM, ambience, SFX). Script-name mapping used by Act 0: `spiral_rise` = `hero_spiral_orbit`, `arc_pan` = `arc_sweep`, `static` = `none`, `orbit` = `orbit_subtle`; scenes `lineart_day` / `lineart_night` / `beach` = `light` / `dark` / `beach3d` (`src/story/scenes.ts`); gradings `dreamy_soft` = `dream_bloom`, `memory_sepia` = `sepia_memory`.
- **`cinematics.wind`** (0 to 3): sticky *ambient* wind, gust multiplier `1 + 0.5 × level`, via `WindForceController.setAmbientWindLevel`. It coexists with the camera `windMultiplier` below (the larger wins), so a move ending does not drop the beach breeze.
- **`cinematics.timeOfDay`** `{ from?, to, durationSec }`: tweens `vrmEngine.setEnvironmentTime` (24 h clock, time-aware scenes such as `beach3d`); only the last frame is saved. It keeps running across beats until another beat starts one or `finish()` runs. Act 0 beat 5 drifts the beach from 14:30 to 17:36.
- **Preview cards** (as in the old Act 0): `change_scene` / `swap_outfit` choices without `nextBeatId` apply in place (scene swap, or outfit swap + a random `outfitShowcase` motion-group move (same as the normal outfit switch) + chime; the "current" badge starts from what is saved in localStorage (scene: `SCENE_THEME_KEY`, nothing saved = no scene card is current; outfit: `WEARING_OUTFIT_KEY`, nothing saved or unknown = `xiaochun_dinner_dress`), matched exactly on `actionPayload`, and follows the card the user previews from then on. The live scene (e.g. `void`) is never used for the badge), keep the cards on screen and mark the picked one; the `confirmChoice` card advances. A preview choice may carry `branch` (last one clicked wins) and, for scenes, `sceneHour`. The recap line for `outfit_confirm` is built from the worn outfit's card, which the engine looks up in a beat named `beat_outfit_choice` (Act 0 keeps that id); `scene_confirm` does the same for a beat named `beat_scene_choice`, otherwise the confirm card's own text is logged.
- **`windMultiplier`** (1.0 to 3.5): raised while the move runs; calls `WindForceController.setGustMultiplier`. Ambient gusts push hair, skirt and ribbons sideways relative to the camera (bust only slightly), pulsing between 35 % and 100 %. The effect fades back about a second after the move ends or is interrupted. Strength: `APP_CONFIG.wind.gustStrength` (0 disables gusts). Gusts stack with the mouse wind.

## 7. Actor motions

- `leadInMotion`: plays at the **start** of the beat, once, and runs to its natural end. It is no longer cut after ~350 ms; while a clip plays, it has priority over EMAGE speech gestures.
- `motion`: starts after the 350 ms lead-in window and is faded out after the line ends. On a **silent beat** it is not stopped (the next beat's start fades it), so use `autoNextDelayMs` to give it time.
- Both must be ids of `MOTION_CATALOG` (`src/motion/catalog.ts`); the Act 0 test enforces that.

## 8. Audio

`audio: { bgmAction, bgmMood, bgmTrack, bgmVolume, bgmFadeSec, ambience, ambienceVolume, playSfx, sfx[] }`

- **`bgmMood`** (procedural, no files, no licensing): `void_drone`, `dusk_warm`, `longing`, `lights_on`, `farewell`; script names `calm` / `bright` / `mystic` are aliases of `dusk_warm` / `lights_on` / `void_drone`. `bgmAction: 'fade_out'` is the "no BGM" beat. Pad chords plus a sparse bell melody synthesised with WebAudio. The LLM generator names `gentle_daily`, `cinematic_epic`, `melancholy_piano`, `mysterious_ambient` are aliases. The synthesised sound is not a substitute for composed music; it is a licence-free placeholder.
- **`bgmTrack`**: URL of a looping audio file (for example `/audio/dusk.mp3`). If it fails to load the director falls back to `bgmMood`, or stays silent, and does not retry the same URL. No audio files ship with the repository; `BGM_URL` in `prologueStory.ts` is the single switch.
- `bgmAction`: `play` (cross-fade to the new music, un-muffle), `fade_in` (default 3 s), `fade_out`, `stop_cut`, `duck`, `muffle`. Starting the same mood/track again only updates the volume.
- **`ambience`**: `sea_waves`, `wind` (filtered noise with slow LFOs), or `none`. Ducks to 60 % while she speaks.
- **`playSfx`** (single id) and `sfx[]` (with `delaySec`): `crystal_chime`, `heartbeat_pulse`, `camera_shutter`, `whoosh`, `bell`, `soft_tap`, `wind_gust`, `wave_wash`; short aliases `crystal`, `heartbeat`, `shutter`, `wind`, `waves`. Delayed SFX are cancelled when the next beat starts, on interruption and on finish.
- **Ducking**: BGM drops to 25 % while a beat with a line speaks and returns afterwards; during an auto-advancing chain with short pauses it stays ducked. `finish()` fades everything out (`stopAll`).

## 9. Verifying a script

```bash
pnpm exec vitest run src/story src/core/scene src/core/wind   # engine flow, audio, camera, wind, Act 0
pnpm exec tsc --noEmit
```

`src/story/__tests__/prologueStory.test.ts` is the script linter: zod validity, no dead ends / dangling ids / unreachable beats, `autoNext` xor `choices`, `custom` choices need `nextBeatId` + function payload, all three languages present, line lengths per language, the four advance modes, per-branch beat 5, and that motion / SFX / mood / ambience / scene / shot / transition ids exist. Copy it when you add a script.

## 10. Known limits

- Environment time (`vrmEngine.setEnvironmentTime`) is an instant snap that also writes `localStorage`; The `beach3d` scene is the only one with a real sun, so `hero_backlight_reveal` is best there; Act 0 no longer uses it (beat 1 is a slow push-in from behind).
- The grading layer uses `backdrop-filter` over the WebGL canvas; very low-end GPUs may prefer `default`.
- Procedural BGM and ambience have not been auditioned by a sound designer; levels (`bgmVolume`, `ambienceVolume`) are the knobs.
- Act 0 has no free typing or barge-in: beat 5 uses fixed "password" cards that all lead to the same reply beat. Typing on a beat with `allowInput` in other scripts hands the story to the LLM generator (with its offline fallback beats); the scripted ending is not resumed.
- `open_provider_config` choices are handled by `StoryPlayer`, not the engine: it opens the provider dialog and, when the dialog closes (configured or not), goes to that choice's `nextBeatId`. Act 0's `beat_brain_choice` uses it next to a `custom` card (on-device WebLLM). Choice `badge` is localized like `text`.
