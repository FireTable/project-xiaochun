# emage-onnx

为小蠢 (XiaoChun) 在浏览器里使用的 EMAGE ONNX 模型做**瘦身、量化、优化**的离线工具链,**不需要重训**:精简只输出 `cls` 的 step、INT8 的 MatMul 与 Conv 权重、去掉几乎无用的 cross-attention 层、离线 ORT 图优化。(原名 `emage-onnx-slim`,职责已不止瘦身。)
它是 **[VolgaGerm/emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export)** 的配套包(兄弟目录 `../emage-onnx-export`,README 中记载的 `export_onnx.py` + `--quantize` 流程仍是权威来源)。本包**不修改**该仓库,只**读取**它的 `onnx/*.onnx` 基线、`PantoMatrix` 的 git 历史(用来取出 `MODEL_COMMIT=0bbb03d` 的模型代码)以及 `demo.wav`;所有产物写入 `packages/emage-onnx/out/`(已 gitignore)。

English: [README.md](README.md)

## 结果(基于原始 HF 权重,本机实测)

下载集合 = 当前 `APP_CONFIG.emage.models` 启用的文件:step + `vq_upper_idx` + `vq_hands_idx` + `vq_lower_idx` + `postprocess`(`vqFace` / `vqGlobal` 已关闭)。MB = 1e6 字节。

| 方案 | step | vq_upper | vq_hands | vq_lower | postprocess | **合计** | 相对当前 INT8 | brotli -q9 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FP32 (emage-onnx-export) | 528.52 | 4.52 | 5.15 | 6.01 | 0.44 | 544.64 | | 502.82 |
| **INT8(当前,`--quantize`)** | 175.00 | 4.52 | 5.15 | 6.02 | 0.67 | **191.35** | 基线 | 161.28 |
| **步骤 1**:瘦 step(仅 `cls_*`)INT8 | 110.86 | 4.52 | 5.15 | 6.02 | 0.67 | **127.21** | -64.14 (-33.5%) | 107.60 |
| **步骤 1+2**:再把 Conv 权重改 INT8 | 95.43 | 1.34 | 1.50 | 1.72 | 0.67 | **100.67** | -90.68 (-47.4%) | 82.83 |
| **步骤 3**:再去掉 cross-attn 第 0..3 层 + 离线优化图(`out/final/`) | 66.55 | 1.34 | 1.50 | 1.72 | 0.47 | **71.59** | **-119.76 (-62.6%)** | **57.72** |

(中间产物:瘦 step 的 FP32 为 376.58 MB。brotli 为逐文件 `brotli -q 9`;175 MB 文件 q11 为 145.5 MB、q9 为 146.7 MB,差别很小。CDN 压缩与本包正交,叠加后线上传输约 83 MB。)

单窗延迟(onnxruntime-web wasm EP,**Node 环境而非浏览器**,64 帧窗口,预热后 10 窗中位数,只适合看相对值):

| step 模型 | 单线程 ort-web 1.29.0 | 单线程 钉死的 1.22.0-dev | 4 线程 1.29.0 | 4 线程 1.22.0-dev | 建会话耗时(单线程 1.29.0) |
|---|---:|---:|---:|---:|---:|
| 基线 `emage_step_int8`(完整) | 548 ms | 551 ms | 165 ms | 173 ms | 878 ms |
| 步骤 1 瘦 step INT8 | 363 ms | 371 ms | 104 ms | 110 ms | 209 ms |
| 步骤 1+2 瘦 step INT8 + Conv INT8 | 366 ms | 368 ms | 104 ms | 109 ms | 213 ms |

步骤 3 在同一次运行里的实测(Node,10 窗,中位数 ms;`create` = 建会话,单线程,ort-web 1.29.0):

| step 模型 | 1T 1.29.0 | 1T 1.22.0-dev | 4T 1.29.0 | 4T 1.22.0-dev | 8T 1.29.0 | create |
|---|---:|---:|---:|---:|---:|---:|
| 基线 `emage_step_int8`(完整) | 578 | 558 | 163 | 192 | 99 | 926 ms |
| 步骤 1+2 | 370 | 380 | 108 | 115 | 62 | 231 ms |
| 步骤 3,去层,未优化 | 276 | 280 | 80 | 85 | 44 | 180 ms |
| **步骤 3 最终**(`out/final/emage_step_int8.onnx`) | **274** | **286** | **79** | **87** | **48** | **80 ms** |

