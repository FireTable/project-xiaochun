import { describe, it, expect } from 'vitest';
import {
  applyHeuristicPunctuation,
  formatDraftPunctuation,
  finalizePunctuation,
  normalizePunctuationSpacing,
  PunctuationPipeline,
} from '../punctuation';

describe('Punctuation Engine & Pipeline', () => {
  describe('Draft vs Finalize Punctuation', () => {
    it('formatDraftPunctuation inserts topic and conjunction commas but NEVER adds terminal periods or questions', () => {
      expect(formatDraftPunctuation('今天晚上我们')).toBe('今天晚上我们');
      expect(formatDraftPunctuation('今天天气很好但是风有点大')).toBe('今天天气很好，但是风有点大');
      expect(formatDraftPunctuation('小春你今天冷吗')).toBe('小春，你今天冷吗');
      expect(formatDraftPunctuation('对了今天晚上吃什么')).toBe('对了，今天晚上吃什么');
      // Notice: NO trailing period, question, or exclamation marks
      expect(formatDraftPunctuation('我们去吃火锅好不好')).toBe('我们去吃火锅好不好');
    });

    it('finalizePunctuation applies terminal marks appropriately', () => {
      expect(finalizePunctuation('今天晚上我们')).toBe('今天晚上我们。');
      expect(finalizePunctuation('我们去吃火锅好不好')).toBe('我们去吃火锅好不好？');
      expect(finalizePunctuation('哇好漂亮')).toBe('哇好漂亮！');
    });
  });

  describe('normalizePunctuationSpacing', () => {
    it('removes spaces before and after Chinese/ASCII punctuation', () => {
      expect(normalizePunctuationSpacing('好的 ， 知道了 。')).toBe('好的，知道了。');
      expect(normalizePunctuationSpacing('测试 ！ 成功 ？')).toBe('测试！成功？');
    });

    it('converts trailing halfwidth punctuation to fullwidth for CJK', () => {
      expect(normalizePunctuationSpacing('你好?')).toBe('你好？');
      expect(normalizePunctuationSpacing('太棒了!')).toBe('太棒了！');
      expect(normalizePunctuationSpacing('等等,')).toBe('等等，');
      expect(normalizePunctuationSpacing('是的.')).toBe('是的。');
    });
  });

  describe('Stage 1: applyHeuristicPunctuation', () => {
    describe('Chinese Question Detection', () => {
      it('handles conversational head particles, topic markers, and converts halfwidth ? to fullwidth ？', () => {
        expect(applyHeuristicPunctuation('是吗现在的话你可以正常识别吗?')).toBe(
          '是吗，现在的话，你可以正常识别吗？',
        );
        expect(applyHeuristicPunctuation('小春你今天冷吗')).toBe('小春，你今天冷吗？');
        expect(applyHeuristicPunctuation('对了今天晚上吃什么')).toBe('对了，今天晚上吃什么？');
      });

      it('detects definite question particles (吗, 么, 嘛)', () => {
        expect(applyHeuristicPunctuation('你今天冷吗')).toBe('你今天冷吗？');
        expect(applyHeuristicPunctuation('可以这样么')).toBe('可以这样么？');
        expect(applyHeuristicPunctuation('你吃不吃嘛')).toBe('你吃不吃嘛？');
      });

      it('detects interrogative pronouns (谁, 什么, 怎么, 哪里, 几点, 多少)', () => {
        expect(applyHeuristicPunctuation('现在几点了')).toBe('现在几点了？');
        expect(applyHeuristicPunctuation('今天晚上吃什么')).toBe('今天晚上吃什么？');
        expect(applyHeuristicPunctuation('你是谁')).toBe('你是谁？');
        expect(applyHeuristicPunctuation('这个要多少钱')).toBe('这个要多少钱？');
        expect(applyHeuristicPunctuation('你在哪里')).toBe('你在哪里？');
      });

      it('detects affirmative-negative structures (是不是, 好不好, A不A)', () => {
        expect(applyHeuristicPunctuation('我们是不是该走了')).toBe('我们是不是该走了？');
        expect(applyHeuristicPunctuation('下午去散步好不好')).toBe('下午去散步好不好？');
        expect(applyHeuristicPunctuation('今天海边冷不冷')).toBe('今天海边冷不冷？');
        expect(applyHeuristicPunctuation('这件衣服你喜不喜欢')).toBe('这件衣服你喜不喜欢？');
      });

      it('correctly distinguishes soft particles (呢/吧) in questions vs statements', () => {
        // Question: soft particle + interrogative structure
        expect(applyHeuristicPunctuation('晚上吃什么呢')).toBe('晚上吃什么呢？');
        expect(applyHeuristicPunctuation('去不去呢')).toBe('去不去呢？');
        expect(applyHeuristicPunctuation('你在哪里呢')).toBe('你在哪里呢？');

        // Statement: soft particle as declarative mood
        expect(applyHeuristicPunctuation('小春今天海边的风很舒服呢')).toBe('小春，今天海边的风很舒服呢。');
        expect(applyHeuristicPunctuation('那我们走吧')).toBe('那我们走吧。');
        expect(applyHeuristicPunctuation('海浪声真好听呀')).toBe('海浪声真好听呀。');
      });
    });

    describe('Chinese Exclamation Detection', () => {
      it('appends exclamation marks for strong expressive utterances', () => {
        expect(applyHeuristicPunctuation('哇好漂亮')).toBe('哇好漂亮！');
        expect(applyHeuristicPunctuation('你太棒了')).toBe('你太棒了！');
        expect(applyHeuristicPunctuation('小春你太棒了')).toBe('小春，你太棒了！');
        expect(applyHeuristicPunctuation('今天天气真好太厉害了')).toBe('今天天气真好太厉害了！');
        expect(applyHeuristicPunctuation('天哪真的假的')).toBe('天哪真的假的？'); // 疑问优先
      });
    });

    describe('Chinese Declarative Statements & Intra-sentence Commas', () => {
      it('appends periods to regular statements', () => {
        expect(applyHeuristicPunctuation('好的我知道了')).toBe('好的我知道了。');
        expect(applyHeuristicPunctuation('今天阳光很温暖')).toBe('今天阳光很温暖。');
      });

      it('inserts commas before logical conjunctions in compound sentences', () => {
        expect(applyHeuristicPunctuation('今天天气很好但是风有点大')).toBe('今天天气很好，但是风有点大。');
        expect(applyHeuristicPunctuation('我想去海边散步然后买杯咖啡')).toBe('我想去海边散步，然后买杯咖啡。');
        expect(applyHeuristicPunctuation('太阳很晒所以要涂防晒霜')).toBe('太阳很晒，所以要涂防晒霜。');
      });
    });

    describe('English & Multilingual Handling', () => {
      it('detects English question beginnings', () => {
        expect(applyHeuristicPunctuation('hello what is your name')).toBe('hello what is your name?');
        expect(applyHeuristicPunctuation('how are you')).toBe('how are you?');
        expect(applyHeuristicPunctuation('can you hear me')).toBe('can you hear me?');
      });

      it('appends periods to English declarative statements', () => {
        expect(applyHeuristicPunctuation('this is a test')).toBe('this is a test.');
        expect(applyHeuristicPunctuation('nice to meet you')).toBe('nice to meet you.');
      });
    });

    describe('Idempotency & Pre-existing Punctuation', () => {
      it('does not duplicate punctuation if already present', () => {
        expect(applyHeuristicPunctuation('今天好冷啊！')).toBe('今天好冷啊！');
        expect(applyHeuristicPunctuation('小春，今天好冷啊！')).toBe('小春，今天好冷啊！');
        expect(applyHeuristicPunctuation('真的吗？')).toBe('真的吗？');
        expect(applyHeuristicPunctuation('知道了。')).toBe('知道了。');
        expect(applyHeuristicPunctuation('hello world.')).toBe('hello world.');
      });

      it('handles empty or whitespace strings safely', () => {
        expect(applyHeuristicPunctuation('')).toBe('');
        expect(applyHeuristicPunctuation('   ')).toBe('');
      });
    });
  });

  describe('Stage 2: PunctuationPipeline Integration', () => {
    it('supports interim draft mode ({ isFinal: false }) without appending terminal punctuation', async () => {
      const pipeline = new PunctuationPipeline();
      const draft = await pipeline.restore('今天天气真好但是有点热', { isFinal: false });
      expect(draft).toBe('今天天气真好，但是有点热');

      const finalized = await pipeline.restore('今天天气真好但是有点热', { isFinal: true });
      expect(finalized).toBe('今天天气真好，但是有点热。');
    });

    it('executes Stage 1 heuristic fallback when no Stage 2 model is registered', async () => {
      const pipeline = new PunctuationPipeline();
      expect(pipeline.hasModel()).toBe(false);

      const res = await pipeline.restore('今天天气真好但是有点热');
      expect(res).toBe('今天天气真好，但是有点热。');
    });

    it('chains Stage 2 model inference followed by Stage 1 boundary sanitation', async () => {
      const pipeline = new PunctuationPipeline();

      // Mock Stage 2 ML model that inserts intra-sentence commas
      pipeline.setModelInference(async (text) => {
        // Model adds rich internal punctuation
        return text.replace('小春', '小春，').replace('咖啡', '咖啡，');
      });
      expect(pipeline.hasModel()).toBe(true);

      const res = await pipeline.restore('小春我们去喝咖啡好不好');
      expect(res).toBe('小春，我们去喝咖啡，好不好？');
    });

    it('gracefully falls back to Stage 1 when Stage 2 model throws an error', async () => {
      const pipeline = new PunctuationPipeline();

      pipeline.setModelInference(async () => {
        throw new Error('WASM out of memory');
      });

      const res = await pipeline.restore('今天晚上吃什么呢');
      expect(res).toBe('今天晚上吃什么呢？');
    });
  });
});
