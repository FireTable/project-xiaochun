# XiaoChun Desktop AI Companion (Cindy Plugin)

This plugin connects **Cindy** with the local **Project XiaoChun** 3D desktop companion app, allowing conversational AI responses to be vividly acted out on your desktop with 3D character voice reading, synchronized gestures, facial expressions, and camera control.

> ⚠️ **Note: This plugin only works on PC / desktop computers (macOS / Windows / Linux desktop Cindy). Mobile environments (iOS / Android) do not support local 3D companion integration.**

---

## Key Features

1. **Dual-Mode Adaptive Architecture (Desktop Pet & Cindy Embed Panel)**:
   - **Desktop Pet Mode**: Automatically reuses and wakes up the standalone desktop client when installed, providing a transparent, always-on-top, click-through 3D desk pet across your entire screen;
   - **Cindy Embed Panel Mode**: Zero installation required! Embeds a 3D companion panel directly in Cindy's sidebar/tab view powered by `@firetable/project-xiaochun` JS SDK;
   - **Interactive Setup Choice & Seamless Switching**: Prompts new users to choose between Desktop Pet and Embed Panel on setup, with one-click mode switching anytime via `xiaochun_bootstrap(action="switch_mode")`.
2. **Vivid Companion Interactions**:
   - Synchronized natural speech and voice reading;
   - Rich motion choreography (`greeting`, `think`, `praiseCute`, `dancePerformance`, etc.);
   - Subtle facial expressions (`happy`, `gentle_smile`, `shy`, `playful`, `surprised`, `relaxed`);
   - Cinematic camera framing (close-up, full shot, pan-up).
3. **Safe Long-Text Transmission**:
   - Automatically utilizes temporary file pipelines for long text (>400 chars) to prevent URL length limits and command line truncation.

---

## Tools

* `xiaochun_speak`: Speak aloud with synchronized motions and expressions (supports cold-start auto-launch, onboarding guard, and `force: true`).
* `xiaochun_motion`: Play standalone motions or animation groups.
* `xiaochun_camera`: Control 3D desktop camera angles and framing (close-up, full shot, pan-up, reset).
* `xiaochun_scene`: Switch 3D stages (`beach3d` sunny beach, `transparent` desk pet mode, `light`, `dark`, `void`).
* `xiaochun_outfit`: 0-frame delta outfit swap (`dinner_dress`, `cheongsam`, `techwear`, `bikini`, `maid`, `default`).
* `xiaochun_update`: Check for and install client updates directly from GitHub Releases with automatic restart.
* `xiaochun_stop`: Stop ongoing speech and animation immediately.
* `xiaochun_status`: Check installation, running status, onboarding status, active scene, and outfit on the PC.
* `xiaochun_bootstrap`: Ensure client readiness, launch, or install missing desktop assets.

---

## Resources

* Open Source Repository: [https://github.com/FireTable/project-xiaochun](https://github.com/FireTable/project-xiaochun)
* Official Website & Download: [https://xiaochun.firetable.tech](https://xiaochun.firetable.tech)
