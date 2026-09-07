import { createContext, useContext } from 'react';
import type { DevDrawerContextValue } from './types';

/**
 * DevDrawer 上下文 — 壳 Provider 注入,各 section 用 useContext 拿 t / collapsed / toggleCollapsed。
 * ponytail: 这样 section 组件不用一层层 prop drilling,新增 section 直接 import 即可。
 */
export const DevDrawerContext = createContext<DevDrawerContextValue>({
  t: (k) => k,
  collapsed: new Set(),
  toggleCollapsed: () => {},
  resetSignal: 0,
});

export const useDevDrawer = () => useContext(DevDrawerContext);