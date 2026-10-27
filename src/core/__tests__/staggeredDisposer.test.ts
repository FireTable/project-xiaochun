import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { StaggeredDisposer } from '../staggeredDisposer';
import { VRMTexturePool } from '../texturePool';

describe('StaggeredDisposer', () => {
  it('collects and disposes geometries, materials, and textures', () => {
    const disposer = new StaggeredDisposer();
    const group = new THREE.Group();

    const geomDispose = vi.fn();
    const matDispose = vi.fn();
    const texDispose = vi.fn();

    const geom = new THREE.BoxGeometry();
    geom.dispose = geomDispose;

    const tex = new THREE.Texture();
    tex.dispose = texDispose;

    const mat = new THREE.MeshBasicMaterial();
    mat.map = tex;
    mat.dispose = matDispose;

    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);

    disposer.enqueueScene(group);
    // In node test environment, scheduleNextSlice flushes synchronously
    expect(geomDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(texDispose).toHaveBeenCalledTimes(1);
    expect(disposer.pendingCount).toBe(0);
  });

  it('respects VRMTexturePool when disposing textures', () => {
    const disposer = new StaggeredDisposer();
    const pool = new VRMTexturePool();
    const group = new THREE.Group();

    const sharedTexDispose = vi.fn();
    const uniqueTexDispose = vi.fn();

    const sharedTex = new THREE.Texture();
    sharedTex.dispose = sharedTexDispose;

    const uniqueTex = new THREE.Texture();
    uniqueTex.dispose = uniqueTexDispose;

    // Simulate shared texture registered with refCount = 2
    const dummyMat: any = { map: sharedTex };
    const mockVrm: any = { scene: new THREE.Group() };
    const mockMesh = new THREE.Mesh(new THREE.BoxGeometry(), dummyMat as any);
    mockVrm.scene.add(mockMesh);
    const mockParser: any = {
      json: {
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
      },
      associations: new Map([[dummyMat, { materials: 0 }]]),
    };
    pool.deduplicateModel(mockVrm, mockParser, new Map([[0, 'hash_shared']]));

    // Model 2 also uses hash_shared
    const dummyMat2: any = new THREE.MeshBasicMaterial();
    dummyMat2.map = new THREE.Texture();
    const mockVrm2: any = { scene: new THREE.Group() };
    const mockMesh2 = new THREE.Mesh(new THREE.BoxGeometry(), dummyMat2 as any);
    mockVrm2.scene.add(mockMesh2);
    const mockParser2: any = {
      json: {
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }],
      },
      associations: new Map([[dummyMat2, { materials: 0 }]]),
    };
    pool.deduplicateModel(mockVrm2, mockParser2, new Map([[0, 'hash_shared']]));

    // Group with sharedTex and uniqueTex
    const mat1 = new THREE.MeshBasicMaterial();
    mat1.map = sharedTex;
    const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(), mat1);

    const mat2 = new THREE.MeshBasicMaterial();
    mat2.map = uniqueTex;
    const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(), mat2);

    group.add(mesh1);
    group.add(mesh2);

    disposer.enqueueScene(group, pool);

    // uniqueTex should be disposed
    expect(uniqueTexDispose).toHaveBeenCalledTimes(1);
    // sharedTex should NOT be disposed because mockVrm2 is still holding a reference!
    expect(sharedTexDispose).not.toHaveBeenCalled();
  });
});
