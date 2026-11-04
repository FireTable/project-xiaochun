# Client-Side Cognitive Memory Architecture (`@firetable/client-memory`)

> **Dedicated Package**: [`packages/client-memory/`](../packages/client-memory/)  
> **Key Integration Files**:  
> - [`src/memory/index.ts`](../src/memory/index.ts) (Singleton accessor & initialization)  
> - [`src/components/MemoryDialog.tsx`](../src/components/MemoryDialog.tsx) (Standalone Memory Settings dialog & 3-tab HUD)  
> - [`src/llm/chatWorkflow.ts`](../src/llm/chatWorkflow.ts) (Memory extraction & recall lifecycle)  
> - [`src/director/chatDirector.ts`](../src/director/chatDirector.ts) (Turn boundary commit & background consolidation)  

---

## 1. Architectural Philosophy: Zero-Backend Cognitive Memory

Project XiaoChun is built on a **100% browser-native** paradigm. All conversation turns, extracted identity traits, episodic memory journals, and SillyTavern lorebook entries reside **strictly within the client browser's IndexedDB database (`client-memory-db`)**.

No conversational history, personal preferences, or knowledge entries are ever uploaded to any cloud backend or telemetry server.

```mermaid
graph TD
    subgraph Browser Sandbox [Client Browser Sandbox (100% Local)]
        User[User Input] --> Assembler[ContextAssembler]
        
        subgraph ClientMemoryEngine [@firetable/client-memory]
            IDB[(IndexedDB: client-memory-db)]
            
            subgraph Multi-Tier Storage
                TurnsStore[turns: Short-Term Working Window]
                ProfileStore[profile: Identity & Preference Facts]
                EpisodesStore[episodes: Long-Term Episodic Journal]
                LorebooksStore[lorebooks: SillyTavern Knowledge Base]
            end
            
            IDB --> TurnsStore
            IDB --> ProfileStore
            IDB --> EpisodesStore
            IDB --> LorebooksStore
            
            subgraph Cognitive & Retrieval Pipeline
                BM25[BM25 In-Memory Inverted Index]
                Scorer[Stanford 3D Cognitive Scorer]
                Extractor[Intent & Fact Extractor]
                Consolidator[Zero-GPU Episodic Consolidator]
            end
            
            EpisodesStore --> BM25
            LorebooksStore --> BM25
            BM25 --> Scorer
            ProfileStore --> Assembler
            Scorer --> Assembler
            TurnsStore --> Assembler
        end
        
        Assembler --> SystemPrompt[Hydrated Context & Stable System Prompt]
        SystemPrompt --> LLM[WebLLM WebGPU / Custom Provider]
        LLM --> AssistantReply[Assistant Streaming Response]
        AssistantReply --> Extractor
        AssistantReply --> Consolidator
        Extractor --> ProfileStore
        Consolidator --> EpisodesStore
    end
```

---

## 2. Multi-Tier Memory Storage Hierarchy

The storage layer is encapsulated behind the `StorageAdapter` interface, implemented in production by `IndexedDBAdapter` (`client-memory-db`):

| Store Name | Primary Key / Index | Stored Entity | Key Purpose & Retention Policy |
| :--- | :--- | :--- | :--- |
| **`turns`** | `id` (auto-increment `number`), index on `ts` | `TurnRecord` (`user`, `assistant`, `ts`, `summarized`) | Rolling short-term conversational context (device-recommended 2~6 turns, user customizable up to 50). |
| **`profile`** | `id` (string: `'user_master'`) | `UserProfile` (`nickname`, `traits`, `facts[]`, `relationshipStage`, `intimacyScore`) | Structured user identity, relations, and up to 60 extracted preference facts (`like`, `dislike`, `identity`, `occupation`, `health`). |
| **`episodes`** | `id` (UUID string), index on `ts`, `lastRecalledAt` | `EpisodeRecord` (`title`, `summary`, `entities[]`, `importance`, `recallCount`) | Consolidated long-term narrative diary cards summarized beyond the short-term working window. |
| **`lorebooks`** | `uid` (string), index on `bookId`, `enabled` | `LorebookEntry` (`keys[]`, `secondaryKeys[]`, `constant`, `order`, `depth`, `content`) | SillyTavern (酒馆) compatible worldbook entries injected upon keyword match or constant presence. |

