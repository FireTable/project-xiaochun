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

* **Props**:`createXiaochun` 除 `container` 外的全部选项,加上 `onHandshake / onReady / onProgress / onState / onStt / onUtterance / onHitRegion / onMove / onResize / onError / onDestroy`、`className`、`style`、`paused`、`mic`。
* **重建与热更新**:创建期选项(`src`、`lazy`、`transparent`、`position` 等)变化会重建实例,所以不要在每次渲染里传新值。`width`、`height`、`draggable`、`resizable`(effect 调 `setSize` / `setDraggable` / `setResizable`)、`lang`、`outfit`、`scene`(以及已弃用的 `model`)、`paused`、`mic` 与回调会原地更新,不重建 iframe(由 effect 调 `setOutfit` / `setScene` / `setConfig`)。另有回调 `onOutfitChanged`、`onSceneChanged`。
* **ref 方法**:`say`、`speakAudio`、`speakAudioStream`、`motion`、`expression`、`lookAt`、`setOutfit`、`setScene`、`getOutfits`、`getScenes`、`prefetch`、`setModel`、`setConfig`、`startListening`、`stopListening`、`mic`、`pause`、`resume`、`activate`、`destroy`,以及 `ready` 与 `instance`。组件挂载前,返回 Promise 的方法会 reject。

---

## 🔊 宿主传音频 (`speakAudio`)

跳过内置 TTS,让小蠢念**你自己的**音频。iframe 负责解码,EMAGE 生成匹配的肢体动作(16 kHz 单声道窗口),音画同步并带口型,播放结束时触发 `utterance end`。重模型仍然懒加载:第一次带动作的 `speakAudio` 才会加载 EMAGE,`motion: false` 则永远不加载。

```ts
await xc.speakAudio(arrayBuffer, { text: '你好', motion: true, lipsync: true }); // ArrayBuffer 会被 transfer(detach);要保留就传 { transfer: false }
await xc.speakAudio(blob);                                   // Blob(mp3 / wav / ogg 等)
await xc.speakAudio('https://cdn.example.com/voice.mp3');    // URL:默认由宿主页 fetch({ fetch: 'frame' } = 交给 iframe 去 fetch)
await xc.speakAudio(pcm, { format: 'pcm16', sampleRate: 24000 });   // 无头原始 PCM 必须给 sampleRate(8000–96000)
await xc.speakAudio(pcm, { format: 'pcm16', sampleRate: 16000, audible: false }); // 只做动作和口型, iframe 增益为 0

const s = xc.speakAudioStream({ sampleRate: 24000 });        // 流式:比如 TTS 服务边合成边返回的 PCM 块
s.write(int16Chunk); s.write(next); s.end(); await s.done;   // s.abort() 立即停止
// 随时可取消:传 { signal: abortController.signal }
```

* `audible` 默认 `true`。`false` 仍会解码、生成动作并驱动口型,但 iframe 增益为 0,声音可以由宿主页面自己播放。
* 失败时 reject:`bad_request`(无法解码 / 空音频 / URL 或 sampleRate 不合法)、`unsupported`、`failed`。
* 浏览器仍要求宿主页先有用户手势才能出声,iframe 也要有 `allow="autoplay"`(SDK 已自动设置)。
* 新的 `say()` / `speakAudio()` 会打断正在进行的那一次,被打断的 Promise 会 resolve。
* `<xiaochun-avatar>` 与 React 的 ref 提供同名的 `speakAudio` / `speakAudioStream` 方法。

---

## 👗 换装、换场景与预取

```ts
const xc = createXiaochun({ container: '#avatar', outfit: 'xiaochun_maid', scene: 'light', persist: 'host' });
await xc.ready;

const outfits = await xc.getOutfits();   // [{ id, name }](裸模永远不会出现在列表里)
const scenes  = await xc.getScenes();    // [{ id: 'light' | 'dark' | 'transparent', transparent }]

await xc.setOutfit('xiaochun_cheongsam');                    // 新服装生效后才 resolve
await xc.setScene('transparent');                            // 外壳背景和穿透开关自动跟随
xc.on('outfit-changed', (p) => console.log(p.id, p.previous));
xc.on('scene-changed', (p) => console.log(p.id));
```

