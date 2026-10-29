import * as THREE from 'three';
import type { VRMTexturePool } from './texturePool';

export type DisposeTask = () => void;

/**
 * Staggered / Time-sliced WebGL Resource Disposer.
 *
 * Eliminates atomic swap frame drops:
 * Instead of synchronously calling .dispose() on 50+ WebGL buffers, textures,
 * and materials during the exact frame of model switching (which stalls the GPU
 * driver for 15-35ms), this disposer queues them and cleanly releases them
 * across subsequent idle / animation frames within a micro-budget (<= 2ms/frame).
 */
export class StaggeredDisposer {
  private queue: DisposeTask[] = [];
  private rafId: number | null = null;
  private isProcessing = false;
  private maxTimePerSliceMs = 2.0;

  /**
   * Enqueue an Object3D hierarchy (such as an old VRM scene) for staggered disposal.
   * Coordinates with VRMTexturePool to preserve shared textures while disposing unique ones.
   */
  public enqueueScene(root: THREE.Object3D | null | undefined, texturePool?: VRMTexturePool): void {
    if (!root) return;

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.geometry) {
          geometries.add(mesh.geometry);
        }

        const skinnedMesh = obj as THREE.SkinnedMesh;
        if (skinnedMesh.skeleton) {
          skeletons.add(skinnedMesh.skeleton);
        }

        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (!m) continue;
            materials.add(m);

            // Collect all textures on the material
            for (const key of Object.keys(m)) {
              const val = (m as any)[key];
              if (val && (val as any).isTexture) {
                textures.add(val as THREE.Texture);
              }
            }

            // Also check shader material uniforms if present
            const uniforms = (m as any).uniforms;
            if (uniforms) {
              for (const uKey of Object.keys(uniforms)) {
                const uVal = uniforms[uKey]?.value;
                if (uVal && (uVal as any).isTexture) {
                  textures.add(uVal as THREE.Texture);
                }
              }
            }
          }
        }
      }
    });

    // 1. Textures: release through TexturePool (preserves shared, frees unique)
    for (const tex of textures) {
      this.queue.push(() => {
        if (texturePool) {
          texturePool.releaseTexture(tex);
        } else {
          try {
            tex.dispose();
          } catch {
            /* ignore */
          }
        }
      });
    }

    // 2. Materials
    for (const mat of materials) {
      this.queue.push(() => {
        try {
          mat.dispose();
        } catch {
          /* ignore */
        }
      });
    }

    // 3. Geometries
    for (const geom of geometries) {
      this.queue.push(() => {
        try {
          geom.dispose();
        } catch {
          /* ignore */
        }
      });
    }

    // 4. Skeletons
    for (const skel of skeletons) {
      this.queue.push(() => {
        try {
          skel.dispose();
        } catch {
          /* ignore */
        }
      });
    }

    this.scheduleNextSlice();
  }

  /**
   * Schedule the next slice via requestIdleCallback or requestAnimationFrame.
   */
  private scheduleNextSlice(): void {
    if (this.isProcessing || this.queue.length === 0) return;

    if (typeof window === 'undefined') {
      // In headless / SSR / Node test environment, drain synchronously
      this.flush();
      return;
    }

    this.isProcessing = true;

    const runSlice = () => {
      this.rafId = null;
      const start = performance.now();

      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (task) {
          try {
            task();
          } catch (e) {
            console.warn('[StaggeredDisposer] Task execution error:', e);
          }
        }

        // Check time budget
        if (performance.now() - start >= this.maxTimePerSliceMs) {
          break;
        }
      }

      this.isProcessing = false;

      if (this.queue.length > 0) {
        this.scheduleNextSlice();
      }
    };

    if (typeof (window as any).requestIdleCallback === 'function') {
      this.rafId = (window as any).requestIdleCallback(runSlice, { timeout: 100 });
    } else {
      this.rafId = window.requestAnimationFrame(runSlice);
    }
  }

  /**
   * Flush all remaining tasks synchronously (e.g. on engine teardown or scene reset).
   */
  public flush(): void {
    this.cancelScheduled();
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          task();
        } catch (e) {
          console.warn('[StaggeredDisposer] Flush error:', e);
        }
      }
    }
    this.isProcessing = false;
  }

  private cancelScheduled(): void {
    if (this.rafId !== null && typeof window !== 'undefined') {
      if (typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(this.rafId);
      } else {
        window.cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
  }

  /**
   * Pending task count.
   */
  public get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Cancel and flush on destroy.
   */
  public dispose(): void {
    this.flush();
  }
}
