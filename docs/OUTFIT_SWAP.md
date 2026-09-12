# Outfit Swap（整套衣服切换）— 现状与方案

> **状态**：🟢 方案 A（状态迁移）已落地（2026-09-10）；整 VRM 重载 + capture/restore，旧 VRM deepDispose
> **核心文件**：`src/core/vrmEngine.ts` · `src/components/dev-drawer/sections/WardrobeSection.tsx` · `src/config.ts`  
> **相关**：本仓库 `docs/ARCHITECTURE_AND_RULES.md` §2（Wardrobe 部件穿脱）· §3（DevDrawer）

---

## 1. 我们想做什么

让 **小 X** 在页面里**不重启、不破坏当前姿态/动画/表情**的前提下，整套换装（裸 ↔ 穿）。

- **触发**：DevDrawer「Wardrobe」右上角的 `🧥 换上 v1_1 全套` / `🔄 切回 v1 裸` 按钮（也可外露到主 UI）。
- **期望效果**（尽力，终测写实）：
  - 当前 VRMA / EMAGE 动作尽量继续（seek/resume，非强制 idle）
  - 表情 blendshape、视线 / glance 尽量不丢
  - spring bone 尽力延续（私有 verlet 字段 best-effort）
  - **朝向** `scene.rotation.y` 恢复（避免 loadVRM 清零导致转身跳）
  - BodyTurn 踱步 / FootIK sink：**尽力**恢复轻量快照；几何重绑后仍可能有一帧收敛
  - **镜头**：换装不 `fitCamera`、不 cinematic；旧模型保持可见直到新模型就绪（避免闪没）
- **代价预算**：整 VRM 重载受下载/解析约束，**不以固定 ≤200ms 为硬指标**；终测以「无闪没、镜头不跳、动作大体连续」为准。显存不永久双开。

---

## 2. 现状（方案 3：整 VRM 重载）

### 2.1 文件与资产

| 项 | 值 |
|---|---|
| 默认角色 | `public/xiaochun_v1.vrm`（16 MB，**裸体**） |
| 目标角色 | `public/xiaochun_v1_1.vrm`（19 MB，**穿整套**） |
| 配置入口 | `src/config.ts` `defaultVrm: '/xiaochun_v1.vrm'` |
| 切换入口 | `WardrobeSection.tsx` 第 142-155 行的按钮 |

### 2.2 当前切换流程

```
[按钮点击]
  └─ vrmEngine.loadVRM('/xiaochun_v1_1.vrm', '小X (v1_1 穿)')
       ├─ VRMUtils.deepDispose(this.currentVRM.scene)
       │     └─ 销毁 v1 的 GameObject 树
       │           ├─ Animator（组件级销毁）
       │           ├─ humanoid 骨架节点
       │           ├─ blendshape / expression
       │           ├─ spring bone state
       │           └─ 所有材质/纹理
       │
       ├─ GLTFLoader → VRMLoaderPlugin 加载 v1_1
       │     ├─ 新 humanoid、新 Animator（idle pose）
       │     ├─ blendshape 全 0
       │     ├─ spring bone 重置
       │     └─ vrmaPlayer/motionPipeline/lookAt 全部 .bind(新 vrm)
       │
       └─ render 下一帧 → 新角色站 idle
```

### 2.3 实际损失清单

切换瞬间以下状态全清零：

| 系统 | 切换前 | 切换后 |
|---|---|---|
| VRMA 动画 | 在 `time = 3.2s` 播 idle2 | 从 `time = 0` 播 idle2 |
| EMAGE motion_chunk | `motion_id=12, time=1.4s` | 回到 idle |
| blendshape（表情）| `joy=0.7, blinkL=0.3` | `joy=0, blinkL=0` |
| LookAt 目标 | `(0.3, 1.5, -0.8)`（用户鼠标） | 回中央 |
| spring bone 状态 | 头发甩动到右侧 | 复位竖直 |
| BodyTurn 步态 | 正在 step 5/8 | 重置为 `step = 0` |
| FootIK 地面 sink | 已测得 4.6cm | 重新探测 |
| Smootherstep transition | crossfade 进行中 | 被打断 |

