# MToon NPR 材质扩展指南

本项目在 `@pixiv/three-vrm-materials-mtoon` 基础上进行了非真实感渲染（NPR）着色扩展，保持与标准 `VRMC_materials_mtoon` 规范完全兼容，同时提供更高质感的人物皮肤与服饰着色能力。

## 1. 材质加载配置

在创建 VRM 加载器时，通过指定 `materialType: MToonMaterial` 确保使用扩展 MToon：

```ts
import { MToonMaterial, MToonMaterialLoaderPlugin } from '@pixiv/three-vrm-materials-mtoon';

const mtoonPlugin = new MToonMaterialLoaderPlugin(parser, {
  materialType: MToonMaterial,
});
```

本地 monorepo 包位于 `packages/three-vrm-materials-mtoon`，在 Vite 开发环境下通过 `resolve.alias` 与 `glsl-raw-loader` 实现源码直读与热更新。

## 2. 扩展特性与着色参数

| 特性类别 | 参数字段 | 作用说明 |
|---|---|---|
| **柔和半兰伯特** | `softMix`, `blurBoost`, `shadowBorder`, `shadowBlur` | 在经典阶梯阴影与平滑半兰伯特之间插值，支持微调明暗交界线位置与过渡宽度 |
| **多阶阴影带** | `shadow2ndStrength`, `shadow2ndBorder`, `shadow2ndBlur`, `shadow2ndColor`<br>`shadow3rdStrength`, `shadow3rdBorder`, `shadow3rdBlur`, `shadow3rdColor` | 二阶/三阶阴影带，用于展现多层次景深与动漫风格阴影过渡色（如冷粉紫环境反光） |
| **环境与暗部提亮** | `ambientLift`, `shadeMainStrength`, `envStrength`, `giEqualizationFactor` | 暗部环境光混合与提亮，防止深阴影死黑并维持通透感 |
| **皮肤水润高光** | `skinSpecStrength`, `skinSpecPower`, `skinSpecFresnel`, `skinSpecColor` | 专为面部与身体设计的漫反射水润高光与边缘微光，避免刺眼白斑 |
| **发丝各向异性** | `hairSpecStrength`, `hairSpecPower`, `hairSpecShift` | 头发天使光环（Angel-ring）切线各向异性高光 |
| **布料丝绸高光** | `clothSpecStrength`, `clothSpecPower` | 服饰材质微表面各向同性高光 |
| **通用卡通高光** | `specularStrength`, `specularPower`, `specularBorder`, `specularBlur` | 阶梯式方向高光 |
| **环境反射拟合** | `reflectStrength`, `reflectFresnel`, `reflectMetallic`, `reflectSmoothness` | 无需环境贴图的轻量级视线反射拟合 |
| **背光包覆** | `backlightStrength`, `backlightColor` | 背光与边缘包覆散射效果 |
| **边缘轮廓光** | `rimBoost`, `rimBorder`, `rimBlur`, `rimDirStrength`, `rimIndirStrength`, `rimShadowMask`, `rimMainStrength`, `rimFresnelPower` | 方向性与反向边缘光，支持深度阴影遮罩 |
| **双重 MatCap** | `matcap2ndStrength`, `matcap2ndContrast`, `matcap2ndScale` | 二次采样的高光质感层 |
| **阴影接收隔离** | `receiveShadowRate` | 控制材质对主光投射阴影（ShadowMap）的接收率（0.0 ~ 1.0）。面部设为 0.0 杜绝碎发黑斑；身体与衣料设为 1.0 接收自然投影 |
| **织物掠射角微光** | `fabricSheenStrength`, `fabricSheenPower`, `fabricSheenColor` | 掠射角微表面漫反射微光，为旗袍、丝绸、缎面服饰提供柔和边缘质感 |

## 3. 几何与投影核心优化

1. **屏幕描边距离自适应（Screen Outline Clamp）**：
   在顶点着色器中对屏幕空间描边距离强制约束在 `0.45 ~ 5.0`，消除远距离拉远时描边过粗糊成黑团，以及镜头极度贴近时描边穿插面部的异常。
2. **曲面自阴影消除（Shadow Acne Mitigation）**：
   人体肢体与胸部属于光滑曲面网格，在 `receiveShadow = true` 接收外界发丝投影时，容易因深度采样阶梯产生规律条纹（Shadow Acne）。通过在主方向光上配置微正偏置与法线偏置：
   ```ts
   this.dirLight.shadow.bias = 0.00002;
   this.dirLight.shadow.normalBias = 0.035; // 沿曲面法线内缩偏移，彻底消灭自阴影斑马纹
   ```
   完美兼顾了**胸前发丝真实落影**与**皮肤平滑无杂纹**。

## 4. 部件分级调优配置

配置入口位于 `src/config.ts` 中的 `APP_CONFIG.mtoon.parts`：

- `face`（面部）：高平滑度、珍珠冷粉紫阴影、低强度柔和水润微光、`receiveShadowRate: 0.0`（纯净二次元脸部，不接外界投射脏影）。
- `body`（身体/四肢）：高平滑度、自然过渡阴影、冷白透亮底色、`receiveShadowRate: 1.0`（接收发丝与锁骨投影）。
- `hair`（头发）：开启切线各向异性天使环高光，高对比度明暗分界。
- `cloth`（服饰）：适度半兰伯特柔和混合，开启掠射角织物微光 (`fabricSheenStrength: 0.35`)。

## 5. 构建与验证

```bash
# 构建本地 MToon 包
pnpm -F @firetable/three-vrm-materials-mtoon build

# 运行本地开发环境
pnpm dev
```
