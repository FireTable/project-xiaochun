/** 剧本里的场景别名 → 真实场景 id (APP_CONFIG.scenes.items)。未知名字原样放行，方便直接写真实 id。 */
export const STORY_SCENE_ALIASES: Record<string, string> = {
  lineart_day: 'light', // 线稿 · 白天
  lineart_night: 'dark', // 线稿 · 夜晚
  beach: 'beach3d', // 海滩
};

export function resolveStoryScene(name: string): string {
  return STORY_SCENE_ALIASES[name] ?? name;
}
