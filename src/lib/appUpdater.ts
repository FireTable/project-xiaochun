/**
 * appUpdater.ts — Tauri in-app updater (official plugin).
 *
 * Web is a no-op. All Tauri desktop installs check GitHub Releases `latest.json`.
 */

import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '@/lib/platform';

export const APP_UPDATE_CHECK_EVENT = 'xiaochun:check-app-update';

export type AppUpdateInfo = {
  version: string;
  currentVersion: string;
  body: string | null;
};

let pendingUpdate: Update | null = null;

export function requestAppUpdateCheck(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(APP_UPDATE_CHECK_EVENT));
}

export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  pendingUpdate = null;
  if (!isTauri()) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;

  pendingUpdate = update;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    body: update.body ?? null,
  };
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const update = pendingUpdate;
  if (!update) throw new Error('No pending update');

  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      downloaded = 0;
      total = event.data.contentLength ?? 0;
      onProgress?.(0, total);
      return;
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength ?? 0;
      onProgress?.(downloaded, total);
    }
  });

  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
