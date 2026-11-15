import { describe, expect, it } from 'vitest';

import {
  SOPHON_LIVE_FRONT_BRAIN_PROMPT,
  estimateBilingualTokens,
  FrontBrainStreamParser,
} from '@/live/brain/frontBrain';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import {
  DUPLEX_TURN_CLASSES,
  type DuplexTurnProbs,
} from '@/live/turn/types';

function makeProbs(partial: Partial<DuplexTurnProbs>): DuplexTurnProbs {
  const base: DuplexTurnProbs = {
    COMPLETE: partial.COMPLETE ?? 0.05,
    INCOMPLETE: partial.INCOMPLETE ?? 0.05,
    BACKCHANNEL: partial.BACKCHANNEL ?? 0.05,
    WAIT_INTERRUPT: partial.WAIT_INTERRUPT ?? 0.05,
  };
  const sum = base.COMPLETE + base.INCOMPLETE + base.BACKCHANNEL + base.WAIT_INTERRUPT;
  return {
    COMPLETE: base.COMPLETE / sum,
    INCOMPLETE: base.INCOMPLETE / sum,
    BACKCHANNEL: base.BACKCHANNEL / sum,
    WAIT_INTERRUPT: base.WAIT_INTERRUPT / sum,
  };
}

describe('Empirical Challenger: SOPHON_LIVE_FRONT_BRAIN_PROMPT Contract & Tag Integrity', () => {
  it('does NOT contain any <delegate .../> XML tags or delegation protocol instructions', () => {
    // 1. Check for <delegate tags
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toMatch(/<delegate\b/i);
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toMatch(/<\/delegate>/i);
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toMatch(/<delegate\s*\/>/i);

    // 2. Check for any other XML or HTML tags (<...>)
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toMatch(/<[a-zA-Z_:][\w:.-]*[^>]*>/);

    // 3. Check for obsolete delegation phrases
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('Delegation Protocol');
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('Heavy tasks: emit');
  });

  it('preserves all 7 required inline emotion tags', () => {
    const requiredEmotionTags = [
      '[happy]',
      '[laugh]',
      '[sigh]',
      '[shy]',
      '[surprised]',
      '[relaxed]',
      '[sad]',
    ];

    for (const tag of requiredEmotionTags) {
      expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).toContain(tag);
    }
  });

  it('keeps prompt compact and well within 900 token limit', () => {
    const tokenEst = estimateBilingualTokens(SOPHON_LIVE_FRONT_BRAIN_PROMPT);
    expect(tokenEst).toBeLessThan(200); // Should be very concise (~70-100 tokens)
    expect(tokenEst).toBeGreaterThan(30);
  });

  it('maintains FrontBrainStreamParser backwards compatibility', () => {
    const parser = new FrontBrainStreamParser();
    const step = parser.push('好的，让我来看一下。<delegate task="code_analysis" urgency="deep" />');
    parser.flush();
    expect(step.cleanDelta).toContain('好的，让我来看一下。');
    expect(step.newDelegates.length).toBe(1);
    expect(step.newDelegates[0].task).toBe('code_analysis');
    expect(step.newDelegates[0].urgency).toBe('deep');
  });
});

