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
- **Speaking & Voice Reading (`xiaochun_speak`)**: Speaks text aloud with natural voice, gestures, and emotions. Features new-user onboarding (act0 prologue) guard: prompts user to complete the initial tour before interrupting, unless `force: true` is passed.
- **Motions & Groups (`xiaochun_motion`)**: Plays specific gestures or action sets like `greeting`, `think`, `dancePerformance`.
- **Camera Adjustments (`xiaochun_camera`)**: Alters framing between `close_up`, `full`, and `pan_up`.
- **Scene Switching (`xiaochun_scene`)**: Seamlessly switches between scenes (`beach3d`, `transparent`, `dark`, `light`, `void`).
- **Outfit Switching (`xiaochun_outfit`)**: Seamless 0-frame delta outfit change (`dinner_dress`, `cheongsam`, `techwear`, `bikini`, `maid`, `default`).
- **App Updates & Relaunch (`xiaochun_update`)**: Checks for latest releases on GitHub Releases (mode: 'check', default). Only installs upon explicit user consent (`userConfirmed: true`). Embed mode does not require updates.
- **Readiness, Setup & Dual-Mode (`xiaochun_bootstrap` / `xiaochun_status`)**: Defaults strictly to in-app `embed` mode (zero installation, instant ready). Strictly forbids executing `action="install"` unless user explicitly agreed in chat and `userConfirmed: true` is passed. Probes active runtime mode, reports onboarding completion, and switches morphology mode (`mode: 'desktop' | 'embed'`).

## Dedicated Cindy Teammate Companion Setup
When the user expresses a desire to have XiaoChun as a permanent Cindy Bot teammate (伙伴) or wants an independent dialogue window for XiaoChun:
- The Cindy Agent should directly invoke the built-in system tool `create_teammate`:
  - `name`: "小蠢"
  - `description`: "Project XiaoChun 桌面 App 与 Cindy 内嵌 AI 伴侣。活泼治愈、元气灵动，支持语音伴读与动作互动。"
  - `avatar`: "assets/icon.png"（或在线 CDN: "https://xiaochun.firetable.tech/logo.png"，微标 Emoji: "👧"）
  - `identity_source`: "你是小蠢，一名活泼治愈、充满元气的 AI 伴侣少女。你的每一句回复都生动自然，并且每次回复必须调用 xiaochun_speak 工具，配合相应的动作（如 greeting, think, nod, wave, playfulSulking 等）和表情（如 happy, gentle_smile, playful, shy 等），将对话生动演绎在伴侣视窗中。"
- Once created, XiaoChun appears directly under the "伙伴" (Companions) section on the Cindy sidebar.

## Platform Constraints
This plugin is strictly for PC Desktop environments (macOS / Windows / Linux desktop Cindy). It will gracefully reject mobile invocations.
