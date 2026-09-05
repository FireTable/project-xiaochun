/**
 * deviceDetection.ts — 客户端硬件与 WebGPU 能力智能评估算法
 *
 * 在加载大型模型前对用户设备进行全方位硬件与 WebGPU 能力探测：
 * 1. WebGPU 适配器有效性及软件模拟 (Fallback Adapter) 探测；
 * 2. 显存缓冲区上限 (maxBufferSize / maxStorageBufferBindingSize)；
 * 3. 宿主设备内存 (deviceMemory) 与并发核心数 (hardwareConcurrency)；
 * 4. 移动端与桌面端环境判定；
 * 5. 推荐最大模型参数量 (recommendedMaxB)。
 *
 * 评估结果：
 * - tier: 'high'  -> 硬件显存充沛（桌面端/旗舰高显存），直接运行正常模型 (APP_CONFIG.llm.model)
 * - tier: 'low'   -> 硬件或显存受限（手机/低内存/受限GPU），直截了当加载轻量 fallback 模型 (APP_CONFIG.llm.fallback)
 */



import { APP_CONFIG } from '@/config';

/** ponytail: reason 用完整 i18n key,vars 给 i18next 插值;reason 留中文 fallback 给非 i18n 通道。 */
export type ReasonKey =
  | 'chat.deviceDialog.reasonText.noWebgpu'
  | 'chat.deviceDialog.reasonText.noAdapter'
  | 'chat.deviceDialog.reasonText.highDefault'
  | 'chat.deviceDialog.reasonText.fallbackAdapter'
  | 'chat.deviceDialog.reasonText.lowMaxBuffer'
  | 'chat.deviceDialog.reasonText.lowStorageBuffer'
  | 'chat.deviceDialog.reasonText.lowMobileMemory'
  | 'chat.deviceDialog.reasonText.lowMobileBuffer'
  | 'chat.deviceDialog.reasonText.lowMobileCores'
  | 'chat.deviceDialog.reasonText.highMobile'
  | 'chat.deviceDialog.reasonText.desktop';

export interface GpuDeviceProfile {
  supported: boolean;
  tier: 'high' | 'low';
  recommendedModelId: string;
  recommendedMaxB: string;
  reasonKey: ReasonKey;
  reasonVars?: Record<string, unknown>;
  /** ponytail: 中文 fallback,用于控制台 / 缓存命中时无 t() 的场景。 */
  reason: string;
  maxBufferSizeMB: number;
  maxStorageBufferMB: number;
  deviceMemoryGB?: number;
  hardwareConcurrency: number;
  isMobile: boolean;
  vendor?: string;
  architecture?: string;
  contextWindowSize: number;
  maxMemoryTurns: number;
}

const TIER_STORAGE_KEY = 'xiaochun.gpu_tier';
let cachedProfile: GpuDeviceProfile | null = null;
let profilePromise: Promise<GpuDeviceProfile> | null = null;

function detectIsMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && typeof window !== 'undefined' && window.innerWidth < 768)
  );
}

function computeRecommendedMaxB(
  supported: boolean,
  isMobile: boolean,
  maxBufferMB: number,
  devMem?: number,
): string {
  if (!supported) return '0B';
  if (isMobile) {
    // 移动设备受限于统一内存架构、系统 LMK 与 Vulkan 看门狗，统一推荐 ≤ 0.5B 避免显存崩溃
    return '≤ 0.5B';
  }
  // 桌面端
  if (maxBufferMB >= 2048 && (!devMem || devMem >= 16)) return '≤ 7B';
  if (maxBufferMB >= 1024 && (!devMem || devMem >= 8)) return '≤ 3B';
  if (maxBufferMB >= 512) return '≤ 1.5B';
  return '≤ 0.5B';
}

