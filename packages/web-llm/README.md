# `@firetable/web-llm`

Project XiaoChun's workspace fork of [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) (`v0.2.88`, commit `e56c954a187590c404fc19dcf9942df4f002f661`), licensed under **Apache-2.0** (see [`LICENSE`](./LICENSE)).

## Enhancements Over Upstream `0.2.88`

1. **Roofline-Preserving Interactive Prefill Slicing (`interactivePrefillChunkSize`: `128` desktop / `64` mobile)**: Slices foreground prompt prefill (text + multimodal embeddings) into 64/128-token chunks while preserving the compiled `prefill_chunk_size` (`2048`) for KV-cache allocation and relying on `@firetable/web-runtime`'s intra-forward `maxDispatchesPerEncoder` splitting so long-context TTFT stays fast without starving 60 FPS WebGL2 rendering.
2. **Inter-Stage, Prefill & Cumulative-Budget Decode Yielding**: Inserts cooperative `device.sync()` + macrotask yields right after ViT vision encoding (`getArtifactImageEmbeddings` / `getImageEmbeddings`), between prefill slices (immediately disposing intermediate `chunkLogits` and consumed adapter tensors), and whenever cumulative decode GPU time (`decodeSliceAccumMs`) reaches the slice budget, plus `tvm.beginBulkAllocation()` around `LLMChatPipeline` KV-cache construction.
3. **Worker `xcSetFramePacing` Extension & Preset Re-Exports**: Re-exports `setWebGPUFramePacing`, `getWebGPUFramePacing`, `DESKTOP_WEBGPU_FRAME_PACING`, `MOBILE_WEBGPU_FRAME_PACING`, and `WebGPUFramePacingOptions` from `@firetable/web-runtime` and handles `xcSetFramePacing` in `WebWorkerMLCEngineHandler` so the main thread can switch between `desktop`, `mobile`, and background `off` modes dynamically.
