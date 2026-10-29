import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

/**
 * Fast 64-bit content hash of an ArrayBuffer or Uint8Array slice.
 * Non-cryptographic, zero-allocation, ~1.5ms per 2MB in V8.
 */
export function fastBufferHash(buf: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const len = buf.length;
  const dv = new DataView(buf.buffer, buf.byteOffset, len);
  const words = len >>> 2;
  for (let i = 0; i < words; i++) {
    const k = dv.getUint32(i * 4, true);
    h1 = Math.imul(h1 ^ k, 2654435761);
    h2 = Math.imul(h2 ^ (k >>> 16), 1597334677);
  }
  for (let i = words * 4; i < len; i++) {
    const b = dv.getUint8(i);
    h1 = Math.imul(h1 ^ b, 2654435761);
  }
  return (h1 >>> 0).toString(16) + '_' + (h2 >>> 0).toString(16) + '_' + len;
}

/**
 * Extract binary content hashes for all glTF images in a parsed GLTF model.
 * Works uniformly for models loaded from URL, ArrayBuffer, or Blob.
 */
export async function extractParserImageHashes(parser: any): Promise<Map<number, string>> {
  const hashes = new Map<number, string>();
  if (!parser || !parser.json) return hashes;

  const images = parser.json.images || [];
  const bvs = parser.json.bufferViews || [];

  let bin: ArrayBuffer | null = null;
  try {
    bin = await parser.getDependency('buffer', 0);
  } catch (err) {
    console.warn('[TexturePool] Could not retrieve GLTF binary buffer dependency:', err);
    return hashes;
  }

  if (!bin) return hashes;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (img && typeof img.bufferView === 'number') {
      const bv = bvs[img.bufferView];
      if (bv && typeof bv.byteLength === 'number') {
        const offset = bv.byteOffset || 0;
        const slice = new Uint8Array(bin, offset, bv.byteLength);
        hashes.set(i, fastBufferHash(slice));
      }
    }
  }

  return hashes;
}

export interface TexturePoolEntry {
  texture: THREE.Texture;
  refCount: number;
  hash: string;
}

export interface DeduplicateStats {
  sharedCount: number;
  uniqueCount: number;
}

export interface TextureSlotMapping {
  slot: string;
  getIndex: (gltfMat: any) => number | undefined;
}

