export interface LlmLoadProgress {
  progress: number;
  text: string;
  loaded: number;
  total: number;
}

let lastLoadProgress: LlmLoadProgress = { progress: 0, text: '', loaded: 0, total: 0 };
const loadProgressListeners = new Set<(p: LlmLoadProgress) => void>();

/** 从 WebLLM 的 report.text (例如 "Loading ... [12.5MB/50.0MB]") 解析已加载和总字节数 */
function parseBytesFromText(text: string): { loaded: number; total: number } | null {
  if (!text) return null;
  const match = text.match(/\[?\s*([\d.]+)\s*(B|KB|MB|GB)\s*[\/|of]\s*([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) return null;

  const unitMultiplier = (unit: string) => {
    switch (unit.toUpperCase()) {
      case 'KB': return 1024;
      case 'MB': return 1024 * 1024;
      case 'GB': return 1024 * 1024 * 1024;
      default: return 1;
    }
  };

  const loadedVal = parseFloat(match[1]);
  const loadedUnit = match[2];
  const totalVal = parseFloat(match[3]);
  const totalUnit = match[4];

  if (isNaN(loadedVal) || isNaN(totalVal)) return null;

  return {
    loaded: Math.round(loadedVal * unitMultiplier(loadedUnit)),
    total: Math.round(totalVal * unitMultiplier(totalUnit)),
  };
}

export function notifyLoadProgress(
  progress: number,
  text: string,
  bytes?: { loaded: number; total: number }
): void {
  let loaded = bytes?.loaded ?? lastLoadProgress.loaded;
  let total = bytes?.total ?? lastLoadProgress.total;

  if ((!bytes || bytes.total <= 0) && text) {
    const parsed = parseBytesFromText(text);
    if (parsed) {
      loaded = parsed.loaded;
      total = parsed.total;
    }
  }

  lastLoadProgress = { progress, text, loaded, total };
  loadProgressListeners.forEach((fn) => {
    try { fn(lastLoadProgress); } catch { }
  });
}

export function getLlmLoadProgress(): LlmLoadProgress {
  return lastLoadProgress;
}

export function onLlmLoadProgress(cb: (p: LlmLoadProgress) => void): () => void {
  loadProgressListeners.add(cb);
  if (lastLoadProgress.text || lastLoadProgress.progress > 0) cb(lastLoadProgress);
  return () => {
    loadProgressListeners.delete(cb);
  };
}
