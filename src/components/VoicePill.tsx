import React, { useEffect, useRef, useState } from 'react';
import { Mic, ArrowLeft, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface VoicePillProps {
  state: 'idle' | 'loading' | 'listening' | 'recognizing' | 'error';
  rms: number; // 0 ~ 1 real audio energy fallback from STT/VAD
  speechProb: number; // 0 ~ 1 speech probability
  loadingPercent?: number;
  errorLabel?: string | null;
  title?: string;
  getAnalyser?: () => AnalyserNode | null;
  onToggle: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  onCancel?: () => void;
  accentColor?: string;
  className?: string;
}

const CANCEL_DISTANCE = 48; // px to drag left to trigger cancel
const WAVE_MAX_BARS = 18;
const WAVE_EVERY = 3;
const MIC_BINS: [number, number][] = [
  [1, 4],
  [4, 11],
  [11, 33],
];
const MIC_GAIN = 2.4;
const DT_MAX = 0.05;

const micLevel = (analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number => {
  analyser.getByteFrequencyData(buf);
  let total = 0;
  for (const [lo, hi] of MIC_BINS) {
    let s = 0;
    for (let i = lo; i < hi; i += 1) s += buf[i]!;
    total += s / ((hi - lo) * 255);
  }
  return (total / MIC_BINS.length) * MIC_GAIN;
};

export const VoicePill: React.FC<VoicePillProps> = ({
  state,
  rms,
  speechProb,
  loadingPercent = 0,
  errorLabel,
  title,
  getAnalyser,
  onToggle,
  onHoldStart,
  onHoldEnd,
  onCancel,
  accentColor = '#ea8377',
  className = '',
}) => {
  const { t } = useTranslation();
  const isListening = state === 'listening';
  const isRecognizing = state === 'recognizing';
  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isActive = isListening || isRecognizing;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);

  // Interaction & gesture state
  const [slideX, setSlideX] = useState(0);
  const isSlidingRef = useRef(false);
  const startXRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const isHoldModeRef = useRef(false);
  const wasHoldTriggeredRef = useRef(false);

  // Time elapsed counter
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);

  // Live waveform animation history (React Bits microphone engine)
  const waveHistRef = useRef<number[]>([]);
  const waveAccRef = useRef<number>(0);
  const waveTickRef = useRef<number>(0);
  const envRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Start elapsed timer on active
  useEffect(() => {
    if (isActive) {
      startTimeRef.current = performance.now();
      lastTimeRef.current = startTimeRef.current;
      envRef.current = 0;
      waveAccRef.current = 0;
      waveTickRef.current = 0;
      waveHistRef.current = [];
      const updateTimer = () => {
        if (!timeRef.current) return;
        const elapsedSec = Math.floor((performance.now() - startTimeRef.current) / 1000);
        const mins = Math.floor(elapsedSec / 60);
        const secs = elapsedSec % 60;
        timeRef.current.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      updateTimer();
      timerIntervalRef.current = window.setInterval(updateTimer, 500);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      waveHistRef.current = [];
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isActive]);

  // Live waveform Canvas renderer (React Bits Canvas wave engine)
  useEffect(() => {
    if (!isActive) return;

    let rafId = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = (now: number) => {
      const last = lastTimeRef.current || now;
      const dt = Math.min((now - last) / 1000, DT_MAX);
      lastTimeRef.current = now;

      // 1. Sample real microphone frequency levels or fall back to VAD RMS
      let target = 0;
      const analyser = getAnalyser?.();
      if (analyser && isListening) {
        if (!bufRef.current || bufRef.current.length !== analyser.frequencyBinCount) {
          bufRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        target = micLevel(analyser, bufRef.current);
      } else if (isListening) {
        target = speechProb > 0.4 ? Math.max(0.12, rms * 3.0) : 0.05;
      } else {
        target = 0.35; // recognizing subtle pulse
      }

      target = Math.min(1, target * 1.15);
      // React Bits attack (40ms) & release (240ms) time constants
      const attack = 40;
      const release = 240;
      const tau = Math.max(1, target > envRef.current ? attack : release) / 1000;
      envRef.current += (target - envRef.current) * (1 - Math.exp(-dt / tau));
      const level = envRef.current;

      waveAccRef.current = Math.max(waveAccRef.current, level);
      waveTickRef.current = (waveTickRef.current + 1) % WAVE_EVERY;

      if (waveTickRef.current === 0) {
        waveHistRef.current.push(waveAccRef.current);
        waveAccRef.current = 0;
        if (waveHistRef.current.length > WAVE_MAX_BARS) {
          waveHistRef.current.shift();
        }
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      ctx.clearRect(0, 0, W, H);

      const hist = waveHistRef.current;
      const bw = 2.5 * dpr;
      const step = 4 * dpr;
      const shift = (waveTickRef.current / WAVE_EVERY) * step;
      const floor = 0.12;

      for (let i = 0; i < hist.length; i++) {
        const v = hist[hist.length - 1 - i]!;
        const x = W - (i + 1) * step - shift;
        if (x + bw < 0) break;

        const h = Math.max(bw, (floor + (1 - floor) * v) * (H * 0.9));
        const t = Math.min(1, Math.max(0, (x + bw / 2) / (W * 0.55)));
        const fade = t * t * (3 - 2 * t);

        ctx.fillStyle = accentColor;
        ctx.globalAlpha = (0.35 + 0.65 * v) * fade;
        ctx.beginPath();
        ctx.roundRect(x, (H - h) / 2, bw, h, bw / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isActive, isListening, speechProb, rms, accentColor, getAnalyser]);

  // Pointer event handlers for click, hold-to-talk, and slide-to-cancel
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Prevent blurring the active chat textarea when interacting with VoicePill
    if (document.activeElement?.id === 'xiaochun-chat-compose') {
      e.preventDefault();
    }

    isHoldModeRef.current = false;
    wasHoldTriggeredRef.current = false;
    isSlidingRef.current = true;
    startXRef.current = e.clientX;
    setSlideX(0);

    // If held for >= 300ms, enter Hold-to-Talk mode
    holdTimerRef.current = window.setTimeout(() => {
      isHoldModeRef.current = true;
      wasHoldTriggeredRef.current = true;
      if (state === 'idle') {
        onHoldStart?.();
      }
    }, 300);

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isSlidingRef.current || !isActive) return;
    const deltaX = e.clientX - startXRef.current;
    if (deltaX < 0) {
      setSlideX(Math.max(-CANCEL_DISTANCE, deltaX));
    } else {
      setSlideX(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }

    const cancelled = Math.abs(slideX) >= CANCEL_DISTANCE - 4;
    isSlidingRef.current = false;
    setSlideX(0);

    if (cancelled) {
      isHoldModeRef.current = false;
      onCancel?.();
      return;
    }

    if (isHoldModeRef.current) {
      isHoldModeRef.current = false;
      onHoldEnd?.();
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wasHoldTriggeredRef.current) {
      wasHoldTriggeredRef.current = false;
      return;
    }
    onToggle();
  };

  const cancelProgress = Math.min(1, Math.abs(slideX) / CANCEL_DISTANCE);
  const isCancelling = cancelProgress > 0.6;

  return (
    <button
      type="button"
      id="chatSttMic"
      aria-label={
        isLoading
          ? t('chat.sttLoading')
          : isListening
          ? t('chat.sttListening')
          : isRecognizing
          ? t('chat.sttRecognizing')
          : isError
          ? errorLabel || t('chat.sttError')
          : t('chat.sttIdle')
      }
      title={
        title ||
        (isLoading
          ? t('chat.sttDownload', { percent: loadingPercent })
          : isListening
          ? t('chat.stopSpeaking')
          : isError
          ? errorLabel || t('chat.sttError')
          : t('chat.sttIdle'))
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      className={`relative inline-flex items-center justify-between select-none touch-none appearance-none outline-none overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
        isActive
          ? 'w-[148px] h-9 px-2 rounded-full bg-[#ea8377]/15 border border-[#ea8377]/40 shadow-[0_0_16px_rgba(234,131,119,0.25)]'
          : isError
          ? 'w-9 h-9 rounded-full bg-red-500/20 text-red-300 border border-red-500/30'
          : isLoading
          ? 'w-9 h-9 rounded-full bg-white/10 text-white/70 border border-white/20'
          : 'w-9 h-9 rounded-full bg-transparent text-white/60 hover:text-[#f5aa9c] hover:bg-white/10 border border-transparent active:scale-95'
      } ${className}`}
    >
      {/* ── Active State: React Bits Voice Pill Interior ── */}
      {isActive ? (
        <>
          {/* Slide-to-cancel overlay */}
          <div
            className={`absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium transition-opacity duration-150 pointer-events-none ${
              isCancelling ? 'text-red-400 opacity-100' : 'text-white/60 opacity-0'
            }`}
            style={{
              opacity: cancelProgress > 0.15 ? cancelProgress : 0,
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0 animate-pulse" />
            <span>{t('chat.cancel')}</span>
          </div>

          {/* Normal Voice Pill Contents: Timer + Waveform + Stop Button */}
          <div
            className="flex items-center justify-between w-full transition-opacity duration-150"
            style={{
              opacity: 1 - cancelProgress * 1.5,
              transform: `translateX(${slideX * 0.4}px)`,
            }}
          >
            {/* 1. Timer / Mode */}
            <span
              ref={timeRef}
              className="text-[11px] font-mono tabular-nums font-medium text-[#ea8377] shrink-0 pl-1"
            >
              0:00
            </span>

            {/* 2. Live Canvas Waveform */}
            <div className="flex-1 px-1.5 flex items-center justify-center overflow-hidden">
              <canvas ref={canvasRef} className="w-16 h-5 block" />
            </div>

            {/* 3. Stop Action Icon */}
            <span className="w-6 h-6 rounded-full bg-[#ea8377] text-white flex items-center justify-center shrink-0 shadow-sm shadow-[#ea8377]/40 active:scale-90 transition-transform">
              {isRecognizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-[2px] bg-white block" />
              )}
            </span>
          </div>
        </>
      ) : (
        /* ── Idle / Loading / Error State: Compact Mic Button ── */
        <span className="w-full h-full flex items-center justify-center">
          {isLoading ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <svg className="absolute inset-0 h-9 w-9 -rotate-90" viewBox="0 0 36 36" aria-hidden>
                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#ea8377"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${(loadingPercent / 100) * 88} 88`}
                />
              </svg>
              <Loader2 className="w-4 h-4 text-[#ea8377] animate-spin" />
            </div>
          ) : (
            <Mic className={`w-4 h-4 ${isError ? 'text-red-400' : 'text-current'}`} />
          )}
        </span>
      )}
    </button>
  );
};
