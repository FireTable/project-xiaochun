import { describe, it, expect } from 'vitest';
import { encodeWav } from '../wavEncoder';

describe('wavEncoder suite', () => {
  it('encodes Float32 PCM to standard 44-byte WAV header', () => {
    // 160 samples at 16kHz = 10ms of audio
    const samples = 160;
    const pcm = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16000); // 440Hz sine tone
    }

    const wavBytes = encodeWav(pcm, 16000, 1);
    expect(wavBytes.length).toBe(44 + samples * 2);

    const view = new DataView(wavBytes.buffer);

    // RIFF header
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    expect(riff).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples * 2);

    // WAVE
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    );
    expect(wave).toBe('WAVE');

    // fmt chunk
    const fmt = String.fromCharCode(
      view.getUint8(12),
      view.getUint8(13),
      view.getUint8(14),
      view.getUint8(15),
    );
    expect(fmt).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // Subchunk1Size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // Channels
    expect(view.getUint32(24, true)).toBe(16000); // Sample rate
    expect(view.getUint32(28, true)).toBe(32000); // Byte rate (16000 * 2)
    expect(view.getUint16(32, true)).toBe(2); // Block align
    expect(view.getUint16(34, true)).toBe(16); // Bits per sample

    // data chunk
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39),
    );
    expect(data).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples * 2);
  });

  it('clamps values outside [-1, 1] safely', () => {
    const pcm = new Float32Array([1.5, -2.0, 0.0]);
    const wavBytes = encodeWav(pcm, 16000, 1);
    const view = new DataView(wavBytes.buffer);

    // First sample clamped to 0x7fff (32767)
    expect(view.getInt16(44, true)).toBe(32767);
    // Second sample clamped to -0x8000 (-32768)
    expect(view.getInt16(46, true)).toBe(-32768);
    // Third sample is 0
    expect(view.getInt16(48, true)).toBe(0);
  });
});
