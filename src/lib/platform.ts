/**
 * platform.ts — 跨平台环境探测与多端适配工具
 */

/**
 * 是否运行在 Tauri 原生宿主环境 (PC 桌面端或移动端)
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

/**
 * 是否运行在移动端设备 (iOS / Android)
 */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * 是否运行在桌面端 (macOS / Windows / Linux)
 */
export function isDesktop(): boolean {
  return isTauri() && !isMobile();
}

/**
 * 当前客户端操作系统是否为 macOS / Apple 平台
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPod|iPad/i.test(platform);
}

/**
 * 获取当前操作系统对应的主修饰键显示标签 (Mac: ⌘, Windows/Linux: Ctrl)
 */
export function getPrimaryModifierLabel(): string {
  return isMacOS() ? '⌘' : 'Ctrl';
}

/**
 * 精准判定指针/鼠标事件是否按下了当前操作系统对应的主修饰键：
 * - macOS: 精准只认 e.metaKey (Command ⌘)，避免与系统的 Ctrl+Click 冲突
 * - Windows / Linux: 精准只认 e.ctrlKey (Ctrl)
 */
export function hasInteractionModifier(e: MouseEvent | PointerEvent | KeyboardEvent): boolean {
  return isMacOS() ? Boolean(e.metaKey) : Boolean(e.ctrlKey);
}

/**
 * 触发原生无框窗口拖拽 (Tauri)
 */
export async function startWindowDragging(_e?: React.MouseEvent | MouseEvent): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch (err) {
    console.warn('[platform] startDragging failed:', err);
  }
}

/**
 * 触发原生无框窗口边缘/边角缩放拉伸 (Tauri)
 */
export async function startWindowResize(
  direction: 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West',
  _e?: React.MouseEvent | MouseEvent
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startResizeDragging(direction);
  } catch (err) {
    console.warn('[platform] startResizeDragging failed:', err);
  }
}

/**
 * 关闭原生窗口 (Tauri) — 需要 capabilities 里开启 core:window:allow-close
 */
export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch (err) {
    console.warn('[platform] closeWindow failed:', err);
  }
}

/**
 * 重新加载 webview (Tauri + 浏览器通用) — window.location.reload() 包装
 */
export function reloadWindow(): void {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/**
 * 动态开启/关闭原生窗口可调整大小特性 (Tauri)
 * 待机模式下为 false，彻底屏蔽 macOS/Windows 默认在透明边缘触发的系统拉伸光标
 */
export async function setWindowResizable(resizable: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setResizable(resizable);
  } catch (err) {
    console.warn('[platform] setResizable failed:', err);
  }
}


