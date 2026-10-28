import { describe, it, expect, vi } from 'vitest';
import {
  toProtocolUrl,
  parseProtocolUrl,
  type XiaochunSpeakAction,
  type XiaochunMotionAction,
  type XiaochunGroupAction,
  type XiaochunExpressionAction,
  type XiaochunCameraAction,
  type XiaochunStopAction,
} from '@firetable/project-xiaochun/protocol-url';
import { runProtocolAction } from '../handler';
import { vrmEngine } from '../../vrmEngine';

vi.mock('../../vrmEngine', () => ({
  vrmEngine: {
    currentVRM: {} as any,
    speakText: vi.fn().mockResolvedValue(undefined),
    playMotion: vi.fn().mockResolvedValue(undefined),
    playMotionGroup: vi.fn().mockResolvedValue(undefined),
    setExpression: vi.fn(),
    transitionCamera: vi.fn().mockResolvedValue(undefined),
    resetCamera: vi.fn(),
    panUpRevealCamera: vi.fn().mockResolvedValue(undefined),
    stopSpeaking: vi.fn(),
    stopMotion: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(true),
    onLoaded: vi.fn(),
  },
}));

describe('protocol-url (toProtocolUrl & parseProtocolUrl)', () => {
  it('encodes and parses speak action', () => {
    const action: XiaochunSpeakAction = { action: 'speak', text: '你好呀，世界！' };
    const url = toProtocolUrl(action);
    expect(url).toContain('xiaochun://speak?text=%E4%BD%A0%E5%A5%BD%E5%91%80%EF%BC%8C%E4%B8%96%E7%95%8C%EF%BC%81');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });

  it('encodes and parses motion action', () => {
    const action: XiaochunMotionAction = {
      action: 'motion',
      name: 'waving',
      loop: true,
      fadeDuration: 0.75,
      mask: 'upperBody',
    };
    const url = toProtocolUrl(action);
    expect(url).toContain('xiaochun://motion?');
    expect(url).toContain('name=waving');
    expect(url).toContain('loop=true');
    expect(url).toContain('mask=upperBody');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });

  it('encodes and parses group action', () => {
    const action: XiaochunGroupAction = {
      action: 'group',
      name: 'praiseCute',
      loop: false,
    };
    const url = toProtocolUrl(action);
    expect(url).toBe('xiaochun://group?name=praiseCute&loop=false');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });

  it('encodes and parses expression action', () => {
    const action: XiaochunExpressionAction = {
      action: 'expression',
      name: 'gentle_smile',
      intensity: 0.85,
    };
    const url = toProtocolUrl(action);
    expect(url).toBe('xiaochun://expression?name=gentle_smile&intensity=0.85');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });

  it('encodes and parses camera action', () => {
    const action: XiaochunCameraAction = {
      action: 'camera',
      shot: 'close_up',
      movement: 'push_in',
      durationSec: 1.5,
      orbitAngleDeg: 45,
    };
    const url = toProtocolUrl(action);
    expect(url).toContain('xiaochun://camera?');
    expect(url).toContain('shot=close_up');
    expect(url).toContain('movement=push_in');
    expect(url).toContain('durationSec=1.5');
    expect(url).toContain('orbitAngleDeg=45');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });

  it('encodes and parses stop action', () => {
    const action: XiaochunStopAction = { action: 'stop' };
    const url = toProtocolUrl(action);
    expect(url).toBe('xiaochun://stop');

    const parsed = parseProtocolUrl(url);
    expect(parsed).toEqual(action);
  });
});

describe('runProtocolAction dispatcher', () => {
  it('dispatches motion to vrmEngine.playMotion', async () => {
    await runProtocolAction({
      action: 'motion',
      payload: { name: 'waving', loop: true },
    });
    expect(vrmEngine.playMotion).toHaveBeenCalledWith(
      'waving',
      expect.objectContaining({ loop: true }),
    );
  });

  it('dispatches group to vrmEngine.playMotionGroup', async () => {
    await runProtocolAction({
      action: 'group',
      payload: { name: 'greeting' },
    });
    expect(vrmEngine.playMotionGroup).toHaveBeenCalledWith(
      'greeting',
      expect.any(Object),
    );
  });

  it('dispatches expression to vrmEngine.setExpression', async () => {
    await runProtocolAction({
      action: 'expression',
      payload: { name: 'gentle_smile', intensity: 0.9 },
    });
    expect(vrmEngine.setExpression).toHaveBeenCalledWith('gentle_smile', 0.9);
  });

  it('dispatches camera to vrmEngine.transitionCamera', async () => {
    await runProtocolAction({
      action: 'camera',
      payload: { shot: 'close_up', movement: 'push_in', durationSec: 1.5 },
    });
    expect(vrmEngine.transitionCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        shot: 'close_up',
        movement: 'push_in',
        durationSec: 1.5,
      }),
    );
  });

  it('dispatches camera reset to vrmEngine.resetCamera', async () => {
    await runProtocolAction({
      action: 'camera',
      payload: { reset: true },
    });
    expect(vrmEngine.resetCamera).toHaveBeenCalled();
  });

  it('dispatches camera panUp to vrmEngine.panUpRevealCamera', async () => {
    await runProtocolAction({
      action: 'camera',
      payload: { panUp: true, durationSec: 2.5 },
    });
    expect(vrmEngine.panUpRevealCamera).toHaveBeenCalledWith(2.5);
  });

  it('dispatches stop to vrmEngine.stopSpeaking and stopMotion', async () => {
    await runProtocolAction({ action: 'stop' });
    expect(vrmEngine.stopSpeaking).toHaveBeenCalled();
    expect(vrmEngine.stopMotion).toHaveBeenCalled();
  });
});
