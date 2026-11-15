/**
 * synth_en_cs.ts — Concurrent multi-voice Edge-TTS synthesizer for English & EN-ZH
 * Code-Switching BACKCHANNEL and WAIT_INTERRUPT audio clips.
 *
 * Uses Project XiaoChun's `src/lib/edge-tts-core.ts` directly via:
 *   node --experimental-strip-types scripts/train-duplex-turn/synth_en_cs.ts
 *
 * Outputs 16 kHz mono PCM16 WAV files + `manifest.jsonl` under:
 *   /tmp/xc-duplex-turn-cache/synth_tts/
 *
 * Strictly enforces a stratified ~15% EN/CS holdout split with ZERO speaker AND
 * ZERO utterance-phrase leakage between train/val and holdout!
 */

import fs from 'node:fs';
import path from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import {
  EDGE_TTS_CONSTANTS,
  buildEdgeTTSPayloads,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  parseBinaryFrame,
} from '../../src/lib/edge-tts-core.ts';

type TurnLabel = 'BACKCHANNEL' | 'WAIT_INTERRUPT';
type LangTag = 'EN' | 'CS' | 'ZH';
type SplitTag = 'train' | 'holdout';

interface PhraseEntry {
  text: string;
  lang: LangTag;
  label: TurnLabel;
  split: SplitTag;
}

interface ProsodyVariant {
  pitch: string;
  rate: string;
  volume: string;
}

interface SynthJob {
  id: string;
  text: string;
  lang: LangTag;
  label: TurnLabel;
  split: SplitTag;
  voice: string;
  pitch: string;
  rate: string;
  volume: string;
  wavPath: string;
}

const OUT_DIR = '/tmp/xc-duplex-turn-cache/synth_tts';
const WAV_DIR = path.join(OUT_DIR, 'wav16k');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.jsonl');
const TARGET_SR = 16000;
const CONCURRENCY = 10;

const EDGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

// Train/val voices (required 5 train voices; 6th required voice en-GB-SoniaNeural + zh-CN-XiaoxiaoNeural/YunjianNeural held out cleanly)
const TRAIN_EN_VOICES = [
  'en-US-JennyNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'zh-CN-XiaoyiNeural',
  'zh-CN-YunxiNeural',
];
const TRAIN_ZH_CS_VOICES = ['zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural'];

// Holdout-only speakers -> ZERO speaker leakage + ZERO utterance leakage
const HOLDOUT_EN_VOICES = ['en-GB-SoniaNeural'];
const HOLDOUT_CS_VOICES = ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunjianNeural'];

const TRAIN_PROSODIES_3: ProsodyVariant[] = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+6Hz', rate: '+10%', volume: '+0%' },
  { pitch: '-6Hz', rate: '-8%', volume: '+0%' },
];

const TRAIN_PROSODIES_6: ProsodyVariant[] = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+8Hz', rate: '+12%', volume: '+0%' },
  { pitch: '-8Hz', rate: '-10%', volume: '+0%' },
  { pitch: '+4Hz', rate: '-5%', volume: '-5%' },
  { pitch: '-4Hz', rate: '+6%', volume: '+5%' },
  { pitch: '+10Hz', rate: '+18%', volume: '+0%' },
];

const HOLDOUT_PROSODIES_EN: ProsodyVariant[] = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+5Hz', rate: '+8%', volume: '+0%' },
  { pitch: '-5Hz', rate: '-8%', volume: '+0%' },
  { pitch: '+10Hz', rate: '+14%', volume: '-3%' },
  { pitch: '-10Hz', rate: '-12%', volume: '+3%' },
  { pitch: '+2Hz', rate: '+4%', volume: '+0%' },
  { pitch: '-2Hz', rate: '-4%', volume: '+0%' },
  { pitch: '+8Hz', rate: '-6%', volume: '+0%' },
  { pitch: '-6Hz', rate: '+10%', volume: '+0%' },
];

const HOLDOUT_PROSODIES_CS: ProsodyVariant[] = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+6Hz', rate: '+10%', volume: '+0%' },
  { pitch: '-6Hz', rate: '-8%', volume: '+0%' },
  { pitch: '+10Hz', rate: '+15%', volume: '+0%' },
  { pitch: '-8Hz', rate: '-12%', volume: '+0%' },
];

