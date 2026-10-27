import { describe, expect, it } from 'vitest';
import { StoryGenerator } from '../storyGenerator';
import { StoryBeatSchema } from '../schema';

describe('StoryGenerator (Dynamic AI Director)', () => {
  it('correctly handles normal JSON parsing and validates against StoryBeatSchema', async () => {
    const generator = new StoryGenerator();
    const rawJson = JSON.stringify({
      id: 'beat_dyn_1',
      cinematics: { letterbox: true },
      camera: {
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.5,
      },
      actor: {
        leadInMotion: 'touchHair',
        motion: 'attentiveLean',
        expression: {
          base: 'gentle_smile',
          intensity: 0.8,
          microReaction: 'blush_ramp',
        },
        speechText: '很高兴在这里见到你，我是小蠢～',
      },
      audio: {
        bgmMood: 'gentle_daily',
        playSfx: 'crystal_chime',
      },
      choices: [
        {
          id: 'c1',
          text: '你好呀小蠢',
          subText: '热情回应',
        },
      ],
    });

    const beat = (generator as any).parseAndValidateBeat(rawJson, 'beat_dyn_1', '你好', false);
    expect(beat.id).toBe('beat_dyn_1');
    expect(beat.actor.expression.base).toBe('gentle_smile');
    expect(beat.actor.expression.microReaction).toBe('blush_ramp');
    expect(beat.choices.length).toBe(1);
    expect(StoryBeatSchema.safeParse(beat).success).toBe(true);
  });

  it('repairs broken/truncated JSON using jsonrepair', () => {
    const generator = new StoryGenerator();
    // 模拟 LLM 流式输出被截断或末尾缺失括号与引号的情况
    const damagedJson = `\`\`\`json
    {
      "id": "beat_dyn_2",
      "camera": { "shot": "medium", "movement": "orbit_subtle", "durationSec": 2.0 },
      "actor": {
        "expression": { "base": "shy", "intensity": 0.9, "microReaction": "avert_gaze" },
        "speechText": "海风吹起来好舒服呀...
    \`\`\``;

    const beat = (generator as any).parseAndValidateBeat(damagedJson, 'beat_dyn_2', '', false);
    expect(beat.id).toBe('beat_dyn_2');
    expect(beat.actor.expression.base).toBe('shy');
    expect(beat.actor.expression.microReaction).toBe('avert_gaze');
    expect(beat.actor.speechText).toContain('海风吹起来好舒服呀');
  });

  it('creates an expressive interruption response beat when interrupted', () => {
    const generator = new StoryGenerator();
    generator.recordInterruption('我本来想说海边的夕阳很美……', '等一下，我想听你唱歌！');

    const fallbackBeat = (generator as any).createFallbackBeat('beat_dyn_interrupt', '等一下，我想听你唱歌！', true);
    expect(fallbackBeat.id).toBe('beat_dyn_interrupt');
    expect(fallbackBeat.actor.expression.base).toBe('surprised');
    expect(fallbackBeat.actor.expression.microReaction).toBe('avert_gaze');
    expect(fallbackBeat.actor.speechText).toContain('插话');
  });

  it('tracks conversation history across multiple turns', () => {
    const generator = new StoryGenerator();
    expect((generator as any).history.length).toBe(0);

    generator.recordAssistantBeat({
      id: 'beat_1',
      actor: {
        expression: { base: 'gentle_smile', intensity: 0.8 },
        speechText: '第一句台词',
      },
    });
    expect((generator as any).history.length).toBe(1);

    generator.recordInterruption('第一句台词', '等等！');
    expect((generator as any).history.length).toBe(2);
    expect((generator as any).history[1].interrupted).toBe(true);

    generator.reset();
    expect((generator as any).history.length).toBe(0);
  });
});