/**
 * 根据设备类型、显存限制与综合分级，动态推断计划上下文窗口与短期记忆保留轮数
 *
 * 评估基准（以中文及 ChatML 对话格式为基准）：
 * - 系统基底开销：System Prompt (小蠢角色卡+格式指令) ~280 tokens，实体偏好 ~50 tokens，合计约 330 tokens
 * - 当轮生成开销：用户本次输入包装 ~60 tokens，模型最大输出空间 (max_tokens) 120~200 tokens
 * - 基础安全留白：~100 tokens 避免命中 KV Cache 临界边界
 * - 静态非记忆开销总计：~500 tokens (移动轻量) 至 ~650 tokens (桌面全量)
 *
 * 单轮历史开销：
 * - 历史由 user 与 assistant 对白组成，按 APP_CONFIG.memory.turnMaxChars (180字) 截断，
/**
 * 根据端侧小模型 (0.5B / 1.5B) 的注意力特性与硬件分级，推断计划上下文窗口与短期记忆保留轮数
 *
 * 核心考量（小模型长上下文痛点与 Token 敏感度）：
 * 1. 本项目运行的是端侧小型语言模型（Fallback 为 Qwen2.5-0.5B，主推为 Qwen2.5-1.5B）；
 * 2. 小模型的参数量和注意力头容量有限，对 Prompt 中的历史 Token 极度敏感：
 *    - 历史轮数过多（如 ≥4~6 轮）会导致模型注意力被过往对白格式严重绑架，陷入可怕的复读死循环（Echo Loop）；
 *    - 历史长了会迅速冲淡 System Prompt 中严苛的“小蠢”傲娇萌系人设与负面提示词（Negative Constraints），
 *      导致模型开始胡言乱语、脱离角色设定；
 *    - 移动端 WebGPU 的 Prefill（首字预填充）耗时随历史长度急剧恶化，多余历史 token 会让首字卡顿数秒；
 * 3. 黄金平衡点：
 *    - 0.5B（移动端 / 低配）：严格限制为 1 轮（仅保留上一次 Q/A），既有指代理解能力，又保证极低延迟与 0 复读；
 *    - 1.5B（桌面端）：限制为 2 轮（高配最多 3 轮），兼顾多轮自然对话深度，绝不给过多历史稀释人设。
 */
export function deduceContextAndMemory(
  tier: 'high' | 'low',
  isMobile: boolean,
  maxBufferSizeMB: number,
  devMem?: number,
): { contextWindowSize: number; maxMemoryTurns: number } {
  if (isMobile || tier === 'low') {
    return {
      contextWindowSize: 1024,
      maxMemoryTurns: 1, // 0.5B 极度敏感，严控在 1 轮历史，杜绝复读并保持首字毫秒级响应
    };
  }

  // 桌面旗舰大显存 (单缓冲区 >= 2GB 且 内存 >= 16GB)
  if (maxBufferSizeMB >= 2048 && (!devMem || devMem >= 16)) {
    return {
      contextWindowSize: 2048,
      maxMemoryTurns: 3, // 1.5B 旗舰配置下最多给 3 轮，防止长历史冲淡 System 人设
    };
  }

  // 桌面标准独立/核显环境
  return {
    contextWindowSize: 2048,
    maxMemoryTurns: 2, // 桌面默认 2 轮
  };
}

/**
 * 打印详细的检测报告至控制台
 */
export function logProfileToConsole(p: GpuDeviceProfile): void {
  if (typeof console === 'undefined') return;
  console.log(
    `%c[设备硬件与 WebGPU 检测报告]%c
• 硬件环境: ${p.isMobile ? '📱 移动端设备 (Mobile)' : '💻 桌面端设备 (Desktop)'} | ${p.deviceMemoryGB ? p.deviceMemoryGB + 'GB RAM' : 'RAM 未知'} | ${p.hardwareConcurrency} 核心
• WebGPU 状态: ${p.supported ? '✅ 硬件加速已支持' : '❌ 不可用 / 不支持'}
• 显卡架构/驱动: ${p.vendor || p.architecture || (p.isMobile ? '移动集成 GPU' : '桌面独立/核显')}
• 单缓冲区上限 (maxBufferSize): ${p.maxBufferSizeMB} MB
• 存储绑定上限 (maxStorageBufferBindingSize): ${p.maxStorageBufferMB} MB
• 性能评估分级: ${p.tier === 'high' ? '🟢 充足 (High Tier)' : '🟡 受限 (Low Tier)'}
• 计划上下文窗口: ${p.contextWindowSize} tokens (记忆保留: ${p.maxMemoryTurns} 轮)
• 推荐最大模型参数: 🌟 ${p.recommendedMaxB}
• 推荐生效模型: 📦 ${p.recommendedModelId}
• 诊断评估理由: ℹ️ ${p.reason} (i18n key: ${p.reasonKey})`,
    'color: #38bdf8; font-weight: bold; font-size: 14px;',
    'color: #94a3b8; font-size: 12px; line-height: 1.6;'
  );
}

