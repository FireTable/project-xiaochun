/**
 * 虚空场景 (id: void, 新手引导第一相遇空间) 的可调参数, 由 src/config.ts 的 APP_CONFIG.voidScene 引用。
 * 字段含义 / 范围见 types/config.ts 的 VoidSceneConfig; 说明见 docs/ONBOARDING.md。
 * 颜色是 sRGB 十六进制, 画面上就是这个颜色 (着色器里已抵消线性色调映射的曝光)。
 */
import type { VoidSceneConfig } from '../../../types/config';

export const VOID_SCENE_CONFIG: VoidSceneConfig = {
  sky: {
    // 与 LoadingOverlay / grok/webgl-warp 同一套深梅紫夜色:
    // 基于 LoadingOverlay 的 radial-gradient(120% 90% at 60% 30%, #3a1c3e 0%, #1d0d22 55%, #0e0610 100%), 光晕收小 / 黑色占比加大
    inner: 0x3a1c3e,     // 0% 中心色 (梅紫)
    mid: 0x1d0d22,       // 中段色
    midStop: 0.38,       // 中段色标位置, 范围 0.1 ~ 0.9
    outer: 0x0a0509,     // 100% 边缘色 (近黑紫); 也作为 scene.background 兜底色
    center: [0.6, 0.3],  // 渐变中心 (屏幕比例, x 从左, y 从上), 同 CSS "at 60% 30%"
    radius: [0.8, 0.6],  // 椭圆半径 (屏幕宽 / 高的比例), 比 CSS 的 120% 90% 收小
  },
  nebula: {
    strength: 0.035,      // 星云叠加强度, 范围 0 ~ 0.15; 0 = 纯渐变, 调大更明显 (>0.15 会脏)
    plum: 0x6b2f63,      // 冷侧星云色 (梅紫)
    apricot: 0xc98a5a,   // 暖侧星云色 (金杏), 与 LoadingOverlay 的 nebula / mist 呼应
    scale: 1.6,          // 噪声频率 (按视线方向), 范围 0.5 ~ 4; 调小 = 云团更大更柔
    driftSpeed: 0.006,   // 漂移速度 (rad/s 量级), 范围 0 ~ 0.03; 0 = 静止
  },
  dither: 1.0,           // 抖动强度 (单位 1/255), 范围 0 ~ 2; 消除深色渐变色带
};
