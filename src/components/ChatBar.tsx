import React, { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Menu, Mic, Mountain, Server, Sun, Zap } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { DeviceStatusDialog } from '@/components/DeviceStatusDialog';
import { ProviderConfigDialog } from '@/components/ProviderConfigDialog';
import { AdvancedSettingsDialog } from '@/components/AdvancedSettingsDialog';
import { SyncDialog } from '@/components/SyncDialog';
import {
  isWebLLMReady,
  onWebLLMReadyChange,
  isThinkingEnabled,
  setThinkingEnabled,
  onLlmLoadProgress,
  getLlmLoadProgress,
  getActiveModelId,
  setActiveModelId,
  onActiveModelChange,
  getQuickDeviceTier,
  getCachedDeviceProfile,
  listModelGroups,
  modelBaseId,
  subscribeThinkingEnabled,
} from '@/llm/webLLMProvider';
import { getActiveProviderId, getProvider, type ProviderProfile, subscribeProvidersChange } from '@/llm/customProvider';
import { readActiveModel, subscribeActiveModel } from '@/llm/activeModel';
import { Send, Sparkles, Loader2 } from '@/components/icons';
import { splitIntoSpeechChunks } from '@/director/chatDirector';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { LlmProviderIcon } from '@/components/LlmProviderIcon';
import { holdPetUi, releasePetUi } from '@/hooks/usePetUiVisibility';
import { isDev } from '@/lib/utils';
import { SttClient, insertAtCursor, type SttUiState } from '@/stt/sttClient';

function MenuSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        on ? 'bg-[#ea8377]' : 'bg-white/20'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

