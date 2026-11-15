import { describe, expect, it } from 'vitest';
import { decideBimodalTurn } from '../bimodalTurnFusion';
import type { DuplexTurnProbs } from '../types';
import {
  SOPHON_LIVE_FRONT_BRAIN_PROMPT,
  FrontBrainStreamParser,
  estimateBilingualTokens,
  normalizeEmotionTag,
} from '../../brain/frontBrain';

function makeProbs(partial: Partial<DuplexTurnProbs>): DuplexTurnProbs {
  const base: DuplexTurnProbs = {
    COMPLETE: 0.1,
    INCOMPLETE: 0.1,
    BACKCHANNEL: 0.1,
    WAIT_INTERRUPT: 0.1,
    ...partial,
  };
  const sum = base.COMPLETE + base.INCOMPLETE + base.BACKCHANNEL + base.WAIT_INTERRUPT;
  return {
    COMPLETE: base.COMPLETE / sum,
    INCOMPLETE: base.INCOMPLETE / sum,
    BACKCHANNEL: base.BACKCHANNEL / sum,
    WAIT_INTERRUPT: base.WAIT_INTERRUPT / sum,
  };
}

describe('Empirical Adversarial Stress Test Harness — Milestone 1', () => {
  describe('1. Extreme Acoustic Noise (High BACKCHANNEL bias override)', () => {
    const extremeBackchannelProbs = makeProbs({
      BACKCHANNEL: 0.95,
      COMPLETE: 0.01,
      INCOMPLETE: 0.02,
      WAIT_INTERRUPT: 0.02,
    });

    const testPhrases = [
      { text: '帮我查一下这个方案的可行性', lang: 'ZH' },
      { text: '我想了解一下昨天的会议纪要', lang: 'ZH' },
      { text: '请问下周一的天气怎么样', lang: 'ZH' },
      { text: '把这个函数的返回值改成布尔类型', lang: 'ZH' },
      { text: 'How do I fix this bug', lang: 'EN' },
      { text: 'Can you explain how WebGPU workgroup memory works', lang: 'EN' },
      { text: 'Please optimize the SQL query for user transactions', lang: 'EN' },
      { text: '帮我 check 一下 server log', lang: 'CS' },
      { text: '这个 PR 里面的 memory leak 怎么排查', lang: 'CS' },
      { text: '用 TypeScript 写一个 debounce 函数', lang: 'CS' },
    ];

    for (const { text, lang } of testPhrases) {
      it(`[${lang}] commits "${text}" with COMPLETE under 95% BACKCHANNEL bias at pauseMs=220`, () => {
        const result = decideBimodalTurn({
          probs: extremeBackchannelProbs,
          stableText: text,
          tailText: '',
          pauseMs: 220,
          assistantSpeaking: false,
          speechDurationMs: 800,
          rmsDb: -22,
        });

        expect(result.action).toBe('COMMIT_USER_TURN');
        expect(result.turnClass).toBe('COMPLETE');
        expect(result.reason).toBe('lexical_complete_commit');
      });

      it(`[${lang}] holds "${text}" with COMPLETE (not BACKCHANNEL) at micro-pause pauseMs=180`, () => {
        const result = decideBimodalTurn({
          probs: extremeBackchannelProbs,
          stableText: text,
          tailText: '',
          pauseMs: 180,
          assistantSpeaking: false,
          speechDurationMs: 800,
          rmsDb: -22,
        });

        expect(result.action).toBe('CONTINUE_WAITING');
        expect(result.turnClass).toBe('COMPLETE');
        expect(result.reason).toBe('awaiting_pause_threshold');
      });
    }
  });

  describe('2. Pause Threshold Boundary Conditions (219ms vs 220ms vs 221ms)', () => {
    const noisyProbs = makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 });
    const text = '帮我查一下这个方案的可行性';

    it('holds at pauseMs = 219ms without committing', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: text,
        tailText: '',
        pauseMs: 219,
        assistantSpeaking: false,
        speechDurationMs: 600,
        rmsDb: -20,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('awaiting_pause_threshold');
    });

    it('commits precisely at pauseMs = 220ms', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: text,
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
        rmsDb: -20,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('commits at pauseMs = 221ms', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: text,
        tailText: '',
        pauseMs: 221,
        assistantSpeaking: false,
        speechDurationMs: 600,
        rmsDb: -20,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('transitions to HOLD_SOFT at pauseMs = 650ms if incomplete', () => {
      const incompleteText = '帮我查一下这个方案因为';
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: incompleteText,
        tailText: '',
        pauseMs: 650,
        assistantSpeaking: false,
        speechDurationMs: 600,
        rmsDb: -20,
      });

      expect(result.action).toBe('HOLD_SOFT');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_soft_hold');
    });
  });

  describe('3. Punctuation & Whitespace Variations', () => {
    const noisyProbs = makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 });

    it('handles heavy leading and trailing whitespace cleanly', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '   帮我 check 一下 server log   \n\t',
        tailText: '   ',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('handles multiple terminal question marks ("???")', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: 'How do I fix this bug???',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('handles Chinese terminal punctuation ("？！")', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '这是真的吗？！',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('treats trailing comma as incomplete and does NOT commit at 220ms', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '帮我查一下，',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_continue_waiting');
    });

    it('handles trailing incomplete word with ellipsis ("我想问...") by holding', () => {
      const result = decideBimodalTurn({
        probs: makeProbs({ COMPLETE: 0.3, INCOMPLETE: 0.4 }),
        stableText: '我想问...',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_continue_waiting');
    });

    it('treats trailing ellipsis ("...") as hesitation, not terminal completion ("我想想...")', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '我想想...',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_continue_waiting');
    });

    it('treats Chinese trailing ellipsis ("…") and English ellipsis ("Let me see...") as hesitation', () => {
      const resultZh = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '我想想…',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
      });
      expect(resultZh.action).toBe('CONTINUE_WAITING');
      expect(resultZh.turnClass).toBe('INCOMPLETE');

      const resultEn = decideBimodalTurn({
        probs: noisyProbs,
        stableText: 'Let me see...',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
      });
      expect(resultEn.action).toBe('CONTINUE_WAITING');
      expect(resultEn.turnClass).toBe('INCOMPLETE');
    });
  });

  describe('4. Substantive vs Pure Backchannel vs Pause Cue Classification Boundaries', () => {
    const noisyBackchannelProbs = makeProbs({ BACKCHANNEL: 0.90, COMPLETE: 0.05 });

    it('preserves BACKCHANNEL classification for pure backchannel items ("好的", "知道了", "嗯哼")', () => {
      const items = ['好的', '知道了', '嗯哼', '对对对', 'ok', 'got it', 'sure'];
      for (const item of items) {
        const result = decideBimodalTurn({
          probs: noisyBackchannelProbs,
          stableText: item,
          tailText: '',
          pauseMs: 300,
          assistantSpeaking: false,
          speechDurationMs: 400,
        });

        expect(result.action).toBe('CONTINUE_WAITING');
        expect(result.turnClass).toBe('BACKCHANNEL');
      }
    });

    it('commits pure backchannel if pause exceeds 480ms when assistant is idle', () => {
      const result = decideBimodalTurn({
        probs: noisyBackchannelProbs,
        stableText: '好的',
        tailText: '',
        pauseMs: 500,
        assistantSpeaking: false,
        speechDurationMs: 400,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
    });

    it('never barges in on assistant with pure backchannel', () => {
      const items = ['嗯嗯', '对对', 'yeah', 'mm-hmm', '好的'];
      for (const item of items) {
        const result = decideBimodalTurn({
          probs: noisyBackchannelProbs,
          stableText: item,
          tailText: '',
          pauseMs: 200,
          assistantSpeaking: true,
          speechDurationMs: 350,
        });

        expect(result.action).toBe('BACKCHANNEL_ACK');
        expect(result.turnClass).toBe('BACKCHANNEL');
      }
    });

    it('holds silently on pure pause cue ("等等", "wait a second")', () => {
      const pauseItems = ['等等', '等一下', '稍等', 'wait', 'hold on'];
      for (const cue of pauseItems) {
        const resultIdle = decideBimodalTurn({
          probs: makeProbs({ WAIT_INTERRUPT: 0.7 }),
          stableText: cue,
          tailText: '',
          pauseMs: 300,
          assistantSpeaking: false,
          speechDurationMs: 400,
        });
        expect(resultIdle.action).toBe('WAIT_SILENT_HOLD');
        expect(resultIdle.turnClass).toBe('WAIT_INTERRUPT');

        const resultSpeaking = decideBimodalTurn({
          probs: makeProbs({ WAIT_INTERRUPT: 0.7 }),
          stableText: cue,
          tailText: '',
          pauseMs: 300,
          assistantSpeaking: true,
          speechDurationMs: 400,
        });
        expect(resultSpeaking.action).toBe('WAIT_SILENT_HOLD');
        expect(resultSpeaking.turnClass).toBe('WAIT_INTERRUPT');
      }
    });

    it('barges in when user says pause cue with substantive payload during assistant speech', () => {
      const result = decideBimodalTurn({
        probs: makeProbs({ WAIT_INTERRUPT: 0.6, COMPLETE: 0.3 }),
        stableText: '等一下，我想问另一个问题',
        tailText: '',
        pauseMs: 200,
        assistantSpeaking: true,
        speechDurationMs: 900,
      });

      expect(result.action).toBe('BARGE_IN_COMMIT');
      expect(result.turnClass).toBe('WAIT_INTERRUPT');
      expect(result.reason).toBe('barge_in_wait_with_substantive_query');
    });

    it('correctly handles substantive queries starting with "请问"', () => {
      const result = decideBimodalTurn({
        probs: noisyBackchannelProbs,
        stableText: '请问下周一的天气',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });
  });

  describe('5. Complex Clause & Compound Sentence Boundaries', () => {
    const noisyProbs = makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 });

    it('recognizes complete sentences containing "因为...所以..." as complete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '因为今天下雨，所以我决定留在家里看书',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1200,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('recognizes complete sentences containing "如果...就..." ending with noun as complete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '如果明天天气好，我们就一起去海滩',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('recognizes complete sentence ending with particle and punctuation as complete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '如果明天天气好，我们就一起去海滩玩吧。',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });

    it('recognizes complete sentences containing modal suggestion particle "吧" as complete', () => {
      const resultWithComma = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '如果明天天气好，我们就一起去海滩玩吧',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(resultWithComma.action).toBe('COMMIT_USER_TURN');
      expect(resultWithComma.turnClass).toBe('COMPLETE');
      expect(resultWithComma.reason).toBe('lexical_complete_commit');

      const resultWithoutComma = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '如果明天天气好我们就去海滩玩吧',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(resultWithoutComma.action).toBe('COMMIT_USER_TURN');
      expect(resultWithoutComma.turnClass).toBe('COMPLETE');
      expect(resultWithoutComma.reason).toBe('lexical_complete_commit');
    });

    it('treats trailing hesitation filler "这个吧" as incomplete and waits for timeout', () => {
      const resultShortPause = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '关于那个方案这个吧',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(resultShortPause.action).toBe('CONTINUE_WAITING');
      expect(resultShortPause.turnClass).toBe('INCOMPLETE');

      const resultTimeout = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '关于那个方案这个吧',
        tailText: '',
        pauseMs: 1500,
        assistantSpeaking: false,
        speechDurationMs: 1100,
      });

      expect(resultTimeout.action).toBe('COMMIT_USER_TURN');
      expect(resultTimeout.turnClass).toBe('COMPLETE');
      expect(resultTimeout.reason).toBe('incomplete_cue_timeout_commit');
    });

    it('recognizes unclosed "如果..." clause as incomplete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '如果明天天气好',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 600,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_continue_waiting');
    });

    it('recognizes subordinate unclosed conditional clause ("帮我查一下如果把参数调大") as incomplete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '帮我查一下如果把参数调大',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

      expect(result.action).toBe('CONTINUE_WAITING');
      expect(result.turnClass).toBe('INCOMPLETE');
      expect(result.reason).toBe('lexical_incomplete_continue_waiting');
    });

    it('recognizes subordinate conditional with consequence as complete', () => {
      const result = decideBimodalTurn({
        probs: noisyProbs,
        stableText: '帮我查一下如果把参数调大那就没有显存瓶颈了',
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1200,
      });

      expect(result.action).toBe('COMMIT_USER_TURN');
      expect(result.turnClass).toBe('COMPLETE');
      expect(result.reason).toBe('lexical_complete_commit');
    });
  });

  describe('6. FrontBrain Prompt Cleanup & Parser Compatibility', () => {
    it('SOPHON_LIVE_FRONT_BRAIN_PROMPT does not contain <delegate XML tags or delegation protocol', () => {
      expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('<delegate');
      expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('Delegation Protocol:');
      expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('delegate');
    });

    it('SOPHON_LIVE_FRONT_BRAIN_PROMPT strictly preserves all 7 inline emotion tags', () => {
      const requiredTags = [
        '[happy]',
        '[laugh]',
        '[sigh]',
        '[shy]',
        '[surprised]',
        '[relaxed]',
        '[sad]',
      ];
      for (const tag of requiredTags) {
        expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).toContain(tag);
      }
    });

    it('SOPHON_LIVE_FRONT_BRAIN_PROMPT is well within the 900-token budget', () => {
      const tokenCount = estimateBilingualTokens(SOPHON_LIVE_FRONT_BRAIN_PROMPT);
      expect(tokenCount).toBeLessThan(900);
      expect(tokenCount).toBeLessThan(150); // It is a compact ~80 token prompt
    });

    it('FrontBrainStreamParser parses emotion tags seamlessly', () => {
      const parser = new FrontBrainStreamParser();
      const chunk1 = parser.push('[happy] 今天天气真好啊！');
      expect(chunk1.emotion).toBe('happy');
      expect(chunk1.cleanDelta).toBe('今天天气真好啊！');

      const chunk2 = parser.push('[shy] 见到你很高兴。');
      expect(chunk2.emotion).toBe('shy');
      expect(chunk2.cleanDelta).toBe('见到你很高兴。');
    });

    it('FrontBrainStreamParser gracefully ignores/parses legacy <delegate> tags without crash', () => {
      const parser = new FrontBrainStreamParser();
      const output = parser.push('<delegate task="analyze log" urgency="deep"/>好的我帮你看看。');
      expect(output.newDelegates).toHaveLength(1);
      expect(output.newDelegates[0].task).toBe('analyze log');
      expect(output.newDelegates[0].urgency).toBe('deep');
      expect(output.cleanDelta).toBe('好的我帮你看看。');
    });

    it('normalizeEmotionTag maps all synonyms correctly', () => {
      expect(normalizeEmotionTag('happy')).toBe('happy');
      expect(normalizeEmotionTag('laugh')).toBe('happy');
      expect(normalizeEmotionTag('excited')).toBe('happy');
      expect(normalizeEmotionTag('sigh')).toBe('sad');
      expect(normalizeEmotionTag('sad')).toBe('sad');
      expect(normalizeEmotionTag('blush')).toBe('shy');
      expect(normalizeEmotionTag('shy')).toBe('shy');
      expect(normalizeEmotionTag('calm')).toBe('relaxed');
      expect(normalizeEmotionTag('surprised')).toBe('surprised');
      expect(normalizeEmotionTag('unknown_foo')).toBeNull();
    });
  });
});
