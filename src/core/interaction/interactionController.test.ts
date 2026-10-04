/**
 * InteractionController 集成冒烟: 真实控制器 + 真实 GestureMachine, DOM / Tauri 用桩。
 * 验证 "事件 → 语义事件 → 控制器副作用" 的映射 (转身位移、pointer capture、保存回调、Tauri 原生拖窗同步调用)。
 * 判定逻辑本身的等价性见 src/core/gesture/__tests__/equivalence.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeDrag = vi.fn();
vi.mock('@/core/gesture/adapters/tauriWindow', () => ({
  startNativeWindowDrag: () => nativeDrag(),
  startNativeCornerResize: vi.fn(),
}));
// 3D 导轨依赖 document.createElement('canvas') 画贴图, node 环境没有; 这里只关心手势 → 控制器的映射, 导轨用空壳
vi.mock('./turnGuide3D', async () => {
  const THREE = await import('three');
  return { TurnGuide3D: class { group = new THREE.Group(); update() {} dispose() {} } };
});
vi.mock('./pitchGuide3D', async () => {
  const THREE = await import('three');
  return { PitchGuide3D: class { group = new THREE.Group(); update() {} dispose() {} } };
});
vi.mock('./cameraYGuide3D', async () => {
  const THREE = await import('three');
  return {
    CameraYGuide3D: class {
      group = new THREE.Group();
      update() {}
      dispose() {}
      setHovered() {}
      worldYToProgress() { return 0; }
      getPickables() { return []; }
    },
  };
});
vi.mock('@/core/scene/passthroughManager', () => ({
  passthroughManager: { setInteracting: vi.fn(async () => {}), registerUIRect: vi.fn() },
}));
vi.mock('@/core/scene/sceneManager', () => ({
  sceneManager: { getCurrentScene: () => ({ isTransparent: false }) },
}));

type Handler = (e: any) => void;

function makeWindowStub() {
  const handlers = new Map<string, Set<Handler>>();
  const win: any = {
    addEventListener: (t: string, h: Handler) => { (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(h); },
    removeEventListener: (t: string, h: Handler) => { handlers.get(t)?.delete(h); },
    innerHeight: 800,
    navigator: { userAgent: 'test', platform: 'Linux' },
  };
  const fire = (t: string, e: any) => { for (const h of [...(handlers.get(t) ?? [])]) h(e); };
  return { win, fire };
}

function ptr(over: Record<string, unknown> = {}) {
  return {
    pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, screenX: 100, screenY: 100,
    ctrlKey: false, metaKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    ...over,
  };
}

describe('InteractionController (集成冒烟)', () => {
  let stub: ReturnType<typeof makeWindowStub>;

  beforeEach(() => {
    vi.useFakeTimers();
    stub = makeWindowStub();
    vi.stubGlobal('window', stub.win);
    vi.stubGlobal('navigator', stub.win.navigator);
    nativeDrag.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function boot() {
    const THREE = await import('three');
    const { InteractionController } = await import('./interactionController');
    const ic = new InteractionController();
    const captured = new Set<number>();
    const canvasHandlers = new Map<string, Handler>();
    const canvas: any = {
      style: {},
      addEventListener: (t: string, h: Handler) => canvasHandlers.set(t, h),
      removeEventListener: (t: string) => canvasHandlers.delete(t),
      setPointerCapture: vi.fn((id: number) => { captured.add(id); }),
      releasePointerCapture: vi.fn((id: number) => { captured.delete(id); }),
      hasPointerCapture: (id: number) => captured.has(id),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
      clientHeight: 800,
    };
    const motionPipeline: any = { targetYawOffset: 0 };
    const controls: any = { _rotateUp: vi.fn(), getPolarAngle: () => Math.PI / 2, target: { y: 1 } };
    const onSaveBodyYaw = vi.fn();
    const onSaveCameraPitch = vi.fn();
    ic.bindCanvas(canvas, {
      scene: new THREE.Scene(),
      controls,
      camera: new THREE.PerspectiveCamera(),
      motionPipeline,
      onSaveBodyYaw,
      onSaveCameraPitch,
      onSetCameraYOffset: vi.fn(),
    });
    const down = (e: any) => canvasHandlers.get('pointerdown')!(e);
    return { ic, canvas, captured, motionPipeline, controls, onSaveBodyYaw, onSaveCameraPitch, down };
  }

  it('长按 480ms 武装 → 位移 >10px 转身 (yaw + pitch) → 松手保存', async () => {
    const t = await boot();
    const { APP_CONFIG } = await import('@/config');
    t.down(ptr());
    vi.advanceTimersByTime(479);
    expect(t.ic.getState().isModifierActive).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.ic.getState().isModifierActive).toBe(true);
    expect(t.canvas.setPointerCapture).toHaveBeenCalledWith(1);

    stub.fire('pointermove', ptr({ clientX: 150, clientY: 100 }));
    expect(t.ic.getState().isDragging).toBe(true);
    const e2 = ptr({ clientX: 160, clientY: 105 });
    stub.fire('pointermove', e2);
    expect(e2.preventDefault).toHaveBeenCalled();
    expect(t.motionPipeline.targetYawOffset).toBeCloseTo(10 * APP_CONFIG.interaction.characterTurnSensitivityX, 10);
    expect(t.controls._rotateUp).toHaveBeenCalledWith(5 * APP_CONFIG.camera.pitchSensitivityY);

    stub.fire('pointerup', ptr({ clientX: 160, clientY: 105 }));
    expect(t.ic.getState().isDragging).toBe(false);
    expect(t.captured.size).toBe(0);
    expect(t.onSaveBodyYaw).toHaveBeenCalledTimes(1);
    expect(t.onSaveCameraPitch).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl 即时 3D: 按下就转身, 不等 480ms', async () => {
    const t = await boot();
    t.down(ptr({ ctrlKey: true, metaKey: true }));
    expect(t.ic.getState().isDragging).toBe(true);
    stub.fire('pointermove', ptr({ clientX: 120, ctrlKey: true, metaKey: true }));
    expect(t.motionPipeline.targetYawOffset).not.toBe(0);
  });

  it('非 Tauri (浏览器/embed): 提前滑动 >10px 只取消长按, 不调用原生拖窗', async () => {
    const t = await boot();
    t.down(ptr());
    stub.fire('pointermove', ptr({ clientX: 140, clientY: 100 }));
    vi.advanceTimersByTime(2000);
    expect(nativeDrag).not.toHaveBeenCalled();
    expect(t.ic.getState().isModifierActive).toBe(false);
  });

  it('Tauri: 提前滑动 >10px → 在 pointermove 同步调用栈内触发原生拖窗, 且只触发一次, 不再武装', async () => {
    (stub.win as any).__TAURI_INTERNALS__ = {};
    const t = await boot();
    t.down(ptr());
    stub.fire('pointermove', ptr({ clientX: 105, clientY: 100 })); // 5px: 不触发
    expect(nativeDrag).not.toHaveBeenCalled();
    let calledSync = false;
    const e = ptr({ clientX: 140, clientY: 100 });
    const orig = nativeDrag.getMockImplementation();
    nativeDrag.mockImplementation(() => { calledSync = true; });
    stub.fire('pointermove', e);
    expect(calledSync).toBe(true);
    nativeDrag.mockImplementation(orig as any);
    expect(nativeDrag).toHaveBeenCalledTimes(1);
    stub.fire('pointermove', ptr({ clientX: 200, clientY: 100 }));
    vi.advanceTimersByTime(2000);
    expect(nativeDrag).toHaveBeenCalledTimes(1);
    expect(t.ic.getState().isModifierActive).toBe(false);
  });

  it('window blur 复位全部状态', async () => {
    const t = await boot();
    t.down(ptr());
    vi.advanceTimersByTime(480);
    stub.fire('pointermove', ptr({ clientX: 150 }));
    stub.fire('blur', {});
    expect(t.ic.getState()).toMatchObject({ isModifierActive: false, isDragging: false });
    expect(t.captured.size).toBe(0);
  });
});
