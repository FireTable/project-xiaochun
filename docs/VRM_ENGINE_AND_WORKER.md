# VRMEngine & vrmWorker — 主线程渲染调度与后台二进制合成双核架构

> **核心文件**：  
> - [`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) (主线程 3D 调度中枢与渲染循环 Facade)  
> - [`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) (Dedicated Web Worker 二进制组装与 WASM 补丁引擎)  
> - [`src/lib/idb-vrm-cache.ts`](../src/lib/idb-vrm-cache.ts) (L1/L2 双层 IndexedDB 缓存持久化)  
> - [`src/core/outfitSwap.ts`](../src/core/outfitSwap.ts) (原子姿态快照捕获与内存预还原器)

---

## 1. 架构总览与线程分工 (Architecture & Threading Model)

在浏览器原生高性能 3D 应用中，主线程面临着极其严苛的 **16.67ms (60 FPS)** 帧率预算。然而，VRM 模型的网络拉取、Zip 解压、差分算法（bspatch）重组以及数十兆 TypedArray 的内存拷贝均属于高负载的 CPU/IO 任务。

为了兼顾「毫秒级换装」与「主线程渲染零掉帧」，Project XiaoChun 采用了 **主线程渲染总线 (`VRMEngine`)** 与 **后台计算中枢 (`vrmWorker`)** 的双核解耦架构：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            主线程 (Main UI Thread)                           │
│                                                                             │
│   [React 19 / UI] ──(TopHeader 换装请求)──┐                                  │
│                                           │                                 │
│                                    [VRMEngine.ts]                           │
│                                           │ (只发送 URL + SHA-256 元信息)    │
│   ┌───────────────────────────────────────┼──────────────────────────────┐  │
│   │ 3D 渲染主循环 (60 FPS, 16.6ms 严格有序) │                              │  │
│   │  ├─ 1. Motion 姿态求值                 │                              │  │
│   │  ├─ 2. FootIK 贴地补偿                ▼                              │  │
│   │  ├─ 3. Smootherstep 曲线融合       [ensureBspatchWorker()]           │  │
│   │  ├─ 5. BodyTurn 踱步转向              │                              │  │
│   │  ├─ 7. GazeController 注视/眨眼       │ postMessage(req)             │  │
│   │  ├─ 8. vrm.update() 骨骼物理          │ (Transferable 零拷贝)         │  │
│   │  ├─ 9. VRMBodyMorph 28 项体型形变     │                              │  │
│   │  └─ 10. PostFx 辉光/色调全流程合成     ▼                              │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────┼─────────────────────────────────┘
                                            │ IPC (Web Worker API)
┌───────────────────────────────────────────┼─────────────────────────────────┐
│                    后台线程 (Dedicated Web Worker: vrmWorker.ts)            │
│                                           │                                 │
│   ┌───────────────────────────────────────▼──────────────────────────────┐  │
│   │ 流水线编排 (Pipeline)                                                 │  │
│   │  1. 查 L2 缓存 (idbGetComposed) ──[Hit]──> 立即返回 (10~30ms)         │  │
│   │  2. [Miss] 查 L1 缓存 (idbGet base) / fetch_base (5.9MB .vrmbase)   │  │
│   │  3. fetch_addon (1~4MB .vrmaddon)                                    │  │
│   │  4. fflate.unzipSync 解开 patch 与 target.json                       │  │
│   │  5. bsdiff-wasm 执行 bspatch 差分重组                                 │  │
│   │  6. packRawGLB (封装 JSON Chunk + BIN Chunk, 4-byte 补齐)            │  │
│   │  7. 异步落库 L1 base & L2 composed (idbPutComposed)                  │  │
│   │  8. postMessage(composedGLB, [transferable]) 回传主线程               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. VRMEngine 调度中枢深度解析 (VRMEngine Facade & Lifecycle)

[`src/core/vrmEngine.ts`](../src/core/vrmEngine.ts) 是全场景的 Facade 门面，聚合了全部底层系统。

### 2.1 编排的 8 大专业子系统

