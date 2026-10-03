# 性能与体积优化笔记（v0.1.14）

> 本页汇总 v0.1.14 这一轮对「小蠢」(Project XiaoChun) 的**加载体积 / 首次加载 / 推理速度**优化：做了什么、实测数据、没采用的方案、以及**还没测的东西**。
> 原则：**数字只写实测过的**；没测的明确标「未实测」；模型质量只有 logits 层面指标，没有系统的主观评审。
> 细节入口：[`EMAGE_MODEL.md`](EMAGE_MODEL.md)（线上现状与限制）· [`packages/emage-onnx`](../packages/emage-onnx/README-CN.md)（离线工具链、完整数据与复现命令）· [`EMBED.md`](EMBED.md)（iframe / SDK / 响应头）。

## 0. 一页总览

| 项目 | 之前 | 现在 | 备注 |
| :-- | :-- | :-- | :-- |
| EMAGE `emage_step` 单文件 | 175.00 MB | **66.55 MB** | INT8，去 face 分支、Conv 权重 INT8、去 cross-attn 第 0..3 层、离线图优化 |
| EMAGE 总下载（5 个文件） | 191.35 MB | **71.59 MB**（−62.6%） | 逐文件 `brotli -q9` 合计 161.28 → **57.72 MB** |
| step 单窗推理（Node wasm，1 线程） | 548 ms | **274 ms** | 4 线程 165 → **79 ms**；仅 Node，见 §1.3 |
| step 建会话（Node，1 线程） | 926 ms | **80 ms** | 浏览器内：离线优化前后 196 → 66 ms（headless Chrome，4 线程） |
| 主 bundle 里的 `vrmEngine` chunk | 6,951,996 B | **1,012,057 B** | web-llm 拆成按需加载的 `lib-*.js`（6,028,572 B）；`/embed` 默认路径不再请求它 |
| EMAGE 模型下载方式 | 逐个下载 | **并行下载 + 流水线建会话** | 慢网下 speak 额外耗时 12.4 → 9.4 s（模拟），见 §3 |
| iframe 内 EMAGE 线程数 | 1（默认） | 宿主隔离并开启 SDK 选项后 **8**（上限） | 默认关闭；需宿主 COOP/COEP，见 §4 |

> 所有「Node」数据来自 ort-web wasm（Node 环境，非浏览器），**只适合看相对值**。浏览器、手机、Safari、Firefox 上的绝对延迟**未实测**。

---

## 1. EMAGE 模型瘦身（不重训）

完整流水线、每一步的体积/延迟/质量表和复现脚本在 [`packages/emage-onnx/README-CN.md`](../packages/emage-onnx/README-CN.md)。这里只摘要。

### 1.1 做了什么

1. **精简 step（仅 `cls_*`）**：去掉 face 分支（应用里 `vqFace` 本来就关着）和图内的 `argmax → VQ 解码 → 6D → 轴角 → 55 关节` 链。`seed`（下一窗前 4 帧）改为在 JS 里重建（[`emageSeed.ts`](../src/motion/sources/emageSeed.ts)，用 `vq_*_idx` + `postprocess`，jaw 6D 固定为单位旋转），每窗多约 **18 ms**（单线程）。191.35 → 127.21 MB。
2. **剩余 Conv 权重量化为 INT8**（逐输出通道，仅权重；`DequantizeLinear` 在建会话时折叠，所以只缩小下载，不改变延迟和内存）。→ 100.67 MB。
3. **去掉 cross-attention 第 0..3 层并离线优化**（不重训）：8 层 cross-attn 占 step 权重 60%，在这份权重上前 4 层近似恒等（去掉后 logits relL2 0.05%，argmax 一致率 99.6%）；再用 python onnxruntime 离线做 `ORT_ENABLE_EXTENDED` 优化，只保留所有 ORT wasm 构建都带的 CPU 融合算子。→ **71.59 MB**。
   - 层号由消融实验得出，**换权重必须重做**；前 4 层近似恒等的机制未验证。

### 1.2 体积（MB = 1e6 字节）

| 方案 | step | 合计 | brotli -q9 合计 |
| :-- | --: | --: | --: |
| 之前的 INT8 | 175.00 | 191.35 | 161.28 |
| 步骤 1（瘦 step） | 110.86 | 127.21 | 107.60 |
| 步骤 1+2（+ Conv INT8） | 95.43 | 100.67 | 82.83 |
| **步骤 3（+ 去层 + 离线优化，线上在用）** | **66.55** | **71.59** | **57.72** |

文件名没变（仍是 `emage_step_int8.onnx`、`vq_{upper,hands,lower}_idx_int8.onnx`、`postprocess_int8.onnx`），`config.ts` 里 `useInt8 = true` 时请求的就是这几个。

### 1.3 速度

