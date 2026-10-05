/**
 * EmbedPicker — /embed 内置的顶栏按钮 (?ui=outfit,scene,lang,github, 默认关): 换装 / 换场景 / 语言 / GitHub。
 *
 * 复用主站 TopHeader 的同一套零件, 外观/文案/交互保持一致, 只是去掉了和 embed 无关的东西 (设置/上传 VRM/裸模)。
 * 语言与 GitHub 按钮直接用 components/HeaderButtons (TopHeader 也用同一份):
 *   - 语言: 选中后 i18n 立即切换, 存进 iframe 自己的 localStorage (EMBED_LANG_KEY), 向宿主发 xc.lang-changed; 不写主站的 cookie;
 *   - GitHub: 新标签页打开 APP_CONFIG.brand.github (target=_blank rel=noopener noreferrer)。
 * 显示时机 (uiAutoHide, 默认 'transparent' = 与 Tauri 一致): 生效时顶栏默认隐藏, 单击角色出现、再点角色 / 点空白 / 10 秒无操作收起
 *   (共用 hooks/usePetUiVisibility.ts 与 core/ui/clickDetector.ts; 悬停在按钮上 / 菜单打开 / 换装中不收); 隐藏时 visibility:hidden, 不挡点击也不算穿透命中。
 *   - 组件:   Button variant="glass" 圆形 icon 按钮 (移动端 h-11 w-11, sm 起 h-9 w-9, 与 TopHeader 同尺寸类)、DropdownMenu*、
 *             图标 MountainSnow (场景) / Shirt (换装) / Check / Loader2 (换装中旋转)
 *   - 文案:   header.switchScene.tooltip / header.switchOutfit.tooltip / scene.nameKey (昼白线稿·极夜黑线稿·透明背景), i18n 三语
 *   - 数据:   服装列表 = listOutfits(APP_CONFIG.model.addons) (与 xc.ready capabilities.outfits 同一个函数: 不含裸模、不含自定义 URL);
 *             场景列表 = APP_CONFIG.scenes.items (与 capabilities.scenes 同源)
 *   - 交互:   点选 → 当前项 ✓; 已穿着的再点什么都不发生 (TopHeader 的 short-circuit)
 * 与 TopHeader 的差异 (有意):
 *   - 点选走 bridge.pickOutfit / pickScene (和 xc.setOutfit / xc.setScene 同一白名单 / 串行队列 / last-wins), 并向宿主发 xc.outfit-changed / xc.scene-changed;
 *     宿主用 SDK 换装时按钮状态通过同一份状态仓 (getEmbedPickerState / sceneManager) 同步;
 *   - 按钮本身不碰 localStorage; 偏好由 bridge 的 pickOutfit / pickScene 写回 iframe 自己的存储 (见 docs/EMBED.md);
 *   - 换装中按钮不 disabled (TopHeader 会 disabled): 连点是允许的, 规则是 last-wins, 超出的用轻提示说明;
 *   - 透明场景下 TopHeader 默认隐藏 (点角色才出现); 这里宿主显式开了就一直显示, 并参与穿透命中 (data-xc-ui / role=menu, 见 bridge.ts)。
 * 位置: 右上角, 不盖住居中的角色; 窄屏只有两个 36~44px 的圆钮。
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Shirt, Check, Loader2, MountainSnow } from 'lucide-react';
import { GithubButton, LangButton } from '@/components/HeaderButtons';
import { holdPetUi, releasePetUi } from '@/hooks/usePetUiVisibility';
import type { Lang } from '@/i18n';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { APP_CONFIG } from '@/config';
import { getEmbedPickerState, notifyEmbedMenuOpen, subscribeEmbedPicker, type EmbedBridge } from './bridge';
import { listOutfits } from './registry';

export interface PickerFlags { outfit: boolean; scene: boolean; lang: boolean; github: boolean }

const NOTICE_MS = 2200;

interface Props {
  flags: PickerFlags;
  bridge: Pick<EmbedBridge, 'pickOutfit' | 'pickScene' | 'pickLang'>;
  /** uiAutoHide 在当前场景是否生效 (生效 = 默认隐藏, 点击出现)。 */
  autoHide?: boolean;
  /** usePetUiVisibility 的 isPetUIVisible (单击角色后为 true, 10 秒无操作自动收起)。 */
  petUiVisible?: boolean;
}

