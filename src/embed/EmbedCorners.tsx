/**
 * EmbedCorners — /embed 里宿主开了 resizable 时的四角圆弧提示 (外观与 Tauri 桌宠窗口的角把手完全同一套: components/CornerHandle)。
 * 只负责"画": 命中 / 按下 / 缩放都在 gestures.ts 里按 core/gesture/corners.ts 的 40px 热区判断, 弧线本身 pointer-events:none, 不挡任何点击。
 * 显示时机: 指针悬停在某个角热区 / 正在拖角 / 刚被宿主打开、鼠标进入 iframe、触屏按下时短暂亮一下 (Tauri 唤出 UI 时 corner-flash 同款; 触屏没有 hover)。
 * 对比度: CornerHandle 自带柔和深色阴影 (Tauri / embed 同一套, 不分场景), 弧线内收 4px 与 20px 圆角同心, 阴影不会被这里的 overflow-hidden 裁掉。
 */
import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CORNERS, CornerHandle } from '@/components/CornerHandle';
import { getEmbedCornerUi, subscribeEmbedCornerUi } from './gestures';

const noop = () => {};

export const EmbedCorners: React.FC = () => {
  const { t } = useTranslation();
  const ui = useSyncExternalStore(subscribeEmbedCornerUi, getEmbedCornerUi, getEmbedCornerUi);
  if (!ui.enabled) return null;
  const visible = ui.flash || ui.hover !== null || ui.active !== null;
  return (
    <div className="fixed inset-0 pointer-events-none z-[9990] overflow-hidden select-none" aria-hidden="true" data-xc-corners="">
      {CORNERS.map((corner) => (
        <CornerHandle
          key={corner}
          corner={corner}
          isVisible={visible}
          isHovered={ui.hover === corner || ui.active === corner}
          pointerEnabled={false}
          resizeTitle={t('header.resizeWindow')}
          onMouseEnter={noop}
          onMouseLeave={noop}
          onMouseDown={noop}
        />
      ))}
    </div>
  );
};
