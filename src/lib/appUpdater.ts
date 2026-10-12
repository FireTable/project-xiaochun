/**
 * appUpdater.ts — Tauri in-app updater (official plugin).
 *
 * Web is a no-op. All Tauri desktop installs check GitHub Releases `latest.json`.
 */

import type { Update } from '@tauri-apps/plugin-updater';
// import { APP_CONFIG } from '@/config';   // githubReleaseUrl 恢复时再加回来
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

// 更新弹窗里的「查看更新日志」入口已下线 —— 当前 GitHub Release 的 body 是空的,
// 点进去只会打开一个空白页面。Release Log 有内容后把这段和 updater.changelog
// 一起恢复, 并在 AppUpdateDialog 的 notes 下方重新挂上外链。
// export function githubReleaseUrl(version: string): string {
//   const tag = version.startsWith('v') ? version : `v${version}`;
//   return `${APP_CONFIG.brand.github}/releases/tag/${tag}`;
// }

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