真实浏览器(同一台 Mac 上的 headless Chrome 154,跨源隔离,4 线程,像 `emageWorker.ts` 一样以 ArrayBuffer 加载,`js/browser_check.mjs`):离线优化后 step 建会话 196 -> 66 ms(ort-web 1.29.0)和 164 -> 50 ms(钉死的 1.22.0-dev),单窗 78 ms / 83 ms;`postprocess` 建会话 566 -> 444 ms 与 423 -> 310 ms(它现在是最慢的会话:图有 5104 个节点)。浏览器里优化后的文件输出与未优化的**逐位一致**(step 的 `cls_*`、`vq_*`、`postprocess` 最大绝对差 0)。离线优化不改变单窗延迟,只缩短建会话。

worker 里为主机侧 seed 每窗多出的计算:`vq_* x3 + postprocess`(64 帧)约 18 ms(单线程)。步骤 2 不改变延迟和内存:ORT 在建会话时会把 `DequantizeLinear` 常量折叠,只缩小**下载**体积。

## 流水线

```
HF 权重 (H-Liu1997/emage_audio, 本机 HF 缓存)  +  PantoMatrix@0bbb03d (git archive, 只读)
        |
        v   export_slim_step.py   (wrapper = EmageAudioModel.forward 的 body 部分逐行拷贝)
 emage_step_slim.onnx (FP32, 输出 cls_upper/cls_hands/cls_lower)              376.58 MB
        |  quantize_dynamic(QInt8, op_types_to_quantize=["MatMul"])   <- 与 README 的 --quantize 调用完全一致
        v
 emage_step_slim_int8.onnx                                                    110.86 MB   (步骤 1)
        |  quantize_conv_int8.py   (逐输出通道 int8 Conv 权重 + DequantizeLinear)
        v
 emage_step_slim_int8_convq.onnx  95.43 MB   + vq_{upper,hands,lower}_idx_int8_convq.onnx 1.34/1.50/1.72 MB   (步骤 2)
        |  step3_drop_optimize.py: export_slim_step.py --drop-cross-layers 0,1,2,3 -> INT8(同一个 README 调用)-> Conv INT8
        |                         -> 对 step、vq_*、postprocess 做离线 ORT_ENABLE_EXTENDED 优化
        v
 out/final/{emage_step_int8,vq_upper_idx_int8,vq_hands_idx_int8,vq_lower_idx_int8,postprocess_int8}.onnx   71.59 MB   (步骤 3)
```

### 步骤 1:瘦 step

`export_slim_step.py` 从原始权重**重新导出**(不是 `onnx.utils.extract_model` 的原型)。wrapper 是 `EmageAudioModel.forward` body 路径的逐行拷贝,并与完整模型比对(PyTorch 下 `max|diff| = 0`;ONNX 对 PyTorch `<= 8e-5`)。与 `emage_step.onnx` 相比去掉了:

* 整个 face 分支:`audio_encoder_face`、`bodyhints_face`、`audio_face_motion_proj`、`face_motion_decoder`(4 层)、`face_out_proj`、`speaker_embedding_face`(`rec_face` 输出随之消失;应用里 `vqFace` 本来就是关闭的);
* 图内 `argmax -> VQ 解码(face/upper/hands/lower) -> 6D -> 轴角 -> 55 关节装配` 这条链,它只服务 `rot6d` / `lower_dec`(`emageWorker.ts` 从不取用)以及 `seed`。

输出:`cls_upper`、`cls_hands`、`cls_lower`,形状 `[1,64,256]`。输入不变(`audio`、`speaker_id`、`masked_motion`、`mask`)。图节点数 6485 -> 1473。

#### 主机侧 `seed` 规范(JS)