describe('Empirical Challenger: Acoustic Collision & Incomplete Priority Stress Tests', () => {
  it('prioritizes acoustic INCOMPLETE (probs.INCOMPLETE >= 0.48) over lexical completeness without punct', () => {
    // Substantive sentence with no lexical incomplete cue and no terminal punctuation:
    const substantiveText = '我想了解一下你的具体看法';

    // 1. At pauseMs = 220 (which would commit under isLexicalComplete if Section 5 ran first):
    // Section 3 MUST intercept because probs.INCOMPLETE >= 0.48 and !terminalPunct.
    const pause220 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: substantiveText,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(pause220.action).toBe('CONTINUE_WAITING');
    expect(pause220.turnClass).toBe('INCOMPLETE');
    expect(pause220.reason).toBe('acoustic_incomplete_continue_waiting');

    // 2. At pauseMs = 500: still CONTINUE_WAITING
    const pause500 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: substantiveText,
      tailText: '',
      pauseMs: 500,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(pause500.action).toBe('CONTINUE_WAITING');
    expect(pause500.turnClass).toBe('INCOMPLETE');

    // 3. At pauseMs = 650: transition to HOLD_SOFT
    const pause650 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: substantiveText,
      tailText: '',
      pauseMs: 650,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(pause650.action).toBe('HOLD_SOFT');
    expect(pause650.turnClass).toBe('INCOMPLETE');
    expect(pause650.reason).toBe('acoustic_incomplete_soft_hold');

    // 4. At pauseMs = 1399: still HOLD_SOFT
    const pause1399 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: substantiveText,
      tailText: '',
      pauseMs: 1399,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(pause1399.action).toBe('HOLD_SOFT');
    expect(pause1399.turnClass).toBe('INCOMPLETE');

    // 5. At pauseMs >= 1400: acoustic incomplete timeout triggers commit
    const pause1400 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: substantiveText,
      tailText: '',
      pauseMs: 1400,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(pause1400.action).toBe('COMMIT_USER_TURN');
    expect(pause1400.turnClass).toBe('COMPLETE');
    expect(pause1400.reason).toBe('acoustic_incomplete_long_pause_commit');
  });

  it('allows terminal punctuation to override acoustic INCOMPLETE at pauseMs >= 220', () => {
    // If the user explicitly ended with terminal punctuation, !terminalPunct is false,
    // so acoustic INCOMPLETE guard in Section 3 does not block it.
    const punctText = '我想了解一下你的具体看法。';
    const punctDecision = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.65, COMPLETE: 0.15 }),
      stableText: punctText,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(punctDecision.action).toBe('COMMIT_USER_TURN');
    expect(punctDecision.turnClass).toBe('COMPLETE');
  });

  it('strictly delays commit for "我想去但因为..."', () => {
    const text = '我想去但因为...';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('strictly delays commit for "我想去但因为"', () => {
    const text = '我想去但因为';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('strictly delays commit for "我觉得这个方案虽然有道理但是"', () => {
    const text = '我觉得这个方案虽然有道理但是';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('contrasts unclosed clause prefix "如果把参数调大" with complete question', () => {
    // Unclosed conditional clause prefix without conclusion
    const unclosed = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '如果把参数调大',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(unclosed.action).toBe('CONTINUE_WAITING');
    expect(unclosed.turnClass).toBe('INCOMPLETE');

    // Complete sentence with unclosed prefix resolved with conclusion
    const complete = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '如果把参数调大那就没有显存瓶颈了',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(complete.action).toBe('COMMIT_USER_TURN');
    expect(complete.turnClass).toBe('COMPLETE');
    expect(complete.reason).toBe('lexical_complete_commit');
  });

  it('strictly delays commit for "I want to check that because..."', () => {
    const text = 'I want to check that because...';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('strictly delays commit for "We could try that although"', () => {
    const text = 'We could try that although';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('strictly delays commit for trailing "without"', () => {
    const text = 'We cannot finish the render pass without';
    const decision220 = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(decision220.action).not.toBe('COMMIT_USER_TURN');
    expect(decision220.turnClass).toBe('INCOMPLETE');
  });

  it('strictly delays commit for unclosed English clauses (because of, due to, even though, as long as)', () => {
    const unclosedClauses = [
      'because of the memory bandwidth on mobile devices',
      'due to unexpected latency spikes',
      'even though we optimized the shader code',
      'as long as the framerate drops',
    ];

    for (const text of unclosedClauses) {
      const decision220 = decideBimodalTurn({
        probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
        stableText: text,
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: false,
        speechDurationMs: 1500,
      });
      expect(decision220.action, `Failed for "${text}"`).not.toBe('COMMIT_USER_TURN');
      expect(decision220.turnClass, `Failed for "${text}"`).toBe('INCOMPLETE');
    }

    // Complete clause with comma/period commits cleanly
    const completeSentence = 'Because of the memory bandwidth, we reduced texture size.';
    const completeDecision = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: completeSentence,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1500,
    });
    expect(completeDecision.action).toBe('COMMIT_USER_TURN');
    expect(completeDecision.turnClass).toBe('COMPLETE');
  });
});

describe('Empirical Challenger: Assistant Speaking Interaction (Barge-In vs Turn-Taking)', () => {
  it('handles pure backchannels vs barge-in interruptions while assistant is speaking', () => {
    // 1. Pure backchannels must NEVER barge-in
    const backchannels = ['嗯嗯', '对对对', 'yeah', 'mm-hmm', 'ok'];
    for (const bc of backchannels) {
      const decision = decideBimodalTurn({
        probs: makeProbs({ BACKCHANNEL: 0.85 }),
        stableText: bc,
        tailText: '',
        pauseMs: 200,
        assistantSpeaking: true,
        speechDurationMs: 400,
      });
      expect(decision.action).toBe('BACKCHANNEL_ACK');
      expect(decision.turnClass).toBe('BACKCHANNEL');
    }

    // 2. Pure wait cues must cause WAIT_SILENT_HOLD
    const waitCues = ['等一下', 'wait', 'hold on', '先停一下'];
    for (const cue of waitCues) {
      const decision = decideBimodalTurn({
        probs: makeProbs({ WAIT_INTERRUPT: 0.85 }),
        stableText: cue,
        tailText: '',
        pauseMs: 200,
        assistantSpeaking: true,
        speechDurationMs: 500,
      });
      expect(decision.action).toBe('WAIT_SILENT_HOLD');
      expect(decision.turnClass).toBe('WAIT_INTERRUPT');
    }

    // 3. Wait cue with payload must BARGE_IN_COMMIT
    const waitPayload = decideBimodalTurn({
      probs: makeProbs({ WAIT_INTERRUPT: 0.70 }),
      stableText: '等一下，我换一个问题',
      tailText: '',
      pauseMs: 180,
      assistantSpeaking: true,
      speechDurationMs: 1100,
    });
    expect(waitPayload.action).toBe('BARGE_IN_COMMIT');
    expect(waitPayload.turnClass).toBe('WAIT_INTERRUPT');
    expect(waitPayload.reason).toBe('barge_in_wait_with_substantive_query');

    // 4. Substantive interruption without wait cue (e.g. user speaking over assistant)
    const substantiveBargeIn = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.75 }),
      stableText: '不对，你刚才说的那点有逻辑漏洞。',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: true,
      speechDurationMs: 1600,
    });
    expect(substantiveBargeIn.action).toBe('BARGE_IN_COMMIT');
    expect(substantiveBargeIn.turnClass).toBe('COMPLETE');

    // 5. Incomplete speech while assistant is speaking must NOT trigger barge-in commit
    const incompleteBargeIn = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.80 }),
      stableText: '我想说但是因为',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: true,
      speechDurationMs: 800,
    });
    expect(incompleteBargeIn.action).toBe('CONTINUE_WAITING');
    expect(incompleteBargeIn.turnClass).toBe('INCOMPLETE');
  });

  it('contrasts assistantSpeaking: true vs false on substantive speech under BACKCHANNEL bias', () => {
    const text = '帮我查一下这个方案的可行性';

    // Case A: assistant is NOT speaking (standard turn taking)
    // Under BACKCHANNEL bias (synthetic audio), lexical completeness overrides and commits at 220ms
    const idleAssistant = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1000,
    });
    expect(idleAssistant.action).toBe('COMMIT_USER_TURN');
    expect(idleAssistant.turnClass).toBe('COMPLETE');
    expect(idleAssistant.reason).toBe('lexical_complete_commit');

    // Case B: assistant IS speaking (barge-in branch)
    // If probs.BACKCHANNEL is high (0.85) and there is no terminal punct or WAIT_INTERRUPT,
    // barge-in guard requires explicit high COMPLETE (>= 0.5) or terminal punct to cut off the assistant.
    // Thus it does NOT barge in erroneously as a backchannel!
    const speakingAssistant = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: text,
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: true,
      speechDurationMs: 1000,
    });
    expect(speakingAssistant.action).toBe('CONTINUE_WAITING');
  });
});

