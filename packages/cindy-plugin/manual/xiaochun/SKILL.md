---
name: xiaochun
description: 3D desktop companion interaction manual and tool routing for XiaoChun.
metadata:
  short-description: Control 3D desktop companion XiaoChun
---

# XiaoChun 3D Desktop Companion Manual

## Overview
This manual guides agents on controlling the local 3D desktop companion XiaoChun.

## Core Capabilities
- **Speaking & Voice Reading (`xiaochun_speak`)**: Speaks text aloud with natural voice, gestures, and emotions. Features new-user onboarding (art0 prologue) guard: prompts user to complete the initial tour before interrupting, unless `force: true` is passed.
- **Motions & Groups (`xiaochun_motion`)**: Plays specific gestures or action sets like `greeting`, `think`, `dancePerformance`.
- **Camera Adjustments (`xiaochun_camera`)**: Alters framing between `close_up`, `full`, and `pan_up`.
- **Scene Switching (`xiaochun_scene`)**: Seamlessly switches between 3D scenes (`beach3d`, `transparent`, `dark`, `light`, `void`).
- **Outfit Switching (`xiaochun_outfit`)**: Seamless 0-frame delta outfit change (`dinner_dress`, `cheongsam`, `techwear`, `bikini`, `maid`, `default`).
- **App Updates & Relaunch (`xiaochun_update`)**: Checks for latest releases on GitHub Releases, automatically downloads and installs whole-app updates, and relaunches the companion cleanly.
- **Readiness, Setup & Dual-Mode (`xiaochun_bootstrap` / `xiaochun_status`)**: Probes active runtime mode (`desktop` floating desk pet vs `embed` Cindy in-app panel), reports onboarding completion, and guides installation or switches morphology mode (`mode: 'auto' | 'desktop' | 'embed'`).

## Platform Constraints
This plugin is strictly for PC Desktop environments (macOS / Windows / Linux desktop Cindy). It will gracefully reject mobile invocations.
