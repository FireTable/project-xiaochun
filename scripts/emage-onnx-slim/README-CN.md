# emage-onnx-slim

为小蠢 (XiaoChun) 瘦身 EMAGE ONNX 下载体积的离线工具链,**不需要重训**。
它是 **[VolgaGerm/emage-onnx-export](https://github.com/VolgaGerm/emage-onnx-export)** 的配套包(兄弟目录 `../emage-onnx-export`,README 中记载的 `export_onnx.py` + `--quantize` 流程仍是权威来源)。本包**不修改**该仓库,只**读取**它的 `onnx/*.onnx` 基线、`PantoMatrix` 的 git 历史(用来取出 `MODEL_COMMIT=0bbb03d` 的模型代码)以及 `demo.wav`;所有产物写入 `scripts/emage-onnx-slim/out/`(已 gitignore)。

English: [README.md](README.md)

## 结果(基于原始 HF 权重,本机实测)

下载集合 = 当前 `APP_CONFIG.emage.models` 启用的文件:step + `vq_upper_idx` + `vq_hands_idx` + `vq_lower_idx` + `postprocess`(`vqFace` / `vqGlobal` 已关闭)。MB = 1e6 字节。

| 方案 | step | vq_upper | vq_hands | vq_lower | postprocess | **合计** | 相对当前 INT8 | brotli -q9 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FP32 (emage-onnx-export) | 528.52 | 4.52 | 5.15 | 6.01 | 0.44 | 544.64 | | 502.82 |
| **INT8(当前,`--quantize`)** | 175.00 | 4.52 | 5.15 | 6.02 | 0.67 | **191.35** | 基线 | 161.28 |
| **步骤 1**:瘦 step(仅 `cls_*`)INT8 | 110.86 | 4.52 | 5.15 | 6.02 | 0.67 | **127.21** | -64.14 (-33.5%) | 107.60 |
| **步骤 1+2**:再把 Conv 权重改 INT8 | 95.43 | 1.34 | 1.50 | 1.72 | 0.67 | **100.67** | -90.68 (-47.4%) | 82.83 |

(中间产物:瘦 step 的 FP32 为 376.58 MB。brotli 为逐文件 `brotli -q 9`;175 MB 文件 q11 为 145.5 MB、q9 为 146.7 MB,差别很小。CDN 压缩与本包正交,叠加后线上传输约 83 MB。)

单窗延迟(onnxruntime-web wasm EP,**Node 环境而非浏览器**,64 帧窗口,预热后 10 窗中位数,只适合看相对值):

| step 模型 | 单线程 ort-web 1.29.0 | 单线程 钉死的 1.22.0-dev | 4 线程 1.29.0 | 4 线程 1.22.0-dev | 建会话耗时(单线程 1.29.0) |
|---|---:|---:|---:|---:|---:|
| 基线 `emage_step_int8`(完整) | 548 ms | 551 ms | 165 ms | 173 ms | 878 ms |
| 步骤 1 瘦 step INT8 | 363 ms | 371 ms | 104 ms | 110 ms | 209 ms |
| 步骤 1+2 瘦 step INT8 + Conv INT8 | 366 ms | 368 ms | 104 ms | 109 ms | 213 ms |

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

如何理解 argmax 数字:INT8 动态量化的激活取整会在**任何**上游扰动下重新"掷骰"(即使 Conv 权重只改成 FP16,relL2 也有 0.9%),而且模型有很多近似并列的 logits,所以"对参考的 argmax 一致率"天生很吵。应用本身对 upper/hands 还做 top-6、温度 0.85 的采样。更有意义的是 logits 层面的数字(relL2、KL、top-3 包含率):步骤 2 在 INT8 的 1.16% 之上只多约 0.15 个百分点的相对 logits 误差。

## 运行

依赖:装好 `requirements.txt` 的 Python(`emage-onnx-export/.venv` 可直接用)、Node 24+(通过 type stripping 运行 `.ts` 的 seed 辅助模块)、ffmpeg(生成音频)、本仓库 `node_modules` 里的 `onnxruntime-web`、HF 缓存里的 `H-Liu1997/emage_audio` 权重(没有会下载)、以及兄弟目录 `../emage-onnx-export`,且其 `onnx/` 已按它的 README 流程导出(可用 `EMAGE_EXPORT_DIR` 覆盖路径)。

```bash
cd scripts/emage-onnx-slim
PYTHON=../../../emage-onnx-export/.venv/bin/python ./run_all.sh --with-pinned-ort --brotli
# 或分步执行:
python export_slim_step.py             # 步骤 1  -> out/emage_step_slim.onnx, out/emage_step_slim_int8.onnx
python quantize_conv_int8.py --all     # 步骤 2  -> out/*_convq.onnx
./make_clips.sh                        # out/clips/*.wav (EMAGE_EXTRA_CLIPS="a.mp3 b.mp3" 可追加素材)
node js/verify_slim.mjs --fp32-step emage_step.onnx   # 步骤 1 检查(+ FP32 噪声下限)
node js/verify_convq.mjs                              # 步骤 2 检查 + 延迟
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
| `js/common.mjs`、`js/verify_slim.mjs`、`js/verify_convq.mjs`、`js/bench_latency.mjs` | ort-web (wasm) 验证与延迟 |
| `tools_vs_fp32.py`、`size_report.py`、`make_clips.sh`、`run_all.sh` | 对 FP32 误差、体积、音频、一键运行 |

## 如何采用这些文件(本包未代做)

1. 把 `emage_step_slim_int8_convq.onnx`、`vq_{upper,hands,lower}_idx_int8_convq.onnx`(以及不变的 `postprocess_int8.onnx`)上传到 `APP_CONFIG.emage.base` 对应的 CDN。新文件名意味着新的 Cache Storage 键(`emage-models-v1` 按 URL 缓存),用户会重新下载一次新集合;旧的约 191 MB 缓存会留着,直到被回收或提升缓存名。
2. 把 `APP_CONFIG.emage.models` 指向新文件名(目前 `q()` 只会把 `.onnx` 改写成 `_int8.onnx`),并保持 `vqFace` 关闭。
3. 在浏览器里用新文件跑一遍 worker(本包未做,见下)。

## 注意事项与未验证项

* **没有浏览器实测。** `emageSeed.ts` 在 Node 里用 onnxruntime-web(1.29.0 与钉死的 1.22.0-dev wasm)跑过;`emageWorker.ts` 通过了 `tsc --noEmit`,但 worker 本身没有在浏览器、Web Worker、SharedArrayBuffer 多线程或手机上端到端运行过。
* 延迟是 Node wasm(1 与 4 线程)的结果;浏览器、内存、手机均未测。步骤 2 没有延迟或内存收益。
* 动作质量只用了 logits 层面和 argmax 指标在 7 条音频上评估;没有对动画做视觉/主观评审,没有模拟 top-k 采样,没有跑数分钟的长自回归会话。自由运行 argmax 一致率 86 到 94% 接近 INT8 对 FP32 的下限(89 到 92%),这不等于动作看起来一样。
* face/jaw:瘦路径把 seed 的 jaw 固定为单位旋转;瘦 step 无法启用 `vqFace`。分析阶段的探针(teacher forcing、单条音频、FP32)显示 jaw 取单位旋转对 body logits 的相对影响 <= 0.07%。
* `package.json` 允许 `onnxruntime-web ^1.22.0-dev…`,`pnpm-lock` 实际装的 JS 是 1.29.0,而 `emageWorker.ts` 从 jsdelivr 加载 1.22.0-dev 的 wasm。两种我都测过,但应用里这种 JS/wasm 版本混用的情形没有测。
* 4-bit 权重量化(`MatMulNBits`)在 ort-web 里能加载(也验证过),但**不在本包范围内**:朴素 RTN 4-bit 实测对 FP32 的 argmax 一致率只有约 70 到 85%,需要 GPTQ/AWQ 一类带校准的方法才值得上线。要到约 20 MB 需要蒸馏/重训。
* 权重来自本机 HF 缓存快照(`main`);对具体 HF 版本的依赖与 `emage-onnx-export` 相同。

## 建议加到 emage-onnx-export README 的回链(未应用,该仓库保持不动)

> **浏览器端更小的下载体积。** [Project-XiaoChun / scripts/emage-onnx-slim](https://github.com/FireTable/project-xiaochun/tree/main/scripts/emage-onnx-slim) 构建仅流式的 `emage_step`:只输出三路 VQ logits(去掉 face 分支与图内 seed 链,seed 在 JS 里计算),并把 Conv 权重改为 INT8:浏览器总下载 191 MB -> 101 MB(brotli 后 83 MB),且在相同输入下 `cls_*` 与 INT8 step 逐位一致。
