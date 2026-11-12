import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_WEBGPU_FRAME_PACING,
  MOBILE_WEBGPU_FRAME_PACING,
  getWebGPUFramePacing,
  setWebGPUFramePacing,
} from '@mlc-ai/web-llm';
import { Instance, WebGPUContext } from '@firetable/web-runtime';
import { resolveAdaptiveFramePacing } from '../webLLMProvider';

describe('WebGPU cooperative frame pacing (@firetable/web-runtime & @firetable/web-llm)', () => {
  it('exposes sanitized frame-pacing configuration and desktop/mobile presets', () => {
    const prev = { ...getWebGPUFramePacing() };
    try {
      const mobile = setWebGPUFramePacing({ preset: 'mobile' });
      expect(mobile).toEqual(MOBILE_WEBGPU_FRAME_PACING);
      expect(mobile.maxDispatchesPerEncoder).toBe(12);
      expect(mobile.uploadChunkBytes).toBe(2 * 1024 * 1024);
      expect(mobile.uploadSliceBytes).toBe(4 * 1024 * 1024);
      expect(mobile.interactivePrefillChunkSize).toBe(64);
      expect(mobile.maxParallelShardDownloads).toBe(2);

      const mobileHidden = setWebGPUFramePacing({ preset: 'mobile', enabled: false });
      expect(mobileHidden.enabled).toBe(false);
      expect(mobileHidden.maxDispatchesPerEncoder).toBe(12);

      const desktop = setWebGPUFramePacing({
        preset: 'desktop',
        maxDispatchesPerEncoder: 16,
        uploadChunkBytes: 4_194_307, // non-multiple of 4 -> floored to 4-byte boundary
      });
      expect(desktop.maxDispatchesPerEncoder).toBe(16);
      expect(desktop.uploadChunkBytes % 4).toBe(0);
      expect(desktop.interactivePrefillChunkSize).toBe(DESKTOP_WEBGPU_FRAME_PACING.interactivePrefillChunkSize);
    } finally {
      setWebGPUFramePacing(prev);
    }
  });

  it('selects mobile vs desktop pacing preset automatically from device tier and visibility', () => {
    expect(
      resolveAdaptiveFramePacing({
        hidden: false,
        profile: { tier: 'high', isMobile: true },
      }),
    ).toEqual({ preset: 'mobile', enabled: true });

    expect(
      resolveAdaptiveFramePacing({
        hidden: false,
        profile: { tier: 'low', isMobile: false },
      }),
    ).toEqual({ preset: 'mobile', enabled: true });

    expect(
      resolveAdaptiveFramePacing({
        hidden: false,
        profile: { tier: 'high', isMobile: false },
      }),
    ).toEqual({ preset: 'desktop', enabled: true });

    expect(
      resolveAdaptiveFramePacing({
        hidden: true,
        profile: { tier: 'high', isMobile: false },
      }),
    ).toEqual({ preset: 'desktop', enabled: false });

    expect(
      resolveAdaptiveFramePacing({
        hidden: false,
        profile: null,
        quickTier: 'low',
      }),
    ).toEqual({ preset: 'mobile', enabled: true });
  });

  it('shrinks and recovers upload slice size via closed-loop GPU sync latency feedback', async () => {
    let nowMs = 100;
    const perf = { now: () => nowMs };
    const pacing = {
      ...MOBILE_WEBGPU_FRAME_PACING,
      uploadYieldMs: 0,
      targetSliceMs: 6,
    };
    const state = {
      pendingSyncBytes: 4 * 1024 * 1024,
      sliceStart: 100,
      adaptiveSliceBytes: 4 * 1024 * 1024,
    };
    const slowDevice = {
      sync: vi.fn(async () => {
        nowMs += 18; // > 6 * 2ms budget -> halve slice
      }),
    };

    await (Instance.prototype as any).syncAndAdaptUploadSlice(slowDevice, perf, pacing, state);
    expect(state.adaptiveSliceBytes).toBe(2 * 1024 * 1024);
    expect(state.adaptiveSliceBytes % 4).toBe(0);

    // Second slow sync halves down to 1 MB floor
    state.sliceStart = nowMs;
    await (Instance.prototype as any).syncAndAdaptUploadSlice(slowDevice, perf, pacing, state);
    expect(state.adaptiveSliceBytes).toBe(1 * 1024 * 1024);

    // Fast sync (< 4.5ms) gently steps slice back up
    const fastDevice = {
      sync: vi.fn(async () => {
        nowMs += 1;
      }),
    };
    state.sliceStart = nowMs;
    await (Instance.prototype as any).syncAndAdaptUploadSlice(fastDevice, perf, pacing, state);
    expect(state.adaptiveSliceBytes).toBe(1280 * 1024);
  });

  it('auto-flushes pending GPUCommandEncoder at maxDispatchesPerEncoder and passes finfo.name to compilationHints', async () => {
    const g = globalThis as any;
    const prevBufferUsage = g.GPUBufferUsage;
    const prevShaderStage = g.GPUShaderStage;
    g.GPUBufferUsage = { STORAGE: 0x80, COPY_SRC: 0x04, COPY_DST: 0x08, UNIFORM: 0x40, MAP_READ: 0x01 };
    g.GPUShaderStage = { COMPUTE: 0x04 };
    const prev = { ...getWebGPUFramePacing() };
    const submitted: unknown[] = [];
    const shaderHints: unknown[] = [];

    const mockDevice = {
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({ id: 'pl' })),
      createShaderModule: vi.fn((desc: any) => {
        shaderHints.push(desc.compilationHints);
        return {};
      }),
      createComputePipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn((desc: { size: number }) => ({ size: desc.size, destroy: vi.fn() })),
      createCommandEncoder: vi.fn(() => ({
        beginComputePass: () => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn(),
          end: vi.fn(),
        }),
        finish: () => ({ cmd: true }),
      })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
      destroy: vi.fn(),
      queue: {
        writeBuffer: vi.fn(),
        submit: vi.fn((cmds: unknown[]) => submitted.push(...cmds)),
        onSubmittedWorkDone: vi.fn(async () => {}),
      },
    } as unknown as GPUDevice;

    try {
      setWebGPUFramePacing({ enabled: true, maxDispatchesPerEncoder: 3 });
      const ctx = new WebGPUContext({} as any, mockDevice);

      const alloc = ctx.getDeviceAPI('deviceAllocDataSpace');
      ctx.beginBulkAllocation();
      const ptrA = alloc(64);
      const ptrB = alloc(64);
      // Only 3 error scopes pushed once for the entire batch instead of 6
      expect(mockDevice.pushErrorScope).toHaveBeenCalledTimes(3);

      const kernel = ctx.createShader(
        {
          name: 'fused_matmul_kernel_entry',
          arg_types: ['handle', 'handle', 'int32'],
          launch_param_tags: ['paramWriteAccess:[0,1]', 'blockIdx.x'],
        },
        '@compute @workgroup_size(64) fn fused_matmul_kernel_entry() {}',
      );
      expect(shaderHints[0]).toEqual([{ entryPoint: 'fused_matmul_kernel_entry', layout: { id: 'pl' } }]);

      // 3 dispatches fit in encoder #1; 4th dispatch triggers auto-flush of encoder #1
      kernel(ptrA, ptrB, 8, 4);
      kernel(ptrA, ptrB, 8, 4);
      kernel(ptrA, ptrB, 8, 4);
      expect(submitted).toHaveLength(0);

      kernel(ptrA, ptrB, 8, 4);
      expect(submitted).toHaveLength(1);

      ctx.flushCommands();
      expect(submitted).toHaveLength(2);
      await ctx.endBulkAllocation();
      expect(mockDevice.popErrorScope).toHaveBeenCalledTimes(3);
    } finally {
      setWebGPUFramePacing(prev);
      g.GPUBufferUsage = prevBufferUsage;
      g.GPUShaderStage = prevShaderStage;
    }
  });

  it('prebuilds WGSL shaders across all loaded WebGPU sub-modules instead of stopping at sub-module 0', async () => {
    const prebuiltByModule = new Map<number, string[]>();
    const makeSubModule = (handle: number, shaderNames: string[]) => {
      prebuiltByModule.set(handle, []);
      const fmap = Object.fromEntries(
        shaderNames.map((name) => [
          name,
          { name, arg_types: ['handle'], launch_param_tags: ['paramWriteAccess:[0]', 'blockIdx.x'] },
        ]),
      );
      return {
        getHandle: () => handle,
        getFunction: (fnName: string) => {
          if (fnName === 'webgpu.get_fmap') {
            const fn: any = () => JSON.stringify(fmap);
            fn.dispose = vi.fn();
            return fn;
          }
          if (fnName === 'webgpu.get_shader') {
            const fn: any = (key: string) => `@compute @workgroup_size(1) fn ${key}() {}`;
            fn.dispose = vi.fn();
            return fn;
          }
          if (fnName === 'webgpu.update_prebuild') {
            const fn: any = (key: string) => {
              prebuiltByModule.get(handle)!.push(key);
            };
            fn.dispose = vi.fn();
            return fn;
          }
          throw new Error(`Unexpected function lookup: ${fnName}`);
        },
      };
    };

    const subMod0 = makeSubModule(101, ['gate_kernel', 'depthwise_conv1d_kernel']);
    const subMod1 = makeSubModule(202, ['fused_NT_matmul_0', 'siglip_vit_attn_0', 'rms_norm_0']);
    const fakeInstance: any = {
      lib: {
        webGPUContext: {
          createShaderAsync: vi.fn(async (finfo: { name: string }) => () => finfo.name),
          sync: vi.fn(async () => {}),
        },
      },
      loadedWebGPUModules: [subMod0, subMod1],
      initProgressCallback: [],
      beginScope: vi.fn(),
      endScope: vi.fn(),
      detachFromCurrentScope: <T>(x: T) => x,
    };

    await Instance.prototype.asyncLoadWebGPUPipelines.call(fakeInstance, subMod0 as any);

    expect(prebuiltByModule.get(101)).toEqual(['gate_kernel', 'depthwise_conv1d_kernel']);
    expect(prebuiltByModule.get(202)).toEqual(['fused_NT_matmul_0', 'siglip_vit_attn_0', 'rms_norm_0']);
    expect(fakeInstance.lib.webGPUContext.createShaderAsync).toHaveBeenCalledTimes(5);
  });
});
