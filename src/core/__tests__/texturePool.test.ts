import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { VRMTexturePool, fastBufferHash } from '../texturePool';

describe('TexturePool & Deduplication System', () => {
  it('computes deterministic fastBufferHash', () => {
    const data1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const data2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const data3 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]);

    expect(fastBufferHash(data1)).toBe(fastBufferHash(data2));
    expect(fastBufferHash(data1)).not.toBe(fastBufferHash(data3));
  });

  it('manages texture references, reuses cached textures, and protects shared ones', () => {
    const pool = new VRMTexturePool();

    const tex1Dispose = vi.fn();
    const tex2Dispose = vi.fn();

    const tex1 = new THREE.Texture();
    tex1.name = 'head_texture_model1';
    tex1.dispose = tex1Dispose;

    const tex2 = new THREE.Texture();
    tex2.name = 'head_texture_model2';
    tex2.dispose = tex2Dispose;

    const dummyMat1 = new THREE.MeshBasicMaterial();
    dummyMat1.name = 'Face_Material';
    dummyMat1.map = tex1;

    const dummyMesh1 = new THREE.Mesh(new THREE.BoxGeometry(), dummyMat1);
    const mockVrm1: any = {
      scene: new THREE.Group(),
    };
    mockVrm1.scene.add(dummyMesh1);

    const mockParser1: any = {
      json: {
        materials: [{ name: 'Face_Material', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
      },
      associations: new Map([[dummyMat1, { materials: 0 }]]),
    };

    const hashes = new Map<number, string>([[0, 'hash_face_texture_abc123']]);

    // Model 1 deduplication: registers tex1 in pool
    const stats1 = pool.deduplicateModel(mockVrm1, mockParser1, hashes);
    expect(stats1.uniqueCount).toBe(1);
    expect(stats1.sharedCount).toBe(0);
    expect(pool.getStats().poolSize).toBe(1);

    // Model 2 has same texture hash
    const dummyMat2 = new THREE.MeshBasicMaterial();
    dummyMat2.name = 'Face_Material';
    dummyMat2.map = tex2;

    const dummyMesh2 = new THREE.Mesh(new THREE.BoxGeometry(), dummyMat2);
    const mockVrm2: any = {
      scene: new THREE.Group(),
    };
    mockVrm2.scene.add(dummyMesh2);

    const mockParser2: any = {
      json: {
        materials: [{ name: 'Face_Material', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
      },
      associations: new Map([[dummyMat2, { materials: 0 }]]),
    };

    // Model 2 deduplication: reuses tex1 from pool, disposes duplicate tex2
    const stats2 = pool.deduplicateModel(mockVrm2, mockParser2, hashes);
    expect(stats2.sharedCount).toBe(1);
    expect(stats2.uniqueCount).toBe(0);
    expect(dummyMat2.map).toBe(tex1); // Pointing to existing GPU texture!
    expect(tex2Dispose).toHaveBeenCalledTimes(1); // Duplicate cleaned up

    // Model 1 releases tex1 (e.g. during outfit swap)
    const released1 = pool.releaseTexture(tex1);
    expect(released1).toBe(false); // Kept alive because Model 2 is still using it!
    expect(tex1Dispose).not.toHaveBeenCalled();

    // Model 2 releases tex1
    const released2 = pool.releaseTexture(tex1);
    expect(released2).toBe(true); // Now refCount reached 0, so it's disposed
    expect(tex1Dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().poolSize).toBe(0);
  });
});
