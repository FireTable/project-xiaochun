import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { Upload, Settings, Github } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  TooltipTrigger,
  TooltipContent,
  TouchAwareTooltip,
} from '@/components/ui/tooltip';
import { APP_CONFIG } from '@/config';
import { changeLang, LANG_LABELS, SUPPORTED_LANGS, type Lang } from '@/i18n';

interface TopHeaderProps {
  isDev: boolean;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  isDev,
  isDrawerOpen,
  onToggleDrawer,
}) => {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    vrmEngine.loadVRM(APP_CONFIG.model.defaultVrm, APP_CONFIG.model.defaultName);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      vrmEngine.loadVRM(url, file.name);
    }
  };

  // ponytail: 当前语言从 i18n 实例读,菜单用 LANG_LABELS 展示母语名。
  const currentLang = (i18n.language || 'zh-CN') as Lang;

  return (
    <header className="absolute top-3 left-3 right-3 sm:top-5 sm:left-5 sm:right-5 flex justify-end items-center z-10 pointer-events-none">
      {/* 顶部操作区 — ponytail: TW mobile-first,移动端按钮统一 h-10(40px,iOS HIG 44 允许按钮密集布局),
          sm 起拉回默认 size 的 h-9;icon 按钮 h-11(44)→ sm:h-9(36)。
          字号 text-sm → sm:text-xs,图标 w-4 h-4 → sm:w-3.5 sm:h-3.5。 */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 max-w-full">
        <Button
          id="btn-upload-vrm"
          type="button"
          variant="glass"
          size="default"
          onClick={() => fileInputRef.current?.click()}
          className="h-10 sm:h-9 px-4 text-sm sm:text-xs"
        >
          <Upload className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-brand-300" />
          <span>{t('header.uploadVrm')}</span>
        </Button>
        <input
          type="file"
          id="vrm-file-input"
          ref={fileInputRef}
          accept=".vrm"
          className="hidden"
          onChange={handleFileUpload}
        />

        <TouchAwareTooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id="btn-switch-lang"
                  variant="glass"
                  size="icon"
                  title={t('header.switchLang.tooltip')}
                  aria-label={t('header.switchLang.tooltip')}
                  className="h-11 w-11 sm:h-9 sm:w-9"
                >
                  <Globe className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SUPPORTED_LANGS.map((lng) => (
                  <DropdownMenuItem
                    key={lng}
                    onSelect={() => changeLang(i18n, lng)}
                    className="justify-between"
                  >
                    <span>{LANG_LABELS[lng]}</span>
                    {currentLang === lng && <span className="text-brand-300 text-xs">✓</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          {/* ponytail: tooltip 只挂在 icon-only 按钮上;"上传 VRM" 已有可见文字标签,不重复。 */}
          <TooltipContent side="bottom">
            {t('header.switchLang.tooltip')}
          </TooltipContent>
        </TouchAwareTooltip>

        <TouchAwareTooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="glass"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
            >
              <a
                id="btn-github"
                href={APP_CONFIG.brand.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('header.github')}
              >
                <Github className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('header.github')}
          </TooltipContent>
        </TouchAwareTooltip>

        {isDev ? (
          <TouchAwareTooltip>
            <TooltipTrigger asChild>
              <Button
                id="btn-toggle-panel"
                variant="glass"
                size="icon"
                title={t('header.settingsPanel')}
                aria-label={t('header.settingsPanel')}
                onClick={onToggleDrawer}
                className={`h-11 w-11 sm:h-9 sm:w-9 ${isDrawerOpen ? 'bg-brand-500/25 border-brand-300 text-brand-100 rotate-90 shadow-lg shadow-brand-500/25' : ''}`}
              >
                <Settings className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('header.settingsPanel')}
            </TooltipContent>
          </TouchAwareTooltip>
        ) : null}
      </div>
    </header>
  );
};