### 2.1 Async Lock & Transaction Safety (`AsyncMutex`)
All write operations across stores are protected by `AsyncMutex`, an in-memory re-entrant lock queue that guarantees atomic read-modify-write sequences across concurrent asynchronous turns and prevents IndexedDB transaction race conditions.

---

## 3. Cognitive Extraction & Conflict Resolution

### 3.1 Heuristic Intent Extraction (`IntentExtractor`)
Extraction occurs post-turn in milliseconds without burning GPU compute:
- **Clean Dialogue Stripping**: Automatically cleans prompt prefixes (e.g. `[System Recall]`, `[User Profile]`), character name guards (strictly guarding against **小蠢** / user vocatives), and assistant reasoning tags (`<think>...</think>`).
- **Pattern Matchers**:
  - `nickname`: "叫我...", "我是...", "称呼我..."
  - `occupation`: "我是做...的", "我的职业是...", "我是一名..."
  - `location`: "我住在...", "我在...", "我家在..."
  - `preferences`: "我喜欢...", "我超爱...", "我讨厌...", "我最烦..."

### 3.2 Conflict Resolution (`ConflictResolver`)
- **Single-Value Overwrites**: For fields like `occupation`, `location`, and `nickname`, newer statements automatically overwrite older records while updating `updatedAt`.
- **Preference Deduplication & Capacity Cap**:
  - Normalizes values (lowercased, punctuation-trimmed);
  - Updates existing keys when matched;
  - Enforces a maximum cap of **60 facts** per user profile, pruning oldest un-reinforced facts with FIFO eviction when full.

---

## 4. Long-Term Episodic Memory & Cognitive Scoring

### 4.1 Zero-GPU Episodic Consolidator (`EpisodicConsolidator`)
When short-term conversational turns exceed the working memory limit ($N > \text{workingMemoryLimit}$), un-summarized turns are processed:
1. Batches older turns ($2 \sim 4$ turns per episode);
2. Extracts high-frequency entities and conversational themes;
3. Generates a compact episodic card:
   - `title`: e.g. "关于周末旅行与喝咖啡的交流"
   - `summary`: High-density narrative summary
   - `importance`: Evaluated from emotional and factual density ($1 \sim 10$)
4. Marks turns as `summarized = true` in IndexedDB.

### 4.2 Stanford Generative Agents 3D Scoring
Retrieved episodes are ranked using Stanford's Generative Agents cognitive reflection formula:

$$\text{CognitiveScore} = w_{\text{recency}} \cdot S_{\text{recency}} + w_{\text{importance}} \cdot S_{\text{importance}} + w_{\text{relevance}} \cdot S_{\text{relevance}}$$

Where:
- **Recency Decay**: Exponential half-life decay function:
  $$S_{\text{recency}} = \exp\left(-\frac{\ln(2) \cdot \Delta t}{T_{\text{half-life}}}\right)$$
  (Default $T_{\text{half-life}} = 7\text{ days}$).
- **Importance**: Normalized from episode importance ($1 \sim 10 \rightarrow 0.1 \sim 1.0$).
- **Relevance**: BM25 keyword matching score over episode title and summary.
- **Default Weights**: $w_{\text{recency}} = 0.35$, $w_{\text{importance}} = 0.25$, $w_{\text{relevance}} = 0.40$.

---

## 5. SillyTavern (酒馆) Lorebook Integration

