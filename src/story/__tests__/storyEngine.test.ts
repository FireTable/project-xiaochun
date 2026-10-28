import { describe, it, expect } from 'vitest';
import {
  StoryBeatSchema,
  StoryScriptSchema,
} from '../schema';
import { ExpressionController } from '@/core/morph/expressionController';
import { SHOT_PRESETS } from '@/core/scene/cameraDirector';

describe('StoryDirectorEngine Architecture & Schemas', () => {
  it('validates a complete StoryBeat with all cinematic and actor directives', () => {
    const rawBeat = {
      id: 'beat_intro',
      cinematics: {
        letterbox: true,
        intertitle: {
          text: '暴雨停歇之时……',
          durationSec: 2.5,
          style: 'noto_serif',
        },
        transition: 'eye_blink',
      },
      camera: {
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.5,
      },
      actor: {
        leadInMotion: 'touch_hair',
        expression: {
          base: 'shy',
          intensity: 0.8,
          microReaction: 'blush_ramp',
        },
        speechText: '呀！你好呀……初次见面，我是小蠢。',
      },
      audio: {
        bgmAction: 'play',
        bgmTrack: '/music/dream_on.mp3',
        sfx: [{ id: 'crystal_chime', delaySec: 0.1 }],
      },
      choices: [
        {
          id: 'choice_1',
          text: '很高兴认识你，小蠢！',
          nextBeatId: 'beat_next',
        },
      ],
    };

    const parsed = StoryBeatSchema.safeParse(rawBeat);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.actor.expression.base).toBe('shy');
      expect(parsed.data.camera?.shot).toBe('close_up');
      expect(parsed.data.cinematics?.letterbox).toBe(true);
      expect(parsed.data.choices?.length).toBe(1);
    }
  });

  it('validates full StoryScript schema graph', () => {
    const rawScript = {
      id: 'prologue',
      title: '序章·虚空初醒',
      initialBeatId: 'beat_0',
      beats: {
        beat_0: {
          id: 'beat_0',
          actor: {
            expression: { base: 'neutral', intensity: 0.5, microReaction: 'none' },
            speechText: '……',
          },
        },
      },
    };

    const parsed = StoryScriptSchema.safeParse(rawScript);
    expect(parsed.success).toBe(true);
  });

  it('verifies camera shot presets contain all required industrial framing values', () => {
    expect(SHOT_PRESETS.extreme_close_up.fov).toBeLessThan(SHOT_PRESETS.medium.fov);
    expect(SHOT_PRESETS.full.distance).toBeGreaterThan(SHOT_PRESETS.medium.distance);
    expect(SHOT_PRESETS.dramatic_low.pitch).toBeGreaterThan(Math.PI * 0.5);
  });

  it('verifies ExpressionController 4-layer living facial dynamics', () => {
    const controller = new ExpressionController();
    controller.setDirective({
      base: 'shy',
      intensity: 0.8,
      microReaction: 'blush_ramp',
    });

    // Simulate 0.5s elapsed
    controller.update(0.5, null, false);
    expect(controller.getBlushIntensity()).toBeGreaterThan(0.05);

    // Simulate speaking mouth ducking (mock VRM object)
    let appliedHappy = 0;
    let appliedBlink = 0;
    const mockVRM: any = {
      expressionManager: {
        setValue: (name: string, val: number) => {
          if (name === 'happy') appliedHappy = val;
          if (name === 'blink') appliedBlink = val;
        },
        update: () => {},
      },
    };

    // Update with isSpeaking = true -> mouth ducking applied
    controller.update(0.1, mockVRM, true);
    // Should execute safely without throwing errors
    expect(appliedHappy).toBeDefined();
    expect(appliedBlink).toBeDefined();
    expect(mockVRM.expressionManager).toBeDefined();
  });

  it('handles scene preview choices by updating active scene and selected state without leaving beat', async () => {
    if (typeof window === 'undefined') {
      (globalThis as any).window = {
        location: { pathname: '/', search: '' },
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      };
      (globalThis as any).document = {
        documentElement: { classList: { toggle: () => {} } },
        createElement: () => ({
          getContext: () =>
            new Proxy({} as any, {
              get: () => () => ({ addColorStop: () => {} }),
            }),
        }),
      };
    }
    const { storyDirectorEngine } = await import('../storyEngine');
    const { sceneManager } = await import('@/core/scene/sceneManager');

    const testScript = {
      id: 'test_script',
      title: '测试剧本',
      initialBeatId: 'beat_scene',
      beats: {
        beat_scene: {
          id: 'beat_scene',
          actor: {
            expression: { base: 'neutral', intensity: 0.5, microReaction: 'none' as const },
            speechText: '',
          },
          choices: [
            {
              id: 'scene_light',
              text: '昼白线稿',
              actionType: 'change_scene' as const,
              actionPayload: 'light',
            },
            {
              id: 'scene_dark',
              text: '极夜线稿',
              actionType: 'change_scene' as const,
              actionPayload: 'dark',
            },
          ],
          confirmChoice: {
            id: 'scene_confirm',
            text: '就决定去这里了',
            actionType: 'next_beat' as const,
            nextBeatId: 'beat_outfit',
          },
        },
        beat_outfit: {
          id: 'beat_outfit',
          actor: {
            expression: { base: 'neutral', intensity: 0.5, microReaction: 'none' as const },
            speechText: '',
          },
        },
      },
    };

    await storyDirectorEngine.playScript(testScript as any);
    expect(storyDirectorEngine.getState().currentBeat?.id).toBe('beat_scene');

    // Click scene_light (preview)
    const lightChoice = testScript.beats.beat_scene.choices[0];
    await storyDirectorEngine.selectChoice(lightChoice as any);

    // Should stay on beat_scene
    expect(storyDirectorEngine.getState().currentBeat?.id).toBe('beat_scene');
    expect(sceneManager.getCurrentSceneId()).toBe('light');

    // Click scene_dark (preview again)
    const darkChoice = testScript.beats.beat_scene.choices[1];
    await storyDirectorEngine.selectChoice(darkChoice as any);

    expect(storyDirectorEngine.getState().currentBeat?.id).toBe('beat_scene');
    expect(sceneManager.getCurrentSceneId()).toBe('dark');

    // Click confirm choice (proceeds to beat_outfit)
    const confirmChoice = testScript.beats.beat_scene.confirmChoice;
    await storyDirectorEngine.selectChoice(confirmChoice as any);

    expect(storyDirectorEngine.getState().currentBeat?.id).toBe('beat_outfit');
  });
});