/**
 * 获取当前设备建议的短期记忆保留轮数（同步快速返回）
 */
export function getDeviceMemoryTurns(): number {
  if (cachedProfile) return cachedProfile.maxMemoryTurns;
  const tier = getQuickDeviceTier();
  return tier === 'low' ? 1 : (APP_CONFIG.memory.shortTermTurns || 2);
}

/**
 * 获取当前设备建议的计划上下文窗口大小（同步快速返回）
 */
export function getDeviceContextWindowSize(): number {
  if (cachedProfile) return cachedProfile.contextWindowSize;
  const tier = getQuickDeviceTier();
  return tier === 'low' ? 1024 : 2048;
}

/**
 * 同步快速预判设备层级 (供初始化 UI 状态秒级同步返回，不阻塞渲染)
 */
export function getQuickDeviceTier(): 'high' | 'low' {
  if (cachedProfile) return cachedProfile.tier;

  if (typeof window !== 'undefined') {
    try {
      const savedTier = window.sessionStorage.getItem(TIER_STORAGE_KEY);
      if (savedTier === 'high' || savedTier === 'low') return savedTier;
    } catch { }
  }

  // 默认启发式：移动端安全起见预置为 low，桌面端预置为 high
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return 'low';
  return detectIsMobile() ? 'low' : 'high';
}

/**
 * 获取当前已缓存的硬件画像（若尚未探测完成则返回 null）
 */
export function getCachedDeviceProfile(): GpuDeviceProfile | null {
  return cachedProfile;
}

/**
 * 异步深度探测硬件与 WebGPU 算力限制，产出权威评测画像
 */
