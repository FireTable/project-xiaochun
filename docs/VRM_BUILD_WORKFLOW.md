# VRM Build & Packaging Workflow (VRM 资产打包工具链)

> **核心文件**：  
> - [`scripts/build-vrm/workflow.mjs`](../scripts/build-vrm/workflow.mjs) (一键打包与流水线调度)  
> - [`scripts/build-vrm/build_vrmbase.mjs`](../scripts/build-vrm/build_vrmbase.mjs) (生成 `.vrmbase` 基础模型)  
> - [`scripts/build-vrm/build_vrmaddon.mjs`](../scripts/build-vrm/build_vrmaddon.mjs) (生成 `.vrmaddon` 增量差分包)  
> - [`scripts/build-vrm/compress_vrm.mjs`](../scripts/build-vrm/compress_vrm.mjs) (基于 oxipng 的纹理离线重压缩)

---

## 1. 为什么需要构建流水线？

- **痛点**：从 VRoid Studio 导出的每一个全量 `.vrm` 模型动辄 18MB ~ 25MB。如果页面上提供 5 套服装，全部下载将耗费超过 **100MB 流量**，冷启动与换装体验极差。
- **解决方案**：
  - **基础模型 (`.vrmbase`)**：仅包含角色身体基础网格、头部、骨骼与通用材质，约 5.9MB；
  - **服装增量 (`.vrmaddon`)**：通过 `bsdiff` 对比提取出的差分增量（仅包含衣服网格与独立贴图），每套仅 0.7MB ~ 4.7MB（**体积缩减约 65%**）；
  - **运行期装配**：在 Web Worker 内通过 WebAssembly 快速执行 `bspatch`，零拷贝合成完整 GLB 二进制。

---

## 2. 目录规范与资产路径

```
public/vrm/
├── .vroid/                        # [git-ignored] 本地开发与源资产工作区
│   ├── base/
│   │   └── xiaochun_base.vrm      # 唯一的裸体基础源模型
│   └── addons/
│       ├── xiaochun_default.vrm   # 默认机能服源模型
│       ├── xiaochun_cheongsam.vrm # 旗袍源模型
│       ├── xiaochun_bikini.vrm    # 比基尼源模型
│       ├── xiaochun_maid.vrm      # 女仆装源模型
│       └── xiaochun_swimsuit.vrm  # 连体泳装源模型
│
├── xiaochun_base.vrmbase          # [产物] 压缩后的基础骨架包 (~5.9 MB)
└── addons/                        # [产物] 5 套差分增量包
    ├── xiaochun_default.vrmaddon  (~3.8 MB)
    ├── xiaochun_cheongsam.vrmaddon(~4.7 MB)
    ├── xiaochun_bikini.vrmaddon   (~2.5 MB)
    ├── xiaochun_maid.vrmaddon     (~4.1 MB)
    └── xiaochun_swimsuit.vrmaddon (~0.7 MB)
```

---

## 3. 一键工作流执行

### 3.1 运行命令
```bash
# 自动检测 .vroid/base/ 唯一模型并全流程构建
node scripts/build-vrm/workflow.mjs

# 或显式指定 base 模型名称
node scripts/build-vrm/workflow.mjs xiaochun_base
```

### 3.2 阶段流水线 (Stages)
1. **Stage 1 (Texture Compress)**：调用 `compress_vrm.mjs`，解压 glTF 内部 PNG 纹理，跑多线程 `oxipng` 原地极致无损压缩；
2. **Stage 2 (Base Packaging)**：调用 `build_vrmbase.mjs`，打包生成标准 `.vrmbase` 文件；
3. **Stage 3 (Addon Packaging)**：调用 `build_vrmaddon.mjs`，逐一与 base 执行 `bsdiff` 差分，输出 `.vrmaddon` 文件；
4. **Stage 4 (Config Verification)**：自动校验 `src/config.ts` 中的 `APP_CONFIG.model.addons`：
   - 提取新生成产物的 SHA-256 哈希值；
   - 若发现新产物未在 `config.ts` 中登记，输出 `[REQUEST_USER_HELP]` 提示，便于开发者快速同步。

---

## 4. 关键工程保障：幂等性与产物可复现

1. **固定 Zip Mtime (Deterministic Output)**：
   - 标准 zip 格式会记录打包时刻的系统时间戳，导致同一份源文件多次构建产生的二进制 hash 不一致；
   - 脚本强制将 zip 内部文件的 `mtime` 固定为 UTC `2026-01-01 00:00:00`，确保纯函数式可复现构建。
2. **SHA-256 字节级比对跳过 (Idempotent Skip)**：
   - 在写入输出目录前，先对内存生成的数据做 SHA-256 比对；
   - 若与既有磁盘文件哈希一致，跳过磁盘写入，避免无效触发 Vite HMR 或 Git 假修改。

---

## 5. 运行时消费端：vrmWorker 与二级缓存

构建产出的 `.vrmbase` 与 `.vrmaddon` 会直接交由客户端运行时的 [`src/core/vrmWorker.ts`](../src/core/vrmWorker.ts) 消费：
- Worker 在后台执行 `fflate` 解压、WASM `bspatch` 重组与 GLB 4 字节边界对齐；
- 结合 [`src/lib/idb-vrm-cache.ts`](../src/lib/idb-vrm-cache.ts) 将完整合成结果缓存至 IndexedDB L2 仓库；
- 换装时主线程与 Worker 之间走 `Transferable ArrayBuffer` 零拷贝通信。
- 完整运行时与 0 帧 T-pose 消除机制详见技术白皮书 [`docs/OUTFIT_SWAP.md`](OUTFIT_SWAP.md)。
