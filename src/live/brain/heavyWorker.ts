/**
 * heavyWorker.ts — Asynchronous Sophon Heavyworker integrating @firetable/client-memory,
 * Custom OpenAI streaming endpoints, on-device `<think>` fallback, and mid-flight `amend()`.
 */

import { getClientMemory, recallForChat } from '@/memory';
import {
  FrontBrainStreamParser,
  stripFrontBrainMarkup,
} from './frontBrain';
import type {
  BrainKVRuntimeAdapter,
  BrainMemoryAdapter,
  BrainMemorySnapshot,
  BrainMessage,
  BrainStreamChunk,
  HeavyWorkerConfig,
  LiveEmotionTag,
} from './types';

export interface HeavyTaskCallbacks {
  onDelta?: (
    delta: string,
    cleanAccum: string,
    emotion: LiveEmotionTag,
  ) => void;
  onSpeakClause?: (text: string, emotion: LiveEmotionTag) => void;
  onComplete?: (fullCleanText: string) => void;
  onError?: (err: Error) => void;
}

export interface HeavyTaskRequest {
  taskId: string;
  turnId: number;
  task: string;
  urgency: 'quick' | 'deep';
  userUtterance: string;
  bridgeSpokenText?: string;
  history: BrainMessage[];
  callbacks?: HeavyTaskCallbacks;
}

export interface HeavyTaskHandle {
  taskId: string;
  turnId: number;
  isActive(): boolean;
  amend(additionalUserText: string): void;
  abort(): void;
  result: Promise<string>;
}

export type OpenAIStreamTransport = (
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
) => AsyncIterable<BrainStreamChunk>;

const LOCAL_THINK_MAX_RAW_CHARS = 240;
const LOCAL_THINK_MAX_WAIT_MS = 7_500;

export const HEAVY_WORKER_SYSTEM_PROMPT = [
  'You are XiaoChun (小春) running deep background reasoning while continuing a live spoken conversation.',
  'CRITICAL: Keep internal <think>...</think> ultra-brief (at most 2 short sentences, under 40 words), then close </think> immediately and emit your spoken commentary.',
  'Deliver clear, accurate, spoken-friendly findings in the same language (ZH / EN / code-switching) as the user, incorporating any live user amendments.',
  'Format for voice commentary: 2-4 crisp spoken paragraphs/sentences (no giant markdown tables, code blocks, emojis, or boilerplate). You may prefix clauses with [happy], [surprised], [shy], [relaxed], or [sad] if helpful.',
].join('\n');