const PHRASES: PhraseEntry[] = [
  // ---------------- EN BACKCHANNEL (Train) ----------------
  ...([
    'mm-hmm', 'yeah', 'right', 'I see', 'sure', 'okay', 'yep', 'yup',
    'aha', 'mmm', 'true', 'cool', 'nice', 'okay sure', 'yeah yeah',
    'mm-hmm yeah', 'oh I see', 'oh okay', 'yes yes', 'totally',
    'exactly', 'definitely', 'of course', 'uh-huh yeah', 'mm-hmm right',
    'yeah right', 'sure thing', 'no problem', 'makes sense yeah',
    'interesting', 'oh really', 'really', 'good point', 'I hear you',
    'I understand', 'fine', 'alright', 'okay got it', 'right okay',
    'mm', 'yeah sure', 'uh-huh okay',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'EN', label: 'BACKCHANNEL', split: 'train' })),

  // ---------------- EN BACKCHANNEL (Holdout - 100% unseen phrases & voice) ----------------
  ...([
    'uh-huh', 'got it', 'makes sense', 'fair enough',
    'for sure', 'right right', 'sounds good', 'all right',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'EN', label: 'BACKCHANNEL', split: 'holdout' })),

  // ---------------- CS + ZH BACKCHANNEL (Train) ----------------
  ...([
    '对对', 'yeah 对', 'mm-hmm 好的', 'ok 没问题', 'I see 原来如此',
    'right 对的', 'got it 收到', 'sure 可以的', 'uh-huh 嗯嗯', 'okay 了解',
    '对 yeah', '好的 okay', '没错 totally', '明白 got it', '哦哦 I see',
    '嗯哼 makes sense', 'nice 不错', 'cool 可以', 'yeah 是啊', '对对对 sure',
    '嗯嗯 okay', '好的呀 sure', '了解 I see', '收到 got it', '没错 yeah',
    '行行 ok', '是这样 right',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'CS', label: 'BACKCHANNEL', split: 'train' })),
  ...([
    '对', '嗯嗯', '哦哦', '嗯哼', '对对对', '是呢',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'ZH', label: 'BACKCHANNEL', split: 'train' })),

  // ---------------- CS BACKCHANNEL (Holdout - 100% unseen phrases & voices) ----------------
  ...([
    'yeah 对对', 'ok 原来如此', 'right 对呀', 'uh-huh 明白',
    'mm-hmm 收到', 'sure 没问题',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'CS', label: 'BACKCHANNEL', split: 'holdout' })),

  // ---------------- EN WAIT_INTERRUPT (Train) ----------------
  ...([
    'wait', 'wait a second', 'stop', 'hang on', 'one sec',
    'hold on please', 'wait a minute', 'wait wait', 'stop stop', 'pause',
    'just a sec', 'just a second', 'hold on a sec', 'hold on a second',
    'wait hold on', 'sorry stop', 'stop please', 'excuse me wait',
    'wait please', 'hold on wait', 'one moment', 'wait one second',
    'wait just a sec', 'sorry hang on', 'hey wait', 'oh wait',
    'wait up', 'stop a second', 'pause please', 'hold it',
    'wait one sec', 'sorry hold up', 'quiet please', 'hang on wait',
    'stop right there', 'wait a moment', 'hold on one sec', 'uh wait',
    'hey hold on', 'sorry excuse me', 'wait for a sec', 'pause a sec',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'EN', label: 'WAIT_INTERRUPT', split: 'train' })),

  // ---------------- EN WAIT_INTERRUPT (Holdout - 100% unseen phrases & voice) ----------------
  ...([
    'hold on', 'wait a sec', 'sorry wait', 'one second',
    'hold up', 'sorry hold on', 'excuse me', 'hang on a sec',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'EN', label: 'WAIT_INTERRUPT', split: 'holdout' })),

  // ---------------- CS + ZH WAIT_INTERRUPT (Train) ----------------
  ...([
    '等一下 wait', 'wait a second 等会儿', 'hold on 等一下', '等一下 hold on',
    '先停一下 wait', '打断一下 excuse me', 'sorry 打断一下', 'wait 等我一下',
    '稍等 one sec', '等等 hold up', 'stop 别说了', '先等一下 wait',
    'hang on 等下', '不好意思 wait a sec', '等一下 stop', 'pause 停一下',
    'wait 稍等一下', 'hold on 别急', 'sorry 等一下下', 'wait 停一下',
    'one sec 等会', '等一下 pause', 'stop 先等下', 'just a sec 等下',
    'wait 别说了', 'hold on 先停下',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'CS', label: 'WAIT_INTERRUPT', split: 'train' })),
  ...([
    '等一下', '等等', '先停一下', '打断一下', '稍等一下', '停一下',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'ZH', label: 'WAIT_INTERRUPT', split: 'train' })),

  // ---------------- CS WAIT_INTERRUPT (Holdout - 100% unseen phrases & voices) ----------------
  ...([
    'wait 等一下', 'hold on 等等', 'sorry 先停一下',
    'wait a sec 稍等', '打断一下 hold on', '等会儿 wait',
  ] as const).map((text): PhraseEntry => ({ text, lang: 'CS', label: 'WAIT_INTERRUPT', split: 'holdout' })),
];