下一窗的前 4 帧 = 上一窗 `motion_inference` 的最后 4 帧。完整 step 在图内计算,瘦 step 不再输出,由 worker 重建(`src/motion/sources/emageSeed.ts`):

1. 对**完整 64 帧窗口**,对 `cls_upper`、`cls_hands`、`cls_lower` 取 `argmax`(贪心,不是最终动作所用的 top-k 采样索引)。
2. 用 worker 已加载的 `vq_upper_idx`、`vq_hands_idx`、`vq_lower_idx` 解码,得到 78 / 180 / 61 维的 `decoded`。
3. 构造 `face_dec` `[1,64,106]` 全零,并把**每帧前 6 维(jaw 6D)显式设为单位旋转 `[1,0,0,0,1,0]`**。不能留零:`postprocess` 对全零 face 会得到错误的 jaw 6D `[0,0,1,1,0,0]`。
4. 运行 `postprocess(face_dec, upper_dec, hands_dec, lower_dec)` 得到 `motion_inference` `[1,64,337]`。
5. `seed = motion_inference[:, 60:64, :]`(`SEED_FRAMES = 4`)。

为什么用整窗而不是 worker 里已解码的范围:一个流的首窗只保留第 0..59 帧,而且 VQ 解码器是卷积结构(只解码最后 8 帧会让 seed 偏差达 ~0.18;上下文 18 帧以上偏差 1.5e-4;整 64 帧除 jaw 外偏差严格为 0)。

参考实现与 worker 补丁(本分支):`src/motion/sources/emageSeed.ts`(纯 TS,依赖注入)与 `src/motion/sources/emageWorker.ts`:

* `runStep` 自动识别模型:若 step 返回 `seed` + `rec_face`(完整模型)则照旧使用;否则调用 `computeSeedFromLogits`,`recFace` 为零占位。**现有模型行为完全不变**,本包不改任何配置。
* 瘦 step 配合启用的 `vqFace` 会明确报错(没有 `rec_face`)。
* `vq_*` / `postprocess` 现在也在 `runStep` 里被使用,因此所有调用统一走一个 Promise 链锁(`withVqLock`,`decode()` 也包进去);ORT wasm 在同一会话上并发 `run()` 会抛 "Session already started"。

### 步骤 2:INT8 Conv 权重

`--quantize` 只量化 `MatMul`;所有 `Conv`(step 里的 audio_encoder_body + motion_encoder,`vq_*_idx` 里全部解码卷积)仍是 FP32,约占 INT8 step 的 30%。`quantize_conv_int8.py` 把它们存成逐输出通道对称 INT8 + FP32 scale,后接 `DequantizeLinear(axis=0)`(仅权重量化,激活不变)。节省:step -15.43 MB(20.60 MB FP32 -> 5.17 MB),vq 三个文件合计 15.69 -> 4.56 MB。

实测后否决的备选:`quantize_dynamic(["Conv"])` 的 `ConvInteger`(-15.3 MB,但对 FP32 的 relL2 为 1.96%、top-1 为 87.7%,延迟 417 ms 对 365 ms);脚本保留 `--mode convinteger` 供对比。另有 `--mode fp16`(权重存 FP16 + Cast,step 100.56 MB)和 `--include <正则>`(例如只量化 `motion_encoder`:105.37 MB;只量化 `audio_encoder_body`:100.91 MB),用于在体积与误差之间取舍。

### 步骤 3:去掉无用的 cross-attention 层 + 离线图优化

**3a. 去掉 cross-attention 第 0..3 层(不重训)。** `audio_motion_cross_attn` 共 8 层,占 step 权重的 60%(INT8 下每层 7.08 MB)。在已发布权重上逐层、分组做消融(61 个窗口,FP32,teacher forcing,logits 对未改动的 FP32 瘦模型):

| 去掉的层 | relL2 | argmax 一致率 |
|---|---:|---:|
| 无 | 0 | 100% |
| 0 | 0.00% | 100% |
| 0,1,2 | 0.00% | 100% |
| **0,1,2,3** | **0.05%** | **99.6%** |
| 0,1,2,4 | 0.33% | 97.1% |
| 0,1,2,3,4 | 8.96% | 44.7% |
| 单独去 5、6、7 中任何一层 | 7.6% 到 25% | 崩掉 |

