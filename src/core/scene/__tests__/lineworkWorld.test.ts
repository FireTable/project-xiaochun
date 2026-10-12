import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LineworkWorld } from '../lineworkWorld';

describe('LineworkWorld', () => {
  it('lazily builds when activated and populates geometries into rootGroup', () => {
    const scene = new THREE.Scene();
    const lineworkWorld = new LineworkWorld();

    expect(lineworkWorld.built).toBe(false);

    // 挂载
    lineworkWorld.attach(scene);
    expect(scene.children.includes(lineworkWorld.rootGroup)).toBe(true);

    // 激活浅色线稿世界
    lineworkWorld.setActive(true, scene);
    expect(lineworkWorld.built).toBe(true);
    expect(lineworkWorld.rootGroup.visible).toBe(true);
    expect(lineworkWorld.rootGroup.children.length).toBeGreaterThan(0);

    // 切换到深色线稿世界
    lineworkWorld.setTheme('dark', scene);
    expect(lineworkWorld.currentTheme).toBe('dark');
    expect(scene.background).toBeInstanceOf(THREE.Color);

    // 取消激活
    lineworkWorld.setActive(false, scene);
    expect(lineworkWorld.rootGroup.visible).toBe(false);

    // 释放资源
    lineworkWorld.dispose(scene);
    expect(lineworkWorld.built).toBe(false);
  });
});
