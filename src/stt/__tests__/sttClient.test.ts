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

  it('calls focus on textarea when inserting text', () => {
    const textarea = createMockInput('你好');
    let focused = false;
    (textarea as any).focus = () => {
      focused = true;
    };
    insertAtCursor(textarea, '小春');
    expect(focused).toBe(true);
    expect(textarea.value).toBe('你好小春');
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

  it('keeps listening state when model finishes loading while desiredActive is true', () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage() {}
      terminate() {}
    };

    try {
      const client = new SttClient();
      const states: string[] = [];
      client.on((ev) => {
        if (ev.type === 'state') states.push(ev.state);
      });

      // Simulate start() setting desiredActive = true and listening state
      (client as any).desiredActive = true;
      (client as any).setState('listening');

      // Simulate worker ready message arriving while stream is not yet ready (async getUserMedia in flight)
      (client as any).stream = null;
      const workerInstance = (client as any).ensureWorker();
      // Trigger onmessage with { type: 'ready' }
      workerInstance.onmessage({ data: { type: 'ready' } } as any);

      expect(client.getState()).toBe('listening');
      expect(states).not.toContain('idle');
      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('emits utterance_result event with pcm, duration, latency and rms on worker result', () => {
    let lastPostedMsg: any = null;
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class MockWorker {
      onmessage: any = null;
      postMessage(msg: any) {
        lastPostedMsg = msg;
      }
      terminate() {}
    };

    try {
      const client = new SttClient();
      let receivedUtterance: any = null;
      client.on((ev) => {
        if (ev.type === 'utterance_result') {
          receivedUtterance = ev;
        }
      });

      // Submit an utterance of 16000 samples (1 second at 16kHz)
      const pcm = new Float32Array(16000).fill(0.2);
      (client as any).submitUtterance(pcm);

      expect(lastPostedMsg).toBeTruthy();
      expect(lastPostedMsg.type).toBe('recognize');
      const id = lastPostedMsg.id;

      // Simulate worker result
      const workerInstance = (client as any).worker;
      workerInstance.onmessage({
        data: {
          type: 'result',
          id,
          text: '你好小春',
        },
      });

      expect(receivedUtterance).toBeTruthy();
      expect(receivedUtterance.id).toBe(id);
      expect(receivedUtterance.text).toBe('你好小春');
      expect(receivedUtterance.durationMs).toBe(1000);
      expect(receivedUtterance.pcm.length).toBe(16000);
      expect(receivedUtterance.rms).toBeCloseTo(0.2, 2);
      expect(receivedUtterance.inferenceMs).toBeGreaterThanOrEqual(0);

      client.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });
});
