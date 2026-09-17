import React from 'react';
import { Power, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri, closeWindow, reloadWindow } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

/**
 * TauriTopHeader — 仅 Tauri 桌面端出现的按钮组, 嵌在 TopHeader 末尾。
 *
 * 现在有 2 颗:
 * - RotateCw (dev only, import.meta.env.DEV) — 重新加载窗口, 调试改代码用
 * - Power — 关闭窗口
 *
 * ponytail: 早期有完整右键毛玻璃菜单 (TauriWindowFrame), 功能没打算藏,
 * 菜单鸡肋。Power / 刷新按钮直接挂 TopHeader 末尾, 不绕菜单。Refresh 仅 dev
 * 模式出现, 生产构建 import.meta.env.DEV=false 自然消除。
 */
export const TauriTopHeader: React.FC = () => {
  const { t } = useTranslation();

  if (!isTauri()) return null;

  const isDev = import.meta.env.DEV;

  return (
    <>
      {isDev && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="glass"
              size="icon"
              aria-label={t('header.reloadApp')}
              onClick={reloadWindow}
              className="h-11 w-11 sm:h-9 sm:w-9 text-white/85 hover:text-white hover:bg-white/15"
            >
              <RotateCw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('header.reloadApp')}
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="glass"
            size="icon"
            aria-label={t('header.closeApp')}
            onClick={closeWindow}
            className="h-11 w-11 sm:h-9 sm:w-9 text-rose-300 hover:text-rose-200 hover:bg-rose-500/15"
          >
            <Power className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t('header.closeApp')}
        </TooltipContent>
      </Tooltip>
    </>
  );
};