---

## 3. v1 与 v1_1 的几何差异（实测）

来自 `/tmp/measure_diff.py` 对 `xiaochun_V1.vrm` 与 `xiaochun_v1_1.vrm` body mesh 的逐骨头 centroid/bbox 量测：

| 部位 | v1（裸）| v1_1（穿）| 差异 |
|---|---:|---:|---|
| 总高（bbox Y）| 1.575 m | 1.627 m | **+5.2 cm** |
| 总 centroid Y | 0.950 | 1.041 | +9.1 cm（衣服整体外扩） |
| Head centroid Y | 1.474 | 1.526 | +5.2 cm ← 身高差全在这 |
| Hips centroid Y | 0.892 | 0.966 | +7.4 cm（衣服厚度） |
| Hips bbox 宽 | 0.252 | 0.310 | **+5.8 cm（+23%）** ← 裙子撑开 |
| UpperChest bbox 宽 | 0.226 | 0.300 | **+33%** ← 衣服撑胸 |
| Head bbox | 0.180 × 0.234 | 0.180 × 0.234 | ✅ 完全一致 |

**关键结论**：

1. **骨骼 transform 完全一致** — VRoid 不改骨架只改 mesh，bones 的 translation/rotation/scale 一致 → Animator 兼容。
2. **Mesh 几何差异巨大** — v1_1 各部位比 v1 大 23%~33%，attach 会出现穿模/破洞/身高错位。
3. **身高+5.2cm 来自 mesh 自身**（鞋底+袜子），不是 root 高度差。

这意味着**方案 1（attach 5 个 SkinnedMesh 到 v1）不可行** — 几何差异太大，会穿模。**必须靠状态迁移**来保动画。

---

## 4. 三种解决路径对比

### 方案 A — 状态迁移（推荐落地）⭐

**思路**：切换前快照所有动画/表情/视线状态，切后灌回新 VRM。

**改动量**：~150 行
- 新增 `OutfitSwapState.capture(vrm)` / `restore(vrm)` API
- 切换按钮在 loadVRM 前后自动调用
- 不改 vrmEngine 主体结构

**能保什么**：
- ✅ VRMA 进度（保存 url + currentTime，切后 loadVRMA(url, currentTime)）
- ✅ blendshape 字典
- ✅ LookAt 目标
- ⚠️ spring bone（保存 joint angles，切后 apply）— 约 80% 准
- ❌ BodyTurn 步态（无状态机接口，只能重置）
- ❌ FootIK sink（需重新探测）

**坑**：
- `VRMAnimationLoaderPlugin.loadVRMAFromUrl(url)` 后需要手动 `playVRMA(vrma)` 然后 `setTime(currentTime)`
- 切换 VRMA 期间有 ~50ms 真空帧（角色瞬时 idle）— 可用 fade 掩盖

**风险**：低。可灰度。

---

### 方案 B — VRoid 端根治（一次性投入，长期最优）

**思路**：在 VRoid Studio 里把 v1 和 v1_1 调到**完全相同的身体参数 + 服装贴合度**，导出后两套 mesh 差异 < 1cm → attach 可行。

**改动量**：0 代码 + 一次性 VRoid 操作
- VRoid 里：v1 和 v1_1 用同一份 Body 模板（同一身高、同一体型、同一体脂）
- 服装的"穿后厚度"调到 ≤ 2mm（实际上不可能）

**能保什么**：
- ✅ 切换 = 5 个 SkinnedMesh `.attach()` 到 v1.scene
- ✅ 动画 100% 保（不重建 VRM）
- ✅ 表情/视线/spring bone 全保

**坑**：
- **VRoid 服装模型本身就会改 mesh**（Dress-up 功能会把衣服烘进 body_skin），不可能做到 < 1cm
- 同一身高是可行的，但衣服厚度差 5cm 是**物理上无法消除**的（袜子确实比裸脚厚）

**结论**：**治不了根**。VRoid 工作流的硬限制。可以改善，但不能消灭差异。

---

