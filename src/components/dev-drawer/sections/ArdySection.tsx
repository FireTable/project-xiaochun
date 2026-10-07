import React, { useRef, useState } from 'react';
import { isArdyCancelled } from '@/motion/sources/ardy/play';
import { vrmEngine } from '@/core/vrmEngine';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';

const DEFAULT_PROMPT = 'A person waves with the right hand.';

export const ArdySection: React.FC = () => {
  const { t } = useDevDrawer();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const ticket = useRef(0);

  const generate = () => {
    const text = prompt.trim();
    if (!text) {
      setStatus(t('panel.ardyNeedPrompt'));
      return;
    }
    const mine = ticket.current + 1;
    ticket.current = mine;
    setBusy(true);
    setLive(true);
    setStatus('');
    void vrmEngine.playArdy(text, (message) => {
      if (ticket.current === mine) setStatus(message);
    }).then(() => {
      if (ticket.current !== mine) return;
      setBusy(false);
    }).catch((error: unknown) => {
      if (ticket.current !== mine) return;
      setLive(false);
      setBusy(false);
      if (isArdyCancelled(error)) {
        setStatus('');
        return;
      }
      setStatus(error instanceof Error ? error.message : String(error));
    });
  };

  const stop = () => {
    ticket.current += 1;
    vrmEngine.stopArdy();
    setLive(false);
    setBusy(false);
    setStatus('');
  };

  const release = () => {
    ticket.current += 1;
    setReleasing(true);
    setLive(false);
    setBusy(false);
    void vrmEngine.releaseArdy()
      .then(() => setStatus(''))
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setReleasing(false));
  };

  return (
    <SectionCard id="ardy">
      <SectionHeader
        id="ardy"
        title={t('panel.ardyLabel')}
        modified={false}
        uppercase={false}
      />
      <p className="text-[11px] leading-snug text-white/55">{t('panel.ardyHint')}</p>
      <label className="flex flex-col gap-1 text-[11px] text-white/70">
        {t('panel.ardyPrompt')}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={280}
          spellCheck={false}
          className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-white/30"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || releasing}
          onClick={generate}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/90 hover:bg-white/15 disabled:opacity-40"
        >
          {t('panel.ardyGenerate')}
        </button>
        <button
          type="button"
          disabled={!live && !busy}
          onClick={stop}
          className="rounded-lg px-3 py-1.5 text-xs text-white/70 hover:text-white/90 disabled:opacity-40"
        >
          {t('panel.ardyStop')}
        </button>
        <button
          type="button"
          disabled={releasing}
          onClick={release}
          className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white/90 disabled:opacity-40"
        >
          {t('panel.ardyRelease')}
        </button>
      </div>
      {status ? <p className="text-[11px] leading-snug text-white/70 break-words">{status}</p> : null}
    </SectionCard>
  );
};
