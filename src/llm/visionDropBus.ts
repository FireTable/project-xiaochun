/**
 * Lightweight coordination bus between global window drag-and-drop (App.tsx)
 * and ChatBar's vision attachment state (active only when the current model supports vision).
 */

type VisionDropHandler = (files: File[]) => void;

let activeHandler: VisionDropHandler | null = null;
const listeners = new Set<(active: boolean) => void>();

export function setVisionDropHandler(handler: VisionDropHandler | null): void {
  const prev = activeHandler !== null;
  activeHandler = handler;
  const next = activeHandler !== null;
  if (prev !== next) {
    listeners.forEach((fn) => {
      try { fn(next); } catch { /* noop */ }
    });
  }
}

export function isVisionDropActive(): boolean {
  return activeHandler !== null;
}

export function subscribeVisionDropActive(cb: (active: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function dispatchVisionDrop(files: File[]): boolean {
  if (!activeHandler || files.length === 0) return false;
  activeHandler(files);
  return true;
}

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function dataTransferHasImage(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) return true;
    }
  }
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (f && isImageFile(f)) return true;
    }
  }
  return false;
}

export function dataTransferHasVrm(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      if (dt.files[i]?.name.toLowerCase().endsWith('.vrm')) return true;
    }
  }
  return false;
}
