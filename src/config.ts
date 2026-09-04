/**
 * Project XiaoChun 全局配置中心与单一可信源 (Single Source of Truth)
 */

export interface LightChannelConfig {
  base: number;
  enabled: boolean;
}

export interface LightConfig {
  dir: LightChannelConfig;
  hemi: LightChannelConfig;
  front: LightChannelConfig;
  fill: LightChannelConfig;
  leg: LightChannelConfig;
  arm: LightChannelConfig;
  globalMult: number;
}

export const APP_CONFIG = {
  brand: {
    name: 'Project XiaoChun',
    logo: '/logo.png',
    favicon: '/favicon.png',
    github: 'https://github.com/FireTable/project-xiaochun',
  },
  model: {
    defaultVrm: '/xiaochun_v1.vrm',
    defaultName: '小蠢 (xiaochun_v1)',
  },
  // ponytail: EMAGE ONNX 模型文件基础 URL。
  // 生产环境 (PROD) 始终强制走 Cloudflare R2 (https://cdn.firetable.tech/xiaochun)；
  // 本地 dev: 在 .env.local 设 VITE_EMAGE_BASE=/onnx 即回到 public/onnx 软链。
  emage: {
    base: import.meta.env.PROD
      ? ((import.meta.env.VITE_EMAGE_BASE_PROD as string | undefined) ?? 'https://cdn.firetable.tech/xiaochun')
      : ((import.meta.env.VITE_EMAGE_BASE as string | undefined) ?? '/onnx'),
    cacheName: 'emage-models-v1',
  },
  camera: {
    defaultFov: 35,
    minFov: 15,
    maxFov: 60,
    defaultPosition: [0.0, 1.5, 3.6] as [number, number, number],
    defaultTarget: [0.0, 1.2, 0.0] as [number, number, number],
  },
  lights: {
    dir: { base: 1.00, enabled: true },
    hemi: { base: 0.60, enabled: true },
    front: { base: 0.70, enabled: true },
    fill: { base: 0.80, enabled: true },
    leg: { base: 0.45, enabled: true },
    arm: { base: 0.50, enabled: true },
    globalMult: 1.1,
  } as LightConfig,
  expressions: [
    { key: 'neutral' },
    { key: 'happy' },
    { key: 'angry' },
    { key: 'sad' },
    { key: 'relaxed' },
    { key: 'surprised' },
  ],
} as const;

export type AppConfig = typeof APP_CONFIG;