### 方案 C — 自定义 vertex shader 反向 skinning（学术路径）

**思路**：vertex shader 里把 v1_1 顶点先按 v1_1 的 inverseBindMatrix 拆下来，再装到 v1 的当前骨骼矩阵上。

**改动量**：~500 行 + 自定义 MToon shader
- 需要为 5 个 clothes primitive 各写一个 `onBeforeCompile` patch
- 需要 v1 和 v1_1 的**骨骼权重同构**（同一顶点位置必须有权重映射）

**能保什么**：
- ✅ 如果权重同构 → 几何差异完全消除
- ✅ 动画 / 表情 / 视线全保

**坑**：
- v1 和 v1_1 **同一身体部位的顶点权重分布不同**（v1 皮肤贴 thigh 骨，v1_1 袜子顶点贴裙根骨）— 权重**不同构**，换算后顶点会跳
- MToon 是封闭 shader，patch 风险大（每次 @pixiv/three-vrm 升级都要重写）

**结论**：**理论可行，工程上不可靠**。仅在 v1 = v1_1 几何差 < 0（不可能）时才行。

---

## 5. 推荐执行计划（方案 A）

### Phase 1 — 状态快照与恢复基础设施（~80 行）

文件：`src/core/vrmEngine.ts`

新增方法：

```typescript
// 切之前调
captureAnimationState(): OutfitSwapState {
  return {
    vrmaUrl: this.currentVRMA?.url ?? null,
    vrmaTime: this.currentVRMA?.currentTime ?? 0,
    blendshapes: Object.fromEntries(
      Object.entries(this.currentVRM?.expressionManager?.expressions ?? {})
        .map(([k, v]) => [k, v.value])
    ),
    lookAtTarget: this.lookAtController?.target?.clone() ?? null,
    springBoneSnapshot: this.captureSpringBoneState(),
  };
}

// 切之后调（vrm 已替换完成）
restoreAnimationState(state: OutfitSwapState) {
  // 1. blendshape
  for (const [k, v] of Object.entries(state.blendshapes)) {
    this.currentVRM.expressionManager.setValue(k, v);
  }
  // 2. LookAt
  if (state.lookAtTarget) this.lookAtController.lookAt(state.lookAtTarget);
  // 3. VRMA（重载 + 跳时间）
  if (state.vrmaUrl) {
    await this.loadVRMA(state.vrmaUrl);
    this.currentVRMA.setTime(state.vrmaTime);
  }
  // 4. spring bone
  this.applySpringBoneState(state.springBoneSnapshot);
}
```

### Phase 2 — 切换按钮接入（~30 行）

文件：`src/components/dev-drawer/sections/WardrobeSection.tsx`

```typescript
const handleToggle = async () => {
  if (!vrmEngine.currentVRM) return;
  const state = vrmEngine.captureAnimationState();
  await vrmEngine.loadVRM(
    next ? '/xiaochun_v1_1.vrm' : '/xiaochun_v1.vrm',
    next ? '小X (v1_1 穿)' : '小X (v1 裸)'
  );
  await vrmEngine.restoreAnimationState(state);
};
```

### Phase 3 — 验证清单

- [ ] 切前 VRMA time = 3.2s → 切后还在 time ≈ 3.2s ± 0.1s（DevDrawer 换装按钮）
- [ ] 切前表情 joy=0.7 → 切后 joy 仍 ≈ 0.7
- [ ] 切前视线偏移 → 切后 glance offset 延续（相机驱动 lookAt）
- [ ] 切前头发甩动中 → 切后相近角度（spring best-effort）
- [ ] EMAGE 说话中换装 → 不强制 idle，动作继续
- [ ] 切换后显存不增长（不永久缓存双 VRM）
- [ ] 朝向大致保持；BodyTurn/FootIK 尽力（可有短收敛）
- [ ] 换装时镜头不跳、角色不闪没（旧模型留到新模型就绪）

### Phase 4 — 后续优化（不在本次范围）

- 把切换按钮从 DevDrawer 移到主 UI（让用户能直接触发）
- 加 `localStorage` 记忆用户的「喜欢穿」状态
- 支持更多套衣服（v1_2, v1_3...）

