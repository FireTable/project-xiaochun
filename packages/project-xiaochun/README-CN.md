<p align="center">
  <img src="https://raw.githubusercontent.com/FireTable/project-xiaochun/main/public/logo.png" width="96" height="96" alt="Project XiaoChun Logo" style="border-radius: 16px;" />
</p>

<h1 align="center">@firetable/project-xiaochun</h1>

<p align="center">
  <b>把「小蠢」——100% 浏览器原生的 3D 二次元陪伴角色——嵌入任意网页:懒加载、严格 origin 校验、零运行时依赖</b>
</p>

<p align="center">
  <a href="README.md">English</a> •
  简体中文
</p>

<p align="center">
  <a href="https://xiaochun.firetable.tech"><b>🌐 在线体验</b></a>
  •
  <a href="https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md"><b>📚 完整嵌入文档</b></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@firetable/project-xiaochun"><img src="https://img.shields.io/npm/v/@firetable/project-xiaochun?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://xiaochun.firetable.tech"><img src="https://img.shields.io/badge/Live_Demo-xiaochun.firetable.tech-10b981?logo=cloudflare&logoColor=white" alt="Live Demo" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-amber.svg" alt="License" /></a>
</p>

---

## 📖 项目简介 (Overview)

这个包通过一个**懒加载、严格校验 origin 的 `<iframe>`**,把 **[Project XiaoChun(小蠢)](https://github.com/FireTable/project-xiaochun)** 放到你自己的网站上。角色、端上 AI(WebLLM / SenseVoice 语音识别 / EMAGE 动作)和所有重资源都在 iframe 里,你的页面只多出几 KB 的胶水代码(SDK 不会打包 three.js)。

* 🧩 **`createXiaochun()`**:无框架 JS SDK。
* 🏷️ **`<xiaochun-avatar>`**:Web Component(Shadow DOM,属性 + 事件)。
* ⚛️ **`@firetable/project-xiaochun/react`**:`<Xiaochun />` 组件与 `useXiaochun` hook(SSR 安全、StrictMode 安全)。
* 📜 **一行 `<script>` loader**:IIFE 构建,走 jsDelivr / unpkg,无需构建。
* 🔊 **`speakAudio()`**:把你自己的音频交给小蠢,她会带着肢体动作和口型念出来。
* 📦 ESM + CJS + `.d.ts`;协议常量与类型从 `@firetable/project-xiaochun/protocol` 导出。

---

## 📥 安装 (Installation)

```bash
npm i @firetable/project-xiaochun
# 或
pnpm add @firetable/project-xiaochun
# 或
yarn add @firetable/project-xiaochun
```

不想构建?用 CDN loader(生产环境请锁定版本):

```html
<script src="https://cdn.jsdelivr.net/npm/@firetable/project-xiaochun@0.1/dist/loader.global.js" defer></script>
<xiaochun-avatar position="bottom-right" size="280" lang="zh-CN"></xiaochun-avatar>
```

unpkg 上是同一个文件:`https://unpkg.com/@firetable/project-xiaochun@0.1/dist/loader.global.js`。

| 入口 | 用途 |
| :--- | :--- |
| `@firetable/project-xiaochun` | `createXiaochun`、协议常量/类型、`toProtocolUrl` |
| `@firetable/project-xiaochun/element` | 注册 `<xiaochun-avatar>`(副作用导入) |
| `@firetable/project-xiaochun/react` | `<Xiaochun />`、`useXiaochun`(需要 `react >= 18`,可选 peer 依赖) |
| `@firetable/project-xiaochun/protocol` | 仅协议常量与类型 |
| `@firetable/project-xiaochun/loader` | IIFE 包(全局变量 `window.Xiaochun`) |

---

## 🚀 快速上手 (Quick Start)

### JavaScript SDK

```ts
import { createXiaochun } from '@firetable/project-xiaochun';

const xc = createXiaochun({
  container: '#avatar',
  width: 320, height: 480,          // 预留固定尺寸 → 零布局抖动
  placeholder: '/img/xiaochun.webp',
  transparent: true,
});

await xc.ready;                      // 模型加载完成
await xc.say('你好呀');              // 念完才 resolve
xc.on('stt', (p) => p.kind === 'text' && console.log(p.text));
xc.destroy();
```

### Web Component

```html
<script type="module">import '@firetable/project-xiaochun/element';</script>
<xiaochun-avatar id="xc" size="320x480" lazy="click"></xiaochun-avatar>
<script>
  xc.addEventListener('xc-ready', () => xc.say('你好!'));
</script>
```

### 一行 script(自动挂一个悬浮头像)

```html
<script src=".../dist/loader.global.js" data-auto data-position="bottom-right" data-size="280" defer></script>
```

`data-*` 属性对应 `<xiaochun-avatar>` 的同名属性。

---

## ⚛️ React

`react` 是**可选的 peer 依赖**(`>=18`,同时支持 React 18 与 19)。子路径是独立的包,主入口体积不会增加。文件带 `'use client'`(兼容 Next.js App Router)。服务端只渲染一个固定尺寸的空 `<div>`,iframe 在客户端 effect 里才创建;`<StrictMode>` 下 effect 清理一定会调用 `destroy()`,不会泄漏。

```tsx
import { useRef } from 'react';
import { Xiaochun, useXiaochun, type XiaochunHandle } from '@firetable/project-xiaochun/react';

export function Mascot({ audio }: { audio?: ArrayBuffer }) {
  const ref = useRef<XiaochunHandle>(null);
  return (
    <>
      <Xiaochun
        ref={ref} width={320} height={480} transparent lazy placeholder="/xc.webp"
        onReady={() => ref.current?.say('你好呀')}
        onUtterance={(u) => console.log(u.phase, u.kind)}   // 'start' | 'end', 'text' | 'audio'
        onError={(e) => console.warn(e.code, e.message)}
      />
      <button onClick={() => audio && ref.current?.speakAudio(audio)}>播放音频</button>
    </>
  );
}

// 想自己控制布局?用 hook:
const { containerRef, client, ready, state } = useXiaochun({ width: 280, height: 420 });
// <div ref={containerRef} style={{ width: 280, height: 420 }} />
```

* **Props**:`createXiaochun` 除 `container` 外的全部选项,加上 `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onError / onDestroy`、`className`、`style`、`paused`、`mic`。
* **重建与热更新**:创建期选项(`src`、`lazy`、`transparent`、`width`、`height`、`position` 等)变化会重建实例,所以不要在每次渲染里传新值。`lang`、`model`、`paused`、`mic` 与回调会原地更新,不重建 iframe。
* **ref 方法**:`say`、`speakAudio`、`speakAudioStream`、`motion`、`expression`、`lookAt`、`setModel`、`setConfig`、`startListening`、`stopListening`、`mic`、`pause`、`resume`、`activate`、`destroy`,以及 `ready` 与 `instance`。组件挂载前,返回 Promise 的方法会 reject。

---

## 🔊 宿主传音频 (`speakAudio`)

跳过内置 TTS,让小蠢念**你自己的**音频。iframe 负责解码,EMAGE 生成匹配的肢体动作(16 kHz 单声道窗口),音画同步并带口型,播放结束时触发 `utterance end`。重模型仍然懒加载:第一次带动作的 `speakAudio` 才会加载 EMAGE,`motion: false` 则永远不加载。

```ts
await xc.speakAudio(arrayBuffer, { text: '你好', motion: true, lipsync: true }); // ArrayBuffer 会被 transfer(detach);要保留就传 { transfer: false }
await xc.speakAudio(blob);                                   // Blob(mp3 / wav / ogg 等)
await xc.speakAudio('https://cdn.example.com/voice.mp3');    // URL:默认由宿主页 fetch({ fetch: 'frame' } = 交给 iframe 去 fetch)
await xc.speakAudio(pcm, { format: 'pcm16', sampleRate: 24000 });   // 无头原始 PCM 必须给 sampleRate(8000–96000)

const s = xc.speakAudioStream({ sampleRate: 24000 });        // 流式:比如 TTS 服务边合成边返回的 PCM 块
s.write(int16Chunk); s.write(next); s.end(); await s.done;   // s.abort() 立即停止
// 随时可取消:传 { signal: abortController.signal }
```

* 失败时 reject:`bad_request`(无法解码 / 空音频 / URL 或 sampleRate 不合法)、`unsupported`、`failed`。
* 浏览器仍要求宿主页先有用户手势才能出声,iframe 也要有 `allow="autoplay"`(SDK 已自动设置)。
* 新的 `say()` / `speakAudio()` 会打断正在进行的那一次,被打断的 Promise 会 resolve。
* `<xiaochun-avatar>` 与 React 的 ref 提供同名的 `speakAudio` / `speakAudioStream` 方法。

---

## 🎨 样式 (CSS 变量与 `::part`)

宿主只能调整**外壳**。角色在跨域 iframe 里,你的 CSS 无法影响 iframe 内部。

| 变量 | 默认值 | 作用 |
| :--- | :--- | :--- |
| `--xc-radius` | `0` | 圆角(任意 CSS 长度,如 `24px`;`50%` 为圆形头像框)。调大更圆,过大会裁掉头和脚 |
| `--xc-shadow` | `none` | `box-shadow` 简写。透明悬浮头像请保持 `none` |
| `--xc-z-index` | `2147483000` | 仅悬浮模式。调小可以让你的弹窗和导航盖在头像上面 |
| `--xc-offset-x` / `--xc-offset-y` | `16px` | 仅悬浮模式:距屏幕侧边 / 底边的距离 |
| `--xc-bg` | `transparent` | iframe 加载期间的底色(`transparent` 模式下忽略) |

```css
xiaochun-avatar {
  --xc-radius: 24px;
  --xc-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  --xc-offset-y: 72px;                       /* 抬高,避开底部导航栏 */
}
xiaochun-avatar::part(iframe) { outline: 1px solid #0002; }
```

可用的 part:`mount` · `wrapper` · `iframe` · `placeholder`。

---

## 🔌 `xiaochun://` 与 `xc.*`

`xiaochun://` 是由小蠢桌面客户端(Tauri)处理的 **OS 级 deep link**;`xc.*` 是你的页面与 `/embed` iframe 之间的 **postMessage 协议**。两者是同一组动作的两个传输层,在应用内共用同一个 handler。`/embed` 页面不会响应 `xiaochun://`。

| SDK / `xc.*` | 桌面 deep link |
| :--- | :--- |
| `say(text)` | `xiaochun://speak?text=…` |
| `speakAudio(url)` | `xiaochun://speak?audioUrl=…[&text=…]` |
| `speakAudio(ArrayBuffer \| Blob)`、`speakAudioStream` | —(二进制数据放不进 URL) |
| `say(text, { mode: 'chat' })`、`motion`、`expression` 等 | — |

`toProtocolUrl()` 与 `parseProtocolUrl()` 是纯字符串函数,可用于桌面脚本或 `<a href>` 链接;`XC_PROTOCOL_MAPPING` 是上表的机器可读版本:

```ts
import { toProtocolUrl } from '@firetable/project-xiaochun';

toProtocolUrl({ action: 'speak', text: '你好' });
// → 'xiaochun://speak?text=%E4%BD%A0%E5%A5%BD'
toProtocolUrl({ action: 'speak', audioUrl: 'https://cdn.example.com/hi.mp3', text: '你好' });
// → 'xiaochun://speak?text=%E4%BD%A0%E5%A5%BD&audioUrl=https%3A%2F%2Fcdn.example.com%2Fhi.mp3'
```

详见 [`docs/PROTOCOL.md` §6](https://github.com/FireTable/project-xiaochun/blob/main/docs/PROTOCOL.md) 与 [`docs/EMBED.md` §2.4–2.5](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md)。

---

## 🔐 权限、CSP 与跨源隔离

### iframe 必须被允许使用麦克风和音频

SDK 会自动设置 `allow="microphone; autoplay"`。如果你手写 iframe,**必须**自己加上:

```html
<iframe src="https://xiaochun.firetable.tech/embed?host=https%3A%2F%2Fyour-site.com"
        allow="microphone; autoplay" loading="lazy" width="320" height="480"></iframe>
```

* `microphone`:端上语音识别(`xc.mic`),需要 HTTPS。
* `autoplay`:语音音频。宿主页仍需要先有用户手势(把第一次 `say()` 绑定到点击上)。
* `host=`:你页面的 origin。缺少它时握手会**默认拒绝**(fail closed)。

### CSP / COOP / COEP

* **你的 CSP**:允许 `frame-src https://xiaochun.firetable.tech`(如果用 CDN loader,还要允许 `script-src https://cdn.jsdelivr.net`)。
* **`/embed` 的响应头**(由小蠢部署端设置):没有 `X-Frame-Options`;默认 `Content-Security-Policy: frame-ancestors *`(自建部署可以收紧);`Permissions-Policy: microphone=(self)`;`Cross-Origin-Resource-Policy: cross-origin`。
* **你的 COOP/COEP**:宿主页设置 `COEP: require-corp` 也能正常嵌入(embed 会发送 CORP)。要让 iframe 自身跨源隔离,需要宿主页也隔离**并且** `allow="cross-origin-isolated"`(即下面可选的 `crossOriginIsolated` 开关);否则端上 ONNX 以单线程运行(更慢但可用)。
* **第三方存储分区**:iframe 内缓存的模型按顶层站点分区,所以每个宿主站点都会各自下载一份。因此 embed 默认**不会**预加载端上 LLM / EMAGE 模型(`heavy: 'lazy'`)。
* **安全性**:握手校验 origin 之后,消息走 `MessageChannel`;从不使用 `'*'` 作为 targetOrigin;通配的 `origin` / `allowedOrigins` 会被拒绝。


### 可选:跨源隔离,让 EMAGE 用多线程

默认 iframe 内 `crossOriginIsolated` 为 `false`,onnxruntime-web 使用**单线程** wasm。要启用多线程(`SharedArrayBuffer`),下面三点缺一不可:

1. **宿主页自己跨源隔离**:页面响应头同时带 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: credentialless`(或 `require-corp`),此时宿主页里 `window.crossOriginIsolated === true`。
2. **embed 文档自己也带 COEP**:`/embed` 已发送 `COEP: credentialless` + `CORP: cross-origin`,无需处理(COOP 在 iframe 内被忽略)。
3. **宿主向 iframe 委派**:跨源 iframe 不会自动继承。打开选项即可(默认关闭,默认 `allow` 仍是 `'microphone; autoplay'`):

```js
createXiaochun({ container: '#stage', crossOriginIsolated: true });  // allow="microphone; autoplay; cross-origin-isolated"
```
```tsx
<Xiaochun crossOriginIsolated />                                    // React
```
```html
<xiaochun-avatar cross-origin-isolated></xiaochun-avatar>
<!-- 手写 iframe:allow="microphone; autoplay; cross-origin-isolated" -->
```

```nginx
add_header Cross-Origin-Opener-Policy  "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;  # 或 require-corp
```

**收益**:EMAGE 推理线程数最高 `min(hardwareConcurrency, 桌面 8 / 手机 4)`。Node 实测同一段推理:**1 线程 274 ms → 4 线程 79 ms(约 3.5 倍)**。

**副作用(隔离的是*你的*页面)**:

* 页面上所有跨源子资源都必须满足 COEP。`credentialless` 下 no-cors 跨源请求会**不带** cookie/凭据(依赖凭据的第三方图片/脚本可能出问题);`require-corp` 下则必须有 `CORP: cross-origin` 或 CORS,否则被拦截。
* 页面里其他第三方 **iframe**(广告、地图、视频、支付、评论等)自己也必须发 COEP,否则被拦截;`COOP: same-origin` 还会切断 `window.opener`(依赖回传的 OAuth / 支付弹窗可能失效)。
* Safari 不支持 `credentialless`,请用 `require-corp`;不支持隔离的浏览器上该选项无效,自动退回单线程。
* 宿主页未隔离时开这个选项没有任何效果。请先在预发环境验证。

**验证**:`xc.ready` 握手里带 `capabilities.crossOriginIsolated`(应为 `true`);或在 iframe 的控制台上下文执行 `crossOriginIsolated`;EMAGE worker 上报的 `numThreads > 1`。本地:`node examples/serve-isolated.mjs`,然后打开 `http://localhost:8081/examples/embed-host.html?isolated=1`。

---

## ⚡ 对 Lighthouse 友好的用法

```ts
createXiaochun({
  container: '#avatar',
  width: 320, height: 480,   // 固定尺寸 → 无布局抖动
  placeholder: '/xc.webp',   // 首屏只有一张图
  lazy: true,                // 进入视口且空闲时才创建 iframe(用 'click' 最省)
  lazyMargin: 200,           // px;越大加载越早,但更耗流量
  heavy: 'lazy',             // 首次互动前不加载 WebLLM / EMAGE
  autoPause: true,           // 滚出视口自动暂停渲染
});
```

---

## 📚 API

### `createXiaochun(options): XiaochunInstance`

| 选项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `container` | — | 元素或选择器(必填) |
| `src` | `https://xiaochun.firetable.tech/embed` | embed 页面地址(自建或本地调试时覆盖) |
| `origin` | 由 `src` 推导 | iframe 的预期 origin,所有消息都以它校验 |
| `allowedOrigins` | `[]` | 额外可信的 iframe origin,不接受 `'*'` |
| `lazy` | `true` | `true` / `'idle'`:进入视口且空闲 · `'click'`:点击或首次调用 API · `false`:立即创建 |
| `lazyMargin` | `200` | 可见性触发的 rootMargin(px)。调大更早加载、更耗流量 |
| `placeholder` | 内置 SVG | 图片 URL、元素或 `false` |
| `transparent` | `false` | 背景透明叠在页面上(同时开启指针穿透) |
| `width`、`height` | `320`、`480` | px 或任意 CSS 长度,务必设置 |
| `position` | `'inline'` | `'inline' \| 'bottom-right' \| 'bottom-left'` |
| `draggable` | `false` | 悬浮模式下显示拖动手柄 |
| `lang`、`model` | — | `'zh-CN' \| 'en' \| 'ja'`;服装 key(如 `xiaochun_maid`)或 https `.vrm` URL |
| `ui` | `false` | 显示 embed 内置的聊天栏 |
| `heavy` | `'lazy'` | `'lazy'`:首次使用才加载 WebLLM / EMAGE · `'eager'`:预加载 |
| `controls` | `false` | 放开 iframe 内滚轮缩放(会吞掉页面滚动) |
| `autoPause` | `true` | 滚出视口自动暂停 |
| `passthrough` | = `transparent` | 按"鼠标是否在角色上"切换 iframe 的 pointer-events |
| `sandbox` | scripts + same-origin + popups | iframe `sandbox`;`false` = 不加。去掉 `allow-same-origin` 会让 IndexedDB 和麦克风失效 |
| `handshakeTimeout` | `20000` | 毫秒;超时会触发 `error { code: 'timeout' }` |
| `crossOriginIsolated` | `false` | 给 iframe 的 `allow` 追加 `cross-origin-isolated`(默认仍是 `microphone; autoplay`)。要求宿主页自己已跨源隔离,见 [可选:跨源隔离](#可选跨源隔离让-emage-用多线程) |
| `zIndex` | `2147483000` | 悬浮模式层级(`--xc-z-index` 变量优先) |

**实例**:`ready` · `say(text, { mode: 'speak' \| 'chat' })` · `speakAudio(source, opts)` · `speakAudioStream(opts)` · `motion(nameOrUrlOrOptions)` · `expression(name)` · `setModel(outfitOrUrl)` · `setConfig(cfg)` · `startListening()` / `stopListening()` / `mic(on)` · `pause()` / `resume()` · `activate()` · `destroy()` · `on(event, cb)` · `lookAt()` *(协议已预留,目前返回 `unsupported`)*。

**事件**:`handshake` · `ready` · `progress` · `state` · `stt` · `utterance`(`phase: 'start' | 'end'`,`kind: 'text' | 'audio'`)· `hit-region` · `error` · `destroy`。

### `<xiaochun-avatar>`

| 属性 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `src` | 官方 `/embed` | 修改会重建 iframe |
| `model` | — | 服装 key,或 https `.vrm` / `.vrmaddon` / `.vrmbase` URL;运行时修改 = `setModel` |
| `lang` | — | `zh-CN` · `en` · `ja`;运行时修改 = `setConfig` |
| `mic` | `false` | 开关听写(模型加载完成后生效) |
| `transparent` | `true` | `"false"` 关闭 |
| `draggable` | `false` | 仅悬浮模式 |
| `position` | `inline` | `inline` · `bottom-right` · `bottom-left` |
| `size` | `320x480` | `"280"`(高 = 宽 × 1.5)、`"320x480"`、`"100%x480px"` |
| `lazy` | 空闲 + 视口 | `"click"` 仅点击;`"false"` 立即创建 |
| `paused` | `false` | `pause()` / `resume()` |
| `placeholder` / `heavy` / `ui` / `controls` / `allowed-origins` | — | 同 `createXiaochun` |
| `cross-origin-isolated` | `false` | 同 `createXiaochun({ crossOriginIsolated })`;修改会重建 iframe |

**事件**(`CustomEvent`,`composed`,`detail` = 协议 payload):`xc-ready` · `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-error`。
**方法**:`say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `destroy`;`el.client` 可拿到完整的 SDK 实例。

---

## 🧪 本地试玩 (Try It Locally)

打开 [`examples/embed-host.html`](./examples/embed-host.html),文件头部注释写了启动步骤。要连本地的小蠢开发服务器,传 `src: 'https://localhost:5185/embed'`。

---

## 🏷️ 版本与发布 (Versioning & Release)

包版本与**小蠢桌面客户端锁步**:一次 `pnpm bump:patch|minor|major` 加一个 `v*` git tag,就会并行且互相独立地触发桌面发布和 npm 发布。

npm 版本由 GitHub Actions 通过 **npm Trusted Publishing(OIDC)** 发布:没有长期有效的 `NPM_TOKEN`,并自动生成 provenance。维护者的配置步骤(首次手动发布、绑定 Trusted Publisher、staged publish)见 [`docs/EMBED.md` §6](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md)。

---

## 📚 更多文档

* [`docs/EMBED.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/EMBED.md):完整的嵌入设计、协议表、响应头、风险与发布流程
* [`docs/PROTOCOL.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/PROTOCOL.md):`xiaochun://` URL Scheme 及其与 `xc.*` 的对照
* [`docs/README.md`](https://github.com/FireTable/project-xiaochun/blob/main/docs/README.md):文档索引
* [项目主页 README](https://github.com/FireTable/project-xiaochun/blob/main/README-CN.md):主项目介绍

---

## 📄 许可证 (License)

[MIT](./LICENSE)
