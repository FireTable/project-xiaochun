import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BubbleTracker, getBubbleTransform } from './bubbleTracker';

describe('getBubbleTransform', () => {
  it('生成正上方居中 transform', () => {
    const t = getBubbleTransform('top', 500, 300);
    expect(t).toBe('translate3d(clamp(16px, calc(500px - 50%), calc(100vw - 100% - 16px)), max(16px, calc(300px - 100% - 16px)), 0)');
  });

  it('生成右上角避让 transform', () => {
    const t = getBubbleTransform('top-right', 500, 80, 80);
    expect(t).toBe('translate3d(clamp(16px, calc(500px + 80px), calc(100vw - 100% - 16px)), max(24px, calc(80px + 10px)), 0)');
  });

  it('生成左上角避让 transform', () => {
    const t = getBubbleTransform('top-left', 800, 80, 80);
    expect(t).toBe('translate3d(clamp(16px, calc(800px - 80px - 100%), calc(100vw - 100% - 16px)), max(24px, calc(80px + 10px)), 0)');
  });
});

describe('BubbleTracker 智能防遮挡避让', () => {
  it('空间充足时保持正上方居中 (top)', () => {
    const tracker = new BubbleTracker();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.4, 1.5);
    camera.lookAt(0, 1.4, 0);

    // 模拟头部世界坐标投射到屏幕中间略偏下 (Y=350)
    tracker.state.visible = true;
    tracker.state.x = 500;
    tracker.state.y = 350;

    // @ts-expect-error test private method
    const changed = tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top');
  });

  it('头部贴近屏幕顶部且可能挡住头部时，自动切换至右上角 (top-right)', () => {
    const tracker = new BubbleTracker();
    tracker.state.visible = true;
    tracker.state.x = 450;
    // headY 为 60px，小于 bubbleHeight(85) + 20 + 16 = 121px
    tracker.state.y = 60;

    // @ts-expect-error test private method
    const changed = tracker.evaluatePlacement(1024);
    expect(changed).toBe(true);
    expect(tracker.state.placement).toBe('top-right');
  });

  it('右侧边缘空间不足时，自动镜像切换至左上角 (top-left)', () => {
    const tracker = new BubbleTracker();
    tracker.state.visible = true;
    // 头部位于视口极右侧 (x=980, 视口宽 1024)
    tracker.state.x = 980;
    tracker.state.y = 60;

    // @ts-expect-error test private method
    const changed = tracker.evaluatePlacement(1024);
    expect(changed).toBe(true);
    expect(tracker.state.placement).toBe('top-left');
  });

  it('具备 35px 迟滞 (hysteresis)，微动不会在 top 与 top-right 间频繁抖动', () => {
    const tracker = new BubbleTracker();
    tracker.state.visible = true;
    tracker.state.x = 500;
    tracker.state.y = 60;

    // 触发进入 top-right
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top-right');

    // headY 稍微下移到 130px (已大于 121px 临界值，但处于 121 ~ 156px 迟滞死区)
    tracker.state.y = 130;
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top-right');

    // headY 进一步下移到 165px (超过 121 + 35 = 156px)，稳定回切到 top
    tracker.state.y = 165;
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top');
  });
});