* **id 严格校验**(`/^[a-z][a-z0-9_]{0,63}$/` + 自有属性白名单)。格式不对本地直接 reject `[bad_request]`(不发消息);格式合法但不存在(`constructor`、`base` 等)reject `[unknown_id]`,iframe 一侧会独立再校验。
* **并发**:换装**串行 + last-wins**。正在加载的不会被中止;排队中的请求被更新的调用顶掉时 reject `[busy]`(可忽略)。同目标请求合并;请求当前服装直接 resolve。**说话不会被打断**:正在说话时新服装在后台加载,好了再换上。
* **场景**:只有 3 个内置主题。运行时切换会同步外壳背景、开关指针穿透监听、非透明场景强制 `pointer-events: auto`、重置命中缓存。
* **能力协商**:协议仍是 v1。对旧版 `/embed`(`xc.ready` 里没有 `capabilities.outfits` / `scenes` / `prefetch`),新方法 reject `[unsupported]`,`getOutfits()` / `getScenes()` 返回 `[]`。
* **偏好保存**:iframe 用**自己的** localStorage 记住用户最近的服装 / 场景(键 `xiaochun_wearing_outfit` / `xiaochun_scene_theme`,与主站一致)。优先级:显式的 `outfit` / `scene`(URL 或 SDK 选项)> 已保存 > 默认;存的 id 不在白名单会被忽略并清掉;存储被拦截 / 分区时静默回退默认。第三方存储按顶层站点分区,每个宿主站各一份。
* **`persist`**(可选)另外把它们存在宿主页 localStorage,并作为显式值传回 iframe,因此会盖过 iframe 自己存的。默认 `false`。
* **`prefetch`**(默认关)只把服装文件下载进 iframe 的 IndexedDB(不解压不合成),串行、排在 EMAGE 加载之后,除非你点名否则不含婚纱。`await xc.prefetch(['xiaochun_cheongsam'])` 任何模式都能用;自动预取需要 `heavy: 'eager'`。用户开了省流量模式则跳过。之后 `setOutfit` 不再走网络(解压合成约 0.9 秒仍在)。
* **内置按钮**:见下一节(`ui: ['outfit', 'scene', 'lang', 'github']`、`uiAutoHide`)。
* **自定义模型**:`setModel({ url })` **默认关闭**,需要 `allowCustomModel: true` 显式开启。
* **迁移**:选项 `model` → `outfit`;旧的 `setModel('base')` 不再可用(列表请用 `getOutfits()`)。

### 🔘 内置按钮(`ui`、`uiAutoHide`)

`ui` 是**部件名数组**,不写就什么都不显示。

```ts
createXiaochun({ container: '#avatar', ui: ['outfit', 'scene', 'lang', 'github'] });   // 部件:chat · bubble · outfit · scene · lang · github
```
```html
<xiaochun-avatar ui="outfit,scene,lang,github" ui-autohide="false"></xiaochun-avatar>     <!-- URL 写法: /embed?ui=outfit,scene,lang,github&uiAutoHide=false -->
```
React:`<Xiaochun ui={['outfit', 'scene']} />`。运行时:`xc.setConfig({ ui: ['outfit'] })`。

