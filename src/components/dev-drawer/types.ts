/**
 * DevDrawer 共享类型。Section schema 是 drawer 跟具体段组件之间的契约 —
 * drawer.tsx 读 SECTIONS 配置渲染壳,每个段组件自己接 props 实现内容。
 */
import type { MaterialSaturationSettings } from '@/core/vrmEngine';
import type { BodyMorphConfig } from '@/config';

/** localStorage 存的完整配置 (跟旧 DevDrawer 兼容) */
export interface DevDrawerFullSettings {
  bodyMorph: BodyMorphConfig;
  saturation: MaterialSaturationSettings;
  lights: {
    globalMult: number;
    dir: { enabled: boolean; base: number };
    hemi: { enabled: boolean; base: number };
    front: { enabled: boolean; base: number };
    fill: { enabled: boolean; base: number };
    leg: { enabled: boolean; base: number };
    arm: { enabled: boolean; base: number };
  };
  camera: {
    fov?: number;
    minDistance?: number;
    maxDistance?: number;
  };
  bodyTurnEnabled: boolean;
  wardrobeVisibility: Record<string, boolean>;
  activeExpr: string;
}

/** 段 id — 跟 schema SECTIONS 一一对应 */
export type SectionId =
  | 'expressions'
  | 'saturation'
  | 'bodyMorph'
  | 'wardrobe'
  | 'lighting'
  | 'camera';

/** drawer 上下文 — 壳通过 DevDrawerContext.Provider 注入,段组件 useContext 读取 */
export interface DevDrawerContextValue {
  t: (key: string, opts?: Record<string, unknown>) => string;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  // ponytail: 全局重置信号 — 自增时强制所有 section remount,从刚重置的 engine
  // 重新读 state,补回 handleResetAllToConfig 漏掉的段级同步
  resetSignal: number;
}