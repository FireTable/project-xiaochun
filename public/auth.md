# auth.md — AI Agent Access & Authentication Policy

This document defines the agent registration, authentication, and access protocols for autonomous AI agents, scrapers, and LLM clients interacting with [Project XiaoChun](https://xiaochun.firetable.tech).

## 1. Agent Audience

This specification applies to all autonomous agents, developer tools, web crawlers, AI search engines (Perplexity, SearchGPT, Claude, Cursor, OpenClaw), and multi-agent systems accessing public pages, Markdown feeds, Edge APIs, and desktop companion protocols.

## 2. Authentication Model: Public & Anonymous Access

Project XiaoChun is **100% open, private, client-native, and publicly accessible**. No pre-registration, API keys, OAuth tokens, or human-in-the-loop claim workflows are required to interact with the web companion, download the desktop application, or invoke the APIs.

- **identity_types_supported**: `["anonymous"]`
- **anonymous.credential_types_supported**: `["none"]`
- **register_uri**: `https://xiaochun.firetable.tech/auth.md`
- **claim_uri**: `https://xiaochun.firetable.tech/auth.md`
- **Registration**: Not required for read-only or standard interactive access.
- **Credential Types**: `none` (All GET/POST endpoints are unauthenticated).
- **Claim Flow**: Not required (`claim_uri`: `https://xiaochun.firetable.tech/auth.md`).

## 3. Supported Endpoints & Protocols

| Resource | Path / Protocol | Format | Description |
| :--- | :--- | :--- | :--- |
| **Site Index (Markdown)** | `/llms.txt` | `text/markdown` | Structured technical overview, architecture, & feature list |
| **Full Technical Corpus** | `/llms-full.txt` | `text/markdown` | Comprehensive architecture & pipeline specifications |
| **Agent Skill Spec** | `/docs/AGENT_SKILL.md` | `text/markdown` | Standard Agent Skill for autonomous companion control |
| **Protocol Specification** | `/docs/PROTOCOL.md` | `text/markdown` | Specification of `xiaochun://` and iframe message protocol |
| **RFC 9727 API Catalog** | `/.well-known/api-catalog` | `application/linkset+json` | Machine-readable API discovery catalog |
| **Edge TTS Endpoint** | `/api/tts?text=...&voice=...` | `audio/mpeg` | Edge-TTS streaming audio proxy (protected by Origin Guard) |
| **Edge STT Endpoint** | `/api/stt` | `application/json` | Workers AI Whisper Large Turbo speech recognition |
| **Desktop IPC Protocol** | `xiaochun://<action>?<params>` | URL Scheme | System-wide IPC for desktop companion control |
| **Web Embed Protocol** | `/embed` | `postMessage` / `MessageChannel` | Iframe embedding with `@firetable/project-xiaochun` SDK |

## 4. Content Negotiation

Agents may request the root URL `/` or `/index.md` with:
```http
Accept: text/markdown
```
The server responds directly with clean Markdown and `Content-Type: text/markdown; charset=utf-8`.

## 5. Rate Limiting & Etiquette

Standard Cloudflare edge rate limits apply. Agents are requested to observe directives in `https://xiaochun.firetable.tech/robots.txt` and honor standard `Retry-After` headers when applicable.
