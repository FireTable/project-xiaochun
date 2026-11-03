// node/worker.cjs - 小蠢 AI 伴侣 (Node.js 运行时宿主与系统桥接进程)

const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

// 统一标准输出 JSON-RPC 响应，日志仅允许输出到 stderr
function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function log(...args) {
  process.stderr.write(`[XiaoChun-Worker] ${args.join(' ')}\n`);
}

// ── 插件二级命名空间存储目录：~/.cindy/plugins/xiaochun-companion/ ──
function getPluginDataDir() {
  const cindyDir = path.join(os.homedir(), '.cindy');
  const baseDir = fs.existsSync(cindyDir)
    ? path.join(cindyDir, 'plugins', 'xiaochun-companion')
    : path.join(os.tmpdir(), 'cindy-plugins', 'xiaochun-companion');
  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  } catch (_) {}
  return baseDir;
}

// 自动平滑迁移老目录中的历史文件（若存在），并彻底清理旧根目录平铺文件
function migrateLegacyStorageOnce() {
  try {
    const cindyDir = path.join(os.homedir(), '.cindy');
    if (!fs.existsSync(cindyDir)) return;
    const dataDir = getPluginDataDir();

    // 1. 迁移或清理老配置 xiaochun-plugin-config.json -> config.json
    const legacyCfg = path.join(cindyDir, 'xiaochun-plugin-config.json');
    const newCfg = path.join(dataDir, 'config.json');
    if (fs.existsSync(legacyCfg)) {
      if (!fs.existsSync(newCfg)) {
        try { fs.copyFileSync(legacyCfg, newCfg); } catch (_) {}
      }
      try { fs.unlinkSync(legacyCfg); } catch (_) {}
    }

    // 2. 迁移或清理老状态 xiaochun-companion-state.json -> state.json
    const legacyState = path.join(cindyDir, 'xiaochun-companion-state.json');
    const newState = path.join(dataDir, 'state.json');
    if (fs.existsSync(legacyState)) {
      if (!fs.existsSync(newState)) {
        try { fs.copyFileSync(legacyState, newState); } catch (_) {}
      }
      try { fs.unlinkSync(legacyState); } catch (_) {}
    }

    // 3. 彻底删除老缓存目录 ~/.cindy/xiaochun-cache
    const legacyCache = path.join(cindyDir, 'xiaochun-cache');
    if (fs.existsSync(legacyCache)) {
      try { fs.rmSync(legacyCache, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
}

migrateLegacyStorageOnce();

// ── 插件配置持久化 ──
function getConfigFilePath() {
  return path.join(getPluginDataDir(), 'config.json');
}

function readPluginConfig() {
  try {
    const p = getConfigFilePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { preferredMode: 'embed', ...parsed };
    }
  } catch {}
  return { preferredMode: 'embed' };
}

function savePluginConfig(patch) {
  try {
    const p = getConfigFilePath();
    const cur = readPluginConfig();
    const next = { ...cur, ...patch };
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  } catch (err) {
    log('保存插件配置失败:', err.message);
    return patch;
  }
}

// ── 伴侣运行时状态持久化 (新手向导、场景、服装，作为本地唯一真理源 SSOT) ──
function getCompanionStatePath() {
  return path.join(getPluginDataDir(), 'state.json');
}

function readCompanionState() {
  let state = {
    onboardingCompleted: false,
    onboardingActive: false,
    currentScene: 'beach3d',
    currentOutfit: null
  };

  try {
    const p = getCompanionStatePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      state = { ...state, ...parsed };
    }
  } catch {}

  if (!state.onboardingCompleted) {
    try {
      const cfg = readPluginConfig();
      if (cfg && cfg.onboardingCompleted) {
        state.onboardingCompleted = true;
      }
    } catch {}
  }

  if (!state.onboardingCompleted) {
    try {
      const rt = readRuntimeState();
      if (rt && rt.onboardingCompleted) {
        state.onboardingCompleted = true;
        if (rt.currentScene) state.currentScene = rt.currentScene;
        if (rt.currentOutfit) state.currentOutfit = rt.currentOutfit;
      }
    } catch {}
  }

  return state;
}

function writeBridgePortFile() {
  if (bridgePort <= 0) return;
  const companionState = readCompanionState();
  const cfg = readPluginConfig();
  const portData = JSON.stringify({
    port: bridgePort,
    onboardingCompleted: Boolean(companionState.onboardingCompleted),
    preferredMode: cfg.preferredMode || 'embed',
    timestamp: Date.now()
  });
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'xiaochun-bridge-port.json'), portData, 'utf-8');
  } catch {}
  if (process.env.XIAOCHUN_TEST_MODE !== '1') {
    try {
      fs.writeFileSync(path.join(__dirname, '..', 'bridge-port.json'), portData, 'utf-8');
    } catch {}
  }
}

