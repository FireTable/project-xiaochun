import React, { useEffect, useMemo, useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import type { EmagePerfSnapshot } from '@/motion/emagePlayer';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';

function fmtMs(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)} ms`;
}

function fmtBool(v: boolean | undefined | null): string {
  if (v == null) return '—';
  return v ? 'true' : 'false';
}

function passFailHint(
  snap: EmagePerfSnapshot,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { ok: boolean; line: string } {
  const env = snap.wasmEnv;
  if (!env) {
    return { ok: false, line: t('panel.emagePerfWaitWasm') };
  }
  const sab = !!env.sharedArrayBuffer;
  const isolated = !!env.crossOriginIsolated;
  const threads = Number(env.numThreads) || 0;
  if (threads >= 2 && sab && isolated) {
    return { ok: true, line: t('panel.emagePerfPassLine') };
  }
  if (!isolated) return { ok: false, line: t('panel.emagePerfFailNotIsolated') };
  if (!sab) return { ok: false, line: t('panel.emagePerfFailNoSab') };
  if (threads < 2) return { ok: false, line: t('panel.emagePerfFailThreads', { n: threads }) };
  return { ok: false, line: t('panel.emagePerfFailUnknown') };
}

type Row = { label: string; value: string; tone?: 'ok' | 'bad' | 'muted' };

/**
 * EMAGE P0b 验收面板：大字号 key/value，方便直接截图，无需开远程 console。
 * 每 500ms 轮询 getEmagePerfSnapshot；不改动动作混合逻辑。
 */
export const EmagePerfSection: React.FC = () => {
  const { t } = useDevDrawer();
  const [snap, setSnap] = useState<EmagePerfSnapshot>(() => vrmEngine.getEmagePerfSnapshot());

  useEffect(() => {
    const tick = () => setSnap(vrmEngine.getEmagePerfSnapshot());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  const hint = useMemo(() => passFailHint(snap, t), [snap, t]);
  const env = snap.wasmEnv;
  const by = snap.lastByStage;

  // Metric labels stay technical English (protocol / ORT field names) for screenshot parity across locales.
  const rows: Row[] = [
    {
      label: 'crossOriginIsolated (worker)',
      value: fmtBool(env?.crossOriginIsolated),
      tone: env ? (env.crossOriginIsolated ? 'ok' : 'bad') : 'muted',
    },
    {
      label: 'crossOriginIsolated (live)',
      value: fmtBool(snap.liveCrossOriginIsolated),
      tone: snap.liveCrossOriginIsolated ? 'ok' : 'bad',
    },
    {
      label: 'sharedArrayBuffer / sabOk',
      value: fmtBool(env?.sharedArrayBuffer),
      tone: env ? (env.sharedArrayBuffer ? 'ok' : 'bad') : 'muted',
    },
    {
      label: 'numThreads',
      value: env ? String(env.numThreads) : '—',
      tone: env ? (env.numThreads >= 2 ? 'ok' : 'bad') : 'muted',
    },
    {
      label: 'hardwareConcurrency',
      value: env ? String(env.hardwareConcurrency) : '—',
    },
    {
      label: 'simd',
      value: env?.simd == null ? '—' : fmtBool(env.simd),
    },
    { label: 'step ms', value: fmtMs(by.step) },
    { label: 'decode_chunk ms', value: fmtMs(by.decode_chunk) },
    { label: 'decode_checkpoint ms', value: fmtMs(by.decode_checkpoint) },
    { label: 'step_tail ms', value: fmtMs(by.step_tail) },
    { label: 'decode_end ms', value: fmtMs(by.decode_end) },
    {
      label: 'ready',
      value: fmtBool(snap.ready),
      tone: snap.ready ? 'ok' : 'muted',
    },
    {
      label: 'streamingMotionActive',
      value: fmtBool(snap.streamingMotionActive),
      tone: snap.streamingMotionActive ? 'ok' : 'muted',
    },
    {
      label: 'awaitingAudioStart',
      value: fmtBool(snap.awaitingAudioStart),
    },
  ];

  const handleClear = () => {
    vrmEngine.clearEmagePerfProfiles();
    setSnap(vrmEngine.getEmagePerfSnapshot());
  };

  const handleToggleProfile = () => {
    const next = !snap.preferProfileStages;
    vrmEngine.setEmagePreferProfileStages(next);
    setSnap(vrmEngine.getEmagePerfSnapshot());
  };

  const handleReset = () => {
    vrmEngine.clearEmagePerfProfiles();
    setSnap(vrmEngine.getEmagePerfSnapshot());
  };

  const valueClass = (tone?: Row['tone']) => {
    if (tone === 'ok') return 'text-emerald-300';
    if (tone === 'bad') return 'text-rose-300';
    if (tone === 'muted') return 'text-white/45';
    return 'text-brand-300';
  };

  return (
    <SectionCard id="emagePerf">
      <SectionHeader
        id="emagePerf"
        title={t('panel.emagePerfLabel')}
        modified={false}
        onReset={handleReset}
        showReset={snap.lastStageProfiles.length > 0}
        uppercase={false}
      />

      <div
        className={`rounded-lg px-3 py-2 text-[11px] leading-snug border ${
          hint.ok
            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
            : 'bg-rose-500/15 border-rose-400/40 text-rose-200'
        }`}
      >
        {hint.ok ? `${t('panel.emagePerfPass')} — ${hint.line}` : hint.line}
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 min-w-0">
            <span className="text-[11px] text-white/70 leading-tight min-w-0 truncate">
              {r.label}
            </span>
            <span
              className={`font-mono text-[11px] tabular-nums text-right shrink-0 ${valueClass(r.tone)}`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[12px] text-white/80">{t('panel.emagePerfToggle')}</span>
          <span className="text-[10px] text-white/45 leading-relaxed">
            {t('panel.emagePerfToggleHint')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggleProfile}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            snap.preferProfileStages ? 'bg-brand-500' : 'bg-white/20'
          }`}
          aria-pressed={snap.preferProfileStages}
          aria-label={t('panel.emagePerfToggle')}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
              snap.preferProfileStages ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <button
        type="button"
        onClick={handleClear}
        className="w-full py-2 rounded-lg text-[12px] font-medium cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
      >
        {t('panel.emagePerfClear')}
      </button>

      {snap.lastStageProfiles.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            {t('panel.emagePerfRecentStages', { n: snap.lastStageProfiles.length })}
          </span>
          <div className="max-h-28 overflow-y-auto rounded-lg bg-white/[0.02] border border-white/10 p-2.5 font-mono text-[11px] text-white/55 space-y-0.5">
            {[...snap.lastStageProfiles].reverse().map((s, i) => (
              <div key={`${s.at}-${s.stage}-${i}`} className="flex justify-between gap-2">
                <span className="truncate">{s.stage}</span>
                <span className="shrink-0 text-brand-200/80">
                  {s.elapsedMs.toFixed(1)}ms
                  {s.frames != null ? ` · ${s.frames}f` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
};
