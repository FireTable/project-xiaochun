import React from 'react';
import { Download, MoreHorizontal, Power, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri, closeWindow, reloadWindow } from '@/lib/platform';
import { isDev } from '@/lib/utils';
import { requestAppUpdateCheck } from '@/lib/appUpdater';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

interface TauriTopHeaderProps {
  onMenuOpenChange?: (open: boolean) => void;
}

/**
 * TauriTopHeader — 仅 Tauri 桌面端。检查更新 / 重载(dev) / 关闭收进三点菜单。
 */
export const TauriTopHeader: React.FC<TauriTopHeaderProps> = ({ onMenuOpenChange }) => {
  const { t } = useTranslation();

  if (!isTauri()) return null;

  return (
    <DropdownMenu onOpenChange={onMenuOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="glass"
              size="icon"
              aria-label={t('header.more')}
              className="h-11 w-11 sm:h-9 sm:w-9 text-white/85 hover:text-white hover:bg-white/15"
            >
              <MoreHorizontal className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t('header.more')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={requestAppUpdateCheck}>
          <Download className="w-3.5 h-3.5" />
          {t('header.checkUpdate')}
        </DropdownMenuItem>
        {isDev() && (
          <DropdownMenuItem onSelect={reloadWindow}>
            <RotateCw className="w-3.5 h-3.5" />
            {t('header.reloadApp')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => void closeWindow()}
          className="text-rose-300 focus:text-rose-200"
        >
          <Power className="w-3.5 h-3.5" />
          {t('header.closeApp')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