export const EmbedPicker: React.FC<Props> = ({ flags, bridge, autoHide = false, petUiVisible = false }) => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
  const [openMenus, setOpenMenus] = useState(0);
  const state = useSyncExternalStore(subscribeEmbedPicker, getEmbedPickerState, getEmbedPickerState);
  const currentScene = useCurrentScene();
  const outfits = useMemo(
    () => listOutfits(APP_CONFIG.model.addons as Record<string, { source: string; name: string }>),
    [],
  );
  const scenes = Object.values(APP_CONFIG.scenes.items);
  const loading = state.loading !== null;

  // 轻提示: notice.n 变化就弹 NOTICE_MS
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef(0);
  useEffect(() => {
    const n = state.notice;
    if (!n || n.n === seen.current) return;
    seen.current = n.n;
    setToast(n.kind === 'busy' ? t('embedPicker.busy') : t('embedPicker.failed'));
    const timer = setTimeout(() => setToast(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice, t]);

  // 菜单开合 → 通知 bridge (打开期间整个 iframe 视为命中, 关闭后重新判定)
  const menuOpen = (open: boolean) => { setOpenMenus((c) => Math.max(0, c + (open ? 1 : -1))); notifyEmbedMenuOpen(open); };

  const btn = 'h-11 w-11 sm:h-9 sm:w-9';
  const ico = 'w-4 h-4 sm:w-3.5 sm:h-3.5';
  // 与 TopHeader 的 showHeader 同一规则: 不自动隐藏 / 被点出来了 / 菜单开着 / 换装中 → 显示
  const shown = !autoHide || petUiVisible || openMenus > 0 || loading;
  const visibility = shown ? 'opacity-100 visible' : 'opacity-0 invisible';

  return (
    // 容器不吃指针 (pointer-events-none), 只有按钮自己 / 菜单是实心的 → 透明场景下按钮之间的空隙仍然穿透。
    // pointerdown 不冒泡: 点按钮不会触发 interactionController 的转身 / 拖动 (它只监听 canvas, 这里是双保险)。
    <div
      className={`pointer-events-none absolute top-3 right-3 sm:top-4 sm:right-4 z-50 flex flex-col items-end gap-2 transition-[opacity,visibility] duration-300 ease-out ${visibility}`}
      data-xc-header=""
      data-xc-visible={shown ? '1' : '0'}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={() => holdPetUi('header')}
      onPointerLeave={() => releasePetUi('header')}
    >
      <div className="flex items-center gap-2 sm:gap-2.5">
        {flags.scene && (
          <DropdownMenu onOpenChange={menuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                id="xc-btn-switch-scene"
                data-xc-ui
                variant="glass"
                size="icon"
                aria-label={t('header.switchScene.tooltip')}
                title={t('header.switchScene.tooltip')}
                className={`pointer-events-auto ${btn}`}
              >
                <MountainSnow className={ico} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {scenes.map((scene) => (
                <DropdownMenuItem
                  key={scene.id}
                  data-scene-id={scene.id}
                  onSelect={() => {
                    if (currentScene.id === scene.id) return;
                    void bridge.pickScene(scene.id);
                  }}
                  className="justify-between"
                >
                  <span>{t(scene.nameKey)}</span>
                  {currentScene.id === scene.id && <Check className="w-3 h-3 text-brand-300" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {flags.outfit && outfits.length > 0 && (
          <DropdownMenu onOpenChange={menuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                id="xc-btn-switch-outfit"
                data-xc-ui
                data-loading={loading ? '1' : undefined}
                variant="glass"
                size="icon"
                aria-label={t('header.switchOutfit.tooltip')}
                aria-busy={loading}
                title={loading ? t('embedPicker.loading') : t('header.switchOutfit.tooltip')}
                className={`pointer-events-auto ${btn}`}
              >
                {loading ? <Loader2 className={`${ico} animate-spin`} /> : <Shirt className={ico} />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {outfits.map((o) => {
                const wearing = state.outfit === o.id;
                const isLoading = state.loading === o.id;
                return (
                  <DropdownMenuItem
                    key={o.id}
                    data-outfit-id={o.id}
                    onSelect={() => {
                      if (wearing && !loading) return;
                      void bridge.pickOutfit(o.id);
                    }}
                    className="justify-between gap-3"
                  >
                    <span>{o.name}</span>
                    <span className="flex items-center gap-1.5">
                      {isLoading
                        ? <Loader2 className="w-3 h-3 text-brand-300 animate-spin" />
                        : wearing && <Check className="w-3 h-3 text-brand-300" />}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {flags.lang && (
          <LangButton
            id="xc-btn-switch-lang"
            xcUi
            className="pointer-events-auto"
            currentLang={currentLang}
            onSelect={(lng) => bridge.pickLang(lng)}
            onOpenChange={menuOpen}
          />
        )}

        {flags.github && <GithubButton id="xc-btn-github" xcUi className="pointer-events-auto" />}
      </div>

      {toast && (
        <div
          role="status"
          data-xc-ui
          className="pointer-events-auto max-w-[14rem] rounded-2xl border border-white/20 bg-slate-950/80 px-3 py-1.5 text-[11px] leading-snug text-white/90 backdrop-blur-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
};
