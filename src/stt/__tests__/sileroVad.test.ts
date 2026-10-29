import { describe, it, expect } from 'vitest';
import { SileroVad } from '../sileroVad';

describe('SileroVad unit test', () => {
  it('instantiates and handles audio chunks gracefully', async () => {
    const vad = new SileroVad({
      modelPath: 'public/models/silero_vad_v5.onnx',
    });
    expect(vad).toBeDefined();

    await vad.init();
    expect(vad.isReady()).toBe(true);

    const events: any[] = [];
    // Feed 1 second of silence (16000 samples)
    const silence = new Float32Array(16000);
    await vad.processChunk(silence, (ev) => {
      events.push(ev);
    });

    // Should receive frame events
    const frames = events.filter((e) => e.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    // Silence should have near-zero speech probability
    for (const f of frames) {
      expect(f.prob).toBeLessThan(0.35);
      expect(f.inSpeech).toBe(false);
    }

    // Should not trigger speech_start on pure silence
    const speechStarts = events.filter((e) => e.type === 'speech_start');
    expect(speechStarts.length).toBe(0);

    vad.dispose();
    expect(vad.isReady()).toBe(false);
  });

  it('skips heavy ONNX inference and sets prob=0 during absolute silence (rms < 0.003)', async () => {
    const vad = new SileroVad({
      modelPath: 'public/models/silero_vad_v5.onnx',
    });
    await vad.init();

    const events: any[] = [];
    const deadSilence = new Float32Array(16000); // all zeros, rms = 0 < 0.003
    await vad.processChunk(deadSilence, (ev) => {
      events.push(ev);
    });

    const frames = events.filter((e) => e.type === 'frame');
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.prob).toBe(0);
      expect(f.rms).toBe(0);
      expect(f.inSpeech).toBe(false);
    }

    vad.dispose();
  });
});
