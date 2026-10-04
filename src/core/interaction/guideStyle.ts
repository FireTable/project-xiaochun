/**
 * guideStyle — 白色"提示 UI"的统一视觉常量: 窗口四角缩放弧线 (components/CornerHandle, Tauri 与 /embed 共用)
 * 和 3D 调整提示 (turn / pitch / cameraY 引导, 见 guideShadow.ts) 都从这里读颜色与阴影参数, 不要各自硬编码。
 *
 * 纯常量文件, 不 import 任何东西 (不依赖 three / React / config), 所以 Tauri、/embed、SDK 相关代码都能直接用, 不会产生循环依赖。
 * 视觉规范: 白色主体 + 低透明度、大模糊、无硬边的深色阴影; 不区分场景、不区分 Tauri / embed。
 */

/**
 * 提示主体颜色 (白, 只含 RGB, 不含透明度)。合法值: #rrggbb。config.ts 的 interaction.guideColor 默认也取它。
 * 为什么不直接写 rgba(255,255,255,0.75): three.js 的 THREE.Color 解析 rgba 会丢掉 alpha, 3D 提示必须把"颜色"和"不透明度"分开传,
 * 所以拆成 GUIDE_COLOR + GUIDE_OPACITY; 要整串 CSS 颜色用下面的 GUIDE_COLOR_CSS / guideRgba()。
 */
export const GUIDE_COLOR = '#ffffff';

/**
 * 提示主体整体不透明度 (乘在各自原有的透明度上: 弧线静止 0.45 / 悬停 0.95, 3D 提示轨道 0.85 / 流光等)。合法范围 0..1, 建议 0.5 到 1。
 * 调大 = 更白更亮 (1 = 之前的纯白); 调小 = 更含蓄, 浅色背景上更不显眼, 低于 0.5 时浅色背景基本只剩阴影。
 * 阴影不乘它: 阴影参数 (GUIDE_SHADOW.alpha / arcAlpha) 自己决定浓淡, 并且阴影层会把主体覆盖的区域抠掉 (见下), 所以主体半透明时不会透出阴影的"脏边"。
 */
export const GUIDE_OPACITY = 0.75;

/** 阴影底色 (黑)。想要偏冷 / 偏暖的阴影可以改成深蓝 / 深棕, 但别用纯彩色, 深色背景上会显脏。 */
export const GUIDE_SHADOW_RGB = '0, 0, 0';

export const GUIDE_SHADOW = {
  /**
   * 3D 调整提示阴影层的整体不透明度 (乘在引导自身 opacity 上)。合法范围 0..1, 建议 0.10 到 0.30。
   * 调大: 浅色背景上更清晰, 但越来越像描了一圈黑边, 深色背景上发脏; 调小: 更柔和, 0 = 无阴影 (浅色背景上白色提示几乎看不见)。
   */
  alpha: 0.2,
  /**
   * 3D 提示阴影贴图的模糊半径 (canvas shadowBlur, 约 2σ, 单位贴图像素)。建议 6 到 16。
   * 调大: 更软更散, 但峰值变淡; 调小: 更接近硬边。
   */
  blur: 10,
  /**
   * 3D 提示阴影在模糊前向四周膨胀的半径 (贴图像素)。建议 2 到 6, 必须 >= 0。
   * 作用: 小圆点 (半径约 2.4px) 的阴影不会被模糊稀释到看不见; 调大 = 阴影更宽更实, 圆点之间的阴影会连成一条带。
   */
  spread: 4,
  /**
   * 四角弧线阴影描边的不透明度 (SVG stroke alpha, 经模糊后峰值约再打 7 折)。合法范围 0..1, 建议 0.10 到 0.30。
   * 调大/调小的效果同 alpha。
   */
  arcAlpha: 0.2,
  /** 四角弧线阴影的高斯模糊标准差 (svg 视口单位, 弧线盒子 32x32)。建议 1.5 到 3; 过大可能被弧线内收的 4px 空隙装不下而被外层 overflow-hidden 裁掉。 */
  arcBlur: 1.8,
  /** 四角弧线阴影描边宽度 (比白色弧线 3 略宽, 阴影才会在两侧露出来)。建议 4 到 6。 */
  arcWidth: 4.5,
  /** 四角弧线阴影向下偏移 (svg 单位), 模拟光从上方来。建议 0 到 1.5。 */
  arcDy: 0.8,
} as const;

/** 四角弧线阴影的 CSS 颜色 */
export const GUIDE_ARC_SHADOW_COLOR = `rgba(${GUIDE_SHADOW_RGB}, ${GUIDE_SHADOW.arcAlpha})`;

/**
 * 带透明度的 CSS 颜色: guideRgba(0.45) => 'rgba(255, 255, 255, 0.34)' (alpha 会再乘 GUIDE_OPACITY; 仅支持 #rrggbb)。
 * 第三个参数 opacity 默认 GUIDE_OPACITY, 传 1 可得到未缩放的结果。
 */
export function guideRgba(alpha: number, hex: string = GUIDE_COLOR, opacity: number = GUIDE_OPACITY): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const a = Math.round(alpha * opacity * 1000) / 1000;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 提示主体的整串 CSS 颜色: rgba(255, 255, 255, 0.75) */
export const GUIDE_COLOR_CSS = guideRgba(1);