function buildJobs(): SynthJob[] {
  const jobs: SynthJob[] = [];
  let idx = 0;

  for (const p of PHRASES) {
    if (p.split === 'train') {
      if (p.lang === 'EN') {
        for (const voice of TRAIN_EN_VOICES) {
          // 5 voices * 2 prosodies for most, 3 prosodies on first 8 -> ~450 clips
          const prosList = TRAIN_PROSODIES_3.slice(0, 2);
          for (const pr of prosList) {
            const id = `tts_${String(idx++).padStart(4, '0')}`;
            jobs.push({
              id,
              text: p.text,
              lang: p.lang,
              label: p.label,
              split: 'train',
              voice,
              pitch: pr.pitch,
              rate: pr.rate,
              volume: pr.volume,
              wavPath: path.join(WAV_DIR, `${id}.wav`),
            });
          }
        }
      } else {
        for (const voice of TRAIN_ZH_CS_VOICES) {
          const prosList = p.lang === 'ZH' ? TRAIN_PROSODIES_6 : TRAIN_PROSODIES_6.slice(0, 5);
          for (const pr of prosList) {
            const id = `tts_${String(idx++).padStart(4, '0')}`;
            jobs.push({
              id,
              text: p.text,
              lang: p.lang,
              label: p.label,
              split: 'train',
              voice,
              pitch: pr.pitch,
              rate: pr.rate,
              volume: pr.volume,
              wavPath: path.join(WAV_DIR, `${id}.wav`),
            });
          }
        }
      }
    } else {
      if (p.lang === 'EN') {
        for (const voice of HOLDOUT_EN_VOICES) {
          for (const pr of HOLDOUT_PROSODIES_EN) {
            const id = `tts_${String(idx++).padStart(4, '0')}`;
            jobs.push({
              id,
              text: p.text,
              lang: p.lang,
              label: p.label,
              split: 'holdout',
              voice,
              pitch: pr.pitch,
              rate: pr.rate,
              volume: pr.volume,
              wavPath: path.join(WAV_DIR, `${id}.wav`),
            });
          }
        }
      } else {
        for (const voice of HOLDOUT_CS_VOICES) {
          for (const pr of HOLDOUT_PROSODIES_CS) {
            const id = `tts_${String(idx++).padStart(4, '0')}`;
            jobs.push({
              id,
              text: p.text,
              lang: p.lang,
              label: p.label,
              split: 'holdout',
              voice,
              pitch: pr.pitch,
              rate: pr.rate,
              volume: pr.volume,
              wavPath: path.join(WAV_DIR, `${id}.wav`),
            });
          }
        }
      }
    }
  }

  return jobs;
}

async function synthesizeEdgeMp3(job: SynthJob): Promise<Uint8Array> {
  const secMsGec = await makeSecMsGec();
  const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_WSS_URL);
  url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', makeConnectionId());

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`Timeout on ${job.id}`));
      }
    }, 12000);

    const ws = new WebSocket(url.toString(), {
      headers: {
        'User-Agent': EDGE_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Cookie: `muid=${makeMuid()};`,
      },
    } as unknown as string[]);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(
        job.text,
        job.voice,
        job.pitch,
        job.rate,
        job.volume,
      );
      ws.send(speechConfig);
      ws.send(ssmlMessage);
    };

    ws.onmessage = (ev) => {
      if (settled) return;
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.failed') || ev.data.includes('403 Forbidden') || ev.data.includes('Unauthorized')) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error(`Edge rejected: ${ev.data.slice(0, 120)}`));
        } else if (ev.data.includes('turn.end')) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          const totalLen = chunks.reduce((a, b) => a + b.length, 0);
          const merged = new Uint8Array(totalLen);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          if (merged.length < 256) {
            reject(new Error(`Empty audio (${merged.length} B) for ${job.id}`));
          } else {
            resolve(merged);
          }
        }
      } else if (ev.data instanceof ArrayBuffer) {
        const { headers, body } = parseBinaryFrame(new Uint8Array(ev.data));
        if (headers.Path === 'audio' && body.length > 0) {
          chunks.push(body);
        }
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket error on ${job.id}`));
      }
    };

    ws.onclose = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket closed early (${ev.code}) on ${job.id}`));
      }
    };
  });
}

