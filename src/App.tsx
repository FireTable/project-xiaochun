import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadingState, BubbleState } from '@/core/vrmEngine';
import { TopHeader } from '@/components/TopHeader';
import { HeadBubble } from '@/components/HeadBubble';
import { ChatBar } from '@/components/ChatBar';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { DevDrawer } from '@/components/DevDrawer';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import type { Lang } from '@/i18n';

const SceneCanvas = React.lazy(() =>
  import('@/components/SceneCanvas').then((m) => ({ default: m.SceneCanvas }))
);

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState<LoadingState>({
    active: true,
    subtitleKey: 'parsingModel',
    progress: 0,
  });

  const [bubble, setBubble] = useState<BubbleState>({
    visible: false,
    statusKey: '',
    speechText: '',
    isError: false,
    x: 0,
    y: 0,
  });

  const isDev = import.meta.env.DEV || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    let engineModule: typeof import('@/core/vrmEngine') | null = null;

    import('@/core/vrmEngine').then((mod) => {
      engineModule = mod;
      mod.vrmEngine.onLoadingChange = (state) => setLoading(state);
      mod.vrmEngine.onBubbleChange = (state) => setBubble(state);
      // ponytail: 引擎内部 alert() / LLM 空输出兜底等走 t(),bindI18n 顺带同步给 chatDirector。
      mod.vrmEngine.bindI18n((key, vars) => i18n.t(key, vars));
      // ponytail: system prompt 按当前 i18n 语言挑;getter 里读 i18n.language 是反应式的,
      // 用户切换语言后下次 send 自动用新语言回答。
      mod.vrmEngine.bindSystemPrompt(() => {
        const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
        return XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
      });
    });

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.toLowerCase().endsWith('.vrm')) {
        const url = URL.createObjectURL(file);
        engineModule?.vrmEngine.loadVRM(url, file.name);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      engineModule?.vrmEngine.dispose();
    };
  }, [i18n]);

  return (
    <div id="app" className="relative w-screen h-screen overflow-hidden bg-[#0b0f19]">
      {/* 3D Canvas (按需异步挂载，不阻塞首屏骨架) */}
      <React.Suspense fallback={<canvas id="vrm-canvas" className="absolute inset-0 w-full h-full block z-0" />}>
        <SceneCanvas />
      </React.Suspense>

      {/* 3D 角色头顶悬浮对话框 */}
      <HeadBubble state={bubble} />

      {/* 底部对话输入条 */}
      <ChatBar />

      {/* 模型加载进度遮罩 */}
      <LoadingOverlay state={loading} />

      {/* 顶部控制栏 */}
      <TopHeader
        isDev={isDev}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen((prev) => !prev)}
      />

      {/* 设置 / 调试抽屉 */}
      <DevDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />

      {/* 拖拽上传提示层 */}
      {isDragOver && (
        <div id="drop-zone" className="drop-zone">
          <div className="drop-card">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>{t('app.dropZoneHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
};