export function resolveOpenAIChatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/chat/completions')) return clean;
  if (/\/v\d+$/.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

/**
 * Default OpenAI SSE streaming transport (reads SSE frames without logging credentials).
 */
export async function* defaultOpenAIStreamTransport(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<BrainStreamChunk, void, void> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`HeavyWorker OpenAI endpoint returned HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error('HeavyWorker OpenAI response has empty stream body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
              finish_reason?: string | null;
            }>;
          };
          const choice = parsed.choices?.[0];
          const contentDelta = choice?.delta?.content ?? '';
          if (contentDelta) {
            yield {
              delta: contentDelta,
              finishReason: choice?.finish_reason ?? null,
            };
          }
        } catch {
          // Ignore malformed partial SSE frames safely
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
}

export function createDefaultMemoryAdapter(): BrainMemoryAdapter {
  return {
    async recall(query: string, maxTurns = 6): Promise<BrainMemorySnapshot> {
      try {
        const res = await recallForChat(query, maxTurns);
        const raw = res.rawResult;
        const profileBits: string[] = [];
        if (res.entities.nickname) {
          profileBits.push(`Nickname: ${res.entities.nickname}`);
        } else if (res.entities.name) {
          profileBits.push(`Name: ${res.entities.name}`);
        }
        if (res.entities.likes.length > 0) {
          profileBits.push(`Likes: ${res.entities.likes.join(', ')}`);
        }
        if (res.entities.facts.length > 0) {
          profileBits.push(
            `Facts: ${res.entities.facts
              .slice(-5)
              .map((f) => `${f.k}=${f.v}`)
              .join('; ')}`,
          );
        }

        const episodeLines =
          raw?.episodes?.slice(0, 4).map((e) => e.summary || e.title) ?? [];
        const lorebookLines =
          raw?.lorebookHits?.slice(0, 4).map((l) => `${l.keys.join(', ')}: ${l.content}`) ??
          [];
        const factLines =
          raw?.matchedFacts?.slice(0, 4).map((f) => `${f.key}=${f.value}`) ?? [];

        return {
          recalledSummary: factLines.length > 0 ? factLines.join('; ') : undefined,
          profileText: profileBits.length > 0 ? profileBits.join(' | ') : undefined,
          episodeLines: episodeLines.length > 0 ? episodeLines : undefined,
          lorebookLines: lorebookLines.length > 0 ? lorebookLines : undefined,
        };
      } catch {
        return {};
      }
    },
    async remember(userText: string, assistantText: string): Promise<void> {
      try {
        const engine = getClientMemory();
        await engine.remember({ user: userText, assistant: assistantText });
      } catch {
        // Ignore IndexedDB unavailability in headless/unit environments
      }
    },
  };
}

function formatMemoryContextBlock(snapshot: BrainMemorySnapshot): string {
  const parts: string[] = [];
  if (snapshot.profileText) {
    parts.push(`[User Profile] ${snapshot.profileText}`);
  }
  if (snapshot.recalledSummary) {
    parts.push(`[Recent Memory Summary] ${snapshot.recalledSummary}`);
  }
  if (snapshot.episodeLines?.length) {
    parts.push(`[Relevant Episodes]\n- ${snapshot.episodeLines.join('\n- ')}`);
  }
  if (snapshot.lorebookLines?.length) {
    parts.push(`[Lorebook]\n- ${snapshot.lorebookLines.join('\n- ')}`);
  }
  return parts.join('\n');
}

export class HeavyWorker {
  private config: HeavyWorkerConfig;
  private readonly localAdapter: BrainKVRuntimeAdapter;
  private readonly memoryAdapter: BrainMemoryAdapter;
  private readonly openAITransport: OpenAIStreamTransport;
  private readonly isLocalBusyFn?: () => boolean;
  private activeTask: {
    handle: HeavyTaskHandle;
    amendments: string[];
    abortedByCaller: boolean;
    activeAttemptController: AbortController | null;
    restartRequested: (() => void) | null;
    settled: boolean;
  } | null = null;

  constructor(options: {
    config: HeavyWorkerConfig;
    localAdapter: BrainKVRuntimeAdapter;
    memoryAdapter?: BrainMemoryAdapter;
    openAITransport?: OpenAIStreamTransport;
    isLocalModelBusy?: () => boolean;
  }) {
    this.config = { ...options.config };
    this.localAdapter = options.localAdapter;
    this.memoryAdapter = options.memoryAdapter ?? createDefaultMemoryAdapter();
    this.openAITransport =
      options.openAITransport ?? defaultOpenAIStreamTransport;
    this.isLocalBusyFn = options.isLocalModelBusy;
  }

  updateConfig(config: Partial<HeavyWorkerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): HeavyWorkerConfig {
    return { ...this.config };
  }

  resolveEffectiveMode(): 'custom-openai' | 'local-thinking' {
    if (this.config.mode === 'custom-openai') {
      return this.config.apiBaseUrl ? 'custom-openai' : 'local-thinking';
    }
    if (this.config.mode === 'auto') {
      if (this.config.apiBaseUrl && this.config.model) {
        return 'custom-openai';
      }
      return 'local-thinking';
    }
    return 'local-thinking';
  }

  getActiveTaskId(): string | null {
    return this.activeTask && !this.activeTask.settled
      ? this.activeTask.handle.taskId
      : null;
  }

  isRunning(): boolean {
    return this.activeTask !== null && !this.activeTask.settled;
  }

  amendActive(additionalUserText: string): boolean {
    if (!this.activeTask || this.activeTask.settled) return false;
    this.activeTask.handle.amend(additionalUserText);
    return true;
  }

  abortActive(): void {
    this.activeTask?.handle.abort();
  }

  startTask(req: HeavyTaskRequest): HeavyTaskHandle {
    // Supersede any previously active heavy task cleanly
    if (this.activeTask && !this.activeTask.settled) {
      this.activeTask.handle.abort();
    }

    const amendments: string[] = [];
    let attemptController: AbortController | null = null;
    let triggerRestart: (() => void) | null = null;

    const state = {
      handle: null as unknown as HeavyTaskHandle,
      amendments,
      abortedByCaller: false,
      activeAttemptController: null as AbortController | null,
      restartRequested: null as (() => void) | null,
      settled: false,
      hasStartedStream: false,
    };

    const resultPromise = this.executeTaskLoop(req, state, (ctrl, wake) => {
      attemptController = ctrl;
      triggerRestart = wake;
      state.activeAttemptController = ctrl;
      state.restartRequested = wake;
    }).finally(() => {
      state.settled = true;
      if (this.activeTask === state) {
        this.activeTask = null;
      }
    });

    const handle: HeavyTaskHandle = {
      taskId: req.taskId,
      turnId: req.turnId,
      isActive: () => !state.settled,
      amend: (additionalUserText: string) => {
        const trimmed = additionalUserText.trim();
        if (!trimmed || state.settled || state.abortedByCaller) return;
        amendments.push(trimmed);
        if (state.hasStartedStream) {
          attemptController?.abort();
          triggerRestart?.();
        }
      },
      abort: () => {
        if (state.settled) return;
        state.abortedByCaller = true;
        attemptController?.abort();
        triggerRestart?.();
      },
      result: resultPromise,
    };

    state.handle = handle;
    this.activeTask = state;
    return handle;
  }

  private async executeTaskLoop(
    req: HeavyTaskRequest,
    state: {
      amendments: string[];
      abortedByCaller: boolean;
      settled: boolean;
      hasStartedStream: boolean;
    },
    bindControl: (ctrl: AbortController, wake: () => void) => void,
  ): Promise<string> {
    const query = [req.userUtterance, req.task].filter(Boolean).join(' ');
    let snapshot: BrainMemorySnapshot | null = null;
    if (this.resolveEffectiveMode() !== 'local-thinking') {
      snapshot = await this.memoryAdapter.recall(query, 6);
      if (state.abortedByCaller) return '';
    }

    let spokenCombined = '';
    const spokenEmitted = new Set<string>();
    let forceDirectLocal = false;

    while (!state.abortedByCaller) {
      state.hasStartedStream = false;
      const amendmentCountAtStart = state.amendments.length;
      const ctrl = new AbortController();
      let restartSignaled = false;
      const wake = () => {
        restartSignaled = true;
      };
      bindControl(ctrl, wake);

      const effectiveMode = this.resolveEffectiveMode();
      // If running local WebLLM `<think>`, yield politely while FrontBrain still holds active stream
      if (effectiveMode === 'local-thinking') {
        await this.waitUntilLocalIdle(ctrl.signal, state);
        if (state.abortedByCaller) return spokenCombined.trim();
        if (ctrl.signal.aborted && restartSignaled) continue;
      }

      if (!snapshot) {
        snapshot = await this.memoryAdapter.recall(query, 6);
        if (state.abortedByCaller) return spokenCombined.trim();
        if (ctrl.signal.aborted && restartSignaled) continue;
      }

      const disableLocalThinking = effectiveMode === 'local-thinking' && forceDirectLocal;
      const messages = this.buildHeavyMessages(req, snapshot, state.amendments, spokenCombined);
      const parser = new FrontBrainStreamParser(Number.MAX_SAFE_INTEGER);
      let supersededByAmendment = false;
      let thinkStarved = false;
      let cleanEmittedInAttempt = false;
      let rawAttemptChars = 0;
      let thinkTimer: ReturnType<typeof setTimeout> | null = null;
      const clearThinkTimer = () => {
        if (thinkTimer) {
          clearTimeout(thinkTimer);
          thinkTimer = null;
        }
      };

      state.hasStartedStream = true;

      if (effectiveMode === 'local-thinking' && !disableLocalThinking) {
        thinkTimer = setTimeout(() => {
          if (!cleanEmittedInAttempt && !state.abortedByCaller && !ctrl.signal.aborted) {
            thinkStarved = true;
            forceDirectLocal = true;
            ctrl.abort();
          }
        }, LOCAL_THINK_MAX_WAIT_MS);
        if (typeof (thinkTimer as any).unref === 'function') {
          (thinkTimer as any).unref();
        }
      }

      try {
        for await (const chunk of this.streamByMode(messages, req.urgency, ctrl.signal, disableLocalThinking)) {
          if (state.abortedByCaller) break;
          if (state.amendments.length > amendmentCountAtStart || restartSignaled) {
            supersededByAmendment = true;
            break;
          }
          if (!chunk.delta) continue;
          rawAttemptChars += chunk.delta.length;
          const step = parser.push(chunk.delta);
          if (step.cleanDelta) {
            cleanEmittedInAttempt = true;
            clearThinkTimer();
            req.callbacks?.onDelta?.(step.cleanDelta, step.cleanAccum, step.emotion);
          }
          for (const clause of step.speakClauses) {
            const norm = clause.text.trim();
            if (norm && !spokenEmitted.has(norm)) {
              spokenEmitted.add(norm);
              spokenCombined = spokenCombined ? `${spokenCombined} ${norm}` : norm;
              req.callbacks?.onSpeakClause?.(norm, clause.emotion);
            }
          }
          if (
            effectiveMode === 'local-thinking' &&
            !disableLocalThinking &&
            !cleanEmittedInAttempt &&
            rawAttemptChars >= LOCAL_THINK_MAX_RAW_CHARS &&
            !parser.getCleanText()
          ) {
            thinkStarved = true;
            forceDirectLocal = true;
            ctrl.abort();
            break;
          }
        }

        if (state.abortedByCaller) {
          return spokenCombined.trim();
        }

        if (thinkStarved && !supersededByAmendment && state.amendments.length === amendmentCountAtStart) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }

        if (
          !supersededByAmendment &&
          state.amendments.length === amendmentCountAtStart &&
          !ctrl.signal.aborted
        ) {
          const tail = parser.flush();
          if (tail.cleanDelta) {
            cleanEmittedInAttempt = true;
            req.callbacks?.onDelta?.(tail.cleanDelta, tail.cleanAccum, tail.emotion);
          }
          for (const clause of tail.speakClauses) {
            const norm = clause.text.trim();
            if (norm && !spokenEmitted.has(norm)) {
              spokenEmitted.add(norm);
              spokenCombined = spokenCombined ? `${spokenCombined} ${norm}` : norm;
              req.callbacks?.onSpeakClause?.(norm, clause.emotion);
            }
          }
          const finalReply = stripFrontBrainMarkup(spokenCombined || parser.getCleanText());
          // If local <think> consumed its entire token budget without closing </think>, retry directly without thinking
          if (!finalReply && effectiveMode === 'local-thinking' && !disableLocalThinking) {
            forceDirectLocal = true;
            continue;
          }
          req.callbacks?.onComplete?.(finalReply);
          return finalReply;
        }
      } catch (err) {
        if (state.abortedByCaller) {
          return spokenCombined.trim();
        }
        if (state.amendments.length > amendmentCountAtStart || restartSignaled) {
          // Superseded cleanly by mid-flight amendment — loop again with amended instructions
          continue;
        }
        if (thinkStarved) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        req.callbacks?.onError?.(error);
        throw error;
      } finally {
        clearThinkTimer();
      }

      if (state.abortedByCaller) {
        return spokenCombined.trim();
      }
    }

    return spokenCombined.trim();
  }

  private async waitUntilLocalIdle(
    signal: AbortSignal,
    state: { abortedByCaller: boolean },
  ): Promise<void> {
    if (!this.isLocalBusyFn) return;
    let spins = 0;
    while (
      this.isLocalBusyFn() &&
      !signal.aborted &&
      !state.abortedByCaller &&
      spins < 750
    ) {
      spins++;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }

  private buildHeavyMessages(
    req: HeavyTaskRequest,
    snapshot: BrainMemorySnapshot,
    amendments: string[],
    alreadySpoken: string,
  ): BrainMessage[] {
    const baseSystem = this.config.systemPrompt?.trim() || HEAVY_WORKER_SYSTEM_PROMPT;
    const memoryBlock = formatMemoryContextBlock(snapshot);
    const systemContent = memoryBlock
      ? `${baseSystem}\n\n${memoryBlock}`
      : baseSystem;

    const recentHistory = req.history
      .filter((m) => m.role !== 'system')
      .slice(-6);

    const taskParts = [
      `Original user request: ${req.userUtterance}`,
      `Delegated task (${req.urgency}): ${req.task}`,
    ];
    if (req.bridgeSpokenText) {
      taskParts.push(`Front-Brain bridge already spoken aloud: ${req.bridgeSpokenText}`);
    }
    if (amendments.length > 0) {
      taskParts.push(
        `Mid-flight user amendments (prioritize these!):\n${amendments
          .map((a, i) => `${i + 1}. ${a}`)
          .join('\n')}`,
      );
    }
    if (alreadySpoken) {
      taskParts.push(
        `Commentary already spoken so far (continue smoothly without repeating):\n${alreadySpoken}`,
      );
    }

    return [
      { role: 'system', content: systemContent },
      ...recentHistory,
      { role: 'user', content: taskParts.join('\n\n') },
    ];
  }

  private streamByMode(
    messages: BrainMessage[],
    urgency: 'quick' | 'deep',
    signal: AbortSignal,
    disableThinking = false,
  ): AsyncIterable<BrainStreamChunk> {
    const mode = this.resolveEffectiveMode();
    if (mode === 'custom-openai') {
      const url = resolveOpenAIChatCompletionsUrl(this.config.apiBaseUrl ?? '');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }
      return this.openAITransport(
        url,
        headers,
        {
          model: this.config.model || 'gpt-4o-mini',
          messages,
          stream: true,
          temperature: urgency === 'quick' ? 0.5 : 0.65,
          max_tokens: urgency === 'quick' ? 320 : 640,
        },
        signal,
      );
    }

    // Local <think> fallback using on-device WebLLM (`thinking: true`)
    const onAbort = () => {
      this.localAdapter.interruptGenerate();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const localStream = this.localAdapter.streamChat({
      messages,
      thinking: !disableThinking,
      temperature: 0.6,
      maxTokens: disableThinking ? (urgency === 'quick' ? 200 : 260) : (urgency === 'quick' ? 256 : 320),
      signal,
    });

    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const chunk of localStream) {
            if (signal.aborted) break;
            yield chunk;
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      },
    };
  }
}
