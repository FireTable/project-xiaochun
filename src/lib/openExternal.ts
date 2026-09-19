/**
 * Open an https URL in the system browser.
 * Tauri webview `target=_blank` is a no-op; use plugin-opener there.
 */
import { isTauri } from '@/lib/platform';

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
