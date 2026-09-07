/**
 * constants.ts — 全项目 localStorage key 集中地。
 *
 * ponytail: 之前 key 字面量散落在各模块（裸字符串 / 本地 const / export），
 * 改一个 key 名要在多文件 grep。新增 key 必须在这里登记，避免重复 / 漂移。
 *
 * 规则：
 * - key 字符串值永远稳定 — 改了字面量就要走数据迁移。
 * - 同 key 不在两个文件定义字面量。
 * - 加新 key 走这里,不要在调用方写裸字符串。
 */

/** LLM 思考模式开关 (sync 协议里也被读) */
export const THINKING_PREF_KEY = 'xiaochun.thinking';

/** 当前激活的 LLM,值格式 `${webllm|custom}:${modelId|providerId}` */
export const LLM_MODEL_KEY = 'xiaochun.llm.model';

/**
 * 设备 GPU tier 评估结果缓存。
 * ponytail: 用 localStorage 而不是 sessionStorage — 关 tab 后保留,
 * 二回访问秒加载,但硬件变化 / GPU 驱动更新后用户需要手动清缓存。
 */
export const GPU_TIER_KEY = 'xiaochun.gpu_tier';

/** 服装 / 肤色 / 瞳色等 MToon 材质饱和度设置 */
export const MAT_SATURATION_KEY = 'xiaochun.mat_saturation_settings';

/** 体型微调(Bone Morph) 配置 */
export const BODY_MORPH_KEY = 'xiaochun_dev_body_morph';

/** 摄像机状态(position / target / fov 等) */
export const CAMERA_STATE_KEY = 'xiaochun_camera_state';

/** DevDrawer 所有面板的展开 / 值合并存储 */
export const DEV_DRAWER_STORAGE_KEY = 'xiaochun_dev_drawer_all_settings';

/** DevDrawer 折叠状态(Set of section id) */
export const DEV_DRAWER_COLLAPSED_KEY = 'xiaochun_dev_drawer_collapsed';

/** DevDrawer 浮窗开 / 关 — App.tsx 头部齿轮按钮状态 */
export const DEV_DRAWER_OPEN_KEY = 'xiaochun_dev_drawer_open';