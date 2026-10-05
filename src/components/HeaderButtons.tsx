/**
 * HeaderButtons — 顶栏里 "语言切换" 与 "GitHub" 两个按钮的共用实现。
 * 主站 / Tauri 的 TopHeader 和 /embed 的 EmbedPicker (?ui=lang,github) 都用这里, 外观 / 文案 / 菜单项完全一致;
 * 差异只通过 props 注入 (id、data-xc-ui、选中语言后做什么、菜单开合回调)。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Github } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { APP_CONFIG } from '@/config';
import { LANG_LABELS, SUPPORTED_LANGS, type Lang } from '@/i18n';
import { isTauri } from '@/lib/platform';
import { openExternal } from '@/lib/openExternal';

const BTN = 'h-11 w-11 sm:h-9 sm:w-9';
const ICO = 'w-4 h-4 sm:w-3.5 sm:h-3.5';

interface LangButtonProps {
  id?: string;
  /** /embed: 标记成"内置 UI", 透明场景下参与穿透命中。 */
  xcUi?: boolean;
  currentLang: Lang;
  onSelect: (lang: Lang) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** 语言切换按钮 + 菜单 (中文 / English / 日本語, 当前项 ✓)。 */
export const LangButton: React.FC<LangButtonProps> = ({ id = 'btn-switch-lang', xcUi, currentLang, onSelect, onOpenChange, className = '' }) => {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenu onOpenChange={onOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              id={id}
              {...(xcUi ? { 'data-xc-ui': '' } : {})}
              variant="glass"
              size="icon"
              title={t('header.switchLang.tooltip')}
              aria-label={t('header.switchLang.tooltip')}
              className={`${BTN} ${className}`}
            >
              <Globe className={ICO} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SUPPORTED_LANGS.map((lng) => (
              <DropdownMenuItem
                key={lng}
                data-lang={lng}
                onSelect={() => onSelect(lng)}
                className="justify-between"
              >
                <span>{LANG_LABELS[lng]}</span>
                {currentLang === lng && <span className="text-brand-300 text-xs">✓</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipTrigger>
      {/* ponytail: tooltip 只挂在 icon-only 按钮上 */}
      <TooltipContent side="bottom">
        {t('header.switchLang.tooltip')}
      </TooltipContent>
    </Tooltip>
  );
};

interface GithubButtonProps {
  id?: string;
  xcUi?: boolean;
  className?: string;
}

/** GitHub 链接按钮: 新标签页打开项目仓库 (Tauri 里走系统浏览器, WebView 的 target=_blank 是 no-op)。 */
export const GithubButton: React.FC<GithubButtonProps> = ({ id = 'btn-github', xcUi, className = '' }) => {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="glass" size="icon" className={`${BTN} ${className}`}>
          <a
            id={id}
            {...(xcUi ? { 'data-xc-ui': '' } : {})}
            href={APP_CONFIG.brand.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('header.github')}
            onClick={(e) => {
              if (!isTauri()) return;
              e.preventDefault();
              void openExternal(APP_CONFIG.brand.github);
            }}
          >
            <Github className={ICO} />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t('header.github')}
      </TooltipContent>
    </Tooltip>
  );
};