Node + onnxruntime-web wasm（`ort-web 1.29.0`，64 帧窗口，预热后 10 窗中位数）：

| step | 1 线程 | 4 线程 | 8 线程 | 建会话（1 线程） |
| :-- | --: | --: | --: | --: |
| 之前的完整 INT8 step | 578 ms（另一次 548） | 163 ms（另一次 165） | 99 ms | 926 ms |
| 步骤 3 最终 | **274 ms** | **79 ms** | 48 ms | **80 ms** |

- 浏览器（同一台 Mac 的 headless Chrome 154，跨源隔离，4 线程）：离线优化让 step 建会话 **196 → 66 ms**（钉死的 1.22.0-dev：164 → 50 ms），单窗约 78 ms；优化前后输出**逐位一致**（最大绝对差 0）。离线优化**不改变单窗延迟**，只缩短建会话。
- 浏览器数据来自一台 Apple M1 Ultra 上的 headless Chrome 154；其他 CPU、内存紧张的设备、手机**未实测**。

### 1.4 质量（只有 logits / argmax 层面）

| 对照 | 指标 | 结果 |
| :-- | :-- | :-- |
| 对 FP32 瘦模型真值（42 窗，python ORT） | relL2 / top-1 | 1.27% / **约 92.5%** |
| 对之前的 INT8 基线，teacher forcing（72 窗） | argmax 一致率 upper / hands / lower | 93.8 / 92.1 / 93.3% |
| 对之前的 INT8 基线，自由运行 | argmax 一致率 upper / hands / lower | **90.1 / 86.5 / 90.6%** |
| 噪声下限（FP32 自由运行对 INT8 自由运行） | 同上 | 89.8 / 88.2 / 92.2% |

- 解读：自由运行一致率落在「INT8 对 FP32 的噪声下限」附近（hands 比下限低约 1.7 个百分点）；**一致率不等于动作看起来一样**。应用里 upper/hands 还做 top-6、温度 0.85 采样。
- **用户本地回归：肉眼未见退化**（手动验收，非自动化指标）。
- 验证集：7 条音频（中英文 TTS、三段音乐/语音截取、demo、bench 基准音频）共 72 个窗口。

**未实测 / 未覆盖**：手机、Safari、Firefox；数分钟的长会话；其他说话人；唱歌；静音；top-k 采样下的统计；系统的视觉/主观评审。

### 1.5 新 CDN 路径与缓存

- 模型现在从 **`https://cdn.firetable.tech/xiaochun/emage/`** 加载（`APP_CONFIG.emage.base` 的生产默认值；可用 `VITE_EMAGE_BASE_PROD` 覆盖——**注意：构建环境里若设了它，会覆盖新默认值**）。
- Cache Storage 桶名升为 **`emage-models-v2`**：新旧集合文件名相同、缓存按 URL 命中，不换桶名会混用旧文件。新模型成功加载后，`emageWorker.ts` 的 `purgeOldModelCaches()` 会自动删除其他 `emage-models-*` 桶（旧 v1 桶约 190 MB）。
- `https://cdn.firetable.tech/xiaochun/` 下的旧文件原样保留，旧版本应用不受影响。

### 1.6 Cloudflare 传输压缩（实测）

对 CDN 上的 `emage_step_int8.onnx`（66,550,463 B）用不同 `Accept-Encoding` 请求，记录实际传输字节（2026-10-03，一次测量，本机网络）：

| Accept-Encoding | 响应 `content-encoding` | 传输字节 | 相对原文件 |
| :-- | :-- | --: | --: |
| identity | — | 66,550,463 | 100% |
| gzip | gzip | 54,112,594 | 81.3% |
| br | br | 53,507,704 | 80.4% |
| zstd | zstd | 53,828,638 | 80.9% |
| zstd, br, gzip | zstd（服务端优先选 zstd） | 53,831,000 | 80.9% |

- 发现：模型文件在边缘就会被即时压缩（现代浏览器通常拿到 zstd 或 br），**但只压到约 80%**；所以**离线瘦身（−62.6%）才是主要收益**，传输压缩是叠加的小头。
- 上表的「离线 brotli -q9」57.72 MB 是整套 5 个文件的合计，**不等于线上传输量**——线上由 Cloudflare 即时压缩，档位未知，另外 5 个文件里只量过 step 一个，**其余四个文件的线上传输量未实测**。

---

## 2. web-llm 按需加载

**问题**：`@mlc-ai/web-llm`（约 6 MB）被 `webLLMProvider.ts` 静态引入，打进了主站与 `/embed` 共用的 `vrmEngine` chunk，导致 `/embed` 即使只朗读也要下载整个 LLM 库。

**做法**：库本身改为 `import('@mlc-ai/web-llm')` 动态加载（只留类型引用），在**第一次真正用到 LLM** 时才取：

