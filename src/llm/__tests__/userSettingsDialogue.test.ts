import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '@/config';
import { resolveShowChatDialogue } from '../userSettings';

describe('resolveShowChatDialogue', () => {
  it('falls back to APP_CONFIG.chat.showChatDialogue when no override', () => {
    expect(resolveShowChatDialogue({})).toBe(APP_CONFIG.chat.showChatDialogue);
  });

  it('uses the showChatDialogue override', () => {
    expect(resolveShowChatDialogue({ showChatDialogue: false })).toBe(false);
    expect(resolveShowChatDialogue({ showChatDialogue: true })).toBe(true);
  });

  it('honours the legacy showHeadBubble field (old IDB records / old sync payloads)', () => {
    expect(resolveShowChatDialogue({ showHeadBubble: false })).toBe(false);
  });

  it('prefers the new field over the legacy one', () => {
    expect(resolveShowChatDialogue({ showChatDialogue: true, showHeadBubble: false })).toBe(true);
  });
});