export const MTOON_AND_STANDARD_SLOTS: TextureSlotMapping[] = [
  { slot: 'map', getIndex: (m) => m.pbrMetallicRoughness?.baseColorTexture?.index },
  { slot: 'shadeMultiplyTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.shadeMultiplyTexture?.index },
  { slot: 'normalMap', getIndex: (m) => m.normalTexture?.index },
  { slot: 'matcapTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.matcapTexture?.index },
  { slot: 'shadingShiftTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.shadingShiftTexture?.index },
  { slot: 'rimMultiplyTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.rimMultiplyTexture?.index },
  { slot: 'outlineWidthMultiplyTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.outlineWidthMultiplyTexture?.index },
  { slot: 'uvAnimationMaskTexture', getIndex: (m) => m.extensions?.VRMC_materials_mtoon?.uvAnimationMaskTexture?.index },
  { slot: 'emissiveMap', getIndex: (m) => m.emissiveTexture?.index },
  { slot: 'roughnessMap', getIndex: (m) => m.pbrMetallicRoughness?.metallicRoughnessTexture?.index },
  { slot: 'metalnessMap', getIndex: (m) => m.pbrMetallicRoughness?.metallicRoughnessTexture?.index },
  { slot: 'aoMap', getIndex: (m) => m.occlusionTexture?.index },
];

/**
 * VRM Texture Pool & Deduplication Manager (Single Source of Truth for shared avatar textures)
 *
 * Keeps active textures (face, hair, eyes, utilities) shared across outfit swaps.
 * When a new outfit is loaded:
 *   - Reuses matching textures from the pool and skips GPU texture uploads (0ms / 0 extra VRAM).
 *   - Disposes the uninitialized duplicate texture.
 *   - Increments reference counts.
 * When the previous outfit is disposed:
 *   - Decrements reference counts.
 *   - Shared textures (refCount > 0) are preserved on GPU.
 *   - Unique clothing textures (refCount == 0) are safely disposed from GPU.
 */
export class VRMTexturePool {
  private pool = new Map<string, TexturePoolEntry>();
  private textureToHash = new WeakMap<THREE.Texture, string>();

  /**
   * Deduplicates textures in a newly parsed VRM model against the pool.
   */
  public deduplicateModel(
    vrm: VRM,
    parser: any,
    imageHashes: Map<number, string>,
  ): DeduplicateStats {
    let sharedCount = 0;
    let uniqueCount = 0;

    if (!vrm || !vrm.scene || !parser?.json) {
      return { sharedCount, uniqueCount };
    }

    const gltfJson = parser.json;
    const gltfMaterials = gltfJson.materials || [];
    const gltfTextures = gltfJson.textures || [];

    // Collect all unique material instances in the VRM scene
    const materials = new Set<THREE.Material>();
    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) materials.add(m);
        }
      }
    });

    for (const mat of materials) {
      const anyMat = mat as any;
      const assoc = parser.associations?.get(mat);
      let matIndex: number | undefined = assoc?.materials;

      // Fallback matching by material name if associations are missing
      if (matIndex === undefined && mat.name) {
        const found = gltfMaterials.findIndex((m: any) => m.name === mat.name);
        if (found !== -1) matIndex = found;
      }

      if (matIndex === undefined) continue;
      const gltfMat = gltfMaterials[matIndex];
      if (!gltfMat) continue;

      for (const mapping of MTOON_AND_STANDARD_SLOTS) {
        const texIndex = mapping.getIndex(gltfMat);
        if (texIndex === undefined) continue;

        const imageIndex = gltfTextures[texIndex]?.source;
        if (imageIndex === undefined) continue;

        const hash = imageHashes.get(imageIndex);
        if (!hash) continue;

        const currentTex = anyMat[mapping.slot] as THREE.Texture | undefined;
        if (!currentTex || !(currentTex as any).isTexture) continue;

        const poolEntry = this.pool.get(hash);
        if (poolEntry) {
          if (poolEntry.texture !== currentTex) {
            // Point the material slot to the existing GPU-resident texture
            anyMat[mapping.slot] = poolEntry.texture;
            anyMat.needsUpdate = true;

            // Dispose the duplicate texture immediately before it touches WebGL
            try {
              currentTex.dispose();
            } catch {
              /* ignore */
            }

            poolEntry.refCount++;
            this.textureToHash.set(poolEntry.texture, hash);
            sharedCount++;
          }
        } else {
          // First time seeing this texture: register in pool as SSOT
          this.pool.set(hash, {
            texture: currentTex,
            refCount: 1,
            hash,
          });
          this.textureToHash.set(currentTex, hash);
          uniqueCount++;
        }
      }
    }

    return { sharedCount, uniqueCount };
  }

  /**
   * Release a texture reference.
   * If the texture is shared (refCount > 0), keeps it alive in GPU memory.
   * If refCount drops to 0 or texture is not in pool, disposes it from GPU memory.
   *
   * @returns true if texture was actually disposed; false if kept alive because shared.
   */
  public releaseTexture(texture: THREE.Texture): boolean {
    if (!texture) return false;

    const hash = this.textureToHash.get(texture);
    if (hash) {
      const entry = this.pool.get(hash);
      if (entry && entry.texture === texture) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          this.pool.delete(hash);
          try {
            texture.dispose();
          } catch {
            /* ignore */
          }
          return true;
        }
        // Still in use by another model: do NOT dispose!
        return false;
      }
    }

    // Not tracked in pool: safe to dispose
    try {
      texture.dispose();
    } catch {
      /* ignore */
    }
    return true;
  }

  /**
   * Check if a texture is registered and currently in active use.
   */
  public isTextureShared(texture: THREE.Texture): boolean {
    const hash = this.textureToHash.get(texture);
    if (!hash) return false;
    const entry = this.pool.get(hash);
    return !!entry && entry.refCount > 1;
  }

  /**
   * Get current pool statistics.
   */
  public getStats(): { poolSize: number; activeEntries: { hash: string; refCount: number }[] } {
    return {
      poolSize: this.pool.size,
      activeEntries: Array.from(this.pool.values()).map((e) => ({
        hash: e.hash,
        refCount: e.refCount,
      })),
    };
  }

  /**
   * Dispose all textures and clear pool (used on engine teardown).
   */
  public clear(): void {
    for (const entry of this.pool.values()) {
      try {
        entry.texture.dispose();
      } catch {
        /* ignore */
      }
    }
    this.pool.clear();
  }
}