---

## 6. 状态迁移与无缝交接技术规范 (2026-09-12 最新版本)

**入口**：`VRMEngine.swapOutfit(url, filename)` ← `TopHeader.tsx` 顶栏正式服装下拉菜单（支持记忆至 `localStorage`）。

**完整交接流程**：
`Worker 后台增量解压/缓存合成` → `GLTFLoader.parse (旧模型在屏幕全速运转)` → `内存预置姿态 (restoreAnimationState)` → `同帧原子替换 (scene.remove + scene.add)`。

| 状态维度 | 恢复质量与实现细节 |
|---|---|
| **VRMA 动作** | ✅ 内存 Buffer 零网络开销复用；解析后 `playLoop` / `playClipOnMixer` + `seek(currentTime)` 瞬间就绪 |
| **thinking.vrma** | ✅ 内存 ArrayBuffer 零延迟缓存 + `playLoop` + seek |
| **EMAGE 语音动作** | ✅ `pause`（不 `stop`）保留 rot6d 流式 buffer → rebind 新骨骼 → seek + `resume` |
| **Universal Motion** | ✅ 支持 URL 与 ArrayBuffer 内存双通道复用，seek 精准时间戳 |
| **Blendshapes (表情)** | ✅ expressionMap 逐项在内存中完成 `setValue()` 赋值 |
| **LookAt / Gaze 视线** | ✅ 聚焦点与眼球微扫（Glance Offset）无缝灌回 |
| **Spring Bone 惯性** | ⚠️ best-effort（四元数 + 私有 `_currentTail`/`_prevTail` 向量映射） |
| **Scene Yaw 身体朝向** | ✅ 自动补偿 `sceneYaw`，彻底抵消加载模型时的重置转身跳 |
| **BodyTurn 踱步** | ⚠️ 轻量 snapshot 恢复；重绑骨骼后短收敛 |
| **FootIK 离地高度** | ⚠️ barefoot/stance 恢复；鞋底几何随新服装自动自适应探测 |
| **镜头稳定性** | ✅ 彻底屏蔽 `fitCamera` 与 cinematicIntro，视角保持纹丝不动 |
| **换装抽搐与卡顿** | ✅ **彻底消灭**（旧模型无提前刹车 150ms，新模型无 1 帧 T-pose Pop-in） |
| **二次换装耗时** | ⚡ **数十毫秒**（直接命中 IndexedDB L2 完整 GLB 缓存） |

---

## 7. 增量差分分发与双层 IndexedDB 缓存体系

为了消灭全量 20MB+ VRM 下载瓶颈，工程上落地了 Delta 方案：

```
[源资产] xiaochun_base.vrm + xiaochun_*.vrm
               ↓ (scripts/build-vrm/workflow.mjs)
[分发产物] xiaochun_base.vrmbase (5.9MB) + 5 套 *.vrmaddon (0.7~4.7MB, zip 含 delta.bin + json)
               ↓ (网络传输: 节省 ~65% 体积)
[Web Worker] WASM bspatch (vrmWorker.ts, 零主线程开销)
               ↓
[L1 缓存] IDB 缓存原始 raw chunks (按 baseSha 存储)
[L2 缓存] IDB 缓存合成好的完整 GLB 二进制 (二次秒开，无需再解压和 bspatch)
```

### 7.1 Dedicated Web Worker 架构 (`src/core/vrmWorker.ts`)

为确保在网络拉取、解压和 bspatch 期间主线程 Three.js 渲染循环稳保 60 FPS，整个二进制重组流水线移入独立 Web Worker：

1. **零主线程冻结**：
   - `fetch` 网络代理：由 Worker 独立发起网络请求；
   - `fflate` 解压：zip 内快速提取 patch 与 target.json；
   - `bsdiff-wasm` 执行 `bspatch`：在 WebAssembly 内部直接操作 TypedArray；
   - `packRawGLB`：封装标准 GLB Header、JSON Chunk 与 BIN Chunk 并执行 4-byte 字节边界对齐。
