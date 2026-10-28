import { describe, it, expect } from 'vitest';
import {
    EDGE_TTS_CONSTANTS,
    generateSecMsGecV2,
    makeSecMsGec,
    cleanSSMLText,
    buildEdgeTTSPayloads,
    parseHeaders,
    parseBinaryFrame,
    isValidTTSVoice,
    isValidTTSProsody,
} from './edge-tts-core';
import { APP_CONFIG } from '../config';

describe('edge-tts-core v2 DRM and SSML suite', () => {
    it('generates the exact reference v2 Sec-MS-GEC token for fixed timestamp', async () => {
        const fixedTs = 1729700000;
        const expected = 'C47400A3BF8E5D48-9588D4696E37F714281C9297C90F37DBE3D6491FD391F0A49081BA6B5926898D';
        const token = generateSecMsGecV2(fixedTs);
        expect(token).toBe(expected);

        const asyncToken = await makeSecMsGec(fixedTs);
        expect(asyncToken).toBe(expected);
    });

    it('generates valid v2 token format (<16 hex>-<64 hex>) for current time', async () => {
        const token = await makeSecMsGec();
        expect(token).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
    });

    it('has correct version 2-143.0.3650.75 in constants', () => {
        expect(EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION).toBe('2-143.0.3650.75');
    });

    it('cleans SSML text safely', () => {
        const cleaned = cleanSSMLText('Hello <World> & "Friends"');
        expect(cleaned).toBe('Hello World  Friends');
    });

    it('builds valid SSML payloads with correct voice and pitch', () => {
        const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads('你好', 'zh-CN-XiaoyiNeural', '+10Hz');
        expect(speechConfig).toContain('Path:speech.config');
        expect(speechConfig).toContain('audio-24khz-48kbitrate-mono-mp3');
        expect(ssmlMessage).toContain('Path:ssml');
        expect(ssmlMessage).toContain('pitch=\'+10Hz\'');
        expect(ssmlMessage).toContain('zh-CN, XiaoyiNeural');
        expect(ssmlMessage).toContain('你好');
    });

    it('parses headers and binary frames correctly', () => {
        const headerText = 'Path:audio\r\nX-RequestId:abc123\r\n\r\n';
        const parsed = parseHeaders(headerText);
        expect(parsed.Path).toBe('audio');
        expect(parsed['X-RequestId']).toBe('abc123');

        const headerBytes = new TextEncoder().encode(headerText);
        const frame = new Uint8Array(2 + headerBytes.length + 4);
        frame[0] = (headerBytes.length >> 8) & 0xff;
        frame[1] = headerBytes.length & 0xff;
        frame.set(headerBytes, 2);
        frame.set([1, 2, 3, 4], 2 + headerBytes.length);

        const parsedFrame = parseBinaryFrame(frame);
        expect(parsedFrame.headers.Path).toBe('audio');
        expect(parsedFrame.body).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('accepts every voice / prosody value the app config actually sends', () => {
        const { voices, defaultPitch, defaultRate, defaultVolume } = APP_CONFIG.tts;
        for (const v of [defaultPitch, defaultRate, defaultVolume]) expect(isValidTTSProsody(v)).toBe(true);
        for (const cfg of Object.values(voices)) {
            expect(isValidTTSVoice(cfg.voice)).toBe(true);
            expect(isValidTTSProsody(cfg.pitch)).toBe(true);
            expect(isValidTTSProsody(cfg.rate)).toBe(true);
            expect(isValidTTSProsody(cfg.volume)).toBe(true);
        }
        expect(isValidTTSVoice('zh-CN-liaoning-XiaobeiNeural')).toBe(true);
        expect(isValidTTSVoice('en-US-AvaMultilingualNeural')).toBe(true);
    });

    it('rejects SSML-injection style voice / prosody values and refuses to build a payload from them', () => {
        expect(isValidTTSVoice("x'><break/><voice name='y")).toBe(false);
        expect(isValidTTSVoice('zh-CN-XiaoyiNeural\r\nPath:evil')).toBe(false);
        expect(isValidTTSVoice('../../etc/passwdNeural')).toBe(false);
        expect(isValidTTSVoice(undefined)).toBe(false);
        expect(isValidTTSProsody("+10Hz' volume='x")).toBe(false);
        expect(isValidTTSProsody('loud')).toBe(false);
        expect(isValidTTSProsody('+10000%')).toBe(false);
        expect(() => buildEdgeTTSPayloads('hi', "x'><s/>", '+10Hz')).toThrow('invalid tts parameter');
        expect(() => buildEdgeTTSPayloads('hi', 'zh-CN-XiaoyiNeural', "+1Hz' x='")).toThrow('invalid tts parameter');
    });
});
