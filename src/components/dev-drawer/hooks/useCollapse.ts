import { useCallback, useState } from 'react';
import { DEV_DRAWER_COLLAPSED_KEY } from '../storage';

/**
 * 折叠状态 hook:自己持有 Set<string>,toggle 同步写 localStorage。
 * 壳引用一次,往下通过 DevDrawerContext 共享给所有 section。
 */
export function useCollapse(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return new Set();
    try {
      const raw = localStorage.getItem(DEV_DRAWER_COLLAPSED_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(DEV_DRAWER_COLLAPSED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return [collapsed, toggle];
}