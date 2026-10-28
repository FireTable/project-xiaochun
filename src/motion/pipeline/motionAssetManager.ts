import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { idbGetMotion, idbPutMotion } from '../../lib/idb-vrm-cache';
import { MOTION_CATALOG } from '../catalog';
import { makeClipSeamless } from '../vrmaRetarget';
import type { PlayMotionOptions } from '../sources/clip';

/** .vrma 是 glTF 二进制容器 (GLB), 头 4 字节固定为 'glTF'。HTML 错误页 / 空体 / 旧格式一律不入缓存。 */
export function hasGlbMagic(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const head = new Uint8Array(buf, 0, 4);
  return head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
}

/**
 * MotionAssetManager — 全局动作资产两级缓存与预热管理中心
 * 
 * 架构层级：
 *   L1 (Memory Buffer): Map<string, ArrayBuffer> 常驻内存二进制池，0ms 瞬时取用
 *   L2 (IndexedDB): 持久化动作二进制缓存，跨页面刷新秒级命中，避免重复网络下载
 *   L3 (Bound Clip Pool): Map<string, THREE.AnimationClip> 与当前 VRM 模型绑定的剪辑池
 * 
 * 保证模型换装时只清理 L3（因为 AnimationClip 绑定了特定骨骼树与节点），
 * 100% 完整保留 L1/L2 二进制池，使得换装后预热重新解析只需 5~10ms（纯 CPU parse，零网络 IO）。
 */
export class MotionAssetManager {
  /** L1 内存二进制池 (URL / Key -> ArrayBuffer) */
  private l1BufferPool = new Map<string, ArrayBuffer>();

  /** L3 与当前 VRM 绑定的已解析 AnimationClip 池 (Key -> AnimationClip) */
  private l3ClipPool = new Map<string, THREE.AnimationClip>();

  /** 正在进行的网络拉取 Promise，防止高并发下重复 fetch 相同 URL */
  private inflightFetches = new Map<string, Promise<ArrayBuffer>>();

  /** L3 代次: 每次换模型 / 清池递增, 预热中的解析结果若跨代则丢弃 (clip 绑定的是旧 VRM 骨骼树) */
  private boundGeneration = 0;

  /**
   * 获取或拉取动作二进制 ArrayBuffer (L1 内存 -> L2 IndexedDB -> Network)
   */
  async fetchBuffer(url: string, version?: string): Promise<ArrayBuffer> {
    // 1. L1 内存池瞬时命中
    const l1Hit = this.l1BufferPool.get(url);
    if (l1Hit) return l1Hit;

    // 2. 防重入：若已有正在拉取该 URL 的 Promise，直接复用
    const inflight = this.inflightFetches.get(url);
    if (inflight) return inflight;

    const fetchPromise = (async () => {
      // 3. L2 IndexedDB 持久化查询
      try {
        const idbHit = await idbGetMotion(url, version);
        if (idbHit && hasGlbMagic(idbHit)) {
          this.l1BufferPool.set(url, idbHit);
          return idbHit;
        }
      } catch (e) {
        console.warn('[MotionAssetManager] L2 IndexedDB 查询失败，降级网络请求:', e);
      }

      // 4. 网络拉取
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`[MotionAssetManager] 动作文件拉取失败: ${url} (HTTP ${resp.status})`);
      }
      const buffer = await resp.arrayBuffer();

      // 5. 写入 L1 & L2 (仅 glTF 魔数合法的缓冲, 避免把 HTML 错误页之类缓存成动作)
      if (!hasGlbMagic(buffer)) return buffer;
      this.l1BufferPool.set(url, buffer);
      void idbPutMotion(url, version, buffer).catch((err) => {
        console.warn('[MotionAssetManager] L2 IndexedDB 写入失败:', err);
      });

      return buffer;
    })();

    this.inflightFetches.set(url, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inflightFetches.delete(url);
    }
  }

  /**
   * 同步获取 L1 内存池中的 ArrayBuffer（若未加载则返回 null）
   */
  getBufferSync(url: string): ArrayBuffer | null {
    return this.l1BufferPool.get(url) ?? null;
  }

  /**
   * 手动注入或预存 ArrayBuffer 到 L1 (可选写入 L2)
   */
  setBuffer(url: string, buffer: ArrayBuffer, persistToIdb = true): void {
    this.l1BufferPool.set(url, buffer);
    if (persistToIdb && hasGlbMagic(buffer)) {
      void idbPutMotion(url, undefined, buffer).catch(() => {});
    }
  }

  /**
   * 获取已绑定并解析好的 AnimationClip (L3)
   */
  getClip(keyOrUrl: string): THREE.AnimationClip | null {
    return this.l3ClipPool.get(keyOrUrl) ?? null;
  }

  /**
   * 设置已解析好的 AnimationClip 到 L3
   */
  setClip(keyOrUrl: string, clip: THREE.AnimationClip): void {
    this.l3ClipPool.set(keyOrUrl, clip);
  }

  /**
   * 检查 L3 是否已存在对应剪辑
   */
  hasClip(keyOrUrl: string): boolean {
    return this.l3ClipPool.has(keyOrUrl);
  }

  /**
   * 清除当前模型绑定的 L3 剪辑池
   * 在发生换衣 (outfit swap) 或模型切换时调用，释放旧模型的骨骼绑定轨道，
   * 同时保留 L1/L2 二进制池以实现毫秒级快速重建。
   */
  invalidateBoundClips(): void {
    this.boundGeneration++;
    this.l3ClipPool.clear();
  }

  /**
   * 扫描 MOTION_CATALOG，对所有标记了 warmup: true 的动作进行预热
   * @param vrm 当前活体模型
   * @param clipParser 剪辑解析器（通常由 UniversalMotionController.parseToClip 提供）
   */
  async warmCatalogMotions(
    vrm: VRM,
    clipParser: (input: string | ArrayBuffer, vrm: VRM, options?: PlayMotionOptions) => Promise<THREE.AnimationClip>,
  ): Promise<void> {
    const warmupTasks: Promise<void>[] = [];
    const generation = this.boundGeneration;

    for (const rawItem of Object.values(MOTION_CATALOG)) {
      const item = rawItem as any;
      if (!item.warmup || !item.url) continue;

      const task = (async () => {
        try {
          // 1. 确保二进制进入 L1/L2
          const buffer = await this.fetchBuffer(item.url);

          // 2. 解析为适配当前 VRM 的 AnimationClip 并存入 L3
          const clip = await clipParser(buffer, vrm, item);
          if (item.loop) {
            makeClipSeamless(clip, item.fadeDuration);
          }

          // 解析期间若已换模型 / 清池, 这个 clip 绑的是旧骨骼树, 丢弃
          if (generation !== this.boundGeneration) return;

          // 注册两个键：一个使用 catalog ID，一个使用 URL，确保无论调用方传 ID 还是 URL 都能命中 L3
          this.l3ClipPool.set(item.id, clip);
          this.l3ClipPool.set(item.url, clip);
        } catch (e) {
          console.warn(`[MotionAssetManager] 动作预热失败: ${item.id} (${item.url})`, e);
        }
      })();

      warmupTasks.push(task);
    }

    await Promise.allSettled(warmupTasks);
  }

  /**
   * 清空所有内存缓存（L1 和 L3）
   */
  clearMemoryPool(): void {
    this.boundGeneration++;
    this.l1BufferPool.clear();
    this.l3ClipPool.clear();
    this.inflightFetches.clear();
  }
}

/** 单例导出 */
export const motionAssetManager = new MotionAssetManager();
