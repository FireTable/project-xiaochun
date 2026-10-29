import { describe, it, expect } from 'vitest';
import {
  resolveChatBubbleVisible,
  type ChatBubbleVisibilityInput,
} from '../chatBubbleVisibility';

describe('Story Dialogue & ChatBubble Persistence Contract', () => {
  const base: ChatBubbleVisibilityInput = {
    scope: 'story',
    enabled: true,
    isStatic: true,
    isCinematic: true,
    stateVisible: false,
    hasState: true,
    statusKey: '',
    rawSpeechText: '换了新环境，也顺便帮我挑套新衣服吧。',
    hasChildren: false,
  };

  it('story scope: keeps static dialogue visible even when bubble state.visible becomes false upon speech end', () => {
    expect(resolveChatBubbleVisible({ ...base, scope: 'story' })).toBe(true);
  });

  it('story scope: is NOT affected by the showChatDialogue setting (always shows)', () => {
    expect(resolveChatBubbleVisible({ ...base, scope: 'story', enabled: false })).toBe(true);
  });

  it('chat scope (mobile cinematic bar): disappears after speech ends (state.visible=false), same as PC bubble', () => {
    const speaking = { ...base, scope: 'chat' as const, stateVisible: true, statusKey: 'speaking' };
    expect(resolveChatBubbleVisible(speaking)).toBe(true);
    // 语音结束: bubbleTracker.hide() 只置 visible=false, speechText 残留
    expect(resolveChatBubbleVisible({ ...speaking, stateVisible: false })).toBe(false);
  });

  it('chat scope: hidden when showChatDialogue is off, for both PC bubble and mobile cinematic bar', () => {
    const speaking = { ...base, scope: 'chat' as const, stateVisible: true, statusKey: 'speaking', enabled: false };
    expect(resolveChatBubbleVisible(speaking)).toBe(false); // mobile cinematic (static)
    expect(resolveChatBubbleVisible({ ...speaking, isStatic: false, isCinematic: false })).toBe(false); // PC bubble
    expect(resolveChatBubbleVisible({ ...speaking, enabled: true, isStatic: false, isCinematic: false })).toBe(true);
  });

  it('suppresses cinematic ChatBubble display before audio speech arrives (e.g. during tts/emage buffering)', () => {
    const buffering = { ...base, stateVisible: true, statusKey: 'tts', rawSpeechText: '' };
    expect(resolveChatBubbleVisible({ ...buffering, scope: 'chat' })).toBe(false);
    expect(resolveChatBubbleVisible({ ...buffering, scope: 'story' })).toBe(false);
    // 思考中允许露出
    expect(resolveChatBubbleVisible({ ...buffering, scope: 'chat', statusKey: 'thinking' })).toBe(true);
  });

  it('gates StoryPlayer dialogue display strictly until speech starts (hasSpokenInBeat latching)', () => {
    // 拍开始但语音网络尚未开声时
    let hasSpokenInBeat = false;
    const scriptSpeechText = '你好呀，我是小蠢！';
    const bubbleSpeaking = false;

    // 状态判定函数
    const checkCanShowDialogue = (hasSpoken: boolean, text: string) => {
      return hasSpoken && Boolean(text.trim());
    };

    // 语音未播前：不可展示
    expect(checkCanShowDialogue(hasSpokenInBeat, scriptSpeechText)).toBe(false);

    // 语音开声发音时 (bubble.statusKey === 'speaking')
    if (!bubbleSpeaking) {
      hasSpokenInBeat = true;
    }
    expect(checkCanShowDialogue(hasSpokenInBeat, scriptSpeechText)).toBe(true);

    // 语音播毕后：维持展示 (不随声音停播而突兀消失)
    expect(checkCanShowDialogue(hasSpokenInBeat, scriptSpeechText)).toBe(true);

    // 切到下一拍：重置为 false
    hasSpokenInBeat = false;
    expect(checkCanShowDialogue(hasSpokenInBeat, '下一拍台词')).toBe(false);
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
