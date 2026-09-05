import React, { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Menu, Server } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
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
import { readActiveKey, subscribeActiveKey } from '@/llm/activeKey';
import { Send, Sparkles, Loader2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
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

export const ChatBar: React.FC = () => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
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

  // ponytail: active key 走 state — sync import 写入 sessionStorage 后会通过 subscribeActiveKey
  // 推过来,直接 readActiveKey() 是非反应式,UI 不会跟新。
  const [activeKey, setActiveKey] = useState(() => readActiveKey());
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
  // active key 变化同时覆盖 webllm 模型切换(setActiveModelId 也走 writeActiveKey)。
  useEffect(() => {
    const unsubKey = subscribeActiveKey((k) => {
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
      if (isWebLLMReady()) setIsLLMReady(true);
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
   * - ChatBar 的 bottom 用 calc(env(safe-area-inset-bottom) + var(--kb,0px)),键盘顶多高它就浮多高
   * - 键盘消失时 --kb 复位为 0,ChatBar 回到底部
   * 同时强制 scrollTo(0,0) 抵消 iOS 自动滚到 input 的行为。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // ponytail: keyboard height = 全屏高度(layout viewport) - 可见视口高度(visual viewport)。
      // layout viewport 一般就是 window.innerHeight,visible viewport 是 vv.height。
      // 二者差值即键盘占的空间,实时同步到 --kb。
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--kb', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
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
      if (inputRef.current) inputRef.current.value = '';
      setHasText(false);
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

    if (inputRef.current) inputRef.current.value = '';
    setHasText(false);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleInput = () => {
    const val = inputRef.current?.value ?? '';
    const nowHasText = val.trim().length > 0;
    if (nowHasText !== hasText) {
      setHasText(nowHasText);
    }
    if (isQueued) {
      queuedTextRef.current = val.trim();
      if (!val.trim()) setIsQueued(false);
    }
  };

  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px)+var(--kb,0px))] sm:bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-3 sm:px-4 pointer-events-auto select-none">
      <div className="flex items-center gap-2 sm:gap-2.5 w-full">
        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            if (!open) setPickingModel(false);
          }}
        >
          {/* ponytail: 不包 Tooltip — Radix 官方 anti-pattern,无论 controlled 还是
            blur 都治不干净(focus 状态变化太多)。aria-label 已经提供无障碍支持,
            触发过一次用户就知道是什么,hover tooltip 提示是冗余。 */}
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              id="chat-menu"
              variant="glass"
              size="icon"
              aria-label={t('chat.chatMenu')}
              className="h-11 w-11 shrink-0"
              onClick={handleMenuClickForVConsole}
            >
              <Menu className="w-4 h-4" />
            </Button>
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

        {/* 输入框主胶囊：高度严格 h-11 (44px)，非阻塞可随时聚焦输入，排队时呼吸高亮。
            ponytail: 用 <form autoComplete="off"> 包住 chat input,显式声明这个 form 不是
            登录表单 — Chrome / Safari 的密码管理器会基于 form 上下文判断要不要弹 autofill,
            这样 ProviderConfigDialog 里的 type="password" 保存的 credential 就不会回流到
            chat input 上。 */}
        <form
          autoComplete="off"
          onSubmit={(e) => e.preventDefault()}
          className={`flex-1 flex items-center h-11 sm:h-11 rounded-full bg-[#13111c]/85 border shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-2xl px-3.5 sm:px-4 transition-all duration-300 relative ${
            isQueued
              ? 'border-[#ea8377] ring-2 ring-[#ea8377]/40 shadow-[0_0_24px_rgba(234,131,119,0.35)]'
              : 'border-white/15 focus-within:border-[#ea8377] focus-within:ring-2 focus-within:ring-[#ea8377]/30 focus-within:shadow-[0_0_24px_rgba(234,131,119,0.3)]'
          }`}
        >
          {/* ponytail: Chrome 内置密码管理器看到 URL 命中 saved credential 就会弹 autofill,
              autoComplete="off" / data-form-type / 1p-ignore 都不管用。decoy pattern — 在
              chat input 前面塞两个视觉隐藏的 username + current-password,Chrome 会把
              autofill 目标锁定到这两个 decoy,真正可见的 chat input 被绕过。tabIndex=-1 +
              aria-hidden + pointer-events-none 保证它们不进 tab 顺序、不影响布局、不被无
              障碍树读出来。absolute 定位脱离 flex 流,不影响 chat input 的对齐。 */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute left-[-9999px] top-0 w-px h-px opacity-0 pointer-events-none"
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute left-[-9999px] top-0 w-px h-px opacity-0 pointer-events-none"
          />
          {/* 左侧状态感知指示器 */}
          {isQueued ? (
            <Loader2 className="w-4 h-4 text-[#ea8377] animate-spin shrink-0 mr-2 sm:mr-2.5" />
          ) : !isModelReady ? (
            <div className="flex items-center gap-1 shrink-0 mr-2 sm:mr-2.5">
              <Sparkles className="w-4 h-4 text-[#f5aa9c] animate-pulse shrink-0 opacity-90" />
              <span className="hidden sm:inline-block text-[9px] font-mono font-bold text-[#f5aa9c] bg-[#ea8377]/15 border border-[#ea8377]/30 px-1 py-0.2 rounded uppercase">
                SYNC
              </span>
            </div>
          ) : (
            <Sparkles className="w-4 h-4 text-[#ea8377] shrink-0 mr-2 sm:mr-2.5 opacity-90 animate-pulse" />
          )}

          <input
            ref={inputRef}
            type="text"
            id="chatText"
            // ponytail: name 故意取 chatMessage — Chrome password manager heuristic
            // 会扫 username / email / password 关键词,不在白名单里就不会把 chat input
            // 当成 username 字段触发 autofill。
            name="chatMessage"
            inputMode="text"
            // ponytail: 通用的 password manager 忽略标记 — 1Password / LastPass / Dashlane /
            // Bitwarden 等见到这些属性就跳过本字段。Chrome 内置密码管理不一定遵守,
            // 但配合外层 <form autoComplete="off"> 通常就够。
            data-form-type="other"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
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
            onBlur={() => setIsInputFocused(false)}
            // ponytail: 回复中也允许输入 — 用户可以预先打下一句,点 send 时
            // handleSend 内部用 isSending 拦截,不重复发。按钮单独 disable。
            className="w-full h-full bg-transparent border-none outline-none text-white placeholder:text-white/40 text-sm sm:text-sm touch-manipulation select-text"
          />
        </form>

        {/* 发送按钮：高度严格 h-11 (44px)，状态随就绪度与排队状态联动 */}
        {(() => {
          const llmPct = Math.round(Math.min(1, Math.max(0, llmProgress.progress)) * 100);
          const llmEta = (llmBps > 0 && llmProgress.total > llmProgress.loaded)
            ? (llmProgress.total - llmProgress.loaded) / llmBps
            : 0;
          // ponytail: 加载失败时 llmProgress.text = "加载失败: ..."(progressCallback 不标 100% 后,
          // 出错路径里我们手动 notifyLoadProgress(0, '加载失败: ...', ...)),UI 切到错误态。
          const isError = !isLLMReady && llmProgress.text.startsWith('加载失败');
          // ponytail: webLLM cached hit 也会 emit 一次含 'fetch' 的 progress 但 loaded/total=0,
          // 直接走"下载 0%"再跳"加载 0%"很突兀。加 loaded/total>0 守卫后,
          // 缓存命中或瞬时跳过 fetch 阶段都会直接进入"加载模型"。
          const hasBytes = llmProgress.loaded > 0 && llmProgress.total > 0;
          const isDownloading = !isError && /fetch/i.test(llmProgress.text) && hasBytes;
          const stageKey = isError ? 'chat.waitLlm' : (isDownloading ? 'chat.downloading' : 'chat.loadingModelProgress');
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
              className={`relative h-11 sm:h-11 px-4 sm:px-5 rounded-full font-medium text-sm flex items-center justify-center gap-1.5 shrink-0 select-none touch-manipulation active:scale-95 appearance-none outline-none border-none ${
                isSending
                  ? 'bg-[#13111c]/85 text-white/50 cursor-wait'
                  : isQueued || hasText
                  ? 'text-white bg-[#ea8377] shadow-[0_4px_16px_rgba(234,131,119,0.35)] cursor-pointer'
                  : 'text-white/40 bg-[#13111c]/85 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] cursor-not-allowed'
              }`}
            >
              <AccentFill on={!isSending && (isQueued || hasText)} />
              <span className="relative z-10 flex items-center gap-1.5">
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{t('chat.sending')}</span>
                  </>
                ) : isQueued ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{t('chat.queued')}{!isLLMReady ? ` ${llmPct}%` : ''}</span>
                  </>
                ) : hasText && !isModelReady ? (
                  <>
                    <Sparkles className="w-4 h-4 text-white animate-pulse" />
                    <span>{t('chat.queueSend')}</span>
                  </>
                ) : (
                  <>
                    <Send className={`w-4 h-4 ${hasText ? 'text-white' : 'text-white/40'}`} />
                    <span>{t('chat.send')}</span>
                  </>
                )}
              </span>
            </button>
          );
          // ponytail: tooltip 按需显示 —— 只在用户跟输入框交互时才出现:
          //   1. 输入框被聚焦(isInputFocused)
          //   2. 输入框有内容(hasText)
          //   3. 用户排了队等模型就绪(isQueued)
          // 不再"模型没好就一直显示",那个太抢戏了。
          if (isModelReady) return sendBtn;
          if (!isInputFocused && !hasText && !isQueued) return sendBtn;
          const forceOpen = true;
          return (
            <Tooltip delayDuration={0} open={forceOpen}>
              <TooltipTrigger asChild>{sendBtn}</TooltipTrigger>
              <TooltipContent
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                {waitTooltip}
              </TooltipContent>
            </Tooltip>
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