function AccentFill({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-full bg-gradient-to-r from-[#ea8377] to-[#e06d64] transition-opacity duration-200 ${on ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

export const ChatBar: React.FC<{
  isPetUIVisible?: boolean;
  onShowDevPanel?: () => void;
}> = ({ isPetUIVisible = false, onShowDevPanel }) => {
  const { t } = useTranslation();
  const currentScene = useCurrentScene();
  const isTransparent = Boolean(currentScene.isTransparent);
  // ponytail: 不再有 hover-show — 透明桌宠模式只靠点击角色身体 (App.tsx 的 isPetUIVisible) 唤出/收起
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sttRef = useRef<SttClient | null>(null);
  const [sttState, setSttState] = useState<SttUiState>('idle');
  const [sttPercent, setSttPercent] = useState(0);
  /** mic_denied | mic_insecure | mic_unsupported | mic_not_found | other */
  const [sttErrorKind, setSttErrorKind] = useState<string | null>(null);
  const [inputRows, setInputRows] = useState(1);
  const composerExpanded = inputRows > 1;
  /** 未聚焦时记录 visualViewport 高度，用来判断 Android 键盘是否挤矮了可视区 */
  const restingVvHeightRef = useRef<number>(typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : 0);
  const [hasText, setHasText] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const queuedTextRef = useRef('');
  const [thinkingOn, setThinkingOn] = useState(() => isThinkingEnabled());
  const [activeModel, setActiveModel] = useState(() => getActiveModelId());
  const [pickingModel, setPickingModel] = useState(false);
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showAdvancedDialog, setShowAdvancedDialog] = useState(false);
  const [showSyncDialog, setShowSyncDialog] = useState(false);

  // STT (SenseVoice) — lazy client; preload on first mic click
  useEffect(() => {
    const client = new SttClient();
    sttRef.current = client;
    const off = client.on((ev) => {
      if (ev.type === 'state') {
        setSttState(ev.state);
        if (ev.state !== 'error') setSttErrorKind(null);
      } else if (ev.type === 'progress') setSttPercent(ev.percent);
      else if (ev.type === 'text') {
        const el = inputRef.current;
        if (el) {
          insertAtCursor(el, ev.text);
          setHasText(el.value.trim().length > 0);
          requestAnimationFrame(() => {
            const box = inputRef.current;
            if (!box) return;
            const MAX = 4;
            if (box.value.trim().length === 0) {
              box.style.height = '';
              box.style.overflowY = 'hidden';
              setInputRows(1);
              return;
            }
            box.style.height = '0px';
            box.style.overflowY = 'hidden';
            const cs = window.getComputedStyle(box);
            let lineHeight = parseFloat(cs.lineHeight);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
              const fs = parseFloat(cs.fontSize) || 15;
              lineHeight = fs * 1.5;
            }
            const content = box.scrollHeight;
            const measuredRows = Math.max(1, Math.min(MAX, Math.ceil(content / lineHeight - 0.01)));
            setInputRows((prev) => {
              const next = Math.max(prev, measuredRows);
              box.style.height = `${lineHeight * Math.min(MAX, next)}px`;
              box.style.overflowY = content > lineHeight * MAX + 0.5 ? 'auto' : 'hidden';
              return next === prev ? prev : next;
            });
          });
        }
      } else if (ev.type === 'error') {
        if (ev.message === 'empty_transcript') {
          // soft: no alert spam
          console.warn('[STT]', t('chat.sttEmpty'));
        } else if (
          ev.message === 'mic_denied' ||
          ev.message === 'mic_insecure' ||
          ev.message === 'mic_unsupported' ||
          ev.message === 'mic_not_found'
        ) {
          setSttErrorKind(ev.message);
          console.warn('[STT]', ev.message, t('chat.sttMicDeniedHint'));
        } else {
          setSttErrorKind('other');
          console.error('[STT]', ev.message);
        }
      }
    });
    return () => {
      off();
      client.dispose();
      sttRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);
  // ponytail: 当前激活的自定义 provider(webllm 与 custom 二选一)。用来在模型下拉里
  // 显示真实生效的服务名 / 模型,而不是 webLLM 的兜底。
  const [activeCustom, setActiveCustom] = useState<ProviderProfile | null>(null);
  const llmGroups = listModelGroups();
  const activeBase = modelBaseId(activeModel);
  // ponytail: 找当前激活 webllm 模型的 label(去掉量化后缀),下拉里跟 custom 一样
  // 显示「WebLLM + 模型」两行 — provider 名固定,因为都是 webllm 引擎跑的。
  let activeWebLLM: { label: string } | null = null;
  if (activeModel) {
    for (const g of llmGroups) {
      const hit = g.models.find((m) => m.id === activeModel);
      if (hit) {
        activeWebLLM = { label: hit.label };
        break;
      }
    }
  }
  const deviceTier = getCachedDeviceProfile()?.tier ?? getQuickDeviceTier();

  // ponytail: active model 走 state — sync import 写入 localStorage 后会通过 subscribeActiveModel
  // 推过来,直接 readActiveModel() 是非反应式,UI 不会跟新。
  const [activeKey, setActiveKey] = useState(() => readActiveModel());
  // custom 用户永远不需要等 webllm 加载,否则 SYNC badge + "加载模型 0%" + "神经核心同步中"
  // 会一直挂着,误导用户。
  const isOnCustom = activeKey?.kind === 'custom';

  // 模型与引擎就绪感知
  const [isVRMReady, setIsVRMReady] = useState(() => vrmEngine.isReady());
  const [isLLMReady, setIsLLMReady] = useState(() => isWebLLMReady());
  // ponytail: 进度 + 速度合并成一个 state,1Hz 节流更新一次,
  // 避免 progress_callback chunk-level 抖动造成 UI re-render 风暴。
  // 速度用过去 3 秒的滑动窗口平均,稳定且抗抖动。
  const [llmStats, setLlmStats] = useState(() => {
    const p = getLlmLoadProgress();
    return { progress: p.progress, text: p.text, loaded: p.loaded, total: p.total, bps: 0 };
  });
  const samplesRef = useRef<{ ts: number; loaded: number }[]>([]);
  const lastUiTsRef = useRef(0);
  const pendingProgressRef = useRef<{ progress: number; text: string; loaded: number; total: number } | null>(null);

  // ponytail: 生产 build 下用户连点菜单 10 次触发 vconsole(不走 dev 自动挂载路径)。
  // ChatBar 在生产一直挂载,所以计数和 lazy import 放这里,无新组件。
  const menuClickCountRef = useRef(0);
  const enableVConsole = async () => {
    if (typeof window === 'undefined') return;
    if ((window as any).__vconsole__) return;
    try {
      const { default: VConsole } = await import('vconsole');
      new VConsole({ theme: 'dark' });
      (window as any).__vconsole__ = true;
      console.log('[WebConsole] 10 次菜单点击触发 — vconsole 已启用');
    } catch (err) {
      console.warn('[WebConsole] lazy load 失败:', err);
    }
  };
  const handleMenuClickForVConsole = () => {
    menuClickCountRef.current += 1;
    if (menuClickCountRef.current >= 10) {
      menuClickCountRef.current = 0;
      void enableVConsole();
      // ponytail: 暗号触发后只「解锁」右上角 ⚙️ 按钮(让生产构建也能看见),面板本身
      // 要用户主动再点 ⚙️ 才会滑出来 — 不要一次性蹦两个面板砸脸。
      onShowDevPanel?.();
    }
  };

  // ponytail: 加载当前激活的自定义 provider,dialog 关闭后也重新拉一次。
  const refreshActiveCustom = async () => {
    const id = await getActiveProviderId();
    if (!id) {
      setActiveCustom(null);
      return;
    }
    const p = await getProvider(id);
    setActiveCustom(p);
  };
  useEffect(() => {
    void refreshActiveCustom();
  }, [showProviderDialog]);

  // ponytail: 跨设备同步 import 写完存储后,store 主动推订阅 — UI 立刻反映。
  // active model 变化同时覆盖 webllm 模型切换(setActiveModelId 也走 writeActiveModel)。
  useEffect(() => {
    const unsubKey = subscribeActiveModel((k) => {
      setActiveKey(k);
      if (k?.kind === 'webllm') {
        setActiveModel(k.modelId);
      }
      // custom / null 都要 re-fetch active provider — import 完 provider 列表变了,
      // 老的 provider 可能已经被覆盖,需要拿到最新一份。
      void refreshActiveCustom();
    });
    const unsubThinking = subscribeThinkingEnabled((enabled) => {
      setThinkingOn(enabled);
    });
    const unsubProviders = subscribeProvidersChange(() => {
      void refreshActiveCustom();
    });
    return () => {
      unsubKey();
      unsubThinking();
      unsubProviders();
    };
    // ponytail: refreshActiveCustom 是组件内函数,身份稳定,故意不列依赖避免循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 监听 3D VRM 模型就绪状态
    const unsubVRM = vrmEngine.onReadyChange((ready) => {
      setIsVRMReady(ready);
    });
    // ponytail: 兜底轮询 — onWebLLMReadyChange 回调可能在 ChatBar 挂载前就触发了
    // (pipeline() 在 preload 阶段就启动,ChatBar 监听器还没注册就 ready 了),
    // 那样 cb(true) 永远到不了,tooltip 就关不掉。每秒 poll 一次直到 ready。
    if (isWebLLMReady()) setIsLLMReady(true);
    const pollId = window.setInterval(() => {
      if (isWebLLMReady()) {
        setIsLLMReady(true);
        window.clearInterval(pollId);
      }
    }, 1000);
    const unsubLLM = onWebLLMReadyChange((ready) => {
      setIsLLMReady(ready);
      if (ready) {
        samplesRef.current = [];
        lastUiTsRef.current = 0;
        pendingProgressRef.current = null;
        setLlmStats({ progress: 1, text: '', loaded: 0, total: 0, bps: 0 });
      }
    });
    const unsubProgress = onLlmLoadProgress((p) => {
      const now = performance.now();

      // 1) 始终把最新原始进度放进 pending,这是给下次 UI tick 用的快照。
      pendingProgressRef.current = { progress: p.progress, text: p.text, loaded: p.loaded, total: p.total };

      // 2) 把样本推进滑动窗口(只保留过去 3 秒)
      samplesRef.current.push({ ts: now, loaded: p.loaded });
      const cutoff = now - 3000;
      while (samplesRef.current.length > 0 && samplesRef.current[0].ts < cutoff) {
        samplesRef.current.shift();
      }

      // 3) 节流:每 1000ms 推一次 UI state,但如果是终态 (>=100% 或错误) 则立即推更新
      const isTerminal = p.progress >= 1 || p.text.startsWith('加载失败');
      if (!isTerminal && now - lastUiTsRef.current < 1000) return;
      lastUiTsRef.current = now;

      const samples = samplesRef.current;
      let bps = 0;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = (last.ts - first.ts) / 1000;
        const dl = last.loaded - first.loaded;
        if (dt > 0 && dl >= 0) bps = dl / dt;
      }

      const pending = pendingProgressRef.current ?? { progress: 0, text: '', loaded: 0, total: 0 };
      setLlmStats({ ...pending, bps });
    });

    const unsubModel = onActiveModelChange((m) => {
      setActiveModel(m);
    });

    return () => {
      window.clearInterval(pollId);
      unsubVRM();
      unsubLLM();
      unsubProgress();
      unsubModel();
    };
  }, []);

  /**
   * ponytail: iOS 软键盘弹出时把 ChatBar 浮起 — 3D 场景保持原尺寸不被挤压。
   * 视觉策略:
   * - App 根仍走 h-screen / h-[100dvh] (锁原 viewport),3D 场景不变
   * - 用 visualViewport API 算键盘高度,写到 --kb CSS 变量
   * - ChatBar bottom 公式不变（唤醒前样式不变）
   * - 键盘打开时 --kb 固定 16px（不叠加 visualViewport gap），失焦清 0
   * - cover 保留；不用 resizes-content（会挤扁 3D）
   * 同时强制 scrollTo(0,0) 抵消 iOS 自动滚到 input 的行为。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const KEYBOARD_GAP_PX = 16;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const gap = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
      const focused = document.activeElement === inputRef.current;
      if (!focused) {
        restingVvHeightRef.current = vv.height;
        document.documentElement.style.setProperty('--kb', '0px');
        document.documentElement.style.setProperty('--kb-safe', '');
        return;
      }
      // Android 上 layout 常已随键盘变矮，只需固定 16px 贴合间距；
      // 不再把 gap 写进 --kb，避免 cover 下飞中间再贴回。
      const shrunk = restingVvHeightRef.current > 0 && vv.height < restingVvHeightRef.current - 80;
      const keyboardOpen = gap > 40 || shrunk;
      const kb = keyboardOpen ? KEYBOARD_GAP_PX : 0;
      document.documentElement.style.setProperty('--kb', `${kb}px`);
      document.documentElement.style.setProperty('--kb-safe', keyboardOpen ? '0px' : '');
    };

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(apply);
      });
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.documentElement.style.removeProperty('--kb');
      document.documentElement.style.removeProperty('--kb-safe');
      document.documentElement.style.removeProperty('--kb-busy');
    };
  }, []);

  const handleInputFocus = () => {
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  };

  const llmProgress = llmStats;
  const llmBps = llmStats.bps;

  function fmtBytes(b: number): string {
    if (!b || b < 0) return '0 B';
    if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${b} B`;
  }
  function fmtSpeed(bps: number): string {
    if (!bps || bps <= 0) return '—';
    if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${bps} B/s`;
  }
  function fmtEta(secs: number): string {
    if (!secs || !isFinite(secs) || secs <= 0) return '—';
    if (secs >= 60) return `${Math.floor(secs / 60)}分${Math.round(secs % 60)}秒`;
    return `${Math.round(secs)}秒`;
  }

  // ponytail: custom provider 永远 ready(webllm engine 用不上),不显示加载状态。
  const isModelReady = isVRMReady && (isOnCustom || isLLMReady);

  // 智能排队机制：一旦模型加载完毕，若此前有排队中的输入，自动无缝触发发送，绝不丢字
  useEffect(() => {
    if (isModelReady && isQueued && queuedTextRef.current) {
      const toSend = queuedTextRef.current;
      queuedTextRef.current = '';
      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.style.height = '';
        inputRef.current.style.overflowY = 'hidden';
      }
      setHasText(false);
      setInputRows(1);
      setIsQueued(false);
      setIsSending(true);

      void vrmEngine
        .sendMessage(toSend)
        .catch((e) => console.error('[ChatBar Queue] Send failed:', e))
        .finally(() => {
          setIsSending(false);
        });
    }
  }, [isModelReady, isQueued]);

  const handleSend = async () => {
    const text = inputRef.current?.value.trim() ?? '';
    if (!text || isSending) return;

    inputRef.current?.blur();

    // 模型尚未完全就绪：智能转入排队状态，输入内容安全保留，不吞字
    if (!isModelReady) {
      setIsQueued(true);
      queuedTextRef.current = text;
      return;
    }

    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = '';
      inputRef.current.style.overflowY = 'hidden';
    }
    setHasText(false);
    setInputRows(1);
    setIsQueued(false);
    setIsSending(true);

    try {
      await vrmEngine.sendMessage(text);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSending(false);
    }
  };

  const handleSpeakText = async (which: 'spring' | 'shudao' = 'spring') => {
    if (isSending || !isVRMReady) return;
    // ponytail: dev 测试菜单 — spring 复用原 testSpeakText 键(向后兼容),
    // shudao 是新增的 ~280 字长文(李白《蜀道难》),用于压测长会话流水线
    const text = which === 'shudao'
      ? t('chat.testSpeakShudaoText')
      : t('chat.testSpeakText');
    if (!text) return;
    setIsSending(true);
    try {
      await vrmEngine.speakText(text);
    } catch (e) {
      console.error('[ChatBar SpeakText]', e);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter newline (expandable textarea)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSttToggle = () => {
    void sttRef.current?.toggle();
  };

  /** Height only grows (cap 4). Shrink back to 1 only when content is cleared. */
  const syncComposerHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    const MAX = 4;
    if (el.value.trim().length === 0) {
      el.style.height = '';
      el.style.overflowY = 'hidden';
      setInputRows((prev) => (prev === 1 ? prev : 1));
      return;
    }

    el.style.height = '0px';
    el.style.overflowY = 'hidden';
    const cs = window.getComputedStyle(el);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fs = parseFloat(cs.fontSize) || 15;
      lineHeight = fs * 1.5;
    }
    const content = el.scrollHeight;
    const measuredRows = Math.max(1, Math.min(MAX, Math.ceil(content / lineHeight - 0.01)));

    setInputRows((prev) => {
      const next = Math.max(prev, measuredRows); // unidirectional: never shrink while typing
      const nextPx = lineHeight * Math.min(MAX, next);
      el.style.height = `${nextPx}px`;
      el.style.overflowY = content > lineHeight * MAX + 0.5 ? 'auto' : 'hidden';
      return next === prev ? prev : next;
    });
  };

  const handleInput = () => {
    const val = inputRef.current?.value ?? '';
    const nowHasText = val.trim().length > 0;
    if (nowHasText !== hasText) {
      setHasText(nowHasText);
    }
    syncComposerHeight();
    if (isQueued) {
      queuedTextRef.current = val.trim();
      if (!val.trim()) setIsQueued(false);
    }
  };

  // ponytail: dev 菜单段数从实际测试文本算出来 — 不写死,
  // 改 testSpeakText / testSpeakShudaoText 后菜单里「N 段」自动跟上。
  // 跟 [t] 绑定:语言切换时 i18n 文本变化,正则重跑一次。
  const { springSegs, shudaoSegs } = useMemo(() => ({
    springSegs: splitIntoSpeechChunks(t('chat.testSpeakText')).length,
    shudaoSegs: splitIntoSpeechChunks(t('chat.testSpeakShudaoText')).length,
  }), [t]);

  const showChatBar = !isTransparent || isPetUIVisible || isMenuOpen || isInputFocused || hasText || isSending || sttState === 'listening' || sttState === 'recognizing' || sttState === 'loading';
  const visibilityClass = showChatBar
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none';

  return (
    <div
      onPointerEnter={() => holdPetUi('chatbar')}
      onPointerLeave={() => releasePetUi('chatbar')}
      className={`fixed bottom-[calc(0.75rem+var(--kb-safe,env(safe-area-inset-bottom,0px))+var(--kb,0px))] sm:bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-3 sm:px-4 select-none transition-opacity duration-300 ease-out ${visibilityClass}`}
    >
      <div id="xiaochun-chatbar" className="flex items-end gap-2 sm:gap-2.5 w-full">
        {/* Unified composer: ONE permanent textarea; single↔multi via CSS grid only (no remount). */}
        {(() => {
          // Single/multi share the same shell padding.
          const shellPad = 'px-2.5 sm:px-3 py-2.5';

          // Left slot: full hamburger menu (moved inside shell; no external round button).
          const leftEl = (
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => {
                setIsMenuOpen(open);
                if (!open) setPickingModel(false);
              }}
            >
              {/* ponytail: 不包 Tooltip — Radix 官方 anti-pattern,无论 controlled 还是
                blur 都治不干净(focus 状态变化太多)。aria-label 已经提供无障碍支持,
                触发过一次用户就知道是什么,hover tooltip 提示是冗余。 */}
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  id="chat-menu"
                  aria-label={t('chat.chatMenu')}
                  title={t('chat.chatMenu')}
                  onClick={handleMenuClickForVConsole}
                  className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center touch-manipulation active:scale-95 appearance-none outline-none border-none text-white/55 hover:text-[#f5aa9c] hover:bg-white/10 transition-colors data-[state=open]:text-[#f5aa9c] data-[state=open]:bg-white/10"
                >
                  {isQueued ? (
                    <Loader2 className="w-4 h-4 text-[#ea8377] animate-spin" />
                  ) : !isModelReady ? (
                    <Menu className="w-4 h-4 text-[#f5aa9c] animate-pulse" />
                  ) : (
                    <Menu className="w-4 h-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
              {/* ponytail: modal={false} 允许菜单打开时点击外部(input)直接聚焦,不会被 Radix
                的覆盖层拦掉。onCloseAutoFocus 阻止菜单关闭时把焦点弹回 trigger — 否则 input
                刚拿到焦点(键盘弹起、ChatBar 浮起)就会被抢回去,键盘收起、ChatBar 回到底部,
                视觉上「折叠」。两个配合才能让 input 稳定保持聚焦状态。 */}
              <DropdownMenuContent
                side="top"
                align="start"
                collisionPadding={12}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className="w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-x-hidden"
              >
                {pickingModel ? (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setPickingModel(false);
                      }}
                    >
                      <ChevronLeft className="h-4 w-4 shrink-0 text-white/50" />
                      <span className="flex-1">{t('chat.switchModel')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowProviderDialog(true)}
                      className="flex items-center gap-2"
                    >
                      <Server className="h-3.5 w-3.5 shrink-0 text-white" />
                      <span className="flex-1">{t('chat.providerMenu')}</span>
                      {/* ponytail: 自定义 provider 已激活时,这里打勾,webLLM 行不打勾。 */}
                      {activeCustom ? <span className="shrink-0 text-brand-300 text-xs">✓</span> : null}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="max-h-[min(18rem,50dvh)] overflow-x-hidden overflow-y-auto">
                      {llmGroups.map((group, i) => (
                        <Fragment key={group.provider}>
                          {i > 0 ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuLabel className="flex min-w-0 items-center gap-2 normal-case tracking-normal text-sm font-semibold text-white/70">
                            <LlmProviderIcon name={group.provider} />
                            <span className="truncate">{group.provider}</span>
                          </DropdownMenuLabel>
                          {group.models.map((m) => {
                            const selected = !activeCustom && modelBaseId(m.id) === activeBase;
                            return (
                              <DropdownMenuItem
                                key={m.id}
                                disabled={isSending}
                                onSelect={() => {
                                  if (selected) return;
                                  // ponytail: setActiveModelId 现在写统一 key 的 webllm 分支,
                                  // 自动覆盖 custom 分支。然后刷新 activeCustom React state,
                                  // 否则 UI 还显示旧 custom。
                                  setActiveModel(m.id);
                                  setActiveModelId(m.id);
                                  void refreshActiveCustom();
                                }}
                                className="min-w-0 justify-between"
                              >
                                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                                {selected ? <span className="shrink-0 text-brand-300 text-xs">✓</span> : null}
                              </DropdownMenuItem>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setPickingModel(true);
                      }}
                      className="justify-between"
                    >
                      <span>{t('chat.switchModel')}</span>
                      <span className="flex min-w-0 items-center gap-1">
                        {activeCustom ? (
                          <span className="flex min-w-0 flex-col items-end max-w-[8rem]">
                            <span className="truncate text-xs text-white/70">{activeCustom.name || activeCustom.model}</span>
                            {activeCustom.name && activeCustom.model !== activeCustom.name ? (
                              <span className="truncate text-[10px] text-white/40 font-mono">{activeCustom.model}</span>
                            ) : null}
                          </span>
                        ) : activeWebLLM ? (
                          <span className="flex min-w-0 flex-col items-end max-w-[8rem]">
                            <span className="truncate text-xs text-white/70">WebLLM</span>
                            <span className="truncate text-[10px] text-white/40 font-mono">{activeWebLLM.label}</span>
                          </span>
                        ) : (
                          <span className="max-w-[7.5rem] truncate text-xs text-white/50">{activeBase}</span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      aria-checked={thinkingOn}
                      onSelect={(e) => {
                        e.preventDefault();
                        const next = !thinkingOn;
                        setThinkingOn(next);
                        setThinkingEnabled(next);
                      }}
                      className="justify-between"
                    >
                      <span>{t('chat.thinkingMode')}</span>
                      <MenuSwitch on={thinkingOn} />
                    </DropdownMenuItem>
                    <p className="px-2.5 pb-1.5 text-[10px] leading-snug text-white/40">
                      {t('chat.thinkingHint')}
                    </p>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setShowAdvancedDialog(true)}
                      className="justify-between"
                    >
                      <span>{t('chat.advancedMenu')}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowSyncDialog(true)}
                      className="justify-between"
                    >
                      <span>{t('chat.syncMenu')}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowDeviceDialog(true)}
                      className="justify-between"
                    >
                      <span>{t('chat.deviceStatus')}</span>
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="max-w-[7.5rem] truncate text-xs text-white/50">
                          {deviceTier === 'high' ? 'High' : 'Low'}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />
                      </span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );

          const textareaEl = (
            <textarea
              ref={inputRef}
              id="xiaochun-chat-compose"
              name="xiaochun-chat-compose"
              rows={inputRows}
              inputMode="text"
              enterKeyHint="send"
              data-form-type="other"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              data-dashlane-ignore="true"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={isModelReady ? t('chat.placeholder') : t('chat.syncingPlaceholder')}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsInputFocused(true);
                handleInputFocus();
              }}
              onBlur={() => {
                setIsInputFocused(false);
                const vv = window.visualViewport;
                if (vv) {
                  restingVvHeightRef.current = vv.height;
                  document.documentElement.style.setProperty('--kb', '0px');
                  document.documentElement.style.setProperty('--kb-safe', '');
                  document.documentElement.style.setProperty('--kb-busy', '0');
                }
              }}
              className={
                composerExpanded
                  ? 'min-h-[1.5rem] w-[calc(100%-1.25rem)] justify-self-center resize-none bg-transparent border-none outline-none text-white placeholder:text-white/40 text-[15px] sm:text-sm touch-manipulation select-text leading-6 px-0 mx-2.5 mt-1 col-span-3 row-start-1'
                  : 'min-w-0 min-h-[1.5rem] resize-none overflow-hidden bg-transparent border-none outline-none text-white placeholder:text-white/40 text-[15px] sm:text-sm touch-manipulation select-text leading-6 py-0 self-center'
              }
            />
          );

          const sttErrorLabel =
            sttState === 'error' && sttErrorKind && sttErrorKind.startsWith('mic_')
              ? `${t('chat.sttMicDenied')} — ${t('chat.sttMicDeniedHint')}`
              : sttState === 'error'
              ? t('chat.sttError')
              : null;

          const micEl = (
            <button
              type="button"
              id="chatSttMic"
              aria-label={
                sttState === 'loading'
                  ? t('chat.sttLoading')
                  : sttState === 'listening'
                  ? t('chat.sttListening')
                  : sttState === 'recognizing'
                  ? t('chat.sttRecognizing')
                  : sttErrorLabel
                  ? sttErrorLabel
                  : t('chat.sttIdle')
              }
              title={
                sttState === 'loading'
                  ? t('chat.sttDownload', { percent: sttPercent })
                  : sttState === 'listening'
                  ? t('chat.sttListening')
                  : sttState === 'recognizing'
                  ? t('chat.sttRecognizing')
                  : sttErrorLabel
                  ? sttErrorLabel
                  : t('chat.sttIdle')
              }
              onClick={handleSttToggle}
              disabled={sttState === 'recognizing'}
              className={`relative shrink-0 h-9 w-9 rounded-full flex items-center justify-center touch-manipulation active:scale-95 appearance-none outline-none border-none transition-colors overflow-visible ${
                sttState === 'listening' || sttState === 'recognizing'
                  ? 'bg-transparent text-[#ea8377]'
                  : sttState === 'error'
                  ? 'bg-red-500/20 text-red-300'
                  : sttState === 'loading'
                  ? 'bg-white/10 text-white/70'
                  : 'bg-transparent text-white/50 hover:text-[#f5aa9c] hover:bg-white/10'
              }`}
            >
              {sttState === 'listening' && (
                <>
                  <span className="mic-ripple" aria-hidden />
                  <span className="mic-ripple mic-ripple--d1" aria-hidden />
                  <span className="mic-ripple mic-ripple--d2" aria-hidden />
                </>
              )}
              {sttState === 'recognizing' && (
                <>
                  <span className="mic-ripple mic-ripple--busy" aria-hidden />
                  <span className="mic-ripple mic-ripple--busy mic-ripple--busy-d1" aria-hidden />
                  <span className="mic-ripple mic-ripple--busy mic-ripple--busy-d2" aria-hidden />
                  <span className="mic-ripple mic-ripple--busy mic-ripple--busy-d3" aria-hidden />
                </>
              )}
              {sttState === 'loading' && (
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
                    strokeDasharray={`${2 * Math.PI * 14}`}
                    strokeDashoffset={`${2 * Math.PI * 14 * (1 - sttPercent / 100)}`}
                  />
                </svg>
              )}
              {sttState === 'loading' ? (
                <Loader2 className="w-4 h-4 animate-spin relative z-10" />
              ) : (
                <Mic className="w-4 h-4 relative z-10" />
              )}
            </button>
          );

          const llmPct = Math.round(Math.min(1, Math.max(0, llmProgress.progress)) * 100);
          const llmEta =
            llmBps > 0 && llmProgress.total > llmProgress.loaded
              ? (llmProgress.total - llmProgress.loaded) / llmBps
              : 0;
          const isError = !isLLMReady && llmProgress.text.startsWith('加载失败');
          const hasBytes = llmProgress.loaded > 0 && llmProgress.total > 0;
          const isDownloading = !isError && /fetch/i.test(llmProgress.text) && hasBytes;
          const stageKey = isError
            ? 'chat.waitLlm'
            : isDownloading
            ? 'chat.downloading'
            : 'chat.loadingModelProgress';
          const waitTooltip = (
            <div className="flex flex-col gap-0.5 max-w-[18rem]">
              {!isVRMReady ? <span>{t('chat.waitVrm')}</span> : null}
              {!isLLMReady ? (
                <>
                  {isError ? (
                    <>
                      <span className="text-[#f85149]">{llmProgress.text}</span>
                      <span className="text-white/40">{t('chat.hintRetry')}</span>
                    </>
                  ) : (
                    <>
                      <span>{t(stageKey, { percent: llmPct })}</span>
                      {llmProgress.total > 0 ? (
                        <span className="text-white/60 tabular-nums">
                          {fmtBytes(llmProgress.loaded)} / {fmtBytes(llmProgress.total)}
                          {' · '}{fmtSpeed(llmBps)}
                          {llmEta > 0 ? <> · 剩余 {fmtEta(llmEta)}</> : null}
                        </span>
                      ) : null}
                      <span className="text-white/50 break-all">{getActiveModelId()}</span>
                    </>
                  )}
                </>
              ) : null}
              {isQueued ? <span className="text-white/70">{t('chat.waitReadyHint')}</span> : null}
            </div>
          );

          const sendBtn = (
            <button
              id="chatSend"
              type="button"
              onClick={() => void handleSend()}
              disabled={isSending || !hasText}
              aria-label={
                isSending
                  ? t('chat.sending')
                  : isQueued
                  ? t('chat.queued')
                  : hasText && !isModelReady
                  ? t('chat.queueSend')
                  : t('chat.send')
              }
              title={
                isSending
                  ? t('chat.sending')
                  : isQueued
                  ? `${t('chat.queued')}${!isLLMReady ? ` ${llmPct}%` : ''}`
                  : hasText && !isModelReady
                  ? t('chat.queueSend')
                  : t('chat.send')
              }
              className={`relative h-9 w-9 shrink-0 rounded-full flex items-center justify-center select-none touch-manipulation active:scale-95 appearance-none outline-none border-none transition-colors ${
                isSending
                  ? 'bg-white/10 text-white/50 cursor-wait'
                  : isQueued || hasText
                  ? 'text-white bg-[#ea8377] shadow-[0_4px_14px_rgba(234,131,119,0.35)] cursor-pointer'
                  : 'text-white/40 bg-transparent cursor-not-allowed'
              }`}
            >
              <AccentFill on={!isSending && (isQueued || hasText)} />
              <span className="relative z-10 flex items-center justify-center">
                {isSending || isQueued ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : hasText && !isModelReady ? (
                  <Sparkles className="w-4 h-4 text-white animate-pulse" />
                ) : (
                  <Send className={`w-4 h-4 ${hasText ? 'text-white' : 'text-white/40'}`} />
                )}
              </span>
            </button>
          );

          const sendWrapped =
            isModelReady || (!isInputFocused && !hasText && !isQueued) ? (
              sendBtn
            ) : (
              <Tooltip delayDuration={0} open>
                <TooltipTrigger asChild>{sendBtn}</TooltipTrigger>
                <TooltipContent side="top" align="end" sideOffset={8} collisionPadding={12}>
                  {waitTooltip}
                </TooltipContent>
              </Tooltip>
            );

          const lightningEl = isDev() ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  id="chatTestSpeak"
                  type="button"
                  disabled={isSending || !isVRMReady}
                  aria-label={t('chat.testSpeak')}
                  className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center select-none touch-manipulation active:scale-95 appearance-none outline-none border-none transition-colors ${
                    isSending || !isVRMReady
                      ? 'text-white/30 cursor-not-allowed'
                      : 'text-[#f5aa9c] hover:bg-[#ea8377]/20 hover:text-[#ea8377] data-[state=open]:bg-[#ea8377]/20 data-[state=open]:text-[#ea8377]'
                  }`}
                >
                  <Zap className={`w-4 h-4 ${isSending ? '' : 'animate-pulse'}`} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                collisionPadding={12}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className="w-[min(16rem,calc(100vw-1.5rem))]"
              >
                <DropdownMenuItem
                  onSelect={() => void handleSpeakText('spring')}
                  className="flex items-center gap-2"
                >
                  <Sun className="h-3.5 w-3.5 shrink-0 text-[#f5aa9c]" />
                  <span className="flex-1">{t('chat.testSpeakSpring')}</span>
                  <span className="shrink-0 text-[10px] font-mono text-white/40">{t('chat.testSpeakSegments', { count: springSegs })}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleSpeakText('shudao')}
                  className="flex items-center gap-2"
                >
                  <Mountain className="h-3.5 w-3.5 shrink-0 text-[#f5aa9c]" />
                  <span className="flex-1">{t('chat.testSpeakShudao')}</span>
                  <span className="shrink-0 text-[10px] font-mono text-white/40">{t('chat.testSpeakSegments', { count: shudaoSegs })}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null;

          const actionsEl = (
            <div className="flex items-center gap-2 shrink-0">
              {micEl}
              {sendWrapped}
              {lightningEl}
            </div>
          );

          // Dual mode: single = one row centered; multi = text top + bottom bar. Hard cut (no FLIP/transition).
          return (
            <div
              className={`w-full grid min-h-12 rounded-[1.75rem] bg-[#13111c]/85 border backdrop-blur-2xl ${shellPad} relative overflow-visible ${
                composerExpanded
                  ? 'grid-cols-[auto_1fr_auto] grid-rows-[minmax(0,1fr)_auto] gap-y-1'
                  : 'grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-1 items-center gap-x-2'
              } ${
                isQueued
                  ? 'border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.35)]'
                  : 'border-white/15 focus-within:border-[#ea8377] focus-within:ring-2 focus-within:ring-[#ea8377]/30 focus-within:shadow-[0_0_24px_rgba(234,131,119,0.3)]'
              }`}
            >
              <div
                className={
                  composerExpanded
                    ? 'row-start-2 col-start-1 self-center'
                    : 'row-start-1 col-start-1 self-center'
                }
              >
                {leftEl}
              </div>
              {textareaEl}
              <div
                className={
                  composerExpanded
                    ? 'row-start-2 col-start-3 self-center justify-self-end'
                    : 'row-start-1 col-start-3 self-center'
                }
              >
                {actionsEl}
              </div>
            </div>
          );
        })()}
      </div>

      <DeviceStatusDialog
        open={showDeviceDialog}
        onOpenChange={setShowDeviceDialog}
        activeModelId={activeModel}
      />

      <ProviderConfigDialog
        open={showProviderDialog}
        onOpenChange={setShowProviderDialog}
      />

      <AdvancedSettingsDialog
        open={showAdvancedDialog}
        onOpenChange={setShowAdvancedDialog}
      />

      <SyncDialog
        open={showSyncDialog}
        onOpenChange={setShowSyncDialog}
      />
    </div>
  );
};