describe('Empirical Challenger: Boundary Conditions & Robustness Stress Tests', () => {
  it('tests character count boundary conditions (0, 1, 2 chars)', () => {
    // 0 chars: subthreshold noise guard
    const zeroChar = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.8 }),
      stableText: '   ',
      tailText: '',
      pauseMs: 250,
      assistantSpeaking: false,
      speechDurationMs: 100,
      rmsDb: -60,
    });
    expect(zeroChar.action).toBe('CONTINUE_WAITING');

    // 1 char non-backchannel: e.g. "查"
    // charCount = 1 < 2, so isLexicalComplete is false.
    // At pauseMs = 220, it should not trigger lexical_complete_commit.
    const oneChar = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '查',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 500,
    });
    expect(oneChar.action).toBe('CONTINUE_WAITING');

    // At long pause (>= 950ms), even 1 char commits
    const oneCharLongPause = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '查',
      tailText: '',
      pauseMs: 960,
      assistantSpeaking: false,
      speechDurationMs: 500,
    });
    expect(oneCharLongPause.action).toBe('COMMIT_USER_TURN');

    // 2 chars substantive: e.g. "开始"
    // charCount = 2, isLexicalComplete is true.
    const twoChars = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '开始',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 500,
    });
    expect(twoChars.action).toBe('COMMIT_USER_TURN');
    expect(twoChars.turnClass).toBe('COMPLETE');
    expect(twoChars.reason).toBe('lexical_complete_commit');
  });

  it('tests pause duration threshold transitions', () => {
    const text = '测试系统状态';
    const makeWithPause = (p: number) =>
      decideBimodalTurn({
        probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
        stableText: text,
        tailText: '',
        pauseMs: p,
        assistantSpeaking: false,
        speechDurationMs: 800,
      });

    // Below 220ms: CONTINUE_WAITING, but turnClass is COMPLETE (overridden from BACKCHANNEL)
    expect(makeWithPause(0).action).toBe('CONTINUE_WAITING');
    expect(makeWithPause(0).turnClass).toBe('COMPLETE');

    expect(makeWithPause(100).action).toBe('CONTINUE_WAITING');
    expect(makeWithPause(100).turnClass).toBe('COMPLETE');

    expect(makeWithPause(219).action).toBe('CONTINUE_WAITING');
    expect(makeWithPause(219).turnClass).toBe('COMPLETE');

    // At exactly 220ms and above: COMMIT_USER_TURN
    expect(makeWithPause(220).action).toBe('COMMIT_USER_TURN');
    expect(makeWithPause(220).turnClass).toBe('COMPLETE');
    expect(makeWithPause(220).reason).toBe('lexical_complete_commit');

    expect(makeWithPause(500).action).toBe('COMMIT_USER_TURN');
    expect(makeWithPause(1000).action).toBe('COMMIT_USER_TURN');
  });

  it('fuzzes 1000 randomized state combinations without exceptions or invalid states', () => {
    const sampleTexts = [
      '',
      '   ',
      '嗯',
      '嗯嗯',
      '等等',
      'wait',
      '好的',
      '帮我看看',
      '帮我看看这个方案',
      '我想去但是因为',
      'What do you think about this?',
      'Let me know when ready, okay?',
      '如果今天下雨',
      '如果今天下雨那我们就改天吧。',
      'Hold on wait a second!',
      '一',
      'abc',
      '1234567890',
    ];

    const validActions = new Set([
      'CONTINUE_WAITING',
      'HOLD_SOFT',
      'COMMIT_USER_TURN',
      'BACKCHANNEL_ACK',
      'WAIT_SILENT_HOLD',
      'BARGE_IN_COMMIT',
    ]);

    const validClasses = new Set(DUPLEX_TURN_CLASSES);

    let seed = 42;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    for (let i = 0; i < 1000; i++) {
      const text = sampleTexts[Math.floor(rand() * sampleTexts.length)];
      const pauseMs = Math.floor(rand() * 2500);
      const speechDurationMs = Math.floor(rand() * 4000);
      const assistantSpeaking = rand() > 0.5;
      const rmsDb = -70 + rand() * 60;

      const rawP = {
        COMPLETE: rand(),
        INCOMPLETE: rand(),
        BACKCHANNEL: rand(),
        WAIT_INTERRUPT: rand(),
      };

      const result = decideBimodalTurn({
        probs: rawP,
        stableText: text,
        tailText: '',
        pauseMs,
        speechDurationMs,
        assistantSpeaking,
        rmsDb,
      });

      expect(validActions.has(result.action)).toBe(true);
      expect(validClasses.has(result.turnClass)).toBe(true);
      expect(result.probs).toBeDefined();
      expect(typeof result.reason).toBe('string');
      expect(result.pauseMs).toBe(pauseMs);
    }
  });
});