- 主站：`ChatBar` 挂载后台加载（模型列表需要它）；
- `/embed`：只有 `xc.say` 的 chat 模式、`heavy: 'eager'` 预热，或 `ui=1` 且打开模型选单时才加载；
- 库未加载时，模型 id 校验对已存储的 id 取「信任」，`getWebLLMEngine` 加载库后再严格校验。

**实测（构建产物，字节）**：

| chunk | 之前 | 现在 |
| :-- | --: | --: |
| `vrmEngine` | 6,951,996（gzip 2,416,814 / br 1,622,728） | **1,012,057**（gzip 292,056 / br 233,548） |
| `lib-*`（web-llm，新增，按需） | — | 6,028,572（gzip 2,145,169 / br 1,408,854） |
| `llmWorker`（本来就是按需） | 6,016,641 | 6,016,641（不变） |

- `/embed` 的 `index.html` 依赖列表里没有 `lib-*`；用 headless Chrome 打开 `/embed`、`speakAudio` 一次，请求里只有 `vrmEngine`，**没有 `lib-*` 和 `llmWorker`**，EMAGE 5 个模型加载并生成了动作。
- 主站 `/` 会请求 `lib-*`。
- **未实测**：加载库之后真正拉起 WebLLM 引擎并对话的完整路径（headless 环境没有 WebGPU，改动前后主站都没请求 `llmWorker`）；`xc.say` chat 模式的端到端；移动端。

---

## 3. EMAGE 模型并行下载

`emageWorker.ts` 的 `ensureLoaded`：之前对每个启用的模型串行「下载 → `InferenceSession.create`」；现在**并行下载全部模型**（缓存逻辑不变），哪个先下完就把它的 `create` 排入队列。

- **`create` 仍然串行**：单线程 wasm 下 `create` 本来就无法真并行，串行也避开 ort-web 共享初始化的并发风险。所以只是「并行下载 + 下载与 create 流水线」。
- 进度通过 `onStatus` 上报（`并行下载 N 个模型… / [k/N] 已下载 … / [k/N] 已加载 …`）。

**实测**（headless Chrome → SDK iframe → `speakAudio`，每组冷缓存 3 轮取中位数；5 个模型全部加载成功并生成动作）：

| 网络条件 | 下载完成耗时（之前 → 现在） | speak 额外耗时（之前 → 现在） |
| :-- | --: | --: |
| 本机，不限速 | 约 1.65 s → 约 0.05 s | 约 2.7 s → 约 2.5 s |
| **模拟** 8 MB/s、延迟 60 ms | 11.5 s → 8.8 s | 12.4 s → 9.4 s |
| **模拟** 2 MB/s、延迟 100 ms | 39.9 s → 34.9 s | 40.9 s → 35.7 s |

- 「下载完成耗时」= 服务端记录的首个到最后一个 `.onnx` 请求的时间跨度；「speak 额外耗时」= 从调用 `speakAudio` 到结束减去 2.5 s 音频时长，**包含加载 + 首窗推理**，不是纯加载时间。
- **重要口径**：限速是我在本地测试服务器上**对每个连接单独限速**的模拟，并行后聚合带宽被放大。真实网络是共享带宽时，并行的收益会**小于**上表（主要来自重叠延迟和与 create 的流水线）；而 step 单文件 66.55 MB 本身就是瓶颈（8 MB/s 时仅 step 就要约 8.3 s）。表里 8.8 s 基本就是这个下界。
- 本地不限速时整体只快约 0.2 s，因为下载本来就不是瓶颈，`create` 才是。
- 真实 CDN、真实带宽、手机：**未实测**。

---

## 4. SDK：可选 `crossOriginIsolated`（EMAGE 多线程）

默认情况下 iframe 内 `crossOriginIsolated === false`，onnxruntime-web 退回**单线程** wasm。想要多线程需要三层同时满足：

1. 宿主页自己跨源隔离：`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless`（或 `require-corp`）；
2. `/embed` 自己也带 COEP：已发 `COEP: credentialless` + `CORP: cross-origin`（`securityHeaders.ts` 与 `public/_headers` 一致，无需改）；
3. 宿主给 iframe 的 `allow` 追加 `cross-origin-isolated`——SDK 新增**默认关闭**的选项：`createXiaochun({ crossOriginIsolated: true })` / React `<Xiaochun crossOriginIsolated />` / `<xiaochun-avatar cross-origin-isolated>`。**默认 `allow` 仍是 `'microphone; autoplay'`，不改变现有行为。**

**实测**（headless Chrome，宿主与 embed 为不同站点；embed 头按 `securityHeaders.ts` 的值手工配置，不是线上部署）：

