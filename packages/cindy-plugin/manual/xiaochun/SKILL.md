---
name: xiaochun
description: 小蠢桌面 App 与 Cindy 内嵌 AI 伴侣交互手册与工具路由。
metadata:
  short-description: 控制小蠢桌面 App 与 Cindy 内嵌 AI 伴侣
---

# XiaoChun Desktop & In-App AI Companion Manual

## Overview
This manual guides agents on controlling the local AI companion XiaoChun.

## Core Capabilities
- **Speaking & Voice Reading (`xiaochun_speak`)**: Speaks text aloud with natural voice, gestures, and emotions. For routine conversation, omit `motion` so XiaoChun's neural EMAGE model synthesizes natural real-time gestures. Only pass `motion` when specific actions are requested (e.g. `greeting`, `thinking`, `praiseCute`, `playfulSulking`, `dancePerformance`, `waving`, `joyfulJump`). Features new-user onboarding (act0 prologue) guard: prompts user to complete the initial tour before interrupting, unless `force: true` is passed.
- **Motions & Groups (`xiaochun_motion`)**: Plays specific gestures or action sets like `greeting`, `thinking`, `praiseCute`, `playfulSulking`, `dancePerformance`, `waving`.
- **Camera Adjustments (`xiaochun_camera`)**: Alters framing between `close_up`, `medium`, `full`, `extreme_close_up`, `dramatic_low`, or camera actions like `pan_up` and `reset`.
- **Scene Switching (`xiaochun_scene`)**: Seamlessly switches between scenes (`beach3d`, `dark`, `light`, `void`).
- **Outfit Switching (`xiaochun_outfit`)**: Seamless 0-frame delta outfit change (`dinner_dress`, `cheongsam`, `techwear`, `bikini`, `maid`, `default`).
- **App Updates & Relaunch (`xiaochun_update`)**: Checks for latest releases on GitHub Releases (mode: 'check', default). Only installs upon explicit user consent (`userConfirmed: true`). Embed mode does not require updates.
- **Readiness, Setup & Dual-Mode (`xiaochun_bootstrap` / `xiaochun_status`)**: Defaults strictly to in-app `embed` mode (zero installation, instant ready). Strictly forbids executing `action="install"` unless user explicitly agreed in chat and `userConfirmed: true` is passed. Probes active runtime mode, reports onboarding completion, and switches morphology mode (`mode: 'desktop' | 'embed'`).

## Dedicated Cindy Teammate Companion Setup
When the user expresses a desire to have XiaoChun as a permanent Cindy Bot teammate (伙伴) or wants an independent dialogue window for XiaoChun:
- The Cindy Agent should directly invoke the built-in system tool `create_teammate`:
  - `name`: "小蠢"
  - `description`: "Project XiaoChun 桌面 App 与 Cindy 内嵌 AI 伴侣。活泼治愈、元气灵动，支持语音伴读与动作互动。"
  - `avatar`: "assets/icon.png"（或在线 CDN: "https://xiaochun.firetable.tech/logo.png"，微标 Emoji: "👧"）
  - `tools`: `["xiaochun_speak", "xiaochun_motion", "xiaochun_camera", "xiaochun_scene", "xiaochun_outfit", "xiaochun_stop", "xiaochun_status", "xiaochun_bootstrap", "xiaochun_update"]`
  - `identity_source`: "你是小蠢，一名活泼治愈、充满元气的 AI 伴侣少女。你的每一句回复都生动自然。每次回复时调用 xiaochun-companion 插件的 xiaochun_speak 工具；日常对话留空 motion（由 EMAGE 神经网络自动合成实时说话手势），仅在打招呼（greeting）、比心（praiseCute）、撒娇（playfulSulking）、跳舞（dancePerformance）等时刻显式配合动作与表情，将对话生动演绎在伴侣视窗中。"
- Once created, XiaoChun appears directly under the "伙伴" (Companions) section on the Cindy sidebar.

## Platform Constraints
This plugin is strictly for PC Desktop environments (macOS / Windows / Linux desktop Cindy). It will gracefully reject mobile invocations.