* **何时显示(`uiAutoHide`,与桌面端一致)**:默认 `'transparent'`——**透明**场景下按钮和聊天栏初始隐藏,**单击角色**才出现(再点角色或点空白收起;10 秒无操作也自动收起,悬停在它们上面或菜单打开时不收);亮 / 暗场景一直显示。`true` 把"点击才出现"扩展到所有场景,`false` 保持一直显示。拖动 iframe(`draggable`)不算单击(位移 ≤ 6px 才算)。限制:透明场景下点宿主页空白处到不了 iframe(穿透),所以收起靠 10 秒超时或再点角色;触屏第一次轻触只用来唤醒命中检测。需要 iframe 声明 `capabilities.ui.autoHide`,旧 iframe 忽略该选项、常显。
* **语言 / GitHub 按钮**:`lang` 弹出菜单(简体中文 / English / 日本語),选择后立即生效,存在 **iframe 自己的** localStorage(`xiaochun_embed_lang`),并发 `lang-changed`(`{ lang, previous?, initial? }`,握手后会发一次 `initial: true`)。只记用户自己点的——显式 `lang` 选项和 `setConfig({ lang })` 不写存储。`github` 是 `<a target="_blank" rel="noopener noreferrer">`,指向项目仓库。
* **和主站 TopHeader 同一套组件**:玻璃质感按钮(触屏 44×44,桌面 36×36)、下拉菜单、`Shirt` / `MountainSnow` / `Check` / `Loader2` 图标、同一批 i18n 文案(随 `lang`)。放在右上角,不遮角色。服装列表来自 `capabilities.outfits`(不含裸模、没有自定义 URL),每行只显示名字(菜单里不显示文件体积)、加载中转圈、当前穿着打 ✓。
* **与 `setOutfit` / `setScene` 同一条路径**:同样的白名单、同一个串行 last-wins 队列,连点会出现轻提示"busy",并照常发 `outfit-changed` / `scene-changed`。宿主用 SDK 调用时按钮状态同步。点按钮不会触发转身/拖动手势。
* **透明场景**:按钮参与穿透命中(点按钮不会漏到宿主页,空白处仍穿透)。触屏 + 透明场景下,第一次轻触只用来唤醒命中检测(落在宿主页上),第二次才落到按钮。
* **偏好保存**:iframe 把按钮 / `setOutfit` / `setScene` 引起的变化存在自己的 localStorage,刷新后自动恢复(显式 `outfit` / `scene` 仍然优先)。想自己留一份(例如跨站),监听事件并把值作为显式选项传回:
```ts
xc.on('outfit-changed', (p) => { if (!p.initial) localStorage.setItem('my-outfit', p.id); });
xc.on('scene-changed',  (p) => { if (!p.initial) localStorage.setItem('my-scene', p.id); });
// 或直接 persist: 'host'
```
* **滚轮缩放**(`controls`,默认开)见上面的选项表,包括"不透明且铺满时会吞该区域页面滚动"的副作用;想保持旧行为用 `controls: false`。

## 🎨 样式 (CSS 变量与 `::part`)

宿主只能调整**外壳**。角色在跨域 iframe 里,你的 CSS 无法影响 iframe 内部。

| 变量 | 默认值 | 作用 |
| :--- | :--- | :--- |
| `--xc-radius` | 非透明 `20px` / 透明 `0` | 圆角(任意 CSS 长度,如 `24px`;`50%` 为圆形头像框)。调大更圆,过大会裁掉头和脚 |
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