The system natively supports **SillyTavern Worldbook JSON** exports (`SillyTavernParser`):
- **Entry Structure**: Parses standard Tavern v1 / v2 lorebook formats, preserving:
  - `keys` & `secondaryKeys`: Keyword triggers
  - `selective`: AND/OR keyword matching
  - `constant`: Always-injected entries
  - `order` & `depth`: Injection priority and position control
  - `content`: Lore description
- **Fast In-Memory Matching (`LorebookMatcher`)**: Scans user prompts and conversational context in $<1\text{ms}$ against normalized token sets.

---

## 6. Context Assembly & KV-Cache Stability (`ContextAssembler`)

Large language models on WebGPU benefit dramatically from **KV-cache reuse**. If dynamic memories are injected unpredictably into the message stream, KV caches invalidate on every turn, causing expensive $1.5\text{s}$ Prefill re-computations.

`ContextAssembler` formats context with deterministic structural prefix ordering:

```
[System Persona Prompt (User Override or Default XIAOCHUN_SYSTEM_PROMPT)]

[User Profile & Persona Facts]
- 称谓: 主人
- 职业: 独立全栈工程师
- 关系阶段: 密友
- 已知喜好: 喜欢 拿铁咖啡, 喜欢 3D 动画制作

[SillyTavern Worldbook Knowledge]
- [常驻设定]: 小蠢的随身手帐与世界观背景...

[Relevant Episodic Memories]
- (2026-11-02) 关于周末露营与海滩漫步的回忆

[Short-Term Conversational Turns]
user: 你好小蠢
assistant: 主人下午好！今天工作累不累呀？
```

- **Prefix Invariance**: System prompt and core user profile are ordered first, maximizing KV-cache prefix hits across subsequent chat turns.
- **Dynamic Tail Ingestion**: Only the dynamic episodic memories and recent turns change per turn.

---

## 7. UI HUD & User Experience (`MemoryDialog.tsx`)

The memory center is accessible from the main ChatBar dropdown as a standalone, peer-level dialog:

```
ChatBar Menu
├── 对话设置 (AdvancedSettingsDialog) — Prompt override, memory turns slider, subtitles
├── 记忆设置 (MemoryDialog)           — Standalone 3-tab cognitive memory manager
├── 跨设备同步 (SyncDialog)           — AES-GCM-256 encrypted export & import
└── 设备算力评测 (DeviceStatusDialog) — WebGPU tier evaluation & VRAM diagnostics
```

### 7.1 Visual & Interactive Specifications
- **Three Segmented Tabs**:
  - `[记忆画像]` (Profile & Facts): Displays user nickname, occupation, location, relation stage, and granular fact tags with one-click deletion (`Trash2`).
  - `[时光回忆]` (Episodes): Displays chronological diary cards with date, summary, entity tags, and importance indicator.
  - `[世界书]` (Lorebook): Displays SillyTavern knowledge entries with constant badges, keyword lists, and an inline JSON import tool.
- **Sleek Text Action Buttons**: In-card triggers use minimal text buttons (`text-brand-300 hover:text-brand-200`) without bulky outer boxes.
- **Unified Design System**: Footer buttons adhere to `Button variant="secondary" size="sm"` (`w-full sm:w-auto h-9 sm:h-8 text-xs`).
- **Two-Step Memory Reset**:
  - Initial click on `[重置记忆]` transitions button into a red pulsing state: `[确认清空记忆？再次点击执行]`;
  - Auto-reverts after a 4-second safety timeout if not confirmed;
  - Second click calls `memory.clearAll({ includeLorebook: false })`, resetting short-term turns, persona facts, and episodes to defaults while safely preserving imported worldbook knowledge;
  - Displays instant green feedback banner: `[记忆已重置为初始状态]`.
- **Mobile Responsive Layout**: Container width bounded by `max-w-[min(32rem,calc(100vw-1.5rem))]` with $12\text{px}$ safe margins, $88\text{dvh}$ max height, touch-friendly tab heights, and `overscroll-contain`.