describe('Empirical Challenger: Hung Live-Mic & Short Incomplete Timeout Regression Guards', () => {
  it('commits trailing-comma / short incomplete utterances ("嗯，" and "小春，") after 1800ms pause instead of deadlocking forever', () => {
    const d1 = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.72, COMPLETE: 0.2 }),
      stableText: '嗯，',
      tailText: '',
      pauseMs: 1850,
      speechDurationMs: 420,
      assistantSpeaking: false,
      rmsDb: -32,
    });
    expect(d1.action).toBe('COMMIT_USER_TURN');

    const d2 = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.6, INCOMPLETE: 0.3 }),
      stableText: '小春，',
      tailText: '',
      pauseMs: 1820,
      speechDurationMs: 520,
      assistantSpeaking: false,
      rmsDb: -30,
    });
    expect(d2.action).toBe('COMMIT_USER_TURN');
  });

  it('commits unpunctuated mid-length utterance ("哈哈哈。oh,我把橄榄树倒") in Branch B at >=1400ms and interrupts in Branch A at >=950ms', () => {
    const branchB = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.68, COMPLETE: 0.25 }),
      stableText: '哈哈哈。oh,我把橄榄树倒',
      tailText: '',
      pauseMs: 1450,
      speechDurationMs: 1900,
      assistantSpeaking: false,
      rmsDb: -28,
    });
    expect(branchB.action).toBe('COMMIT_USER_TURN');

    const branchA = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.55, COMPLETE: 0.35 }),
      stableText: '哈哈哈。oh,我把橄榄树倒',
      tailText: '',
      pauseMs: 980,
      speechDurationMs: 1900,
      assistantSpeaking: true,
      rmsDb: -26,
    });
    expect(branchA.action).toBe('BARGE_IN_COMMIT');
  });
});
