import { describe, expect, it } from 'vitest';
import { CAMERA_TASK_THRESHOLDS, CameraTaskProgress } from './cameraTaskProgress';

describe('CameraTaskProgress', () => {
  it('starts with nothing done and never reads any camera state', () => {
    const p = new CameraTaskProgress();
    expect(p.state).toEqual({ orbit: false, pitch: false, zoom: false });
  });

  it('zoom only ticks from zoom input, not from turning', () => {
    const p = new CameraTaskProgress();
    p.onTurn(500, 500);
    expect(p.state).toEqual({ orbit: true, pitch: true, zoom: false });
  });

  it('orbit / pitch tick from accumulated horizontal / vertical drags; zoom from accumulated wheel', () => {
    const p = new CameraTaskProgress();
    expect(p.onTurn(CAMERA_TASK_THRESHOLDS.orbitPx - 1, 0)).toBe(false);
    expect(p.onTurn(2, 0)).toBe(true);
    expect(p.state.orbit).toBe(true);
    expect(p.state.pitch).toBe(false);
    p.onTurn(0, CAMERA_TASK_THRESHOLDS.pitchPx);
    expect(p.state.pitch).toBe(true);
    p.onZoom(20);
    expect(p.state.zoom).toBe(false);
    expect(p.onZoom(40)).toBe(true);
    expect(p.state.zoom).toBe(true);
    expect(p.onZoom(100)).toBe(false); // 已经打过勾，不再有变化
  });
});