也就是说这份权重里前 4 层几乎是恒等映射(连随机噪声输入下,去掉它们 logits 也只变 < 1e-4),后面的层必不可少。思路与 LLM 不重训的深度剪枝一致:[ShortGPT](https://arxiv.org/abs/2403.03853)、[Gromov 等](https://arxiv.org/abs/2403.17887)。可能的原因是前几层残差分支的激活量级很大、被后面的 LayerNorm 抹掉([massive activations](https://arxiv.org/abs/2402.17762)),这个机制**没有验证**。self-encoder 和三个 body decoder 也做过消融,必须保留(relL2 1.3% 到 9%)。层号来自这些消融实验(在草稿目录,不随包发布),换了权重要重做。

`export_slim_step.py --drop-cross-layers 0,1,2,3 --name emage_step_drop0123` 在导出前删掉这些层(不加参数时行为不变);其余是 README 的 `quantize_dynamic` 调用和步骤 2 的 Conv INT8。FP32 263.0 MB,INT8 82.11 MB,再加 Conv INT8 为 **66.68 MB**(步骤 2 的文件是 95.43 MB)。

**3b. 离线优化。** `step3_drop_optimize.py` 用 python onnxruntime 在 CPU EP 上以 `ORT_ENABLE_EXTENDED` 加载每个文件,并把优化后的图存下来(`optimized_model_filepath`)。保存的图里只有所有 ORT wasm 构建都带的 CPU `com.microsoft` 融合算子(`DynamicQuantizeMatMul`、`MatMulIntegerToFloat`、`FusedMatMul`、`SkipLayerNormalization`、`FusedConv`);脚本遇到 NHWC / NCHWc 等平台相关布局域会拒绝写出。这样浏览器在建会话时要做的优化少很多。`postprocess_int8.onnx` 从 0.67 缩到 0.47 MB。单窗延迟不变。

**.ort 格式与优化后的 .onnx。** `--ort` 还会把 ORT 格式文件写到 `out/final_ort/`(`convert_onnx_models_to_ort --optimization_style Fixed --target_platform amd64`;该工具不接受 `wasm` 这个 target)。两种格式在 headless Chrome 里用 ort-web 1.29.0 和钉死的 1.22.0-dev 都能加载,输出逐位一致(见 `js/browser_check.mjs`)。最终集合不用 `.ort`,因为浏览器里没有收益(step 建会话 59 对 66 ms)、体积略大(step +0.28 MB,`postprocess` 1.18 对 0.47 MB),而且 ORT 格式与写出它的 ORT 版本绑定。**两种方式都没有文件名问题**:`emageWorker.ts` 用 `fetchWithCache` 取字节再把 `ArrayBuffer` 交给 `InferenceSession.create`,ORT 按字节内容识别格式,扩展名无关;`config.ts` 继续请求 `emage_step_int8.onnx` 等,最终集合正好是这些名字。

质量(步骤 3 最终,已优化):对 FP32 瘦模型真值(42 窗,python ORT)relL2 **1.27%**,top-1 **92.5%**(步骤 1+2:1.29%、92.9%;去层后的 FP32:0.05%、99.5%)。对基线 INT8 `emage_step_int8`(72 窗,ort-web 1.29.0,1.22.0-dev 上相同):teacher forcing 下 argmax 一致率 upper 93.8%、hands 92.1%、lower 93.3%(按构造不再与基线逐位一致);自由运行 90.1% / 86.5% / 90.6%,FP32 对 INT8 的噪声下限为 89.8% / 88.2% / 92.2%;主机侧 seed 非 jaw 维最大绝对差 0,jaw <= 0.056,与之前相同。自由运行的 `hands` 比下限低 1.7 个百分点(步骤 2 单独相对步骤 1 就是 86.0%),所以步骤 3 应理解为"在噪声下限附近,hands 略低于它"。

进一步压体积/提速中测过但否决的方案(详见作者本地 `out/research/NOTES.md`,不随包发布):带校准的静态量化(更差且不更快)、ORT 自带 GPTQ(比 RTN 还差)、4-bit `MatMulNBits`(更小但 wasm 里更慢,top-1 只有 78% 到 86%)、不微调的 SVD 低秩与 FFN/注意力头剪枝、权重重排/去重、用 JS 替换 `postprocess`(压缩后只省约 0.05 MB)。

## 验证(72 个窗口,7 条音频:emage-onnx-export 的 `demo.wav`、本仓库 `bench/baseline.wav`、三段 32 秒本地 mp3 截取(`gaosu_baolun`、`test-2`、`the-11th-forest`,内容未审听,可能含非语音)、macOS `say` 中文与英文)

窗口为 64 帧(34112 采样点),互不重叠,每条最多 14 个;音频在 `out/clips/`(`make_clips.sh` 生成)。已安装的 ort-web 1.29.0 与 `emageWorker.ts` 钉死的 wasm(`1.22.0-dev.20250409-89f8206ba4`)结果一致。

| 检查项 | 结果 |
|---|---|
| 瘦 INT8 对基线 `emage_step_int8`,相同输入(teacher forcing),`cls_*` | **最大绝对差 0,argmax 一致率 100%**(72 窗) |
| 主机侧 seed(JS 路径)对图内 seed,相同 logits | **非 jaw 维最大绝对差 0**;jaw 维 0.03 到 0.056(单位旋转对真实 face 解码出的 jaw) |
| 自由运行(各自喂自己的 seed),瘦+主机 seed 对基线,argmax 一致率 | upper 93.1%,hands 91.5%,lower 94.1% |
| 上一行的噪声下限:基线 FP32 自由运行对 INT8 自由运行 | upper 90.1%,hands 88.9%,lower 92.4% |
| 步骤 2 对步骤 1,teacher forcing:logits relL2 / 每帧 KL / 参考 argmax 在 top-3 | 1.2% / 0.005 / 99.8%;argmax 一致率 93.4 / 91.9 / 93.6% |
| 步骤 2 对步骤 1,自由运行 argmax 一致率 | 89.0 / 86.0 / 90.9% |
| 对 FP32 瘦模型真值(28 窗,python ORT):步骤 1 INT8 -> 步骤 1+2 | relL2 1.16% -> 1.31%,top-1 93.4% -> 92.5%(重掷骰下限,Conv 用 FP16:1.16%,94.0%) |
| 同一批 VQ 索引分别过 `vq_*_convq` 与 `vq_*_int8`,`motion_inference` | 平均绝对差 0.00083,最大 0.029 |
| **步骤 3** 对基线 `emage_step_int8`,teacher forcing,argmax 一致率(72 窗) | 93.8 / 92.1 / 93.3%(upper / hands / lower) |
| **步骤 3** 自由运行 argmax 一致率,对基线;FP32 对 INT8 下限 | 90.1 / 86.5 / 90.6%;下限 89.8 / 88.2 / 92.2% |
| **步骤 3** 对 FP32 瘦模型真值(42 窗,python ORT) | relL2 1.27%,top-1 92.5% |
| **步骤 3** 优化后对未优化,Chrome 内(step、vq x3、postprocess;ort 1.29.0 与 1.22.0-dev;.onnx 与 .ort) | 最大绝对差 0 |

如何理解 argmax 数字:INT8 动态量化的激活取整会在**任何**上游扰动下重新"掷骰"(即使 Conv 权重只改成 FP16,relL2 也有 0.9%),而且模型有很多近似并列的 logits,所以"对参考的 argmax 一致率"天生很吵。应用本身对 upper/hands 还做 top-6、温度 0.85 的采样。更有意义的是 logits 层面的数字(relL2、KL、top-3 包含率):步骤 2 在 INT8 的 1.16% 之上只多约 0.15 个百分点的相对 logits 误差。

## 运行

依赖:装好 `requirements.txt` 的 Python(`emage-onnx-export/.venv` 可直接用)、Node 24+(通过 type stripping 运行 `.ts` 的 seed 辅助模块)、ffmpeg(生成音频)、`onnxruntime-web`(本包依赖,从 `node_modules` 解析)、HF 缓存里的 `H-Liu1997/emage_audio` 权重(没有会下载)、以及兄弟目录 `../emage-onnx-export`,且其 `onnx/` 已按它的 README 流程导出(可用 `EMAGE_EXPORT_DIR` 覆盖路径)。

```bash
cd packages/emage-onnx
# 经 pnpm(命令相同,见 package.json 的 scripts):
PYTHON=../../../emage-onnx-export/.venv/bin/python pnpm run all:pinned     # = ./run_all.sh --with-pinned-ort --brotli
pnpm run step1 | step2 | step3 | clips | verify:slim | verify:convq | bench | vs-fp32 | sizes
# 或直接执行:
PYTHON=../../../emage-onnx-export/.venv/bin/python ./run_all.sh --with-pinned-ort --brotli
# 或分步执行:
python export_slim_step.py             # 步骤 1  -> out/emage_step_slim.onnx, out/emage_step_slim_int8.onnx
python quantize_conv_int8.py --all     # 步骤 2  -> out/*_convq.onnx
python step3_drop_optimize.py --ort    # 步骤 3  -> out/final/*.onnx (+ out/final_ort/*.ort), MANIFEST.json
./make_clips.sh                        # out/clips/*.wav (EMAGE_EXTRA_CLIPS="a.mp3 b.mp3" 可追加素材)
node js/verify_slim.mjs --fp32-step emage_step.onnx   # 步骤 1 检查(+ FP32 噪声下限)
node js/verify_convq.mjs                              # 步骤 2 检查 + 延迟
node js/verify_slim.mjs --slim-dir out/final --slim-step emage_step_int8.onnx --fp32-step emage_step.onnx   # 步骤 3 检查
node js/browser_check.mjs [--threads 4]               # headless Chrome:加载并对比最终 .onnx 与 .ort,ort-web 已安装版 + 钉死版
node js/bench_latency.mjs [--threads 4] [--ort-web-dir DIR]
python tools_vs_fp32.py                # 对 FP32 真值的误差
python size_report.py --brotli         # 体积表
```

钉死版本 wasm:`npm i onnxruntime-web@1.22.0-dev.20250409-89f8206ba4 --prefix out/ort-pinned`,然后传 `--ort-web-dir out/ort-pinned/node_modules/onnxruntime-web`。

| 文件 | 作用 |
|---|---|
| `slim_common.py` | 路径、对 PantoMatrix@`0bbb03d` 做 `git archive`(绝不在 export 仓库里 `git checkout`) |
| `export_slim_step.py` | 步骤 1:wrapper 导出 + README 的 INT8 调用 + 自检 |
| `quantize_conv_int8.py` | 步骤 2:Conv 权重(`dq` / `fp16` / `convinteger`) |
| `step3_drop_optimize.py` | 步骤 3:去层(经 `export_slim_step.py --drop-cross-layers`)+ Conv INT8 + 离线优化 -> `out/final/` |
| `js/browser_check.mjs` | 最终文件的 headless Chrome 加载/对比检查(需要 Chrome,可用 `CHROME=` 指定路径) |
| `js/common.mjs`、`js/verify_slim.mjs`、`js/verify_convq.mjs`、`js/bench_latency.mjs` | ort-web (wasm) 验证与延迟 |
| `tools_vs_fp32.py`、`size_report.py`、`make_clips.sh`、`run_all.sh` | 对 FP32 误差、体积、音频、一键运行 |

## npm 包(尚未发布)

本目录是 workspace 包 `@firetable/emage-onnx`(`version` 独立于 app 版本,`publishConfig.access = public`,MIT)。发布包只含脚本和文档(约 30 kB,`npm pack --dry-run` 共 18 个文件),`out/`、`.cache/` 和所有模型文件都由 `files` 排除。`prepack` 会运行 `js/sync-seed.mjs`,把 `src/motion/sources/emageSeed.ts` 转成纯 JS(`js/vendor/emageSeed.mjs`,已 gitignore),这样验证脚本在本仓库之外也能运行。唯一依赖是 `onnxruntime-web`(与 app 同一版本范围,在 `pnpm-lock.yaml` 中解析为同一个 1.29.0)。

没有接入任何发布流程:`publish-npm.yml` 只发布 `packages/project-xiaochun`,`scripts/bump-version.mjs` 只改固定的文件清单,其中不含本包。有意不提供 `build` 脚本,所以 `pnpm build:packages` 会跳过它。以后要发布:先在 npmjs.com 为本包单独绑定 Trusted Publishing(仓库 `FireTable/project-xiaochun` 加一个 workflow 文件名),再新增专用 workflow(或在新 job 里用 `working-directory: packages/emage-onnx`)以及它自己的 tag 或版本规则。现有 `publish-npm.yml` 不要改,因为 npm 是按文件名绑定的。

## 如何采用这些文件

可部署集合在 `out/final/`:`emage_step_int8.onnx`、`vq_{upper,hands,lower}_idx_int8.onnx`、`postprocess_int8.onnx`(71.59 MB,brotli q9 后 57.72 MB)。文件名正是 `config.ts` 在 `useInt8 = true` 时请求的名字,切换不需要改代码。

**本仓库(分支 `feat-emage-slim`)的现状**:这 5 个文件已在 CDN `https://cdn.firetable.tech/xiaochun/emage/`(SHA-256 与字节数同 `out/final/` 完全一致,HTTP 200,`access-control-allow-origin: *`,请求时返回 `content-encoding: zstd`);生产构建的 `APP_CONFIG.emage.base` 默认指向它;`emage.cacheName` 升到 `emage-models-v2`(文件名与旧 INT8 集合相同,而 Cache Storage 按 URL 缓存,沿用旧桶会混乱;`emageWorker.ts` 在新模型加载成功后删除其他 `emage-models-*` 桶)。`https://cdn.firetable.tech/xiaochun/` 下的旧文件原样保留,旧版本应用不受影响。

1. 本地试用:gitignore 的 `public/onnx-slim3/` 里放指向 `out/final/*.onnx` 的软链,在 `.env.local` 设 `VITE_EMAGE_BASE=/onnx-slim3`。
2. 部署侧:除非 Cloudflare/CI 的构建环境里设了 `VITE_EMAGE_BASE_PROD`(那样会覆盖新默认值,需删除或改成 `https://cdn.firetable.tech/xiaochun/emage`),否则无需其他改动。`wrangler*.jsonc` 里的 `EMAGE_MODELS_BASE` 没有被 `src/` 读取,仅为一致性而更新。
3. 保持 `vqFace` 关闭。worker 尚未在浏览器里用这些文件端到端运行(见下)。

## 许可证与来源

* 本包的脚本和文档是小蠢 (XiaoChun) 自己的,采用 MIT 许可证([LICENSE](LICENSE))。本包**不含**任何权重或第三方模型代码。
* 它们处理的权重是 PantoMatrix 的 EMAGE:Hugging Face [`H-Liu1997/emage_audio`](https://huggingface.co/H-Liu1997/emage_audio)(model card 标注 **Apache-2.0**),训练数据 [BEAT2](https://huggingface.co/datasets/H-Liu1997/BEAT2)(dataset card 标注 Apache-2.0)。代码仓库 [PantoMatrix/PantoMatrix](https://github.com/PantoMatrix/PantoMatrix) 的**根目录没有 LICENSE 文件**,其代码许可证不明确(脚本只在本地缓存里取出 `0bbb03d` 的模型代码,不再分发)。论文与作者见 [NOTICE](NOTICE)(EMAGE,CVPR 2024;BEAT,ECCV 2022)。
* 本包产出的 ONNX 文件是这些权重的**衍生作品**(导出 wrapper、去掉 cross-attention 第 0..3 层、INT8 / Conv 量化、离线图优化;`vq_*` / `postprocess` 的输入来自 [emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export),MIT)。再分发这些文件时,请同时附上 Apache-2.0 全文([LICENSE-APACHE-2.0](LICENSE-APACHE-2.0))和 [NOTICE](NOTICE)。
* SMPL-X 与 FLAME 人体/人脸模型有各自的授权(通常限制商用),本包既不包含也不使用它们。
* 商用方请自行核对上游许可证(模型、数据集、代码、SMPL-X、FLAME)。本节不构成法律意见。

## 注意事项与未验证项

* **只有部分浏览器实测。** `js/browser_check.mjs` 在 headless Chrome 154(ort-web 1.29.0 与钉死的 1.22.0-dev,4 线程,跨源隔离)里加载并运行步骤 3 的文件,并与未优化文件对比。`emageSeed.ts` 在 Node 里跑过。`emageWorker.ts` 通过了 `tsc --noEmit`,但 worker 本身没有在浏览器、Web Worker、其他浏览器(Safari、Firefox)或手机上端到端运行过。
* 延迟主要是 Node wasm(1、4、8 线程),外加一台 Apple M1 Ultra 上 4 线程的 headless Chrome 检查;其他 CPU、内存、手机均未测。步骤 2 没有延迟或内存收益;步骤 3 去掉 8 层 cross-attention 里的 4 层,提速来自这里(1T 370 -> 274 ms,4T 108 -> 79 ms)。
* **步骤 3 的风险**:去掉 cross-attention 第 0..3 层是由数据决定的,只在 7 条音频(中英文 TTS、三段音乐/语音截取、demo、bench)上验证过;没有视觉/主观评审,没有 top-k 采样,没有数分钟的长会话,没有其他说话人、唱歌或静音。这几层在这份权重上近似恒等(机制未验证),换权重必须重做消融。优化后的图由 arm64 macOS 上的 python onnxruntime 1.23.2 写出,只用了 CPU `com.microsoft` 融合算子,在两个 ort-web 构建里都能加载,其他 ort-web 版本或平台没有测(未优化的 `out/emage_step_drop0123_int8_convq.onnx` 等可作回退)。
* WebGPU **不在**本包范围内。旁路实验里 FP32/FP16 的 step 在同一台 Mac 的 headless Chrome WebGPU 上单窗约 21 到 28 ms,但要 130 到 263 MB 权重且只在一块 GPU 上测过,所以应用沿用 wasm + INT8 的决定。
* 动作质量只用了 logits 层面和 argmax 指标在 7 条音频上评估;没有对动画做视觉/主观评审,没有模拟 top-k 采样,没有跑数分钟的长自回归会话。自由运行 argmax 一致率 86 到 94% 接近 INT8 对 FP32 的下限(89 到 92%),这不等于动作看起来一样。
* face/jaw:瘦路径把 seed 的 jaw 固定为单位旋转;瘦 step 无法启用 `vqFace`。分析阶段的探针(teacher forcing、单条音频、FP32)显示 jaw 取单位旋转对 body logits 的相对影响 <= 0.07%。
* `package.json` 允许 `onnxruntime-web ^1.22.0-dev…`,`pnpm-lock` 实际装的 JS 是 1.29.0,而 `emageWorker.ts` 从 jsdelivr 加载 1.22.0-dev 的 wasm。两种我都测过,但应用里这种 JS/wasm 版本混用的情形没有测。
* 4-bit 权重量化(`MatMulNBits`)在 ort-web 里能加载(也验证过),但**不在本包范围内**:朴素 RTN 4-bit 实测对 FP32 的 argmax 一致率只有约 70 到 85%,需要 GPTQ/AWQ 一类带校准的方法才值得上线。要到约 20 MB 需要蒸馏/重训。
* 权重来自本机 HF 缓存快照(`main`);对具体 HF 版本的依赖与 `emage-onnx-export` 相同。

## 建议加到 emage-onnx-export README 的回链(未应用,该仓库保持不动)

> **浏览器端更小的下载体积。** [Project-XiaoChun / packages/emage-onnx](https://github.com/FireTable/project-xiaochun/tree/main/packages/emage-onnx) 构建仅流式的 `emage_step`:只输出三路 VQ logits(去掉 face 分支与图内 seed 链,seed 在 JS 里计算),并把 Conv 权重改为 INT8:浏览器总下载 191 MB -> 101 MB(brotli 后 83 MB),且在相同输入下 `cls_*` 与 INT8 step 逐位一致。