function saveCompanionState(patch) {
  try {
    const cur = readCompanionState();
    const next = { ...cur, ...patch, updatedAt: Date.now() };

    const p = getCompanionStatePath();
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');

    if (patch.onboardingCompleted !== undefined) {
      savePluginConfig({ onboardingCompleted: Boolean(patch.onboardingCompleted) });
    }

    const tmpStatePath = path.join(os.tmpdir(), 'xiaochun-runtime-state.json');
    try {
      let tmpData = {};
      if (fs.existsSync(tmpStatePath)) {
        tmpData = JSON.parse(fs.readFileSync(tmpStatePath, 'utf-8'));
      }
      fs.writeFileSync(tmpStatePath, JSON.stringify({ ...tmpData, ...next }), 'utf-8');
    } catch {}

    writeBridgePortFile();
    return next;
  } catch (err) {
    log('保存伴侣状态失败:', err.message);
    return patch;
  }
}

// ── Cindy 内嵌视窗 (panel.html) 的轻量 SSE/HTTP 桥接与小蠢 AI 伴侣反向代理服务 ──
const sseClients = new Set();
let bridgePort = 0;
const PREFERRED_BRIDGE_PORT = 23518;

const bridgeServer = http.createServer((req, res) => {
  const reqOrigin = req.headers.origin || '';
  let isAllowedOrigin = false;
  if (!reqOrigin) {
    // 允许非浏览器或同源直连（无 Origin 请求标头）
    isAllowedOrigin = true;
  } else if (reqOrigin.startsWith('cindy-ghost:')) {
    // 允许来自 Cindy 插件协议的面板及设置页
    isAllowedOrigin = true;
  } else {
    try {
      const parsed = new URL(reqOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // 严格精确匹配本地回环主机名，杜绝前缀伪造（如 127.0.0.1.attacker.com）与沙箱 null 越权
        isAllowedOrigin = (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
      }
    } catch {}
  }

  if (!isAllowedOrigin) {
    log(`[安全拦截] 阻止来自外部未授权域名的桥接请求: ${reqOrigin}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: unauthorized origin' }));
    return;
  }

  const allowOrigin = (isAllowedOrigin && reqOrigin) ? reqOrigin : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqPath = (req.url || '').split('?')[0];
  if (reqPath === '/events' || reqPath === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    if (req.socket) req.socket.unref();
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (reqPath === '/bridge-port' || reqPath === '/bridge-port.json') {
    const companionState = readCompanionState();
    const cfg = readPluginConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      port: bridgePort,
      onboardingCompleted: Boolean(companionState.onboardingCompleted),
      mode: resolveActiveMode(),
      preferredMode: cfg.preferredMode || 'embed',
      timestamp: Date.now()
    }));
    return;
  }

  // ── 伴侣状态持久化 API ──
  if (reqPath === '/api/companion-state') {
    if (req.method === 'GET') {
      const state = readCompanionState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...state, port: bridgePort }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const saved = saveCompanionState(data);
          log('[伴侣状态] 成功持久化保存伴侣状态:', JSON.stringify(saved));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, state: saved }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // ── 面板聊天输入端点 (HTTP -> JSON-RPC 通知 Cindy 主逻辑 main.js) ──
  if (reqPath === '/api/chat-input' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const userText = data.text;
        const locale = data.locale || 'zh-CN';
        log('[面板输入] 收到用户对话输入:', userText);
        reply({
          jsonrpc: '2.0',
          method: 'user_chat_input',
          params: { text: userText, locale, timestamp: Date.now() }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── 伴侣重新进入新手引导端点 (支持外部脚本 / CDP / 调试一键触发) ──
  if (reqPath === '/api/trigger-onboarding') {
    saveCompanionState({ onboardingCompleted: false, onboardingActive: true });
    broadcastToEmbedPanel('onboarding', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '已派发新手引导触发指令' }));
    return;
  }

  // ── 面板申请创建小蠢专属伙伴端点 ──
  if (reqPath === '/api/create-companion' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const locale = data.locale || 'zh-CN';
        log('[面板申请] 收到创建专属伙伴请求, 语言:', locale);
        reply({
          jsonrpc: '2.0',
          method: 'create_companion_request',
          params: { locale, timestamp: Date.now() }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── 面板核对伙伴存在状态端点 ──
  if ((reqPath === '/api/check-bot-status' || reqPath === '/api/bot-status') && (req.method === 'GET' || req.method === 'POST')) {
    reply({
      jsonrpc: '2.0',
      method: 'check_bot_status',
      params: { timestamp: Date.now() }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── 供设置面板 (settings.html) 与前端查询与切换运行形态的轻量 API ──
  if (reqPath === '/api/config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        preferredMode: 'embed',
        activeMode: 'embed',
        installed: false,
        running: false,
        appPath: null,
        platform: process.platform,
        arch: process.arch
      }));
      return;
    }
    if (req.method === 'POST') {
      savePluginConfig({ preferredMode: 'embed' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        preferredMode: 'embed',
        activeMode: 'embed',
        installed: false,
        running: false,
        platform: process.platform,
        arch: process.arch
      }));
      return;
    }
  }

// ── 本地磁盘资产缓存机制（加速首屏加载、消除换端口重复拉取、坚决不缓存 HTML 页面） ──
function getAssetCacheDir() {
  const cacheDir = path.join(getPluginDataDir(), 'cache');
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  } catch (_) {}
  return cacheDir;
}

const MIME_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.vrm': 'model/gltf-binary',
  '.vrmbase': 'application/octet-stream',
  '.vrmaddon': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

function isHtmlPageRequest(cleanUrl) {
  if (cleanUrl === '/' || cleanUrl === '/embed' || cleanUrl === '/embed/' || cleanUrl.endsWith('.html')) {
    return true;
  }
  return false;
}

function isCacheableAsset(cleanUrl) {
  if (isHtmlPageRequest(cleanUrl)) return false;
  if (cleanUrl.startsWith('/api/') || cleanUrl.startsWith('/bridge-port') || cleanUrl.startsWith('/events') || cleanUrl.startsWith('/sse')) {
    return false;
  }
  return (
    cleanUrl.startsWith('/assets/') ||
    cleanUrl.startsWith('/emage/') ||
    cleanUrl.startsWith('/onnx/') ||
    cleanUrl.startsWith('/stt/') ||
    cleanUrl.startsWith('/wasm/') ||
    cleanUrl.startsWith('/audio/') ||
    cleanUrl.endsWith('.vrmaddon') ||
    cleanUrl.endsWith('.vrmbase') ||
    cleanUrl.endsWith('.vrm') ||
    cleanUrl.endsWith('.onnx') ||
    cleanUrl.endsWith('.wasm') ||
    cleanUrl.endsWith('.mp3') ||
    cleanUrl.endsWith('.wav') ||
    cleanUrl.endsWith('.png') ||
    cleanUrl.endsWith('.jpg') ||
    cleanUrl.endsWith('.webp') ||
    cleanUrl.endsWith('.svg') ||
    cleanUrl.endsWith('.woff2') ||
    cleanUrl.endsWith('.woff') ||
    cleanUrl.endsWith('.ttf') ||
    cleanUrl.endsWith('.js') ||
    cleanUrl.endsWith('.mjs') ||
    cleanUrl.endsWith('.cjs') ||
    cleanUrl.endsWith('.css')
  );
}

  // ── 反向代理路由解析：根据路径将请求分发至对应上游服务器，严格保持 127.0.0.1 域内 ──
  const cleanUrl = (req.url || '').split('?')[0];
  const isJsAsset = cleanUrl.endsWith('.js');
  const isAudioOrTts = cleanUrl === '/api/tts' || cleanUrl.startsWith('/audio/') || cleanUrl.endsWith('.mp3');
  const isHeavyModelOrAsset = cleanUrl.endsWith('.vrmaddon') || cleanUrl.endsWith('.vrmbase') || cleanUrl.endsWith('.onnx') || cleanUrl.endsWith('.wasm');
  const isHtml = isHtmlPageRequest(cleanUrl);
  const shouldCache = req.method === 'GET' && isCacheableAsset(cleanUrl);

  let targetHost = 'xiaochun.firetable.tech';
  let targetPath = req.url;

  if (cleanUrl.startsWith('/emage/') || cleanUrl.startsWith('/onnx/')) {
    targetHost = 'cdn.firetable.tech';
    const subPath = cleanUrl.replace(/^\/(emage|onnx)\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/xiaochun/emage/${subPath}${query}`;
  } else if (cleanUrl.startsWith('/stt/')) {
    targetHost = 'cdn.firetable.tech';
    const subPath = cleanUrl.replace(/^\/stt\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/xiaochun/stt/${subPath}${query}`;
  } else if (cleanUrl.startsWith('/wasm/')) {
    // onnxruntime-web 运行时 (ort-wasm-simd-threaded.{wasm,mjs})：自有 CDN，版本目录须与前端 APP_CONFIG.ort 一致 (1.29.0)
    targetHost = 'cdn.firetable.tech';
    const subPath = cleanUrl.replace(/^\/wasm\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/xiaochun/ort/1.29.0/${subPath}${query}`;
  }

  // 1. 优先尝试从本地磁盘资产缓存读取（极速命中，零网络开销，Origin 无关）
  const cacheDir = getAssetCacheDir();
  const cacheKey = crypto.createHash('sha256').update(`${targetHost}:${targetPath}`).digest('hex');
  const ext = path.extname(cleanUrl) || '';
  const cacheFilePath = path.join(cacheDir, `${cacheKey}${ext}`);

  if (shouldCache) {
    try {
      if (fs.existsSync(cacheFilePath)) {
        const stat = fs.statSync(cacheFilePath);
        if (stat.size > 0) {
          const mime = MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Opener-Policy': 'unsafe-none',
            'Cross-Origin-Embedder-Policy': 'unsafe-none',
            'X-XiaoChun-Cache': 'HIT'
          });
          fs.createReadStream(cacheFilePath).pipe(res);
          return;
        }
      }
    } catch (err) {
      log('读取磁盘缓存异常, 降级至网络直连:', err.message);
    }
  }

  // 代理请求始终强制要求上游以 identity (未压缩原始数据) 返回，
  // 确保写入磁盘缓存并经由 127.0.0.1 服务本地 iframe 时，CSS / JS / WASM / 模型数据均为原始数据，绝不出现 zstd/br 二进制乱码导致 CSS 样式解析崩溃！
  const forwardHeaders = {
    ...req.headers,
    host: targetHost,
    origin: `https://${targetHost}`,
    referer: `https://${targetHost}/`,
    'accept-encoding': 'identity'
  };

  const proxyReq = https.request({
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders
  }, (proxyRes) => {
    // 自动重定向处理 (例如 /embed -> /embed/)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let loc = proxyRes.headers.location;
      // 保持在 127.0.0.1 域内重定向
      if (loc.startsWith('https://xiaochun.firetable.tech')) {
        loc = loc.replace('https://xiaochun.firetable.tech', '');
      }
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        location: loc,
        'access-control-allow-origin': '*',
      });
      res.end();
      return;
    }

    const headers = { ...proxyRes.headers };
    // 移除阻碍 Electron iframe 嵌入与通信的严格限制标头
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    headers['access-control-allow-origin'] = '*';
    headers['cross-origin-opener-policy'] = 'unsafe-none';
    headers['cross-origin-embedder-policy'] = 'unsafe-none';

    // 核心安全与更新保证：对 HTML 页面强制禁止缓存，确保前端发版后一刷新即拉取最新页面！
    if (isHtml) {
      headers['cache-control'] = 'no-cache, no-store, must-revalidate';
      headers['pragma'] = 'no-cache';
      headers['expires'] = '0';
    }

    // 针对 JS 核心资产补丁：放行 cindy-ghost: 协议的 origin 校验，实现双向 postMessage 握手并写入磁盘缓存
    if (isJsAsset) {
      delete headers['content-encoding'];
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        let modified = body;
        // 关键补丁：解决 WHATWG 规范下 new URL('cindy-ghost:...').origin 返回 "null" 的标准行为，
        // 确保 normalizeOrigin 能够正确返回 cindy-ghost://xiaochun-companion
        if (modified.includes('protocol!==`https:`') || modified.includes('protocol!==\"https:\"') || modified.includes('cindy-ghost')) {
          modified = modified.replace(
            /t\.protocol!==`https:`&&t\.protocol!==`http:`(?:&&t\.protocol!==`cindy-ghost:`)?\?null:t\.origin/g,
            "t.protocol===`cindy-ghost:`?(t.protocol+`//`+t.host):(t.protocol!==`https:`&&t.protocol!==`http:`?null:t.origin)"
          );
        }
        headers['content-length'] = Buffer.byteLength(modified, 'utf8');

        // 写入磁盘缓存（下次请求直接命中）
        if (shouldCache && proxyRes.statusCode === 200) {
          try {
            fs.writeFileSync(cacheFilePath, modified, 'utf8');
          } catch (_) {}
        }

        res.writeHead(proxyRes.statusCode, headers);
        res.end(modified);
      });
      return;
    }

    // 其他重型静态资产 (VRM, ONNX, WASM, 图片, 音频等)：在向客户端流式输出的同时写入磁盘缓存
    if (shouldCache && proxyRes.statusCode === 200) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
      const extMime = MIME_TYPES[ext.toLowerCase()];
      if (extMime) {
        headers['content-type'] = extMime;
      }
      res.writeHead(proxyRes.statusCode, headers);
      const tmpFile = `${cacheFilePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const fileStream = fs.createWriteStream(tmpFile);
      let streamFailed = false;

      fileStream.on('error', () => {
        streamFailed = true;
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      });

      proxyRes.on('data', (chunk) => {
        res.write(chunk);
        if (!streamFailed) fileStream.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();
        if (!streamFailed) {
          fileStream.end(() => {
            try {
              fs.renameSync(tmpFile, cacheFilePath);
            } catch (_) {
              try { fs.unlinkSync(tmpFile); } catch (_) {}
            }
          });
        }
      });

      proxyRes.on('error', () => {
        streamFailed = true;
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        res.end();
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log('代理请求失败:', req.url, err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('XiaoChun Proxy Error: ' + err.message);
  });

  req.pipe(proxyReq);
});

const CANDIDATE_PORTS = [PREFERRED_BRIDGE_PORT, 23519, 23520];
let portRetryAttempts = 0;
const MAX_PORT_RETRIES = process.env.XIAOCHUN_TEST_MODE === '1' ? 0 : 2;

function startBridgeServer(candidateIndex = 0) {
  const currentPort = candidateIndex < CANDIDATE_PORTS.length ? CANDIDATE_PORTS[candidateIndex] : 0;

  const errorHandler = (err) => {
    bridgeServer.removeListener('listening', listenHandler);
    if (err.code === 'EADDRINUSE' && currentPort !== 0) {
      if (portRetryAttempts < MAX_PORT_RETRIES) {
        portRetryAttempts++;
        log(`端口 ${currentPort} 暂时被占用 (可能正处于重载释放中)，250ms 后进行第 ${portRetryAttempts} 次复用重试...`);
        setTimeout(() => {
          startBridgeServer(candidateIndex);
        }, 250);
        return;
      }
      portRetryAttempts = 0;
      const nextCandidate = candidateIndex + 1;
      log(`端口 ${currentPort} 持续占用，尝试候选端口序列 [${candidateIndex + 1}]...`);
      startBridgeServer(nextCandidate);
    } else {
      log('桥接服务器发生错误 (非致命):', err.message);
    }
  };

  const listenHandler = () => {
    bridgeServer.removeListener('error', errorHandler);
    const addr = bridgeServer.address();
    bridgePort = addr ? addr.port : currentPort;
    bridgeServer.unref();
    log(`内嵌视窗与反向代理服务器就绪: http://127.0.0.1:${bridgePort}`);
    writeBridgePortFile();
  };

  bridgeServer.once('error', errorHandler);
  bridgeServer.once('listening', listenHandler);
  bridgeServer.listen(currentPort, '127.0.0.1');
}