function resampleTo16kMono(channels: Float32Array[], sampleRate: number): Float32Array {
  const nChan = channels.length;
  const nIn = channels[0]?.length ?? 0;
  if (nIn === 0) return new Float32Array(0);

  const mono = new Float32Array(nIn);
  if (nChan === 1) {
    mono.set(channels[0]!);
  } else {
    const inv = 1 / nChan;
    for (let i = 0; i < nIn; i++) {
      let s = 0;
      for (let c = 0; c < nChan; c++) s += channels[c]![i]!;
      mono[i] = s * inv;
    }
  }

  if (sampleRate === TARGET_SR) return mono;

  // Low-pass filter (cutoff ~7.2 kHz for 24k -> 16k) using 15-tap Hamming FIR before linear resampling
  const ratio = sampleRate / TARGET_SR;
  const filtered = new Float32Array(nIn);
  const fc = 0.45 * (TARGET_SR / sampleRate);
  const halfTap = 7;
  const kernel = new Float32Array(halfTap * 2 + 1);
  let kSum = 0;
  for (let k = -halfTap; k <= halfTap; k++) {
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * (k + halfTap)) / (halfTap * 2));
    const v = sinc * win;
    kernel[k + halfTap] = v;
    kSum += v;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kSum;

  for (let i = 0; i < nIn; i++) {
    let acc = 0;
    for (let k = -halfTap; k <= halfTap; k++) {
      const idx = Math.min(nIn - 1, Math.max(0, i + k));
      acc += mono[idx]! * kernel[k + halfTap]!;
    }
    filtered[i] = acc;
  }

  const nOut = Math.max(1, Math.round(nIn / ratio));
  const out = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(nIn - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = filtered[i0]! * (1 - frac) + filtered[i1]! * frac;
  }
  return out;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

function trimLeadingTrailingSilence(samples: Float32Array, sr: number): Float32Array {
  const thresh = 0.004;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]!) < thresh) start++;
  while (end > start && Math.abs(samples[end - 1]!) < thresh) end--;
  const pad = Math.round(0.03 * sr); // keep 30ms clean margin
  start = Math.max(0, start - pad);
  end = Math.min(samples.length, end + pad);
  return end > start ? samples.subarray(start, end) : samples;
}

async function runWithRetry(job: SynthJob, decoder: MPEGDecoder): Promise<{ durationSec: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const mp3 = await synthesizeEdgeMp3(job);
      await decoder.reset();
      const decoded = decoder.decode(mp3);
      if (decoded.samplesDecoded === 0) {
        throw new Error(`Zero samples decoded (${decoded.errors.length} decoder errors)`);
      }
      const pcm16 = trimLeadingTrailingSilence(
        resampleTo16kMono(decoded.channelData, decoded.sampleRate),
        TARGET_SR,
      );
      if (pcm16.length < 1600) {
        throw new Error(`Decoded audio too short (${pcm16.length} samples)`);
      }
      const wavBuf = encodeWavPcm16(pcm16, TARGET_SR);
      fs.writeFileSync(job.wavPath, wavBuf);
      return { durationSec: Number((pcm16.length / TARGET_SR).toFixed(3)) };
    } catch (err) {
      lastErr = err;
      const backoffMs = 250 * attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main() {
  fs.mkdirSync(WAV_DIR, { recursive: true });
  const jobs = buildJobs();

  const summary = new Map<string, number>();
  for (const j of jobs) {
    const key = `${j.split}:${j.label}:${j.lang}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  console.log(`Planned ${jobs.length} Edge-TTS clips:`, Object.fromEntries(summary));

  // Resume support: skip WAVs already written and valid
  const results = new Array<string | null>(jobs.length).fill(null);
  let cursor = 0;
  let done = 0;
  let cached = 0;
  let failed = 0;
  const tStart = Date.now();

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    const decoder = new MPEGDecoder();
    await decoder.ready;
    try {
      while (true) {
        const myIdx = cursor++;
        if (myIdx >= jobs.length) break;
        const job = jobs[myIdx]!;
        let durationSec = 0;

        if (fs.existsSync(job.wavPath) && fs.statSync(job.wavPath).size > 3244) {
          const wavBytes = fs.statSync(job.wavPath).size - 44;
          durationSec = Number((wavBytes / (TARGET_SR * 2)).toFixed(3));
          cached++;
        } else {
          try {
            const res = await runWithRetry(job, decoder);
            durationSec = res.durationSec;
          } catch (err) {
            failed++;
            console.warn(`[WARN] ${job.id} (${job.voice} "${job.text}") failed:`, err);
            continue;
          }
        }

        results[myIdx] = JSON.stringify({
          id: job.id,
          wav_path: job.wavPath,
          text: job.text,
          lang: job.lang,
          label: job.label,
          split: job.split,
          voice: job.voice,
          pitch: job.pitch,
          rate: job.rate,
          duration_sec: durationSec,
        });

        done++;
        if (done % 150 === 0 || done === jobs.length) {
          const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
          console.log(`Progress: ${done}/${jobs.length} (cached=${cached}, failed=${failed}) in ${elapsed}s`);
        }
      }
    } finally {
      decoder.free();
    }
  });

  await Promise.all(workers);

  const lines = results.filter((x): x is string => x !== null);
  fs.writeFileSync(MANIFEST_PATH, lines.join('\n') + '\n', 'utf8');
  console.log(`Done! Wrote ${lines.length} entries to ${MANIFEST_PATH} (failed=${failed}).`);
  if (failed > 50) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