| 子系统 | 实例成员 / 路径 | 核心职责 |
| :--- | :--- | :--- |
| **LineworkWorld** | `this.lineworkWorld` (`./scene/lineworkWorld.ts`) | 纯代码程序化太阳光芒、19 栋线稿建筑、网格地面、5 种风格化树木；支持 `linework-light` / `linework-dark` 双主题。 |
| **StudioLighting** | `this.studioLighting` (`./lighting/studioLighting.ts`) | 影棚 3 通道光照（dir 1.00 主日光 + 2048 阴影相机、hemi 0.95 天光、fill 1.40 背后轮廓），集中调光。 |
| **VRMMaterialManager** | `this.materialManager` (`./material/vrmMaterialManager.ts`) | 网格语义分类（skin / hair / eyes / clothing），Shader Uniform `uMatSaturation` 注入与部件可见性控制。 |
| **VRMBodyMorph** | `this.bodyMorph` (`./morph/vrmBodyMorph.ts`) | 28 项骨骼比例正交缩放、解剖学后延锁死、前腹壁余弦顶点微凸与顶点动态测高。 |
| **GazeController** | `this.gazeController` (`@/motion/gazeController.ts`) | 眼神追踪、微扫视、生理极限角度限位（Yaw $\pm 45^\circ$、Pitch $-20^\circ \sim +30^\circ$）与思考晃头。 |
| **BubbleTracker** | `this.bubbleTracker` (`./ui/bubbleTracker.ts`) | 头部世界坐标 $\to$ 屏幕 2D 气泡投影，带 1.5px 移动死区过滤，直接操控 DOM Transform 绕开 React。 |
| **UniversalMotion** | `this.motionPipeline` (`@/motion/pipeline/motionPipeline.ts`) | 统一分层动作图谱（Layer 0 呼吸、Layer 1 思考/EMAGE/动作、Layer 2 迈步转身），五次平滑步阶补帧。 |
| **PostFxPipeline** | `postFxPipeline` (`./postfx/postFxPipeline.ts`) | 电影级软雾辉光（UnrealBloomPass）、高亮背景物理剔除、ToneMapping 模式切换与全色调 BC/HS 调色。 |

### 2.2 帧主循环 10 步时序与时钟保护

主渲染循环在 `requestAnimationFrame` 下运行，每一帧内部执行严格有序的 10 步计算：

```typescript
// 时钟保护机制 (防止后台标签页唤醒后的巨大 delta 导致物理骨骼爆炸)
let delta = this.clock.getDelta();
if (delta > 0.1) delta = 0.016; // 限制单步物理最大步长为 ~60 FPS
```

1. **Step 1 (Motion)**: 求值当前活跃姿态源（Idle / Think / Speech / Universal），写入姿态缓冲；
2. **Step 2 (FootIK Sink)**: 计算赤足下沉高度（`updateBarefoot`），更新 `scene.position.y`，使骨骼贴合世界绝对零地平面；
3. **Step 3 (Transition)**: 应用五次平滑步阶曲线（`MotionTransition.apply`，以 $6t^5 - 15t^4 + 10t^3$ 自适应插值）；
4. **Step 4 (Sync)**: 非破坏性同步动作快照（`sampleFromVRM`）；
5. **Step 5 (BodyTurn)**: 迈步状态机解算与偏航角（Yaw）弹簧阻尼跟随；
6. **Step 6 (FootIK Leveling)**: 脚掌物理贴地与对立平衡单腿重心转移（在 `isStepping` 时主动让出）；
7. **Step 7 (Gaze)**: 视线注视点插值、微扫视更新与自然生理眨眼；
8. **Step 8 (VRM Internal)**: 调用 `vrm.update(delta)`，将标准骨骼解算同步至原始物理骨骼并驱动 SpringBone 飘动；
9. **Step 9 (BodyMorph)**: 实施 28 项体型缩放与顶点形变（**严禁在此时覆盖 quaternion 旋转！**）；
10. **Step 10 (PostFx)**: 当 `postfx.enabled` 开启时走 `postFxPipeline.render()`，关闭时走 `renderer.render()` 零开销直通。

### 2.3 进场镜头动画与视锥体自适应

- **视锥自适应公式 (`computeDefaultCameraPosition`)**：
  为避免不同 FOV 下长焦“大头糊脸”或广角“过小”，相机距离统一按目标主体高度（`defaultShotExtent = 1.4m`）逆解：
  $$\text{distance} = \frac{\text{extent}}{2 \cdot \tan\left(\frac{\text{FOV}}{2}\right)}$$
- **破次元推进 (`cinematicIntro`)**：
  初次加载破次元时，镜头自远端 $3.3 \times \text{distance}$ 起始，采用 `easeOutCubic` 在 1100ms 内平滑推至计算位置，配合加载蒙版缩放消退。

### 2.4 WebGL 资源防泄漏清理规范 (`dispose`)

当加载外部 VRM 或销毁引擎时，执行彻底的拓扑清理：
1. 递归遍历 `scene`，释放所有 `Mesh` 的 `BufferGeometry`；
2. 释放材质绑定的所有纹理（`map`, `normalMap`, `roughnessMap` 等）并调用 `texture.dispose()`；
3. 显式调用 `vrm.dispose()` 与 `VRMUtils.deepDispose(vrm.scene)`；
4. 清理 `PostFxPipeline` 的各级 `WebGLRenderTarget`。

---

## 3. vrmWorker 二进制流水线与协议规范 (vrmWorker Deep Dive)