| 宿主 | 选项 | `xc.ready` 的 `capabilities.crossOriginIsolated` | EMAGE `numThreads` |
| :-- | :-- | :-- | --: |
| 普通 | 关 | false | 1 |
| 隔离（COEP `credentialless`） | 关 | false | 1 |
| 隔离（COEP `credentialless`） | **开** | **true** | **8**（桌面上限；机器 `hardwareConcurrency` 为 20） |
| 隔离（COEP `require-corp`） | **开** | **true** | **8** |
| 普通 | 开 | false | 1 |

- 线程收益参考 §1.3 的 Node 数据：同一推理 1 线程 274 ms → 4 线程 79 ms → 8 线程 48 ms；**浏览器里 1 线程对 8 线程的实际耗时未实测**。
- 协议新增了一个可选的诊断字段 `xc.ready.capabilities.crossOriginIsolated`（旧版 /embed 没有；加性字段，协议版本不变）。
- **副作用（隔离的是宿主页）**：宿主页上所有跨源子资源要满足 COEP（`credentialless` 下 no-cors 请求不带凭据；`require-corp` 下需要 CORP/CORS）；宿主页里其他第三方 iframe 也要带 COEP，否则被拦；`COOP: same-origin` 会切断 `window.opener`（OAuth/支付弹窗回传可能失效）；Safari 不支持 `credentialless`，需用 `require-corp`。未隔离的宿主开选项无害（浏览器忽略）。
- 详见 [`EMBED.md` §3.1](EMBED.md#31-可选跨源隔离让-emage-用多线程-wasm) 和 [SDK README](../packages/project-xiaochun/README-CN.md)。

---

## 5. 试过但没采用的方案

结论来自 [`packages/emage-onnx`](../packages/emage-onnx/README-CN.md) 的实验记录（作者本地 `out/research/NOTES.md` 不随仓库发布，所以这里的数字是 README 里写明的那些）：

| 方案 | 结果 | 为什么没采用 |
| :-- | :-- | :-- |
| 带校准的**静态量化** | 更差，且不更快 | 精度和速度都没有收益 |
| ORT 自带 **GPTQ** | 比 RTN 还差 | 质量不达标 |
| **4-bit `MatMulNBits`** | 更小，但 wasm 里**更慢**；对 FP32 top-1 约 78%–86%（README 另一处写朴素 RTN 约 70%–85%） | 慢且质量掉得多；要上线需要 AWQ/GPTQ 类带校准的方法 |
| **SVD 低秩 / FFN·注意力头剪枝**（不微调） | 被否决（README 只记录了结论，无具体数据） | 不微调的方案不达标 |
| 权重重排 / 去重 | 被否决（README 只记录了结论，无具体数据） | — |
| 用 JS 替换 `postprocess` | 压缩后只省约 0.05 MB | 不值得 |
| `quantize_dynamic(["Conv"])`（`ConvInteger`） | −15.3 MB，但对 FP32 relL2 1.96%、top-1 87.7%，延迟 417 ms 对 365 ms | 质量和延迟都更差；脚本保留 `--mode convinteger` 作对比 |
| **`.ort` 格式** | 浏览器里建会话 59 对 66 ms，没有实质收益；体积略大（step +0.28 MB，`postprocess` 1.18 对 0.47 MB）；且与写出它的 ORT 版本绑定 | 收益不足，且版本耦合 |
| **WebGPU 跑 EMAGE** | 旁路实验 FP32/FP16 step 在同一台 Mac 的 headless Chrome WebGPU 上单窗约 21–28 ms，但要 130–263 MB 权重，且只在一块 GPU 上测过；模型含 `int64`（`speaker_id`、VQ `indices`），ORT WebGPU 的 int64 支持不完整 | 体积反而更大，兼容性风险高；EMAGE 继续用 wasm + INT8，WebGPU 只留给 LLM（见 [`EMAGE_MODEL.md` §2](EMAGE_MODEL.md#2-why-emage-stays-on-wasm-e3--closed)） |
| **蒸馏 / 重训**（把 step 压到约 20 MB） | **只做了评估，没有实施，没有任何实测数据** | README 的判断是要到约 20 MB 需要蒸馏/重训；成本和风险未评估，暂不做 |

---

## 6. 还没测 / 需要确认的事

- 真实网络下的首次加载总时间（只有模拟限速）、手机端首次加载；
- Safari / Firefox / 手机上的 EMAGE 推理与加载（含 `crossOriginIsolated` 选项）；
- 数分钟长会话、其他说话人、唱歌、静音、top-k 采样下的质量；
- 浏览器里 1 线程 vs 8 线程的真实推理耗时；
- 线上 Cloudflare 构建环境是否设置了 `VITE_EMAGE_BASE_PROD`（设了会覆盖新的 CDN 默认值，需要在控制台核对）；
- web-llm 动态加载后，主站上 WebGPU 设备的完整对话路径。
