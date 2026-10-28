/**
 * src/stt/sttDispatcher.ts — 智能语音识别远程调度器与断路器。
 *
 * 核心调度与降级规则：
 * 1. 官方内置 (builtin)：优先 Cloudflare Workers AI (/api/stt Whisper Turbo)；
 * 2. 用户自定义 (custom)：调用用户自备 OpenAI /v1/audio/transcriptions 兼容服务；
 * 3. 熔断保护 (Circuit Breaker)：
 *    - 遇到 429 配额用尽或连续 2 次请求超时，立即熔断 5 分钟 (degraded)；
 *    - 熔断期间直接返回不可用，0ms 秒切本地 SenseVoice 兜底，绝不让用户每次说话死等超时；
 *    - 5 分钟后半开放行一次探针探测自愈。
 * 4. 纯端侧离线 (local)：直通本地 WebWorker。
 */

import { encodeWav } from './wavEncoder';
import { readActiveSttMode, type ActiveSttMode } from '../llm/activeAudioModes';
import { getProviderDecrypted } from '../llm/customProvider/store';

export interface CircuitState {
  failures: number;
  openUntil: number;
  lastError?: string;
}

const CIRCUIT_MAX_FAILURES = 2;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟熔断窗口
const REMOTE_TIMEOUT_MS = 8000; // 8s 超时阈值

const circuits = new Map<string, CircuitState>();

function getCircuitKey(mode: ActiveSttMode): string {
  return mode.kind === 'custom' ? `custom:${mode.providerId}` : mode.kind;
}

function getCircuit(key: string): CircuitState {
  let c = circuits.get(key);
  if (!c) {
    c = { failures: 0, openUntil: 0 };
    circuits.set(key, c);
  }
  return c;
}

/** 检查当前远程路由是否处于可用状态（未被熔断且非离线模式） */
export function isRemoteSttAvailable(mode?: ActiveSttMode): boolean {
  const currentMode = mode ?? readActiveSttMode();
  if (currentMode.kind === 'local') return false;

  const key = getCircuitKey(currentMode);
  const state = getCircuit(key);
  if (Date.now() < state.openUntil) {
    return false; // 熔断保护中
  }
  return true;
}

/** 触发熔断 */
export function tripCircuit(mode: ActiveSttMode, reason: string): void {
  const key = getCircuitKey(mode);
  const state = getCircuit(key);
  state.failures = CIRCUIT_MAX_FAILURES;
  state.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  state.lastError = reason;
  console.warn(
    `[STT Dispatcher] Circuit tripped for ${key} (cooldown 5m). Reason: ${reason}. Falling back to local SenseVoice.`,
  );
}

/** 重置熔断器（探针成功） */
export function resetCircuit(mode: ActiveSttMode): void {
  const key = getCircuitKey(mode);
  const state = getCircuit(key);
  state.failures = 0;
  state.openUntil = 0;
  state.lastError = undefined;
}

export interface RemoteTranscribeResult {
  text: string;
}

/** 调用远程接口转录音频。若不可用或请求失败，抛出异常触发本地兜底。 */
export async function transcribeRemote(
  pcm: Float32Array,
  sampleRate: number,
  mode?: ActiveSttMode,
  signal?: AbortSignal,
): Promise<RemoteTranscribeResult> {
  const currentMode = mode ?? readActiveSttMode();
  if (currentMode.kind === 'local') {
    throw new Error('Local only mode active');
  }

  const key = getCircuitKey(currentMode);
  const circuit = getCircuit(key);
  if (Date.now() < circuit.openUntil) {
    throw new Error(`Circuit open for ${key} until ${new Date(circuit.openUntil).toLocaleTimeString()}`);
  }

  const wavBytes = encodeWav(pcm, sampleRate);
  const wavBlob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), REMOTE_TIMEOUT_MS);
  const onExternalAbort = () => {
    clearTimeout(timer);
    abortController.abort();
  };
  if (signal) {
    if (signal.aborted) onExternalAbort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    let resultText = '';

    if (currentMode.kind === 'builtin') {
      // 官方内置 Cloudflare Workers AI
      const resp = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wavBlob,
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (resp.status === 429) {
          tripCircuit(currentMode, 'Quota 429 exceeded');
        } else {
          circuit.failures++;
          if (circuit.failures >= CIRCUIT_MAX_FAILURES) {
            tripCircuit(currentMode, `HTTP ${resp.status}`);
          }
        }
        throw new Error(`Cloudflare STT failed: HTTP ${resp.status} ${text.slice(0, 100)}`);
      }

      const json = await resp.json();
      resultText = String(json?.text ?? '');
    } else if (currentMode.kind === 'custom') {
      // 用户自定义 OpenAI 兼容接口
      const profile = await getProviderDecrypted(currentMode.providerId);
      if (!profile) {
        tripCircuit(currentMode, 'Provider profile not found');
        throw new Error(`Custom provider ${currentMode.providerId} not found`);
      }

      const url = `${profile.baseURL.replace(/\/+$/, '')}/audio/transcriptions`;
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', profile.model);

      const headers: Record<string, string> = {};
      if (profile.apiKey) {
        headers['Authorization'] = `Bearer ${profile.apiKey}`;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        circuit.failures++;
        if (resp.status === 429 || resp.status === 401 || circuit.failures >= CIRCUIT_MAX_FAILURES) {
          tripCircuit(currentMode, `HTTP ${resp.status} ${text.slice(0, 60)}`);
        }
        throw new Error(`Custom STT failed: HTTP ${resp.status} ${text.slice(0, 100)}`);
      }

      const json = await resp.json();
      resultText = String(json?.text ?? '');
    }

    // 成功调用：重置断路器失败计数
    resetCircuit(currentMode);
    return { text: resultText };
  } catch (err) {
    if (abortController.signal.aborted && !signal?.aborted) {
      circuit.failures++;
      if (circuit.failures >= CIRCUIT_MAX_FAILURES) {
        tripCircuit(currentMode, 'Request timeout (8s)');
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort); // 长寿命 signal 上不累积已结束请求的监听
  }
}
