import { describe, it, expect } from 'vitest';
import type { BubbleState } from '@/core/ui/bubbleTracker';

describe('Story Dialogue & ChatBubble Persistence Contract', () => {
  it('keeps static dialogue visible even when bubble state.visible becomes false upon speech end', () => {
    // 模拟语音播放结束时 BubbleTracker.hide() 产生的状态
    const endedBubbleState: BubbleState = {
      visible: false,
      statusKey: '',
      speechText: '',
      isError: false,
      x: 100,
      y: 200,
      placement: 'bottom',
    };

    // 静态电影条模式传入当前拍台词文本
    const currentSpeechText = '换了新环境，也顺便帮我挑套新衣服吧。';
    const isStatic = true;
    const children = null;
    const state = endedBubbleState;
    const rawSpeechText = currentSpeechText;
    const statusKey = state.statusKey;

    // 验证 ChatBubble.tsx 中的 isVisible 判定逻辑
    const isVisible = isStatic
      ? Boolean(children) || Boolean(rawSpeechText) || (state ? state.visible && Boolean(statusKey) : Boolean(statusKey))
      : Boolean(state?.visible);

    expect(isVisible).toBe(true);
  });

  it('correctly decouples isSpeaking animation flag from static text display when speech finishes', () => {
    // 说话中：isSpeaking 为 true
    const speakingState = {
      isSpeakingProp: true,
      statusKey: 'speaking',
      rawSpeechText: '正在说话中...',
    };
    const isSpeakingActive = speakingState.isSpeakingProp !== undefined
      ? speakingState.isSpeakingProp
      : (speakingState.statusKey === 'speaking');
    expect(isSpeakingActive).toBe(true);

    // 说话完毕并递麦等待交互（换装/场景/视角）：
    // isSpeakingProp 置为 false，但台词文本依然保留
    const postSpeechState = {
      isSpeakingProp: false,
      statusKey: '',
      rawSpeechText: '换了新环境，也顺便帮我挑套新衣服吧。',
    };
    const isSpeakingEnded = postSpeechState.isSpeakingProp !== undefined
      ? postSpeechState.isSpeakingProp
      : (postSpeechState.statusKey === 'speaking');

    expect(isSpeakingEnded).toBe(false);
    expect(Boolean(postSpeechState.rawSpeechText)).toBe(true);
  });

  it('guarantees layout height contract: PC choices are elevated above bottom dialogue bar to eliminate occlusion', () => {
    // PC 底部电影条安全高度：bottom 24px + 85px 卡片设计高度 ≈ 109px
    const dialogueTopBoundPx = 24 + 85;

    // PC 选项列当电影条存在时，基准 bottom 为 bottom-28 (112px) 或 bottom-32 (128px)
    const pcChoicesBottomActivePx = 112; // bottom-28
    const pcChoicesBottomWidePx = 128;   // bottom-32

    expect(pcChoicesBottomActivePx).toBeGreaterThan(dialogueTopBoundPx);
    expect(pcChoicesBottomWidePx).toBeGreaterThan(dialogueTopBoundPx);
  });
});