[`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) 独立运行在 Dedicated Web Worker 线程中。

### 3.1 Worker 内部流水线五阶段

Worker 接收到 `compose_outfit` 指令后，执行标准流水线：

```
[fetch_addon]  拉取目标服饰 .vrmaddon (包含 bin-patch.bin + target.json)
      ↓
[fetch_base]   如果 L1 缓存未命中，拉取底模 xiaochun_base.vrmbase
      ↓
[unzip]        调用 fflate.unzipSync 解开 ZIP 容器，提取裸差分二进制与元数据
      ↓
[bspatch]      在 WebAssembly 实例中执行 bspatch 差分拼接，合成完整 BIN Chunk
      ↓
[pack]         packRawGLB 重新封装为标准化 glTF Binary (GLB) 格式
```

### 3.2 GLB 4 字节边界规约与打包 (`packRawGLB`)

glTF 2.0 规范要求每个 Chunk 的起始偏移量和长度必须是 **4 字节对齐**。`vrmWorker` 内部封装了标准构造逻辑：

```typescript
function packRawGLB(jsonChunk: Uint8Array, binChunk: Uint8Array): ArrayBuffer {
  // 1. 计算 4 字节填充对齐
  const jsonPadding = (4 - (jsonChunk.length % 4)) % 4;
  const binPadding = (4 - (binChunk.length % 4)) % 4;
  const jsonPaddedLen = jsonChunk.length + jsonPadding;
  const binPaddedLen = binChunk.length + binPadding;

  // 2. 总长度 = 12 字节 GLB Header + JSON Chunk 头与数据 + BIN Chunk 头与数据
  const totalByteLength = 12 + 8 + jsonPaddedLen + 8 + binPaddedLen;
  const out = new ArrayBuffer(totalByteLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  // Magic: 0x46546C67 ("glTF"), Version: 2
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalByteLength, true);

  // Chunk 0: JSON (0x4E4F534A "JSON")，空格 0x20 填充
  view.setUint32(12, jsonPaddedLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonChunk, 20);
  for (let i = 0; i < jsonPadding; i++) bytes[20 + jsonChunk.length + i] = 0x20;

  // Chunk 1: BIN (0x004E4942 "BIN\0")，零字节 0x00 填充
  const binHeaderOffset = 20 + jsonPaddedLen;
  view.setUint32(binHeaderOffset, binPaddedLen, true);
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  bytes.set(binChunk, binHeaderOffset + 8);
  for (let i = 0; i < binPadding; i++) bytes[binHeaderOffset + 8 + binChunk.length + i] = 0x00;

  return out;
}
```

### 3.3 跨线程 IPC 通信协议

主线程与 Worker 之间采用全双工消息通信，所有数据通过全局自增 `id` 进行严格绑定，天然防并发竞态：

#### 主线程 $\to$ Worker 请求：
```typescript
type ComposeRequest = {
  id: number;
  type: 'compose_outfit';
  baseUrl: string;      // 基础底模 URL (/vrm/xiaochun_base.vrmbase)
  baseSha: string;      // 基础模型 SHA-256 (用于 L1 IDB key)
  addonUrl: string;     // 服饰增量 URL (/vrm/addons/xiaochun_*.vrmaddon)
  addonSha: string;     // 服饰增量 SHA-256 (用于 L2 复合 key)
};
```

#### Worker $\to$ 主线程响应：
```typescript
// 1. 进度通知 (用于驱动 UI 顶栏换装按钮微旋转指示器)
type ComposeProgress = {
  id: number;
  type: 'compose_progress';
  phase: 'fetch_addon' | 'fetch_base' | 'unzip' | 'bspatch' | 'pack';
  pct: number;
};

// 2. 成功响应 (composedGLB 以 Transferable 零拷贝归还主线程)
type ComposeOk = {
  id: number;
  type: 'compose_ok';
  composedGLB: ArrayBuffer;
  elapsedMs: number;
};

// 3. 失败响应
type ComposeErr = {
  id: number;
  type: 'compose_err';
  error: string;
};
```

#### 控制台日志透传代理 (`proxyConsole`)：
由于 Web Worker 内部的 `console.log/error` 默认被浏览器归集在 Worker 独立上下文中，`vrmWorker` 重写了控制台方法，通过 `type: 'log'` 消息统一透传至主线程 DevTools，日志自带 `[vrmWorker]` 统一前缀。

---

## 4. 双层 IndexedDB 缓存体系 (`src/lib/idb-vrm-cache.ts`)

为了彻底杜绝重复下载与重复解算，客户端设立了原生 IndexedDB 数据库 `xiaochun-vrm-cache`（版本号 2）：

```
IndexedDB: "xiaochun-vrm-cache"
├── ObjectStore: "base"      (L1: 缓存解压后的基础 BIN)
│   └── Key: baseSha         (Value: ArrayBuffer)
│
└── ObjectStore: "composed"  (L2: 缓存已完成 bspatch 的整套 GLB)
    └── Key: `${baseSha}:${addonSha}` (Value: ArrayBuffer)
```

### 4.1 命中流转策略

1. **第 1 次换装**：
   - 检查 L2 `composed` 仓库 $\to$ **Miss**；
   - 检查 L1 `base` 仓库 $\to$ **Miss**；
   - 下载 `xiaochun_base.vrmbase`（~5.9 MB）并存入 L1 仓库；
   - 下载 `xiaochun_maid.vrmaddon`（~4.1 MB）；
   - 执行解压与 bspatch 合成，组装为女仆装 GLB；
   - 将合成结果写入 L2 `composed` 仓库（耗时约 400~800ms）。
2. **第 2 次切回该装扮（或刷新页面二次访问）**：
   - 检查 L2 `composed` 仓库 $\to$ **Hit！**
   - 直接从磁盘读取 `composedGLB` 字节流，零网络请求、零 WASM 计算，耗时仅 **10~30ms**。

---

## 5. 跨线程原子换装全链路时序图 (Full Sequence Diagram)

下图展示了从用户在界面点击切换外观，到主线程与 Worker 协同完成换装且**消灭 1 帧 T-pose 抽搐**的完整调用流：

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户 (TopHeader)
    participant Engine as VRMEngine (主线程)
    participant Swap as outfitSwap.ts
    participant Worker as vrmWorker.ts (后台)
    participant IDB as IndexedDB Cache
    participant Loop as Three.js RenderLoop

    User->>Engine: 点击切换服装 (e.g. Maid 女仆装)
    Engine->>Worker: postMessage(compose_outfit, addonUrl, addonSha)
    Note over Engine,Loop: 旧模型继续平稳播放动画，主线程 60 FPS 不停歇
    
    alt L2 缓存命中 (二次换装)
        Worker->>IDB: idbGetComposed(`${baseSha}:${addonSha}`)
        IDB-->>Worker: 返回已缓存的 GLB ArrayBuffer
    else 缓存未命中 (首次加载)
        Worker->>IDB: 读写 L1 Base / 网络拉取 Addon
        Worker->>Worker: fflate 解压 + WASM bspatch 差分拼接 + packRawGLB
        Worker->>IDB: idbPutComposed(新 GLB)
    end

    Worker-->>Engine: postMessage(compose_ok, [composedGLB]) (零拷贝)
    
    rect rgb(240, 248, 255)
    Note over Engine,Swap: 内存预还原与原子交接阶段 (无感 0 帧 T-pose)
    Engine->>Swap: captureOutfitSwapState(oldVrm) (抓取旋转/表情/注视快照)
    Engine->>Engine: GLTFLoader 解析新 GLB (但暂不挂载到场景)
    Engine->>Swap: preRestoreOutfitSwapState(newVrm, snapshot) (在内存预设姿态)
    Engine->>Engine: 原子替换：scene.remove(oldVrm) + scene.add(newVrm)
    Engine->>Swap: postRestoreOutfitSwapState(newVrm, snapshot) (重绑 SpringBone)
    Engine->>Engine: dispose 旧模型网格与材质
    end

    Engine-->>User: 换装完成！动作表情无缝延续
```

---

## 6. 开发者与 Agent 避坑红线 (Engineering Invariants)

1. ❌ **严禁在主线程执行 `bsdiff` 或 `bspatch`**：
   WASM 计算会直接阻塞主线程 200~500ms，导致 Three.js 严重掉帧与音频口型卡顿。所有二进制差分重组必须派发给 `vrmWorker`。
2. ❌ **严禁通过深度拷贝（Structured Clone）传递大二进制**：
   在 `postMessage` 时必须将 `ArrayBuffer` 放入第二个参数的 Transferable 数组中（`[composedGLB]`），实现微秒级内存所有权转移。
3. ❌ **严禁在模型未完成内存预还原前挂载至场景**：
   若先调用 `scene.add(newVrm.scene)` 再恢复姿态，必然导致用户屏幕上闪现 1 帧 T-pose 破绽。必须遵守 `preRestoreOutfitSwapState` $\to$ `scene.add` 的原子交接顺序。
4. ❌ **严禁修改 `packRawGLB` 的 4 字节填充规则**：
   glTF 规范强制对齐。若遗漏 Chunk 的 4 字节空格/零填充，`GLTFLoader` 会在运行时直接抛出 `INVALID_GLTF` 致命错误。
5. ⚠️ **保证缓存键的强唯一性**：
   L2 缓存键必须是 `${baseSha}:${addonSha}` 复合字符串，杜绝底模升级而服饰沿用导致的数据脏读。