2. **Transferable 零拷贝转移**：
   - Worker 合成完毕后，以 `Transferable ArrayBuffer` 将最终 `composedGLB` 的内存所有权直接转交主线程，完全规避 16MB+ 的内存深度克隆开销。
3. **请求协议与并发安全**：
   - 消息通过自增 `id` 严格配对，支持跨次快速切换的并发请求竞态消除；
   - **请求**：`{ id, type: 'compose_outfit', baseUrl, baseSha, addonUrl, addonSha }`
   - **进度**：`{ id, type: 'compose_progress', phase: 'fetch_addon'|'fetch_base'|'unzip'|'bspatch'|'pack', loaded, total, pct }`，驱动 UI 顶栏换装按钮的 Loading 状态；
   - **成功**：`{ id, type: 'compose_ok', composedGLB, elapsedMs }`；
   - **错误**：`{ id, type: 'compose_err', error }`。
4. **主线程控制台日志代理**：
   - Worker 内部通过 `proxyConsole` 将 Worker 内部的 Cache Hit / Miss、合成耗时日志透传回主线程控制台，极大方便调试。

### 7.2 双层 IndexedDB 缓存体系 (`src/lib/idb-vrm-cache.ts`)

依托浏览器原生 IndexedDB（数据库名 `xiaochun-vrm-cache`），建立两级存储：
- **L1 级 `base` 存储**：Key 为 `baseSha`（如 `c987fae...`），缓存解压后的基础 BIN 字节流。保证 5.9MB 底模在用户设备上终身只下载一次；
- **L2 级 `composed` 存储**：Key 为 `${baseSha}:${addonSha}` 复合哈希键，直接持久化 bspatch 完成后的完整 GLB 二进制。二次切到已穿过的服装时，Worker **直接从 IDB 读出并即刻返回（耗时仅 10~30ms）**，彻底跳过网络请求与 WebAssembly 差分解算。

### 7.3 现已接入的 5 套官方扩展：
1. `xiaochun_default` (Techwear 机能风，默认加载)
2. `xiaochun_cheongsam` (Cheongsam 旗袍)
3. `xiaochun_bikini` (Bikini 比基尼)
4. `xiaochun_maid` (Maid 女仆装)
5. `xiaochun_swimsuit` (Swimsuit 连体泳装)

---

## 8. 历史决策记录（避免重走弯路）

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-09-08 | 放弃方案 1（attach 5 mesh）| bones 重映射后 z-fight + VRoid 烘焙网格几何差异大，严重穿模破皮 |
| 2026-09-08 | 放弃方案 2（Blender 拆分）| 工作量大且随 VRM 迭代成本极高，治标不治本 |
| 2026-09-09 | 采用方案 3（整 VRM 重载）| 实现简单、服装贴合与材质效果最纯净 |
| 2026-09-09 | 发现方案 3 动画重置 | 转向方案 A（状态快照与迁移）补救 |
| 2026-09-10 | 落地方案 A（状态迁移）| capture→loadVRM(preserveMotion)→restore；旧 VRM 仍 dispose |
| 2026-09-11 | 落地 Delta 路线与 Worker 合成 | 格式标准化为 `.vrmbase` + `.vrmaddon`，体积减少 65%，落地 L1/L2 双层 IDB 缓存 |
| 2026-09-11 | 换装外露至 TopHeader | 从 DevDrawer 内部移至顶栏用户正式交互，加入 `localStorage` 穿衣持久化记忆 |
| 2026-09-12 | 解决时序卡顿与 1 帧抽搐 | 旧模型不提前 stop（0 发愣），新模型在内存置好姿态再上屏（0 抽搐），动作内存缓存 |

---

## 9. 相关废弃物与历史归档

- `public/xiaochun_v1.vrm` — 原始 21.4 MB 单体模型，已被 `.vrmbase` + `.vrmaddon` 完全替代并删除
- `/tmp/pack_outfits.py` — 早期打包 diff.glb 脚本，已废弃
- `/tmp/extract_outfits.py` — 早期抽 xwear 脚本，已废弃

