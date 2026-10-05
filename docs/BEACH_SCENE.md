# 海滩场景 `beach`

第 4 个内置场景（名字「海滩」/ Beach / ビーチ）：**不透明**场景，背景是 AI 生成插画拼成的竖长条，随相机**俯仰角**纵向滚动。主站、Tauri、`/embed`（`?scene=beach` / `xc.setScene('beach')`）共用同一份代码，圆角、TopHeader / ChatBar 常显等规则与 `light` / `dark` 相同；透明 / 穿透逻辑不受影响。

## 相机模型与背景映射

- 相机只有**俯仰**是绕角色转（`minPolarAngle 0.01` / `maxPolarAngle π-0.01`，近满 180°）；左右是角色自身 `bodyTurn`，**不动相机**。所以背景只做纵向滚动，**不随左右转动**。
- 背景是一个跟相机固定的全屏 quad（`src/core/scene/beachBackdrop.ts`，`renderOrder -1000`、无深度），片元里按俯仰角算竖条的采样中心；采样为 cover（宽高比不同只裁、不拉伸）。映射是纯函数（`src/core/scene/beachStrip.ts`，有单测）：
  - 平视时海平线对齐角色**髋部**（`scroll.horizonAboveHipsM` 微调）；
  - 俯仰到 ±89° 时采样窗口正好贴到竖条顶 / 底，不会露边 / 黑边；
  - 映射保证单调，窗口永远落在竖条内（任意宽高比，包括 600×1080 竖屏）。
- **滚轮缩放时背景跟随**（`APP_CONFIG.beachScene.zoom`）：相机前后距离变化时，背景同步缩放——推近放大、拉远缩小。倍率 = (默认取景视距 / 当前视距)^`strength`，夹到 `[minScale, maxScale]`（默认 0.65 / 0.6 / 1.8）；缩放中心是平视时的海平线（髋部附近），海平线不会因缩放上下跳。实现是把采样窗口按 1/zoom 缩放（`computeStripCenter` 的 `zoom` 参数），窗口始终落在竖条内；横屏宽度已用满 1280 时无法再缩小，只能放大。`strength=0` 背景不跟随，`1` 与角色等比缩放。
- 竖条由 `scripts/build-beach-strip.mjs` 生成（需要 `magick` + `cwebp`）：天空（垂直翻转，使淡色端接到主景）→ 主景 → 沙地，接缝各做 100~120px 渐变；同时生成 `beach-mask.webp`（R = 海面、G = 纯天空 / 云区）供 shader 限定动态范围。产物在 `public/scene/beach/`，缓存头与 `/vrm/*` 一致（`public/_headers` 的 `/scene/*`）。
- 第三张源图（沙地）已去掉四角的草和叶影，只剩纯沙地与贝壳，风格与另两张一致（明亮、赛璐璐、高调日光）；拼接后沙地区域四边无草、无黑边、无接缝。
- 源图是 1280×720，分辨率偏低；竖屏 cover 只用到中间约 31% 宽度，高 DPR 屏会有放大的柔化感（没有做锐化 / 假细节）。

## 局部动态（`APP_CONFIG.beachScene.dynamics`）

- 海面波光 / UV 微扰：只在 mask 的海面区域；
- 云：只在天空区做缓慢横向 UV 滚动（克制）；
- 花瓣 / 光点：GPU `Points`，画在角色身后，数量少、粉彩色。
- 关闭：`dynamics.enabled=false`，或系统 `prefers-reduced-motion`（`respectReducedMotion`），或运行时 FPS 过低自动降级（`autoDowngrade`）。关闭后背景是静态图，粒子隐藏。
- 所有强度 / 速度 / 数量及合法范围、调大调小的效果见 `src/types/config.ts#BeachSceneConfig` 的中文注释。

## 角色与背景融合（只做场景级微调，不动角色材质）

- `StudioLighting.applyTheme('beach')`：只改半球光的天 / 地颜色和平行光颜色（天空偏冷奶白、地面反射偏奶油沙色、主光略暖），**强度与角色材质不变**；离开 beach 恢复原值。
- `CharacterShadow.applyTheme('beach')`：ShadowMaterial 颜色改成匹配沙地的暖紫褐并开软阴影；脚下另加一个**柔和接触影子**（径向渐变平面，跟随脚位置，只在 beach 显示），因为这个场景没有地面网格。
- **脚下沙地**（`APP_CONFIG.beachScene.ground`）：脚下铺一块真实的 3D 沙色圆盘（半径 `radiusM`，边缘径向羽化淡出，带很轻的沙纹），颜色与背景沙地一致，所以全身时脚是踩在沙上、俯视时圆盘与背景沙地无缝衔接。圆盘画在落影 / 接触影之下、角色之后。只有脚底进入画面（NDC y 高于 `fadeOutNdcY`，到 `fadeInNdcY` 完全显示）才显示——半身取景脚在画面外，画面与之前完全一致。
- 落影与接触影：地面落影（`shadowColor` / `shadowOpacity`）与脚下接触影（`contactColor` / `contactOpacity` / `contactSizeM`）调到足以在沙上"压"出脚印般的暖褐软影，不用纯黑。
- PostFX：背景 quad 写入的 alpha 为 0.99 作标记，Bloom 高通跳过这类像素（避免亮沙地 / 天空被泛光洗白），OutputPass 再把 alpha 还原为 1。其他场景不受影响。
- 其他场景：`lineworkWorld` 把 `beach` 与 `transparent` 一样当“无线稿世界”处理（背景 null、线稿隐藏），背景由 backdrop 负责。