export async function detectGpuDeviceProfile(): Promise<GpuDeviceProfile> {
  if (cachedProfile) return cachedProfile;
  if (profilePromise) return profilePromise;

  profilePromise = (async (): Promise<GpuDeviceProfile> => {
    const isMobile = detectIsMobile();
    const devMem = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;

    // 1. 检查浏览器环境与 WebGPU API 支持
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      const p: GpuDeviceProfile = {
        supported: false,
        tier: 'low',
        recommendedModelId: APP_CONFIG.llm.fallback,
        recommendedMaxB: computeRecommendedMaxB(false, isMobile, 0, devMem),
        reasonKey: 'chat.deviceDialog.reasonText.noWebgpu',
        reason: '当前浏览器或上下文不支持 WebGPU',
        maxBufferSizeMB: 0,
        maxStorageBufferMB: 0,
        deviceMemoryGB: devMem,
        hardwareConcurrency: cores,
        isMobile,
        ...deduceContextAndMemory('low', isMobile, 0, devMem),
      };
      cacheResult(p);
      return p;
    }

    // 2. 请求 GPU 适配器
    let adapter: GPUAdapter | null = null;
    try {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('[DeviceDetection] requestAdapter failed:', e);
    }

    if (!adapter) {
      const p: GpuDeviceProfile = {
        supported: false,
        tier: 'low',
        recommendedModelId: APP_CONFIG.llm.fallback,
        recommendedMaxB: computeRecommendedMaxB(false, isMobile, 0, devMem),
        reasonKey: 'chat.deviceDialog.reasonText.noAdapter',
        reason: '未能成功获取 WebGPU 硬件适配器',
        maxBufferSizeMB: 0,
        maxStorageBufferMB: 0,
        deviceMemoryGB: devMem,
        hardwareConcurrency: cores,
        isMobile,
        ...deduceContextAndMemory('low', isMobile, 0, devMem),
      };
      cacheResult(p);
      return p;
    }

    // 3. 收集硬件与限制指标
    const limits = adapter.limits;
    const maxBufferSizeMB = Math.floor((limits.maxBufferSize || 0) / (1024 * 1024));
    const maxStorageBufferMB = Math.floor((limits.maxStorageBufferBindingSize || 0) / (1024 * 1024));
    const isFallbackAdapter = Boolean((adapter as any).isFallbackAdapter);

    let vendor = '';
    let architecture = '';
    try {
      const info = (adapter as any).info || (await (adapter as any).requestAdapterInfo?.()) || {};
      vendor = info.vendor || '';
      architecture = info.architecture || '';
    } catch { }

    // 4. 算法综合裁决 — reason 用完整 i18n key + 插值 vars,中文 fallback 同步保留。
    let tier: 'high' | 'low' = 'high';
    let reasonKey: ReasonKey = 'chat.deviceDialog.reasonText.highDefault';
    let reasonVars: Record<string, unknown> | undefined;
    let reason = '硬件显存与配置达标，支持全量正常模型';

    const ramGB = devMem ? `, ${devMem}GB RAM` : '';

    if (isFallbackAdapter) {
      tier = 'low';
      reasonKey = 'chat.deviceDialog.reasonText.fallbackAdapter';
      reason = 'WebGPU 运行在 CPU/软件模拟降级模式，无法承载大模型';
    } else if (maxBufferSizeMB < 512) {
      tier = 'low';
      reasonKey = 'chat.deviceDialog.reasonText.lowMaxBuffer';
      reasonVars = { maxBufferSizeMB };
      reason = `GPU 单缓冲区上限不足 (${maxBufferSizeMB}MB < 512MB)，易触发 mapAsync 显存溢出`;
    } else if (maxStorageBufferMB < 512) {
      tier = 'low';
      reasonKey = 'chat.deviceDialog.reasonText.lowStorageBuffer';
      reasonVars = { maxStorageBufferMB };
      reason = `GPU 存储缓冲区绑定上限不足 (${maxStorageBufferMB}MB < 512MB)`;
    } else if (isMobile) {
      tier = 'low';
      if (typeof devMem === 'number' && devMem < 6) {
        reasonKey = 'chat.deviceDialog.reasonText.lowMobileMemory';
        reasonVars = { devMem };
        reason = `移动设备内存较小 (${devMem}GB)，结合 3D 渲染优先适配轻量模型`;
      } else if (maxBufferSizeMB < 1024) {
        reasonKey = 'chat.deviceDialog.reasonText.lowMobileBuffer';
        reasonVars = { maxBufferSizeMB };
        reason = `移动端 GPU 缓冲区受限 (${maxBufferSizeMB}MB < 1024MB)，适配轻量模型避免显存溢出`;
      } else if (cores <= 4) {
        reasonKey = 'chat.deviceDialog.reasonText.lowMobileCores';
        reasonVars = { cores };
        reason = `移动端处理核心数较少 (${cores}核)，大模型推理延迟过高`;
      } else {
        reasonKey = 'chat.deviceDialog.reasonText.highMobile';
        reasonVars = { maxBufferSizeMB, ramGB };
        reason = `移动端共享显存架构 (${maxBufferSizeMB}MB 显存缓冲区${ramGB})，优先适配轻量模型避免驱动超时`;
      }
    } else {
      reasonKey = 'chat.deviceDialog.reasonText.desktop';
      reasonVars = {
        maxBufferSizeMB,
        ramGB,
        cores,
      };
      reason = `桌面端计算环境 (${maxBufferSizeMB}MB 显存缓冲区${ramGB}，${cores}核)`;
    }

    const recommendedMaxB = computeRecommendedMaxB(true, isMobile, maxBufferSizeMB, devMem);

    const profile: GpuDeviceProfile = {
      supported: true,
      tier,
      recommendedModelId: tier === 'high' ? APP_CONFIG.llm.model : APP_CONFIG.llm.fallback,
      recommendedMaxB,
      reasonKey,
      reasonVars,
      reason,
      maxBufferSizeMB,
      maxStorageBufferMB,
      deviceMemoryGB: devMem,
      hardwareConcurrency: cores,
      isMobile,
      vendor,
      architecture,
      ...deduceContextAndMemory(tier, isMobile, maxBufferSizeMB, devMem),
    };

    cacheResult(profile);
    return profile;
  })();

  return profilePromise;
}

function cacheResult(profile: GpuDeviceProfile): void {
  cachedProfile = profile;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(TIER_STORAGE_KEY, profile.tier);
    } catch { }
  }
  logProfileToConsole(profile);
}