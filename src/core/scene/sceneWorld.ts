import type * as THREE from 'three';

/**
 * 统一 3D 场景世界接口
 * 所有具体世界（LineworkWorld, Beach3DWorld, VoidWorld）均遵循此生命周期
 */
export interface ISceneWorld {
  /** 世界唯一标识符 */
  readonly id: string;
  /** 挂载到主 Three.js 场景 */
  attach(scene: THREE.Scene): void;
  /** 激活 / 隐藏当前世界（管理 Mesh 显隐与背景） */
  setActive(active: boolean, scene?: THREE.Scene): void;
  /** 每帧动画与物理积分更新 */
  update(delta: number, time: number, camera?: THREE.Camera, renderer?: THREE.WebGLRenderer): void;
  /** 资源销毁与场景卸载 */
  dispose(scene?: THREE.Scene): void;
}
