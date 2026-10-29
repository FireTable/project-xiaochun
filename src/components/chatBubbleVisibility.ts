/**
 * chatBubbleVisibility — ChatBubble 是否渲染的纯函数判定 (从组件抽出以便单测)。
 *
 * 两种对白范围 (dialogueScope):
 * - 'chat'  日常聊天 (PC 头顶气泡 + 移动端电影字幕栏): 受「显示对话字幕」设置 (showChatDialogue) 控制,
 *           且跟随 bubbleTracker 的 state.visible —— 语音结束 hide() 后消失。
 * - 'story' 故事 / 新手引导: 台词整拍常驻, 不受设置开关与 state.visible 影响。
 */
export interface ChatBubbleVisibilityInput {
  scope: 'chat' | 'story';
  /** 用户设置 showChatDialogue 解析后的值 (仅 chat 范围使用) */
  enabled: boolean;
  isStatic: boolean;
  isCinematic: boolean;
  /** bubbleTracker 的 state.visible; 无 state 时 undefined */
  stateVisible: boolean | undefined;
  hasState: boolean;
  statusKey: string;
  rawSpeechText: string;
  hasChildren: boolean;
}

export function resolveChatBubbleVisible(i: ChatBubbleVisibilityInput): boolean {
  // 电影字幕条只在存在台词正文、展开回顾、或明确处于思考中时展示，杜绝在 TTS/EMAGE 缓冲无声音阶段提前露出空白外壳
  const hasCinematicContent = i.hasChildren || Boolean(i.rawSpeechText) || i.statusKey === 'thinking';
  if (i.scope === 'chat') {
    return i.enabled && Boolean(i.stateVisible) && (!i.isStatic || !i.isCinematic || hasCinematicContent);
  }
  if (i.isCinematic) return hasCinematicContent;
  return i.hasChildren || Boolean(i.rawSpeechText)
    || (i.hasState ? Boolean(i.stateVisible) && Boolean(i.statusKey) : Boolean(i.statusKey));
}
