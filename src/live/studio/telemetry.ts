/**
 * telemetry.ts — Real-time turn latency & 3D frame telemetry collector for Live Studio.
 */

import type { DuplexTurnClass, DuplexTurnProbs } from '@/live/turn/types';
import type { LiveTelemetryRow, TranscriptEntry } from './types';

export interface ActiveTurnTimer {
  seq: number;
  scenario: string;
  input: string;
  startMs: number;
  turnLabel: DuplexTurnClass | string;
  turnProbs?: DuplexTurnProbs;
  speculativeHit: boolean;
  ttftMs: number | null;
  ttsTtfaMs: number | null;
  firstSoundMs: number | null;
  ttsEngine: string;
  replyChunks: string[];
  wasInterrupted: boolean;
  notes: string[];
}

export class TelemetryStore {
  private rows: LiveTelemetryRow[] = [];
  private transcript: TranscriptEntry[] = [];
  private nextSeq = 0;
  private activeTurn: ActiveTurnTimer | null = null;
  private readonly startMsBySeq = new Map<number, number>();
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  beginTurn(params: {
    scenario: string;
    input: string;
    turnLabel?: DuplexTurnClass | string;
    turnProbs?: DuplexTurnProbs;
    speculativeHit?: boolean;
  }): ActiveTurnTimer {
    const seq = ++this.nextSeq;
    const t: ActiveTurnTimer = {
      seq,
      scenario: params.scenario,
      input: params.input,
      startMs: performance.now(),
      turnLabel: params.turnLabel ?? 'COMPLETE',
      turnProbs: params.turnProbs,
      speculativeHit: Boolean(params.speculativeHit),
      ttftMs: null,
      ttsTtfaMs: null,
      firstSoundMs: null,
      ttsEngine: 'auto',
      replyChunks: [],
      wasInterrupted: false,
      notes: [],
    };
    this.activeTurn = t;
    this.startMsBySeq.set(seq, t.startMs);
    if (this.startMsBySeq.size > 120) {
      const oldestKey = this.startMsBySeq.keys().next().value;
      if (oldestKey !== undefined) this.startMsBySeq.delete(oldestKey);
    }
    return t;
  }

  getActiveTurn(): ActiveTurnTimer | null {
    return this.activeTurn;
  }

  markTurnClassification(label: DuplexTurnClass | string, probs?: DuplexTurnProbs, specHit?: boolean): void {
    if (!this.activeTurn) return;
    this.activeTurn.turnLabel = label;
    if (probs) this.activeTurn.turnProbs = probs;
    if (specHit !== undefined) this.activeTurn.speculativeHit = specHit;
  }

  markTtft(ms?: number): void {
    if (!this.activeTurn || this.activeTurn.ttftMs !== null) return;
    this.activeTurn.ttftMs = Math.round(ms ?? performance.now() - this.activeTurn.startMs);
  }

  markTtsTtfa(ms: number, engine: string): void {
    this.markTtsTtfaForSeq(null, ms, engine);
  }

  markTtsTtfaForSeq(seq: number | null, ms: number, engine: string): void {
    if (this.activeTurn && (seq === null || this.activeTurn.seq === seq)) {
      if (this.activeTurn.ttsTtfaMs === null) {
        this.activeTurn.ttsTtfaMs = Math.round(ms);
      }
      this.activeTurn.ttsEngine = engine;
      return;
    }
    if (seq !== null) {
      const committed = this.rows.find((r) => r.seq === seq);
      if (committed) {
        if (committed.ttsTtfaMs === null) {
          committed.ttsTtfaMs = Math.round(ms);
        }
        committed.ttsEngine = engine;
        this.notify();
      }
    }
  }

  markFirstSound(ms?: number): void {
    this.markFirstSoundForSeq(null, ms);
  }

  markFirstSoundForSeq(seq: number | null, ms?: number): void {
    if (this.activeTurn && (seq === null || this.activeTurn.seq === seq)) {
      if (this.activeTurn.firstSoundMs === null) {
        this.activeTurn.firstSoundMs = Math.round(ms ?? performance.now() - this.activeTurn.startMs);
      }
      return;
    }
    if (seq !== null) {
      const committed = this.rows.find((r) => r.seq === seq);
      if (committed && committed.firstSoundMs === null) {
        const startMs = this.startMsBySeq.get(seq);
        if (ms !== undefined || startMs !== undefined) {
          committed.firstSoundMs = Math.round(ms ?? Math.max(0, performance.now() - (startMs ?? 0)));
          this.notify();
        }
      }
    }
  }

  appendReplyText(chunk: string): void {
    if (!this.activeTurn || !chunk) return;
    this.activeTurn.replyChunks.push(chunk);
  }

  addNote(note: string): void {
    if (!this.activeTurn || !note) return;
    this.activeTurn.notes.push(note);
  }

  markInterrupted(): void {
    if (!this.activeTurn) return;
    this.activeTurn.wasInterrupted = true;
  }

  commitTurn(frameWindow: { minFps: number; jank25: number; jank50: number }): LiveTelemetryRow | null {
    const t = this.activeTurn;
    if (!t) return null;
    const now = new Date();
    const row: LiveTelemetryRow = {
      seq: t.seq,
      ts: now.toLocaleTimeString([], { hour12: false }),
      scenario: t.scenario,
      input: t.input,
      replyPreview: t.replyChunks.join('').trim().slice(0, 72),
      turnLabel: t.turnLabel,
      turnProbs: t.turnProbs,
      speculativeHit: t.speculativeHit,
      ttftMs: t.ttftMs,
      ttsTtfaMs: t.ttsTtfaMs,
      firstSoundMs: t.firstSoundMs,
      minFps: frameWindow.minFps,
      jank25: frameWindow.jank25,
      jank50: frameWindow.jank50,
      wasInterrupted: t.wasInterrupted,
      ttsEngine: t.ttsEngine,
      notes: t.notes.join(' | '),
    };
    this.rows.unshift(row);
    if (this.rows.length > 60) this.rows.length = 60;
    this.activeTurn = null;
    this.notify();
    return row;
  }

  pushStandAloneRow(row: Omit<LiveTelemetryRow, 'seq' | 'ts'>): LiveTelemetryRow {
    const full: LiveTelemetryRow = {
      ...row,
      seq: ++this.nextSeq,
      ts: new Date().toLocaleTimeString([], { hour12: false }),
    };
    this.rows.unshift(full);
    if (this.rows.length > 60) this.rows.length = 60;
    this.notify();
    return full;
  }

  addTranscript(entry: Omit<TranscriptEntry, 'id' | 'ts'>): TranscriptEntry {
    const full: TranscriptEntry = {
      ...entry,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
    };
    this.transcript.push(full);
    if (this.transcript.length > 100) this.transcript.shift();
    this.notify();
    return full;
  }

  updateTranscript(id: string, patch: Partial<TranscriptEntry>): void {
    const item = this.transcript.find((x) => x.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.notify();
  }

  getRows(): LiveTelemetryRow[] {
    return this.rows.slice();
  }

  getTranscript(): TranscriptEntry[] {
    return this.transcript.slice();
  }

  clear(): void {
    this.rows = [];
    this.transcript = [];
    this.activeTurn = null;
    this.startMsBySeq.clear();
    this.notify();
  }
}
