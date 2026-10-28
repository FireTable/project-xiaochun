import React, { useState, useEffect, useRef } from 'react';
import {
  getVoiceHistory,
  clearVoiceHistory,
  VOICE_HISTORY_UPDATE_EVENT,
  wavDataUrlToPcm,
  isSpeechRecognitionSupported,
  testWithSpeechRecognition,
  type VoiceAnalysisRecord,
} from '@/stt/voiceSessionHistory';
import { getSharedSttClient } from '@/stt/sttClient';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { Play, Pause, Trash2, Copy, Check, Mic, Zap, Globe, Loader2 } from '@/components/icons';

function formatTime(timestamp: number): string {
  try {
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '—';
  }
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TestResultState {
  senseVoice?: {
    text: string;
    inferenceMs: number;
    loading?: boolean;
    error?: string;
  };
  webSpeech?: {
    text: string;
    durationMs: number;
    loading?: boolean;
    error?: string;
  };
}

export const VoiceAnalysisSection: React.FC = () => {
  const { t, isOpen } = useDevDrawer();
  const [records, setRecords] = useState<VoiceAnalysisRecord[]>(() => getVoiceHistory());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResultState>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync records when sessionStorage updates or drawer visibility changes
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      setRecords(getVoiceHistory());
    };
    update();
    window.addEventListener(VOICE_HISTORY_UPDATE_EVENT, update);
    return () => {
      window.removeEventListener(VOICE_HISTORY_UPDATE_EVENT, update);
    };
  }, [isOpen]);

  // Clean up audio on unmount or when drawer closes
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleTogglePlay = (record: VoiceAnalysisRecord) => {
    if (playingId === record.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(record.audioDataUrl);
    audioRef.current = audio;
    setPlayingId(record.id);
    setPlaybackTime(0);
    setPlaybackDuration(record.durationMs / 1000);

    audio.ontimeupdate = () => {
      setPlaybackTime(audio.currentTime);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setPlaybackDuration(audio.duration);
      }
    };

    audio.onended = () => {
      setPlayingId(null);
      setPlaybackTime(0);
    };

    audio.onerror = (e) => {
      console.warn('[VoiceAnalysis] Audio playback error:', e);
      setPlayingId(null);
    };

    audio.play().catch((err) => {
      console.warn('[VoiceAnalysis] Play call was prevented:', err);
      setPlayingId(null);
    });
  };

  const handleSeek = (record: VoiceAnalysisRecord, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * (record.durationMs / 1000);

    if (playingId === record.id && audioRef.current) {
      audioRef.current.currentTime = targetTime;
      setPlaybackTime(targetTime);
    } else {
      // Start playing from clicked position
      handleTogglePlay(record);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = targetTime;
          setPlaybackTime(targetTime);
        }
      }, 50);
    }
  };

  const handleCopyText = (record: VoiceAnalysisRecord) => {
    if (!record.text) return;
    void navigator.clipboard?.writeText(record.text);
    setCopiedId(record.id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === record.id ? null : curr));
    }, 1500);
  };

  const handleClearAll = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
    clearVoiceHistory();
    setRecords([]);
    setTestResults({});
  };

  const handleTestAsr = async (record: VoiceAnalysisRecord) => {
    setTestResults((prev) => ({
      ...prev,
      [record.id]: {
        ...prev[record.id],
        senseVoice: { text: '', inferenceMs: 0, loading: true },
      },
    }));

    try {
      const { pcm, sampleRate } = wavDataUrlToPcm(record.audioDataUrl);
      const res = await getSharedSttClient().recognizePcm(pcm, sampleRate);
      setTestResults((prev) => ({
        ...prev,
        [record.id]: {
          ...prev[record.id],
          senseVoice: { text: res.text, inferenceMs: res.inferenceMs, loading: false },
        },
      }));
    } catch (err) {
      console.error('[VoiceAnalysis] SenseVoice retest failed:', err);
      setTestResults((prev) => ({
        ...prev,
        [record.id]: {
          ...prev[record.id],
          senseVoice: {
            text: '',
            inferenceMs: 0,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  };

  const handleTestWebSpeech = async (record: VoiceAnalysisRecord) => {
    if (!isSpeechRecognitionSupported) return;

    setTestResults((prev) => ({
      ...prev,
      [record.id]: {
        ...prev[record.id],
        webSpeech: { text: '', durationMs: 0, loading: true },
      },
    }));

    try {
      const res = await testWithSpeechRecognition(record.audioDataUrl);
      setTestResults((prev) => ({
        ...prev,
        [record.id]: {
          ...prev[record.id],
          webSpeech: { text: res.text, durationMs: res.durationMs, loading: false },
        },
      }));
    } catch (err) {
      console.warn('[VoiceAnalysis] WebSpeech test failed:', err);
      setTestResults((prev) => ({
        ...prev,
        [record.id]: {
          ...prev[record.id],
          webSpeech: {
            text: '',
            durationMs: 0,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  };

  return (
    <SectionCard id="voiceAnalysis">
      <SectionHeader
        id="voiceAnalysis"
        title={t('panel.voiceAnalysisTitle')}
        modified={false}
        showReset={false}
        uppercase={false}
      />

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-6 text-center rounded-lg border border-white/10 bg-white/5 gap-2.5">
          <div className="w-10 h-10 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-300">
            <Mic className="w-5 h-5 text-brand-300" />
          </div>
          <div className="text-xs text-white/80 font-medium">{t('panel.voiceAnalysisEmptyTitle')}</div>
          <p className="text-[11px] text-white/50 max-w-[280px] leading-relaxed">
            {t('panel.voiceAnalysisEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* Subheader with clean clear button */}
          <div className="flex items-center justify-between text-[11px] text-white/50 px-1">
            <span>{t('panel.voiceAnalysisRecentList', { count: records.length })}</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="hover:text-rose-300 flex items-center gap-1 transition-colors cursor-pointer text-[10px]"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t('panel.voiceAnalysisClearBtn')}</span>
            </button>
          </div>

          {records.map((rec, idx) => {
            const isPlaying = playingId === rec.id;
            const progress =
              isPlaying && playbackDuration > 0
                ? Math.min(100, Math.max(0, (playbackTime / playbackDuration) * 100))
                : 0;
            const resultState = testResults[rec.id];

            return (
              <div
                key={rec.id}
                className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/20 transition-all text-[11px]"
              >
                {/* Clean Metas Header (No cramped multi-color badges) */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-white/80 font-bold text-[11px]">
                      #{idx + 1}
                    </span>
                    <span className="text-white/30 text-[10px] font-mono">·</span>
                    <span className="text-white/45 font-mono text-[10px]">
                      {formatTime(rec.timestamp)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                    <span className="text-white/40">
                      {(rec.durationMs / 1000).toFixed(2)}s
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-400/20"
                      title={t('panel.voiceAnalysisLatencyTooltip')}
                    >
                      ⚡ {rec.inferenceMs}ms
                    </span>
                  </div>
                </div>

                {/* Recognized Text Box (Hero content, self-evident, with top-right copy icon) */}
                <div className="relative group p-2.5 rounded-lg bg-black/40 border border-white/8 hover:border-white/15 transition-colors">
                  <div className="text-[13px] text-white/95 font-medium leading-relaxed select-text break-words pr-6 min-h-[18px]">
                    {rec.text ? (
                      rec.text
                    ) : (
                      <span className="text-white/35 italic text-xs">
                        {t('panel.voiceAnalysisNoText')}
                      </span>
                    )}
                  </div>
                  {rec.text && (
                    <button
                      type="button"
                      onClick={() => handleCopyText(rec)}
                      className="absolute top-2 right-2 p-1 rounded hover:bg-white/15 text-white/40 hover:text-white transition-all cursor-pointer"
                      title={t('panel.voiceAnalysisCopy')}
                    >
                      {copiedId === rec.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Audition Player & Stats Bar */}
                <div className="flex items-center gap-2.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => handleTogglePlay(rec)}
                    aria-label={isPlaying ? t('panel.voiceAnalysisPause') : t('panel.voiceAnalysisPlay')}
                    className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all shrink-0 ${
                      isPlaying
                        ? 'bg-brand-500 text-white shadow-[0_0_8px_rgba(234,131,119,0.5)]'
                        : 'bg-white/10 hover:bg-white/20 text-white/90 border border-white/10 active:scale-95'
                    }`}
                  >
                    {isPlaying ? (
                      <Pause className="w-3 h-3 fill-current" />
                    ) : (
                      <Play className="w-3 h-3 ml-0.5 fill-current" />
                    )}
                  </button>

                  {/* Progress scrubber & inline stats */}
                  <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
                    <div
                      className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden relative cursor-pointer"
                      onClick={(e) => handleSeek(rec, e)}
                    >
                      <div
                        className="h-full bg-brand-400 transition-[width] duration-100 rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
                      <span>
                        {isPlaying ? formatSeconds(playbackTime) : '0:00'} / {formatSeconds(rec.durationMs / 1000)}
                      </span>
                      <span title={t('panel.voiceAnalysisRmsTooltip')}>
                        RMS {(rec.rms * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* A/B Benchmark & Retest Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    disabled={resultState?.senseVoice?.loading}
                    onClick={() => handleTestAsr(rec)}
                    className="flex-1 py-1 px-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 active:scale-95 text-amber-300 border border-amber-400/25 flex items-center justify-center gap-1.5 text-[10px] font-medium transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                    title={t('panel.voiceAnalysisTestAsrTooltip')}
                  >
                    {resultState?.senseVoice?.loading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{t('panel.voiceAnalysisTesting')}</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3" />
                        <span>{t('panel.voiceAnalysisTestAsrBtn')}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={!isSpeechRecognitionSupported || resultState?.webSpeech?.loading}
                    onClick={() => handleTestWebSpeech(rec)}
                    className={`flex-1 py-1 px-2 rounded-lg flex items-center justify-center gap-1.5 text-[10px] font-medium transition-all ${
                      isSpeechRecognitionSupported
                        ? 'bg-sky-500/10 hover:bg-sky-500/20 active:scale-95 text-sky-300 border border-sky-400/25 cursor-pointer disabled:opacity-50 disabled:pointer-events-none'
                        : 'bg-white/5 text-white/30 border border-white/5 cursor-not-allowed opacity-40'
                    }`}
                    title={
                      isSpeechRecognitionSupported
                        ? t('panel.voiceAnalysisTestWebSpeechTooltip')
                        : t('panel.voiceAnalysisWebSpeechUnsupported')
                    }
                  >
                    {resultState?.webSpeech?.loading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{t('panel.voiceAnalysisTesting')}</span>
                      </>
                    ) : (
                      <>
                        <Globe className="w-3 h-3" />
                        <span>{t('panel.voiceAnalysisTestWebSpeechBtn')}</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Comparison Results Card */}
                {(resultState?.senseVoice?.text !== undefined ||
                  resultState?.webSpeech?.text !== undefined ||
                  resultState?.senseVoice?.error ||
                  resultState?.webSpeech?.error) && (
                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-black/50 border border-white/10 text-[11px] font-sans">
                    {(resultState.senseVoice?.text !== undefined || resultState.senseVoice?.error) && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-amber-400 font-semibold text-[10px] shrink-0 font-mono">
                          {t('panel.voiceAnalysisSenseVoiceLabel')}:
                        </span>
                        <span className="flex-1 text-white/95 select-text break-words">
                          {resultState.senseVoice.error ? (
                            <span className="text-rose-400/80">{resultState.senseVoice.error}</span>
                          ) : resultState.senseVoice.text ? (
                            resultState.senseVoice.text
                          ) : (
                            <span className="text-white/35 italic">(未识别出有效文本)</span>
                          )}
                        </span>
                        {resultState.senseVoice.inferenceMs > 0 && (
                          <span className="text-[10px] text-amber-300/80 font-mono shrink-0">
                            ⚡ {resultState.senseVoice.inferenceMs}ms
                          </span>
                        )}
                      </div>
                    )}
                    {(resultState.webSpeech?.text !== undefined || resultState.webSpeech?.error) && (
                      <div className="flex items-start justify-between gap-2 border-t border-white/5 pt-1">
                        <span className="text-sky-400 font-semibold text-[10px] shrink-0 font-mono">
                          {t('panel.voiceAnalysisWebSpeechLabel')}:
                        </span>
                        <span className="flex-1 text-white/95 select-text break-words">
                          {resultState.webSpeech.error ? (
                            <span className="text-rose-400/80">{resultState.webSpeech.error}</span>
                          ) : resultState.webSpeech.text ? (
                            resultState.webSpeech.text
                          ) : (
                            <span className="text-white/35 italic">{t('panel.voiceAnalysisNoWebSpeechResult')}</span>
                          )}
                        </span>
                        {resultState.webSpeech.durationMs > 0 && (
                          <span className="text-[10px] text-sky-300/80 font-mono shrink-0">
                            ⏱️ {resultState.webSpeech.durationMs}ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};
