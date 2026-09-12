import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Shirt, Check, Upload, Loader2, MountainSnow } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import type { LineworkTheme } from '@/core/scene/lineworkWorld';
import { Settings, Github } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { APP_CONFIG } from '@/config';
import { WEARING_OUTFIT_KEY, SCENE_THEME_KEY } from '@/lib/constants';
import { resolveInitialSceneTheme } from '@/lib/utils';
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
  // 当前 wearing 的 addon key (null = 裸模 base)。
  // 持久化到 localStorage (WEARING_OUTFIT_KEY),刷新后从 base 走 swapOutfit 还原 — 不需要
  // 重新走 cinematicIntro / 全 reset 路径。
  // ponytail: 启动时读 localStorage,立刻做 stale check — 旧 key(如 'v1_1' 已从 addons 删)
  // 直接 removeItem,fallback 到 base 之外还顺带清掉旧 key,下次持久化就只写新 key。
  const [wearingAddonKey, setWearingAddonKey] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    const saved = localStorage.getItem(WEARING_OUTFIT_KEY);
    if (!saved) return null;
    // 暂时先 return saved,等 addons 加载完再清理(下面 effect 跑)
    return saved;
  });
  const addons = APP_CONFIG.model.addons;
  // ponytail: 换装进行中状态 — worker compose 期间设 true,swapOutfit 收尾设 false。
  // TopHeader 不直接管理 isSwapping,而是订阅 vrmEngine.onSwapProgress 单一来源,
  // 让按钮 spinner / disabled 跟 worker 真实进度严格对齐,不靠本地 setTimeout 估时。
  const [isSwapping, setIsSwapping] = useState(false);
  useEffect(() => {
    vrmEngine.onSwapProgress = (state) => setIsSwapping(state.active);
    return () => { vrmEngine.onSwapProgress = undefined; };
  }, []);

  const [sceneTheme, setSceneTheme] = useState<LineworkTheme>(() => resolveInitialSceneTheme());

  const handleSceneThemeChange = (theme: LineworkTheme) => {
    if (sceneTheme === theme) return;
    setSceneTheme(theme);
    vrmEngine.setLineworkTheme(theme, true);
  };

  // 初次访问且用户未手动切换主题时，监听系统亮暗模式变化自动无感切换
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        // 仅当用户未显式存储主题偏好时跟随系统，不持久化至 localStorage
        if (localStorage.getItem(SCENE_THEME_KEY) === null) {
          const autoTheme: LineworkTheme = e.matches ? 'dark' : 'light';
          setSceneTheme(autoTheme);
          vrmEngine.setLineworkTheme(autoTheme, false);
        }
      } catch {}
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // ponytail: C 方案 — '__upload__' 哨兵表示"当前穿的是用户上传的 VRM"。
  // blob URL 是临时,不能持久化 (会变成 stale key),所以仅驻留内存,
  // 不写 localStorage,刷新后回到 base。
  const UPLOAD_KEY = '__upload__';
  const isWearingBase = wearingAddonKey === null;
  const isWearingUpload = wearingAddonKey === UPLOAD_KEY;

  // ponytail: 启动后第一件事 — 校验持久化的 wearingAddonKey 是否还在 addons 里。
  // 不在就清掉(下次 useEffect 写回 + UI 显示 fallback 到 base)。
  useEffect(() => {
    if (wearingAddonKey !== null && !(wearingAddonKey in addons)) {
      console.warn(`[TopHeader] stale wearingAddonKey '${wearingAddonKey}' not in current addons, clearing`);
      setWearingAddonKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 持久化 wearingAddonKey 变化 (写 debounce 不必要 — 一天切不到 100 次)
  // ponytail: '__upload__' 不持久化 — blob URL 临时,刷新后失效,持久化会变 stale key
  // 触发上面的 useEffect 清掉。base (null) 和 addon key (普通 string) 才写。
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (wearingAddonKey === null || wearingAddonKey === UPLOAD_KEY) {
      localStorage.removeItem(WEARING_OUTFIT_KEY);
    } else {
      localStorage.setItem(WEARING_OUTFIT_KEY, wearingAddonKey);
    }
  }, [wearingAddonKey]);

  useEffect(() => {
    // 延后触发模型下载与解析，优先将主线程让给 LoadingOverlay 首屏动画与交互
    const timer = setTimeout(() => {
      // ponytail: 走 swapOutfit — 冷启动也统一进 addon 协议。defaultSource 现在是 /xiaochun_base.vrmbase
      // (whole-glb zip, 9.44 MB,省 41% vs 原 v1.vrm 15.92 MB)。
      //
      // 冷启动目标 URL 优先级:
      //   1. 持久化 wearingAddonKey 命中 addons key → 该 addon (.vrmaddon)
      //   2. 持久化 key 不在 addons (老 config / 删了的 addon) → 退化到 default addon
      //   3. 没有任何 default addon → 退化到 base (.vrmbase)
      // ponytail: default addon 机制 — 普通用户冷启无偏好时直接穿上衣服,不用先点菜单。
      // 多个 addon 标 default 时取第一个(workflow check 会 [REQUEST_USER_HELP] 警告)。
      // 加载 default addon 后同步 setWearingAddonKey,菜单显示 ✓ + localStorage 持久化。
      const savedKey = wearingAddonKey;
      let addon = savedKey !== null && savedKey in addons ? addons[savedKey] : null;
      let resolvedKey = addon ? savedKey : null;
      if (!addon) {
        const defaultEntry = Object.entries(addons).find(([, a]) => a.default);
        if (defaultEntry) {
          addon = defaultEntry[1];
          resolvedKey = defaultEntry[0];
        }
      }
      const targetUrl = addon ? addon.source : APP_CONFIG.model.defaultSource;
      const targetName = addon ? addon.name : APP_CONFIG.model.defaultName;
      vrmEngine.swapOutfit(targetUrl, targetName).then(() => {
        // ponytail: 命中 default addon 时把 key 写回 state,菜单 ✓ 才亮,
        // 下次 refresh 直接走持久化路径,不再走 default 查找。
        if (resolvedKey && resolvedKey !== savedKey) setWearingAddonKey(resolvedKey);
      }).catch((e) => {
        console.error('[TopHeader] cold-start swap failed:', e);
      });
    }, 120);
    return () => clearTimeout(timer);
    // wearingAddonKey 变化时不要重启冷启动 timer — 这是单次启动逻辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      // ponytail: 走 swapOutfit — 不重置镜头 / 动作 / 视线 / 转身 / IK,
      // 跟换整套衣服保持一致的体验。blob URL 不是 .vrmaddon,会落到
      // loadVRM(url, name, { preserveMotion: true }) 路径。
      // 成功后 setWearingAddonKey('__upload__') — 上传菜单项显示 ✓,
      // 但 __upload__ 不写 localStorage (blob URL 临时)。
      vrmEngine.swapOutfit(url, file.name).then(() => {
        setWearingAddonKey(UPLOAD_KEY);
      }).catch((e) => {
        console.error('[TopHeader] upload swap failed:', e);
      });
    }
  };

  // ponytail: 当前语言从 i18n 实例读,菜单用 LANG_LABELS 展示母语名。
  const currentLang = (i18n.language || 'zh-CN') as Lang;

  // ponytail: drawer 打开时,桌面端 (sm+) 把 header 右边距从 right-5 拉到 right-[22rem]
  // 给抽屉 w-84 (21rem) 让位,留 1rem gap。移动端 drawer 占 92vw,header 没地方让,不动。
  const headerRightClass = isDrawerOpen ? 'sm:right-[22rem]' : 'sm:right-5';

  return (
    // ponytail: z-50 永远在 drawer (z-40) 之上 — drawer 打开时按钮不被 drawer 半透明背景糊掉。
    // 其它按钮(Upload / Lang / GitHub / Settings)只要位置压到 drawer 区都会被挡,
    // 统一提到 z-50 一次解决,不必为每个按钮单独处理。
    <header className={`absolute top-3 left-3 right-3 sm:top-5 sm:left-5 ${headerRightClass} z-50 flex justify-end items-center pointer-events-none transition-[right] duration-300`}>
      {/* 顶部操作区 — ponytail: TW mobile-first,移动端按钮统一 h-10(40px,iOS HIG 44 允许按钮密集布局),
          sm 起拉回默认 size 的 h-9;icon 按钮 h-11(44)→ sm:h-9(36)。
          字号 text-sm → sm:text-xs,图标 w-4 h-4 → sm:w-3.5 sm:h-3.5。 */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 max-w-full">
        <input
          type="file"
          id="vrm-file-input"
          ref={fileInputRef}
          accept=".vrm"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* 场景风格切换菜单 — 昼白/极夜黑线稿背景 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="btn-switch-scene"
              variant="glass"
              size="icon"
              aria-label={t('header.switchScene.tooltip')}
              title={t('header.switchScene.tooltip')}
              className="h-11 w-11 sm:h-9 sm:w-9"
            >
              <MountainSnow className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => handleSceneThemeChange('light')}
              className="justify-between"
            >
              <span>{t('header.switchScene.light')}</span>
              {sceneTheme === 'light' && <Check className="w-3 h-3 text-brand-300" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleSceneThemeChange('dark')}
              className="justify-between"
            >
              <span>{t('header.switchScene.dark')}</span>
              {sceneTheme === 'dark' && <Check className="w-3 h-3 text-brand-300" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ponytail: 换装菜单 — 面向普通用户,从 APP_CONFIG.model.addons 拉列表。
            触发器是 icon-only 按钮(Shirt 图标),菜单里列 N 个 addon,激活态打 ✓。
            isSwapping 期间按钮 disabled + Loader2 旋转,防用户连点重复请求。 */}
        {Object.keys(addons).length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="btn-switch-outfit"
                variant="glass"
                size="icon"
                aria-label={t('header.switchOutfit.tooltip')}
                title={t('header.switchOutfit.tooltip')}
                disabled={isSwapping}
                className="h-11 w-11 sm:h-9 sm:w-9 disabled:opacity-70"
              >
                {isSwapping
                  ? <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin" />
                  : <Shirt className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* ponytail: base(裸模) 选项只在 devDrawer 打开时出现 —
                  普通用户有 default addon 兜底,不需要这个切换入口。
                  devDrawer 打开时 (按 ⚙️ 或 10 次连击解锁) 能切到裸模,方便排查
                  addon 异常 / 对比 base vs addon 渲染差异。 */}
              {isDrawerOpen && (
                <DropdownMenuItem
                  onSelect={() => {
                    // ponytail: Issue 1 — 已在穿 base 时重复点 → short-circuit,不再调 swapOutfit
                    // (避免 worker 再跑一遍 fetch + unzip + bspatch + pack)。
                    if (isWearingBase) return;
                    void vrmEngine.swapOutfit(APP_CONFIG.model.defaultSource, APP_CONFIG.model.defaultName)
                      .then(() => setWearingAddonKey(null))
                      .catch((e) => console.error('[TopHeader] load base failed:', e));
                  }}
                  className="justify-between"
                >
                  <span>{APP_CONFIG.model.defaultName}</span>
                  {isWearingBase && <Check className="w-3 h-3 text-brand-300" />}
                </DropdownMenuItem>
              )}
              {Object.entries(addons).map(([key, addon]) => (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => {
                    // ponytail: Issue 1 — 已在穿这个 addon → short-circuit。
                    if (wearingAddonKey === key) return;
                    void vrmEngine.swapOutfit(addon.source, addon.name)
                      .then(() => setWearingAddonKey(key))
                      .catch((e) => console.error('[TopHeader] outfit swap failed:', e));
                  }}
                  className="justify-between"
                >
                  <span>{addon.name}</span>
                  {wearingAddonKey === key && <Check className="w-3 h-3 text-brand-300" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {/* ponytail: 上传 VRM 也并入同一菜单 — 触发隐藏的 file input。
                  独立项(独立图标)带分隔线,跟换装 addons 视觉区分。
                  isWearingUpload 时显示 ✓(C 方案哨兵状态:用户已上传,正在穿自定义模型)。 */}
              <DropdownMenuItem
                onSelect={(e) => {
                  // ponytail: Radix DropdownMenu 默认会关闭菜单 + focus trigger,
                  // 这里关掉默认行为让 file dialog 干净打开。
                  e.preventDefault();
                  fileInputRef.current?.click();
                }}
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <Upload className="w-3.5 h-3.5 text-brand-300" />
                  {t('header.uploadVrm')}
                </span>
                {isWearingUpload && <Check className="w-3 h-3 text-brand-300" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Tooltip>
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
        </Tooltip>

        <Tooltip>
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
        </Tooltip>

        {isDev ? (
          <Tooltip>
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
                <Settings className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isDrawerOpen ? 'text-slate-900' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('header.settingsPanel')}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
};
