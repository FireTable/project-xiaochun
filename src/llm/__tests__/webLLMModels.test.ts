import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSlicedGrid } from '@mlc-ai/web-llm';
import { APP_CONFIG } from '@/config';
import {
  CUSTOM_WEBLLM_MODELS,
  DEFAULT_LLM_MODEL,
  FALLBACK_LLM_MODEL,
  VISION_LLM_MODEL,
  isVisionModelId,
  listModelGroups,
} from '../webLLMProvider';

describe('CUSTOM_WEBLLM_MODELS & MiniCPM-V-4.7-1B integration', () => {
  it('registers MiniCPM-V-4.7-1B-q4f16_1-MLC with built-in 4x (256-token) WebGPU runtime & manifest', () => {
    expect(VISION_LLM_MODEL).toBe('MiniCPM-V-4.7-1B-q4f16_1-MLC');
    expect(DEFAULT_LLM_MODEL).toBe(APP_CONFIG.llm.model);
    expect(FALLBACK_LLM_MODEL).toBe(APP_CONFIG.llm.fallback);

    const v47 = CUSTOM_WEBLLM_MODELS.find((m) => m.model_id === VISION_LLM_MODEL);
    expect(v47).toBeDefined();
    expect(v47?.model).toContain('/m070122/MiniCPM-V-4.7-1B-q4f16_1-MLC');
    expect(v47?.model_lib).toBe('/wasm/MiniCPM-V-4.7-1B-q4f16_1-4x-8378eafa-webgpu.wasm');
    expect(v47?.model_manifest).toBe('/wasm/MiniCPM-V-4.7-1B-q4f16_1-4x-8378eafa-manifest.json');
    expect(v47?.buffer_size_required_bytes).toBe(268435456);
    expect(v47?.required_features).toEqual(['shader-f16']);
    expect(v47?.overrides?.context_window_size).toBe(4096);

    const repoRoot = process.cwd();
    const wasmFile = path.join(repoRoot, 'public', v47!.model_lib);
    const manifestFile = path.join(repoRoot, 'public', v47!.model_manifest!);
    expect(fs.existsSync(wasmFile)).toBe(true);
    expect(fs.statSync(wasmFile).size).toBeGreaterThan(5_000_000);
    expect(fs.existsSync(manifestFile)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.schema).toBe('mlc.model-package');
    expect(manifest.schema_version).toBe(1);
    expect(manifest.interface_id).toBe(
      'sha256:8378eafa2c70ba731fc3faaa040dc511ce985b2271be97687bca3276d0280bc0',
    );
    expect(manifest.weights.parameter_schema_id).toBe(
      'sha256:35686906beb814c9b7214f8815b3d52fea6874636fd1a383139653b75d790fdb',
    );
    expect(manifest.tasks['chat.completions'].inputs.image.processor.num_embeddings).toBe(256);
  });

  it('bundles default MiniCPM5-2B-q4f16_1-MLC WebGPU WASM locally in public/wasm/', () => {
    const cpm5 = CUSTOM_WEBLLM_MODELS.find((m) => m.model_id === 'MiniCPM5-2B-q4f16_1-MLC');
    expect(cpm5).toBeDefined();
    expect(cpm5?.model).toContain('/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC');
    expect(cpm5?.model_lib).toBe('/wasm/MiniCPM5-2B-q4f16_1-MLC-webgpu.wasm');

    const wasmPath = path.join(process.cwd(), 'public', cpm5!.model_lib);
    expect(fs.existsSync(wasmPath)).toBe(true);
    const stat = fs.statSync(wasmPath);
    expect(stat.size).toBeGreaterThan(5_000_000);
    const fd = fs.openSync(wasmPath, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    expect(Array.from(magic)).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('computes aspect-preserving high-resolution slice grids for wide, tall, square, and HD images', () => {
    // Disabled slicing
    expect(computeSlicedGrid(1920, 1080, 0, 448)).toBeNull();
    expect(computeSlicedGrid(1920, 1080, 1, 448)).toBeNull();
    // Small / near-448 square images need no extra slices
    expect(computeSlicedGrid(448, 448, 6, 448)).toBeNull();
    expect(computeSlicedGrid(512, 512, 6, 448)).toBeNull();
    // Large square image -> 2x2
    expect(computeSlicedGrid(900, 900, 6, 448)).toEqual([2, 2]);
    // User screenshot (1024x503 ~ 2:1) -> 1x2 horizontal split
    expect(computeSlicedGrid(1024, 503, 6, 448)).toEqual([1, 2]);
    // Ultra-wide table (2200x550 = 4:1) -> 1x4 horizontal split
    expect(computeSlicedGrid(2200, 550, 6, 448)).toEqual([1, 4]);
    // Tall mobile long-screenshot (750x2250 = 1:3) -> 3x1 vertical split
    expect(computeSlicedGrid(750, 2250, 6, 448)).toEqual([3, 1]);
    // 1080p HD (1920x1080 = 16:9) -> 2x3 on desktop (maxSlices=6), 1x2 on mobile (maxSlices=2)
    expect(computeSlicedGrid(1920, 1080, 6, 448)).toEqual([2, 3]);
    expect(computeSlicedGrid(1920, 1080, 2, 448)).toEqual([1, 2]);
  });

  it('surfaces both MiniCPM-V-4.7-1B and MiniCPM5-2B under the MiniCPM group', () => {
    const groups = listModelGroups();
    const minicpmGroup = groups.find((g) => g.provider === 'MiniCPM');
    expect(minicpmGroup).toBeDefined();
    const ids = minicpmGroup!.models.map((m) => m.id);
    expect(ids).toContain('MiniCPM-V-4.7-1B-q4f16_1-MLC');
    expect(ids).toContain('MiniCPM5-2B-q4f16_1-MLC');
  });

  it('distinguishes multimodal vision model IDs from text-only model IDs across WebLLM and Custom APIs', () => {
    // WebLLM on-device models
    expect(isVisionModelId('MiniCPM-V-4.7-1B-q4f16_1-MLC')).toBe(true);
    expect(isVisionModelId('Phi-3.5-vision-instruct-q4f16_1-MLC')).toBe(true);
    expect(isVisionModelId('MiniCPM5-2B-q4f16_1-MLC')).toBe(false);
    expect(isVisionModelId('Qwen2.5-0.5B-Instruct-q4f16_1-MLC')).toBe(false);
    expect(isVisionModelId('Llama-3.2-3B-Instruct-q4f16_1-MLC')).toBe(false);
    expect(isVisionModelId('gemma-2-2b-it-q4f16_1-MLC')).toBe(false);

    // Custom OpenAI-compatible HTTP models
    expect(isVisionModelId('gpt-4o')).toBe(true);
    expect(isVisionModelId('gpt-4.1-mini')).toBe(true);
    expect(isVisionModelId('o1')).toBe(true);
    expect(isVisionModelId('o3')).toBe(true);
    expect(isVisionModelId('o4-mini')).toBe(true);
    expect(isVisionModelId('o1-mini')).toBe(false);
    expect(isVisionModelId('o1-preview')).toBe(false);
    expect(isVisionModelId('o3-mini')).toBe(false);
    expect(isVisionModelId('claude-sonnet-4-5')).toBe(true);
    expect(isVisionModelId('gemini-2.5-flash')).toBe(true);
    expect(isVisionModelId('gemma-3-4b-it')).toBe(true);
    expect(isVisionModelId('pixtral-12b')).toBe(true);
    expect(isVisionModelId('qwen2.5-vl-7b-instruct')).toBe(true);
    expect(isVisionModelId('glm-4.5v')).toBe(true);
    expect(isVisionModelId('deepseek-chat')).toBe(false);
    expect(isVisionModelId('deepseek-reasoner')).toBe(false);
    expect(isVisionModelId('qwen2.5:7b')).toBe(false);
    expect(isVisionModelId('   ')).toBe(false);
  });
});
