/**
 * f1_turn_fusion.test.ts — Tier 1 & Tier 2 E2E Tests for Feature F1:
 * Bimodal Turn Classification Consistency (Lexical Override & turnClass: 'COMPLETE').
 */

import { describe, expect, it } from 'vitest';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import {
  BOUNDARY_CORPUS,
  makeDuplexProbs,
  PAUSE_THRESHOLDS,
  PROB_FIXTURES,
} from './fixtures/testCorpus';

describe('Feature F1: Bimodal Turn Decision Consistency (Tier 1 & Tier 2)', () => {
  describe('Tier 1: Feature Coverage (Happy Path Turn Completion)', () => {
    it('T1-F1-01: commits Mandarin complete sentence with turnClass COMPLETE', () => {
      const decision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: '帮我看一下这个代码。',
        tailText: '',
        pauseMs: 240,
        assistantSpeaking: false,
        speechDurationMs: 1200,
        rmsDb: -22,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.combinedText).toBe('帮我看一下这个代码。');
      expect(decision.reason).toMatch(/complete/i);
    });

    it('T1-F1-02: commits English question with turnClass COMPLETE', () => {
      const decision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: 'Can you optimize the WebGPU shader?',
        tailText: '',
        pauseMs: 250,
        assistantSpeaking: false,
        speechDurationMs: 1400,
        rmsDb: -24,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.combinedText).toBe('Can you optimize the WebGPU shader?');
    });

    it('T1-F1-03: commits bilingual code-switching complete question', () => {
      const decision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: '这个 shader 的 bloom 效果怎么写？',
        tailText: '',
        pauseMs: 230,
        assistantSpeaking: false,
        speechDurationMs: 1500,
        rmsDb: -23,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.combinedText).toBe('这个 shader 的 bloom 效果怎么写？');
    });

    it('T1-F1-04: lexical completeness overrides acoustic noise/BACKCHANNEL to emit turnClass COMPLETE', () => {
      // Acoustic model heavily biased towards BACKCHANNEL due to background noise or short syllables,
      // but lexical text is a fully formed sentence without terminal punctuation.
      const decision = decideBimodalTurn({
        probs: makeDuplexProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
        stableText: '帮我排查一下这个方案的可行性',
        tailText: '',
        pauseMs: 240,
        assistantSpeaking: false,
        speechDurationMs: 1100,
        rmsDb: -25,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.turnClass).not.toBe('BACKCHANNEL');
      expect(decision.reason).toBe('lexical_complete_commit');
    });

    it('T1-F1-05: commits acoustic complete sentence with compound pause threshold (450ms+)', () => {
      const decision = decideBimodalTurn({
        probs: makeDuplexProbs({ COMPLETE: 0.70 }),
        stableText: '我想去海边散步',
        tailText: '',
        pauseMs: PAUSE_THRESHOLDS.COMPOUND_THRESHOLD + 10, // 460ms
        assistantSpeaking: false,
        speechDurationMs: 900,
        rmsDb: -26,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
    });
  });

  describe('Tier 2: Boundary Value Analysis & Extreme Stress Cases', () => {
    it('T2-F1-01: exact 219ms vs 220ms pause threshold Boundary Value Analysis (BVA)', () => {
      const completeSentence = BOUNDARY_CORPUS.exactPauseBva.text;

      // 1. Below threshold (219ms): must NOT commit yet
      const subThreshold = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: completeSentence,
        tailText: '',
        pauseMs: BOUNDARY_CORPUS.exactPauseBva.pauseSubMs, // 219ms
        assistantSpeaking: false,
        speechDurationMs: 1200,
      });
      expect(subThreshold.action).toBe('CONTINUE_WAITING');
      expect(subThreshold.reason).toBe('awaiting_pause_threshold');

      // 2. Exactly at threshold (220ms): must commit immediately with turnClass COMPLETE
      const atThreshold = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: completeSentence,
        tailText: '',
        pauseMs: BOUNDARY_CORPUS.exactPauseBva.pauseCommitMs, // 220ms
        assistantSpeaking: false,
        speechDurationMs: 1200,
      });
      expect(atThreshold.action).toBe('COMMIT_USER_TURN');
      expect(atThreshold.turnClass).toBe('COMPLETE');
    });

    it('T2-F1-02: acoustic BACKCHANNEL flood (>= 0.88) on 30-char sentence overrides noise', () => {
      const substantive30Char = '帮我排查一下 WebGPU compute pipeline 的 OOM 崩溃';
      expect(substantive30Char.length).toBeGreaterThanOrEqual(25);

      // A: At commit pause (240ms) -> commits with COMPLETE
      const committed = decideBimodalTurn({
        probs: PROB_FIXTURES.noisyBackchannelFlood, // BACKCHANNEL: 0.89
        stableText: substantive30Char,
        tailText: '',
        pauseMs: 240,
        assistantSpeaking: false,
        speechDurationMs: 1600,
        rmsDb: -21,
      });
      expect(committed.action).toBe('COMMIT_USER_TURN');
      expect(committed.turnClass).toBe('COMPLETE');
      expect(committed.reason).toBe('lexical_complete_commit');

      // B: Sub-threshold pause (140ms) -> waits, but fallback turnClass must NOT be BACKCHANNEL
      const subPause = decideBimodalTurn({
        probs: PROB_FIXTURES.noisyBackchannelFlood,
        stableText: substantive30Char,
        tailText: '',
        pauseMs: 140,
        assistantSpeaking: false,
        speechDurationMs: 1600,
        rmsDb: -21,
      });
      expect(subPause.action).toBe('CONTINUE_WAITING');
      expect(subPause.turnClass).toBe('COMPLETE');
    });

    it('T2-F1-03: whitespace-only and silence inputs are rejected as sub-threshold noise', () => {
      for (const ws of BOUNDARY_CORPUS.whitespaceOnly) {
        const wsDecision = decideBimodalTurn({
          probs: PROB_FIXTURES.clearComplete,
          stableText: ws,
          tailText: '',
          pauseMs: 500,
          assistantSpeaking: false,
          speechDurationMs: 100,
          rmsDb: -65,
        });
        expect(wsDecision.action).toBe('CONTINUE_WAITING');
        expect(wsDecision.reason).toBe('silence_or_subthreshold_noise');
      }

      const silenceDecision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: BOUNDARY_CORPUS.silenceInput.text,
        tailText: '',
        pauseMs: 600,
        assistantSpeaking: false,
        speechDurationMs: BOUNDARY_CORPUS.silenceInput.speechDurationMs,
        rmsDb: BOUNDARY_CORPUS.silenceInput.rmsDb,
      });
      expect(silenceDecision.action).toBe('CONTINUE_WAITING');
      expect(silenceDecision.reason).toBe('silence_or_subthreshold_noise');
    });

    it('T2-F1-04: 500+ character user utterance handles gracefully without regex stack overflow', () => {
      const longInput = BOUNDARY_CORPUS.longUtterance500;
      expect(longInput.length).toBeGreaterThan(500);

      const decision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: longInput,
        tailText: '',
        pauseMs: 350,
        assistantSpeaking: false,
        speechDurationMs: 6500,
        rmsDb: -20,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.combinedText.length).toBe(longInput.length);
    });

    it('T2-F1-05: punctuation soup & symbols handled cleanly and committed', () => {
      const soup = BOUNDARY_CORPUS.punctuationSoup;
      const decision = decideBimodalTurn({
        probs: PROB_FIXTURES.clearComplete,
        stableText: soup,
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
        rmsDb: -22,
      });

      expect(decision.action).toBe('COMMIT_USER_TURN');
      expect(decision.turnClass).toBe('COMPLETE');
      expect(decision.combinedText).toBe(soup);
    });
  });
});
