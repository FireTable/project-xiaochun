import React, { useState, useEffect, useRef } from 'react';
import {
  getVoiceHistory,
  clearVoiceHistory,
  VOICE_HISTORY_UPDATE_EVENT,
  type VoiceAnalysisRecord,
} from '@/stt/voiceSessionHistory';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { Play, Pause, Trash2, Copy, Check, Mic } from '@/components/icons';

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

export const VoiceAnalysisSection: React.FC = () => {
  const { t, isOpen } = useDevDrawer();
  const [records, setRecords] = useState<VoiceAnalysisRecord[]>(() => getVoiceHistory());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};
