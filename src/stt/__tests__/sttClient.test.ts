/**
 * Unit tests for sttClient.ts and insertAtCursor.
 */
import { describe, it, expect } from 'vitest';
import { SttClient, insertAtCursor } from '../sttClient';

describe('insertAtCursor', () => {
  function createMockInput(initial = '') {
    const el = {
      value: initial,
      selectionStart: initial.length,
      selectionEnd: initial.length,
      dispatched: [] as string[],
      setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      dispatchEvent(ev: { type: string }) {
        this.dispatched.push(ev.type);
        return true;
      },
    };
    return el as unknown as HTMLTextAreaElement;
  }

  it('inserts text into empty textarea and dispatches input and change events', () => {
    const textarea = createMockInput('');
    insertAtCursor(textarea, '你好小春');
    expect(textarea.value).toBe('你好小春');
    expect((textarea as any).dispatched).toContain('input');
    expect((textarea as any).dispatched).toContain('change');
  });

  it('inserts text at cursor position with proper boundary spacing', () => {
    const textarea = createMockInput('Hello');
    textarea.selectionStart = 5;
    textarea.selectionEnd = 5;

    insertAtCursor(textarea, 'world');
    expect(textarea.value).toBe('Hello world');
  });

  it('preserves Chinese punctuation without extra space', () => {
    const textarea = createMockInput('你好');
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;

    insertAtCursor(textarea, '，很高兴认识你');
    expect(textarea.value).toBe('你好，很高兴认识你');
  });

  it('inserts text in middle of sentence preserving caret', () => {
    const textarea = createMockInput('你好世界');
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;

    insertAtCursor(textarea, '美麗的');
    expect(textarea.value).toBe('你好美麗的世界');
    expect(textarea.selectionStart).toBe(5);
  });
});

describe('SttClient state logic', () => {
  it('initializes in idle state', () => {
    const client = new SttClient();
    expect(client.getState()).toBe('idle');
    expect(client.getProgressPercent()).toBe(0);
    client.dispose();
  });

  it('stops and resets state on stop call', async () => {
    const client = new SttClient();
    await client.stop(false);
    expect(client.getState()).toBe('idle');
    client.dispose();
  });
});