function cleanupBridgeServer() {
  try {
    bridgeServer.close();
  } catch (_) {}
}
process.on('SIGTERM', () => { cleanupBridgeServer(); process.exit(0); });
process.on('SIGINT', () => { cleanupBridgeServer(); process.exit(0); });
process.on('exit', () => { cleanupBridgeServer(); });

startBridgeServer();

function broadcastToEmbedPanel(method, params) {
  const payload = `data: ${JSON.stringify({ method, params, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {}
  }
}

// 判定当前活动的运行形态（Cindy 插件内严格为 'embed' 侧边栏伴侣视窗）
function resolveActiveMode() {
  return 'embed';
}

function checkClientInstalled() {
  return { installed: false, path: null };
}

function checkClientRunning() {
  return false;
}

// 读取小蠢运行时跨进程状态（新手引导状态、当前场景、当前服装）
function readRuntimeState() {
  const candidates = [
    '/tmp/xiaochun-runtime-state.json',
    path.join(os.tmpdir(), 'xiaochun-runtime-state.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'tech.firetable.xiaochun', 'runtime-state.json'),
    path.join(process.env.APPDATA || '', 'tech.firetable.xiaochun', 'runtime-state.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return JSON.parse(content);
      }
    } catch {}
  }
  return null;
}



// 自动完成就绪准备（纯 embed 视窗形态）
async function bootstrapClient() {
  savePluginConfig({ preferredMode: 'embed' });
  return {
    success: true,
    mode: 'embed',
    installed: false,
    running: false,
    canEmbed: true,
    embedUrl: 'https://xiaochun.firetable.tech/embed',
    hasActivePanel: true,
    actionTaken: 'embed_ready',
    message: '小蠢 Cindy 内嵌伴侣视窗模式已就绪！直接在 Cindy 侧边栏/Tab 中使用，免安装。'
  };
}

// 发送协议指令到小蠢（通过 SSE 桥接器直接广播给 Cindy panel.html）
async function dispatchProtocol(action, params = {}) {
  log(`[内嵌视窗模式] 派发指令至 Cindy Panel: ${action}`, JSON.stringify(params));
  broadcastToEmbedPanel(action, params);
  return {
    success: true,
    mode: 'embed',
    action,
    target: 'panel',
    hasActivePanel: true
  };
}

// 监听 Cindy 宿主发送的标准输入 JSON-RPC 请求
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    return;
  }

  const { id, method, params } = request;

  try {
    if (method === 'status') {
      const runtimeState = readRuntimeState();
      const companionState = readCompanionState();
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          platform: process.platform,
          arch: process.arch,
          mode: 'embed',
          preferredMode: 'embed',
          canEmbed: true,
          embedUrl: 'https://xiaochun.firetable.tech/embed',
          hasActivePanel: true,
          isInstalled: false,
          isRunning: false,
          appPath: null,
          onboardingCompleted: Boolean(companionState.onboardingCompleted || runtimeState?.onboardingCompleted),
          onboardingActive: companionState.onboardingActive || (runtimeState ? Boolean(runtimeState.onboardingActive) : false),
          currentScene: companionState.currentScene || runtimeState?.currentScene || 'beach3d',
          currentOutfit: companionState.currentOutfit || runtimeState?.currentOutfit || null
        }
      });
      return;
    }

    if (method === 'panel_broadcast') {
      broadcastToEmbedPanel('panel_event', params || {});
      reply({ jsonrpc: '2.0', id, result: { success: true } });
      return;
    }

    if (method === 'bootstrap') {
      const res = await bootstrapClient();
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'speak') {
      const { text, motion, expression, force } = params || {};
      if (!text) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供 text 朗读内容' }
        });
        return;
      }
      const runtimeState = readRuntimeState();
      const isOnboarding = runtimeState ? Boolean(runtimeState.onboardingActive) : false;
      if (isOnboarding && !force) {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            success: false,
            onboardingActive: true,
            message: '小蠢当前正在进行新手引导（act0 序章剧情向导）。建议您先在小蠢窗口完成向导，或传入 force=true 强制插话。'
          }
        });
        return;
      }
      const res = await dispatchProtocol('speak', {
        text,
        motion,
        expression,
        force: force ? 'true' : undefined
      });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'motion') {
      const { name, loop } = params || {};
      if (!name) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供动作名称 name' }
        });
        return;
      }
      const res = await dispatchProtocol('motion', { name, loop: loop ? 'true' : 'false' });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'camera') {
      const cameraParams = { ...(params || {}) };
      if (cameraParams.action === 'reset') {
        cameraParams.reset = 'true';
      } else if (cameraParams.action === 'pan_up' || cameraParams.action === 'panUp') {
        cameraParams.panUp = 'true';
      }
      const res = await dispatchProtocol('camera', cameraParams);
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'scene') {
      const { name, scene, persist } = params || {};
      const sceneName = name || scene;
      if (!sceneName) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供场景名称 name 或 scene' }
        });
        return;
      }
      if (sceneName === 'transparent') {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Cindy 伴侣视窗不支持 transparent 透明场景，请选择 beach3d / light / dark / void' }
        });
        return;
      }
      const res = await dispatchProtocol('scene', {
        name: sceneName,
        persist: persist !== false ? 'true' : 'false'
      });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'outfit') {
      const { name, outfit, key } = params || {};
      const outfitName = name || outfit || key;
      if (!outfitName) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供服装名称 name, outfit 或 key' }
        });
        return;
      }
      const res = await dispatchProtocol('outfit', { name: outfitName });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'update') {
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          isRunning: false,
          installed: false,
          mode: 'embed',
          message: '当前小蠢以 Cindy 内嵌伴侣视窗运行（免安装开箱即用），无需更新。'
        }
      });
      return;
    }

    if (method === 'stop') {
      const res = await dispatchProtocol('stop', {});
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    reply({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `不支持的方法: ${method}` }
    });
  } catch (error) {
    log('执行方法报错:', error);
    reply({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || 'Node 进程内部执行失败' }
    });
  }
});
