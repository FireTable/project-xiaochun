import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUBBLE_MAX_CAPACITY_HEIGHT, BubbleTracker, getBubbleTransform } from './bubbleTracker';

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

  it('生成移动端底部悬浮对白卡 transform', () => {
    const t = getBubbleTransform('bottom', 187, 80);
    expect(t).toBe('translate3d(clamp(12px, calc(187px - 50%), calc(100vw - 100% - 12px)), calc(100dvh - 100% - 84px), 0)');
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
    // headY 为 60px，小于 5 行满载设计高度(156) + 20 + 16 = 192px
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

  it('以 5 行最大容量(156px)作为空间判定基准，短文本思考状态不会误居顶而在说话时发生跳跃', () => {
    expect(BUBBLE_MAX_CAPACITY_HEIGHT).toBe(156);
    const tracker = new BubbleTracker();
    tracker.state.visible = true;
    tracker.state.x = 500;
    // headY 为 150px：如果按 40px 短文本算(40+20+16=76)会误判为空间充足放 top；
    // 但 150 < 192px (156+20+16)，不足以容纳 5 行对白。
    tracker.state.y = 150;
    tracker.setMeasuredSize(280, 42); // 模拟此时仅有单行思考状态文本

    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    // 应直接决断为 top-right，绝不放在 top
    expect(tracker.state.placement).toBe('top-right');

    // 接下来语音文本到达，实测高度扩大到 140px，布局应始终恒定为 top-right，零位置跳动
    tracker.setMeasuredSize(320, 140);
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top-right');
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

    // headY 稍微下移到 200px (已大于 192px 临界值，但处于 192 ~ 227px 迟滞死区)
    tracker.state.y = 200;
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top-right');

    // headY 进一步下移到 235px (超过 192 + 35 = 227px)，稳定回切到 top
    tracker.state.y = 235;
    // @ts-expect-error test private method
    tracker.evaluatePlacement(1024);
    expect(tracker.state.placement).toBe('top');
  });

  describe('移动端窄屏特别优化 (w < 640)', () => {
    it('移动端头部靠近顶栏且空间受限时，自动平滑转移至底部悬浮区 (bottom)，严禁侧偏挤压面部', () => {
      const tracker = new BubbleTracker();
      tracker.state.visible = true;
      tracker.state.x = 187;
      tracker.state.y = 80; // iPhone SE 等机型头部在 Y=80px

      // @ts-expect-error test private method
      const changed = tracker.evaluatePlacement(375);
      expect(changed).toBe(true);
      expect(tracker.state.placement).toBe('bottom');
    });

    it('移动端正上方垂直空间充裕时，保持居中悬浮头顶 (top)', () => {
      const tracker = new BubbleTracker();
      tracker.state.visible = true;
      tracker.state.x = 187;
      tracker.state.y = 300; // 300 > 228 (156 + 56 + 16)

      // @ts-expect-error test private method
      tracker.evaluatePlacement(375);
      expect(tracker.state.placement).toBe('top');
    });

    it('移动端从 bottom 回弹到 top 具备迟滞防抖', () => {
      const tracker = new BubbleTracker();
      tracker.state.visible = true;
      tracker.state.x = 187;
      tracker.state.y = 80;

      // @ts-expect-error test private method
      tracker.evaluatePlacement(375);
      expect(tracker.state.placement).toBe('bottom');

      // 稍微下移到 240px (虽 > 228px，但未达到 228 + 35 = 263px 迟滞)，仍保持 bottom
      tracker.state.y = 240;
      // @ts-expect-error test private method
      tracker.evaluatePlacement(375);
      expect(tracker.state.placement).toBe('bottom');

      // 充分下移到 270px 恢复 top
      tracker.state.y = 270;
      // @ts-expect-error test private method
      tracker.evaluatePlacement(375);
      expect(tracker.state.placement).toBe('top');
    });
  });

  describe('BubbleTracker 多订阅者机制 (Pub/Sub)', () => {
    it('首次订阅立即分发当前状态快照', () => {
      const tracker = new BubbleTracker();
      tracker.state.speechText = '初始文本';
      tracker.state.segmentIndex = 1;

      let receivedText = '';
      const unsub = tracker.subscribe((state) => {
        receivedText = state.speechText;
      });

      expect(receivedText).toBe('初始文本');
      unsub();
    });

    it('setStatus 派发时，所有订阅者均能同步收到分段切片与进度', () => {
      const tracker = new BubbleTracker();
      const mockCamera = new THREE.PerspectiveCamera();

      const received1: string[] = [];
      const segments1: number[] = [];
      const received2: string[] = [];

      const unsub1 = tracker.subscribe((state) => {
        if (state.speechText) received1.push(state.speechText);
        if (state.segmentIndex) segments1.push(state.segmentIndex);
      });
      const unsub2 = tracker.subscribe((state) => {
        if (state.speechText) received2.push(state.speechText);
      });

      // 模拟第一段播放
      tracker.setStatus('speaking', null, mockCamera, undefined, false, '第一段切片', 1, 2);
      // 模拟第二段播放
      tracker.setStatus('speaking', null, mockCamera, undefined, false, '第二段切片', 2, 2);

      expect(received1).toEqual(['第一段切片', '第二段切片']);
      expect(segments1).toEqual([1, 2]);
      expect(received2).toEqual(['第一段切片', '第二段切片']);

      // 验证取消订阅生效
      unsub1();
      tracker.setStatus('speaking', null, mockCamera, undefined, false, '第三段切片', 3, 3);
      expect(received1).toEqual(['第一段切片', '第二段切片']); // unsub1 不再增加
      expect(received2).toEqual(['第一段切片', '第二段切片', '第三段切片']); // unsub2 照常接收

      unsub2();
    });

    it('hide() 派发时通知订阅者 visible 变为 false', () => {
      const tracker = new BubbleTracker();
      let lastVisible = true;
      const unsub = tracker.subscribe((s) => {
        lastVisible = s.visible;
      });

      tracker.hide();
      expect(lastVisible).toBe(false);
      unsub();
    });
  });
});