**不会被选区染蓝**:宿主页的文字选区(拖选划过、Cmd/Ctrl+A)跨过 iframe 时,Chrome 会给整块 iframe 盖一层蓝色高亮。SDK 给外壳、占位图、iframe 都设了 `user-select: none`(CSSOM 内联样式,不注入 `<style>`,不受宿主 CSP 影响);宿主自己的文字照常可选,`pointer-events` 和透明穿透不变。别在 `::part(iframe)` 上把 `user-select` 改回 `auto`。

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
| `transparent` | `false` | 背景透明叠在页面上(同时开启指针穿透),等价于 `scene: 'transparent'` |
| `scene` | — | 初始场景:`'light' \| 'dark' \| 'transparent'`(见 `getScenes()`)。未知 id 会被忽略并触发 `error { code: 'unknown_id' }` |
| `width`、`height` | `600`、`1080` | px 或任意 CSS 长度。**默认值受视口限制**:宽 = `min(600px, 100vw)`(外壳另有 `max-width: 100%`,窄容器不溢出),高 = `min(1080px, 100svh)`(悬浮 `position` 还会扣掉 `--xc-offset-x/y` 边距,整块不会顶出屏幕);显式传入的值原样使用。运行时 `setSize(w, h)`(传 `undefined` = 恢复默认) |
| `position` | `'inline'` | `'inline' \| 'bottom-right' \| 'bottom-left'` |
| `draggable` | `false` | 手势拖动:按住角色(不要压在内置按钮上)拖 = 移动 iframe,限制在视口内;内联 / 悬浮模式都生效。见下文「手势」 |
| `borderRadius` | 非透明 `20px` / 透明 `0` | 外壳圆角(数字 = px 或任意 CSS 长度)。light / dark 场景默认与桌面版窗口圆角同值(20px),透明场景不裁角。运行时用 `setBorderRadius()`;`--xc-radius` CSS 变量优先;`0` = 方角 |
| `resizable` | `false` | 拖四个角缩放 iframe(与桌面版同一套 40px 热区 / 光标 / 圆弧),运行时状态,**不重建 iframe**。可传 `true` 或 `{ minWidth, minHeight, maxWidth, maxHeight }`(默认最小 120×180,最大 = 视口) |
| `lang` | 自动 | `'zh-CN' \| 'en' \| 'ja'`。优先级:此选项 > 用户上次在内置语言按钮里选的(存在 iframe 自己的 localStorage `xiaochun_embed_lang`)> 浏览器语言 > `zh-CN`。运行时 `setConfig({ lang })` 不持久化。变化时发 `lang-changed` |
| `outfit` | 默认服装 | 初始服装 id(如 `xiaochun_maid`,见 `getOutfits()`)。未知 id 回退默认服装并触发 `error { code: 'unknown_id' }` |
| `model` | — | **已弃用**,请改用 `outfit`(会打印 `console.warn`)。不再接受 https URL,见 `allowCustomModel` |
| `allowCustomModel` | `false` | 显式开启后才允许 `setModel({ url })` 加载任意 https `.vrm` / `.vrmaddon` / `.vrmbase`。第三方文件会在 iframe 里解析,仅对可信 URL 打开 |
| `camera` | — | 相机取景 `{ fov, distance, height, intro }`:`fov` 15–60°(默认 30,视距按 fov 自动补偿,角色大小基本不变),`distance` 1–15 米(默认约 2.5;首次取景时盖过 iframe 保存的缩放 / 俯仰),`height` ±1 米取景高度偏移(iframe 不保存),`intro: false` 不播推镜头。越界值夹到范围;没有 `pitch`(相机只绕角色上下俯仰,左右是角色自身的 bodyTurn)。创建期写进 `?cameraFov=` 等 URL 参数;运行时用 `setConfig({ camera })`(缺省键不变、`null` 恢复默认,立即重新取景并取消进行中的推镜头)。旧版 `/embed`(无 `capabilities.camera`)忽略。优先级:显式 > iframe 保存的视角 > 默认。 |
| `persistBox` | `false` | 在**宿主页** localStorage 记住拖动 / 缩放后的位置和大小,下次创建时恢复:`true`(key `xiaochun:box`)或命名空间字符串(`xiaochun:box:<名字>`)。需要 `draggable` / `resizable`。优先级:显式 `width` / `height` > 已保存 > 默认;恢复时钳制到当前视口。`clearPersistedBox({ reset? })` 清除。见「手势」一节 |
| `persist` | `false` | 可选:另把服装 + 场景偏好保存在**宿主页**的 localStorage(iframe 本来就会存一份自己的):`false` \| `'host'`(`xiaochun:prefs`)\| 自定义 key。显式的 `outfit` / `scene` 选项优先于已保存的偏好;宿主保存的优先于 iframe 自己存的 |
| `prefetch` | `false` | `true`(全部服装,婚纱 13.9 MB 除外)或 `string[]`。首次加载完成后自动发一次,**仅在 `heavy: 'eager'` 时**;否则请自己调用 `prefetch()` |
| `ui` | `[]` | iframe 内要显示的内置界面部件,数组,可选 `'chat'`(聊天栏)· `'bubble'`(头顶气泡)· `'outfit'`(换装按钮)· `'scene'`(换场景按钮)· `'lang'`(语言切换)· `'github'`(GitHub 链接,新标签页打开)。不写/空 = 都不显示;未知名字被忽略并 `console.warn`。见下文「内置按钮」 |
| `uiAutoHide` | `'transparent'` | 内置界面何时显示,**与桌面端一致**:`'transparent'` = 只有透明(桌宠)场景初始隐藏、单击角色才出现,亮 / 暗场景常显;`true` = 所有场景都点击才出现;`false` = 一直显示(旧行为)。运行时 `setConfig({ uiAutoHide })` 热切换 |
| `heavy` | `'lazy'` | `'lazy'`:首次使用才加载 WebLLM / EMAGE · `'eager'`:预加载 |
| `controls` | `true` | iframe 内滚轮缩放,默认开(与主站一致)。透明场景:只有指针在角色上才缩放,其余位置滚轮仍滚动宿主页;不透明场景:iframe 铺满,该区域内滚轮 = 缩放,**会吞掉该区域的页面滚动**。`false` 锁定(`?controls=0`) |
| `autoPause` | `true` | 滚出视口自动暂停 |
| `passthrough` | = `transparent` | 按"鼠标是否在角色上"切换 iframe 的 pointer-events |
| `sandbox` | scripts + same-origin + popups | iframe `sandbox`;`false` = 不加。去掉 `allow-same-origin` 会让 IndexedDB 和麦克风失效 |
| `handshakeTimeout` | `20000` | 毫秒;超时会触发 `error { code: 'timeout' }` |
| `crossOriginIsolated` | `false` | 给 iframe 的 `allow` 追加 `cross-origin-isolated`(默认仍是 `microphone; autoplay`)。要求宿主页自己已跨源隔离,见 [可选:跨源隔离](#可选跨源隔离让-emage-用多线程) |
| `zIndex` | `2147483000` | 悬浮模式层级(`--xc-z-index` 变量优先) |

**实例**:`ready` · `say(text, { mode: 'speak' \| 'chat' })` · `speakAudio(source, opts)` · `speakAudioStream(opts)` · `motion(nameOrUrlOrOptions)` · `expression(name)` · `setOutfit(id)` · `setScene(id)` · `getOutfits()` · `getScenes()` · `prefetch(ids?)` · `outfit` / `scene`(只读)· `setModel(outfitOrUrl)` *(旧)* · `setConfig(cfg)` · `setSize(w, h)` · `getBox()` · `setDraggable(on)` · `setResizable(on | limits)` · `startListening()` / `stopListening()` / `mic(on)` · `pause()` / `resume()` · `activate()` · `destroy()` · `on(event, cb)` · `lookAt()` *(协议已预留,目前返回 `unsupported`)*。

**事件**:`handshake` · `ready` · `progress` · `state` · `stt` · `utterance`(`phase: 'start' | 'end'`,`kind: 'text' | 'audio'`)· `hit-region` · `outfit-changed` · `scene-changed` · `lang-changed`(`{ lang, previous?, initial? }`)· `move` / `resize`(`{ phase: 'start' | 'move' | 'end', left, top, width, height }`)· `error`(新增 `busy`、`unknown_id`;旧 iframe 上开手势会收到一次 `unsupported`)· `destroy`。`progress.phase` 为 `'model' | 'outfit' | 'prefetch'`。

### `<xiaochun-avatar>`

| 属性 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `src` | 官方 `/embed` | 修改会重建 iframe |
| `outfit` | — | 服装 id;运行时修改 = `setOutfit`(**热更新,不重建 iframe**) |
| `scene` | — | `light` · `dark` · `transparent`;运行时修改 = `setScene`(热更新) |
| `model` | — | `outfit` 的**已弃用**别名(`outfit` 优先) |
| `camera-fov` / `camera-distance` / `camera-height` / `camera-intro` | — | 同 `camera`(热更新 `setConfig({ camera })`,不重建;去掉属性 = 恢复默认) |
| `persist` / `persist-box` / `prefetch` / `allow-custom-model` | — | 同对应选项(`persist-box=""` = 默认 key,其它字符串 = 命名空间);修改会重建 |
| `lang` | 自动 | `zh-CN` · `en` · `ja`;不写 = 用户上次的选择 > 浏览器语言 > `zh-CN`;运行时修改 = `setConfig`(不持久化) |
| `mic` | `false` | 开关听写(模型加载完成后生效) |
| `transparent` | `true` | `"false"` 关闭 |
| `draggable` | `false` | 手势拖动(内联 / 悬浮都行);运行时修改 = `setDraggable`(热更新) |
| `resizable` | `false` | 拖角缩放;运行时修改 = `setResizable`(热更新) |
| `border-radius` | 非透明 `20px` / 透明 `0` | 外壳圆角(数字 = px 或 CSS 长度);运行时修改 = `setBorderRadius`(热更新) |
| `min-size` / `max-size` | — | 缩放限幅,格式同 `size`(如 `min-size="160x240"`) |
| `position` | `inline` | `inline` · `bottom-right` · `bottom-left` |
| `size` | `600x1080`(受视口限制) | `"280"`(高 = 宽 × 1.5)、`"320x480"`、`"100%x480px"`;运行时修改 = `setSize`(**热更新,不重建 iframe**) |
| `lazy` | 空闲 + 视口 | `"click"` 仅点击;`"false"` 立即创建 |
| `paused` | `false` | `pause()` / `resume()` |
| `ui` | — | 逗号分隔的部件名,如 `ui="outfit,scene,lang,github"`(不写 = 都不显示;未知项忽略并 warn)。改它会重建;运行时用 `setConfig({ ui })` |
| `ui-autohide` | `transparent` | `"transparent"`(默认,仅透明场景点击才出现)· `"true"`(所有场景)· `"false"`(一直显示)。改它会重建;运行时用 `setConfig({ uiAutoHide })` |
| `controls` | 开 | `controls="false"` 锁定 iframe 内滚轮缩放 |
| `placeholder` / `heavy` / `allowed-origins` | — | 同 `createXiaochun` |
| `cross-origin-isolated` | `false` | 同 `createXiaochun({ crossOriginIsolated })`;修改会重建 iframe |

**事件**(`CustomEvent`,`composed`,`detail` = 协议 payload):`xc-ready` · `xc-progress` · `xc-state` · `xc-stt` · `xc-utterance` · `xc-outfit-changed` · `xc-scene-changed` · `xc-lang-changed` · `xc-move` · `xc-resize` · `xc-error`。
**方法**:`say` · `speakAudio` · `speakAudioStream` · `motion` · `expression` · `setOutfit` · `setScene` · `getOutfits` · `getScenes` · `prefetch` · `destroy`;`el.client` 可拿到完整的 SDK 实例。

---

### 手势(拖动与角落缩放)

iframe 可以拥有和桌面版一样的体验:**按住角色拖动 = 移动,拖四个角 = 缩放**。两者**默认关闭**并按实例协商:宿主没开时,iframe 不识别手势、不拦截指针事件、也不画角落圆弧。

```ts
const xc = createXiaochun({
  container: '#avatar', width: 320, height: 480,
  draggable: true,                       // 移动:拖角色
  resizable: { minWidth: 160, minHeight: 240, maxWidth: 640, maxHeight: 960 }, // 也可直接 true(最小 120×180,最大 = 视口)
});
xc.on('move',   (b) => console.log(b.phase, b.left, b.top));
xc.on('resize', (b) => console.log(b.phase, b.width, b.height));
xc.setResizable(false);                  // 运行时开关,不重建 iframe
xc.setSize(240, 360);                    // 程序化改尺寸(同样热更新)
```

* 识别逻辑复用应用共用的手势状态机(`src/core/gesture/`);iframe 只发 `xc.gesture-move` / `xc.gesture-resize` 增量(`gesture`、`seq`、`phase: start | move | end`、`dx/dy`、累计 `totalDx/totalDy`、缩放带 `corner`),**由宿主 SDK 执行**:校验 origin / 端口,丢弃伪造、重放、乱序的消息,并按最小 / 最大尺寸与视口限幅(内联模式用 CSS `translate` 移动,悬浮模式改 `left/top`)。
* 缩放是运行时状态:`width` / `height` / `size` / `draggable` / `resizable` 变化都**不会重建 iframe**(模型、动画、对话状态保留)。
* 透明场景 + 穿透:只有角色、(开了 `resizable` 时)四角 40px 热区会接管指针,其余位置仍穿透到你的页面;内置按钮不会成为拖动 / 缩放起点。
* 拖动时的选中蓝框两侧都已抑制(`user-select: none`、阻止 `selectstart` / `dragstart`、缩放时用 pointer capture)。
* 旧版 `/embed`(没有 `capabilities.gestures`)上开内联 `draggable` 或 `resizable`,会触发一次 `error { code: 'unsupported', command: 'gestures' }`。
* **记住位置和大小(`persistBox`,默认关)**:开了 `draggable` / `resizable` 后,`persistBox: true`(或命名空间字符串 → key `xiaochun:box:<名字>`)会在每次拖动 / 缩放**结束**时把盒子存进**宿主页**的 localStorage(读写都包了 try/catch,隐私模式 / 配额满只是不记忆),下次创建时恢复。优先级:显式 `width` / `height` > 已保存 > 默认(600×1080);位置没有显式选项(`position` 只是预设锚点),所以已保存的位置始终生效。**想恢复用户缩放后的大小,就不要传 `width` / `height`。** 恢复时钳制到*当前*视口(大小夹在 `[最小, 视口]`,最小 120×180 或你的 `resizable` 限幅;悬浮盒子整块拉回屏幕内;内联盒子横向夹进视口、纵向不越过文档顶部)。保存时的 `position` 模式与当前不同、或数据损坏,都会被忽略并清掉。只在开了手势时恢复。`xc.clearPersistedBox()` 删除已保存的值;`xc.clearPersistedBox({ reset: true })` 还会把盒子还原到初始位置 / 大小。元素属性 `persist-box`(`""` / `"true"` / 命名空间),React `persistBox` prop + `ref.clearPersistedBox()`。
* 试玩:`examples/embed-host.html?draggable=1&resizable=1&persistBox=1`。

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
