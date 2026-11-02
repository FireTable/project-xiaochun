// node/worker.cjs - 小蠢 AI 伴侣 (Node.js 运行时宿主与系统桥接进程)

const readline = require('node:readline');
const { execFile, execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');

// 统一标准输出 JSON-RPC 响应，日志仅允许输出到 stderr
function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function log(...args) {
  process.stderr.write(`[XiaoChun-Worker] ${args.join(' ')}\n`);
}

// ── 插件形态配置持久化 (desktop: 独立桌面桌宠 / embed: Cindy 内嵌视窗 / auto: 自动识别) ──
function getConfigFilePath() {
  const cindyDir = path.join(os.homedir(), '.cindy');
  if (fs.existsSync(cindyDir)) {
    return path.join(cindyDir, 'xiaochun-plugin-config.json');
  }
  return path.join(os.tmpdir(), 'xiaochun-plugin-config.json');
}

function readPluginConfig() {
  try {
    const p = getConfigFilePath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch {}
  return { preferredMode: 'auto' };
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

// ── Cindy 内嵌视窗 (panel.html) 的轻量 SSE/HTTP 桥接与小蠢 AI 伴侣反向代理服务 ──
const sseClients = new Set();
let bridgePort = 0;
const PREFERRED_BRIDGE_PORT = 23518;

const bridgeServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/events') {
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

  if (req.url === '/bridge-port') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ port: bridgePort, mode: resolveActiveMode() }));
    return;
  }

  // ── 反向代理 https://xiaochun.firetable.tech (确保在 Cindy CSP 严格沙箱内以 127.0.0.1 loopback 形式安全加载) ──
  const cleanUrl = req.url.split('?')[0];
  const isUtilsChunk = cleanUrl.includes('utils-') && cleanUrl.endsWith('.js');
  const isEmbedAppChunk = cleanUrl.includes('EmbedApp-') && cleanUrl.endsWith('.js');
  const needsRewrite = isUtilsChunk || isEmbedAppChunk;

  const forwardHeaders = {
    ...req.headers,
    host: 'xiaochun.firetable.tech',
    'accept-encoding': needsRewrite ? 'identity' : (req.headers['accept-encoding'] || 'identity')
  };

  const proxyReq = https.request({
    hostname: 'xiaochun.firetable.tech',
    port: 443,
    path: req.url,
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

    // 针对 utils 及 EmbedApp 核心代码补丁：放行 cindy-ghost: 协议的 origin 校验，实现双向 postMessage 握手
    if (needsRewrite) {
      delete headers['content-encoding'];
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        let modified = body;
        if (isUtilsChunk) {
          modified = modified.replace(
            /t\.protocol!==`https:`&&t\.protocol!==`http:`\?null:t\.origin/g,
            "t.protocol===`cindy-ghost:`?(t.protocol+`//`+t.host):(t.protocol!==`https:`&&t.protocol!==`http:`?null:t.origin)"
          );
        }
        if (isEmbedAppChunk) {
          modified = modified.replace('z&&window.parent.postMessage', 'window.parent.postMessage');
          modified = modified.replace('height],intro:!0}}}),z)', "height],intro:!0}}}),'*')");
          modified = modified.replace('!re.has(t.origin)', "!re.has(t.origin)&&!String(t.origin).startsWith('cindy-ghost:')");
        }
        headers['content-length'] = Buffer.byteLength(modified, 'utf8');
        res.writeHead(proxyRes.statusCode, headers);
        res.end(modified);
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

function startBridgeServer(port = PREFERRED_BRIDGE_PORT) {
  bridgeServer.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port !== 0) {
      log(`端口 ${port} 被占用，回退至随机端口...`);
      startBridgeServer(0);
    } else {
      log('桥接服务器发生错误 (非致命):', err.message);
    }
  });

  bridgeServer.listen(port, '127.0.0.1', () => {
    const addr = bridgeServer.address();
    bridgePort = addr ? addr.port : port;
    bridgeServer.unref();
    log(`内嵌视窗与反向代理服务器就绪: http://127.0.0.1:${bridgePort}`);
    const portData = JSON.stringify({ port: bridgePort, timestamp: Date.now() });
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'xiaochun-bridge-port.json'), portData, 'utf-8');
    } catch {}
    try {
      fs.writeFileSync(path.join(__dirname, '..', 'bridge-port.json'), portData, 'utf-8');
    } catch {}
  });
}

startBridgeServer();

function broadcastToEmbedPanel(method, params) {
  const payload = `data: ${JSON.stringify({ method, params, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {}
  }
}

// 跨平台打开 URL 或文件
function openUrl(targetUrl, appPath = null, isDev = false) {
  // 自动化测试环境下执行 DryRun 拦截，杜绝产生系统级脱机悬挂进程
  if (process.env.XIAOCHUN_TEST_MODE === '1') {
    log(`[测试模式 DryRun] 拦截外部唤起: ${targetUrl}`);
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    // 如果是本地开发编译产物（非 .app 包），脱机拉起并立即放行
    if (isDev && appPath && fs.existsSync(appPath)) {
      log(`本地开发模式：通过原生二进制独立拉起协议指令 (${appPath} ${targetUrl})`);
      try {
        const child = spawn(appPath, [targetUrl], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        resolve(true);
      } catch (err) {
        log(`开发二进制启动失败:`, err.message);
        reject(err);
      }
      return;
    }

    let cmd = 'open';
    let args = [targetUrl];

    if (process.platform === 'win32') {
      cmd = 'cmd.exe';
      args = ['/c', 'start', '', targetUrl];
    } else if (process.platform === 'linux') {
      cmd = 'xdg-open';
      args = [targetUrl];
    }

    execFile(cmd, args, (error) => {
      if (error) {
        log(`唤起失败 (${cmd} ${targetUrl}):`, error.message);
        reject(error);
      } else {
        resolve(true);
      }
    });
  });
}

// 检查小蠢桌面端是否已在电脑上安装
function checkClientInstalled() {
  if (process.platform === 'darwin') {
    // 1. 检查 macOS 常见 App 目录
    const standardPaths = [
      '/Applications/Project XiaoChun.app',
      path.join(os.homedir(), 'Applications', 'Project XiaoChun.app'),
      '/Applications/Project.XiaoChun.app',
      path.join(os.homedir(), 'Applications', 'Project.XiaoChun.app'),
      '/Applications/xiaochun.app',
      path.join(os.homedir(), 'Applications', 'xiaochun.app')
    ];
    for (const p of standardPaths) {
      if (fs.existsSync(p)) return { installed: true, path: p };
    }

    // 2. 本地裸调试二进制回退 (仅当显式设置 XIAOCHUN_DEV_BIN=1 时开启，避免未打包的 debug 二进制在无本地前端 dev 服务器时启动成透明幽灵窗口)
    if (process.env.XIAOCHUN_DEV_BIN === '1') {
      const devBin = path.join(__dirname, '..', '..', '..', 'src-tauri', 'target', 'debug', 'project-xiaochun');
      if (fs.existsSync(devBin)) {
        return { installed: true, path: devBin, isDev: true };
      }
    }

    // 2. 检查 LaunchServices 登记的 Bundle ID
    try {
      const out = execSync("mdfind \"kMDItemCFBundleIdentifier == 'tech.firetable.xiaochun'\"", {
        encoding: 'utf-8',
        timeout: 1500
      });
      const foundPath = out.trim().split('\n')[0];
      if (foundPath && fs.existsSync(foundPath)) {
        return { installed: true, path: foundPath };
      }
    } catch {}

    return { installed: false, path: null };
  }

  if (process.platform === 'win32') {
    // 检查 Windows 注册表与常见路径
    try {
      execSync('reg query HKCU\\Software\\Classes\\xiaochun', { timeout: 1500 });
      return { installed: true, path: 'Registry: xiaochun://' };
    } catch {}

    const winPath = path.join(process.env.LOCALAPPDATA || '', 'Project XiaoChun', 'project-xiaochun.exe');
    if (fs.existsSync(winPath)) return { installed: true, path: winPath };
    return { installed: false, path: null };
  }

  // Linux
  try {
    const whichOut = execSync('which project-xiaochun', { encoding: 'utf-8', timeout: 1000 }).trim();
    if (whichOut) return { installed: true, path: whichOut };
  } catch {}
  const localBin = path.join(os.homedir(), '.local', 'bin', 'project-xiaochun');
  if (fs.existsSync(localBin)) return { installed: true, path: localBin };

  return { installed: false, path: null };
}

// 检查小蠢桌面端当前是否在线运行
function checkClientRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist', { encoding: 'utf-8', timeout: 1500 });
      return /project-xiaochun/i.test(out);
    }
    // macOS / Linux
    const out = execSync('pgrep -f "project-xiaochun|Project XiaoChun"', { encoding: 'utf-8', timeout: 1000 }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

// 判定当前活动的运行形态 ('desktop' 桌面桌宠 / 'embed' Cindy 内嵌视窗)
function resolveActiveMode() {
  const cfg = readPluginConfig();
  if (cfg.preferredMode === 'embed') return 'embed';
  if (cfg.preferredMode === 'desktop') return 'desktop';
  // auto 模式：已安装走桌面端，未安装走内嵌模式
  const status = checkClientInstalled();
  return status.installed ? 'desktop' : 'embed';
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

// 下载工具封装 (跟随 302 重定向)
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(currentUrl, hops = 0) {
      if (hops > 5) {
        reject(new Error('下载重定向次数过多'));
        return;
      }
      https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location, hops + 1);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败 HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    get(url);
  });
}

// 解析最新发布版本的 DMG 下载地址
async function resolveLatestDmgUrl(arch = 'aarch64') {
  const apiUrl = 'https://api.github.com/repos/FireTable/project-xiaochun/releases/latest';
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(apiUrl, { headers: { 'User-Agent': 'XiaoChun-Cindy-Plugin' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (data && Array.isArray(data.assets)) {
      const matchPattern = arch === 'aarch64' ? /aarch64.*\.dmg$/i : /x64.*\.dmg$/i;
      const asset = data.assets.find(a => matchPattern.test(a.name));
      if (asset && asset.browser_download_url) {
        log(`动态解析到 GitHub 资产: ${asset.browser_download_url}`);
        return asset.browser_download_url;
      }
    }
  } catch (err) {
    log('解析最新 GitHub Release 资产失败，使用基线版本回退:', err.message);
  }

  // 默认已知可用基线版本回退
  const cleanArch = arch === 'aarch64' ? 'aarch64' : 'x64';
  return `https://github.com/FireTable/project-xiaochun/releases/download/v0.2.2/Project.XiaoChun_0.2.2_${cleanArch}.dmg`;
}

// 自动完成冷启动安装 / 就绪准备 / 双模切换
async function bootstrapClient(action = 'ensure', targetMode = null) {
  if (targetMode && ['auto', 'desktop', 'embed'].includes(targetMode)) {
    savePluginConfig({ preferredMode: targetMode });
  }
  const cfg = readPluginConfig();
  const mode = targetMode || cfg.preferredMode || 'auto';
  const status = checkClientInstalled();
  const isRunning = checkClientRunning();

  // 测试环境下拦截耗时的真实物理下载安装
  if (process.env.XIAOCHUN_TEST_MODE === '1' && (action === 'install' || !status.installed)) {
    log('[测试模式 DryRun] 拦截物理下载安装，模拟就绪');
    return {
      success: true,
      mode: mode === 'embed' ? 'embed' : 'desktop',
      installed: true,
      running: true,
      actionTaken: 'test_mock_ready'
    };
  }

  // 1. 如果用户显式要求切换形态
  if (action === 'switch_mode') {
    const nextMode = targetMode || (mode === 'desktop' ? 'embed' : 'desktop');
    savePluginConfig({ preferredMode: nextMode });
    if (nextMode === 'desktop' && status.installed && !isRunning) {
      await openUrl('xiaochun://action?type=ping', status.path, status.isDev);
    }
    return {
      success: true,
      mode: nextMode,
      actionTaken: 'mode_switched',
      installed: status.installed,
      running: isRunning,
      canEmbed: true,
      embedUrl: 'https://xiaochun.firetable.tech/embed',
      message: nextMode === 'desktop' ? '已成功切换为桌面桌宠模式！' : '已成功切换为 Cindy 内嵌视窗模式！'
    };
  }

  // 2. 内嵌视窗模式 (embed)
  if (mode === 'embed') {
    savePluginConfig({ preferredMode: 'embed' });
    return {
      success: true,
      mode: 'embed',
      installed: status.installed,
      running: isRunning,
      canEmbed: true,
      embedUrl: 'https://xiaochun.firetable.tech/embed',
      hasActivePanel: sseClients.size > 0,
      actionTaken: 'embed_ready',
      message: '小蠢 Cindy 内嵌视窗模式已就绪！您可以在 Cindy 侧边栏/Tab 打开小蠢 AI 伴侣。'
    };
  }

  // 3. 若已安装且仅要求唤醒 (桌面模式 / auto 模式)
  if (status.installed && (action === 'launch' || action === 'ensure')) {
    if (!isRunning) {
      log('小蠢客户端已安装但未运行，执行冷拉起...');
      await openUrl('xiaochun://action?type=ping', status.path, status.isDev);
    }
    return {
      success: true,
      mode: 'desktop',
      installed: true,
      running: true,
      appPath: status.path,
      actionTaken: isRunning ? 'already_running' : 'cold_started'
    };
  }

  // 4. 未安装且模式为 auto：提示用户选择（桌面端 vs 内嵌视窗）
  if (mode === 'auto' && !status.installed && action === 'ensure') {
    return {
      success: true,
      mode: 'auto',
      needSetupChoice: true,
      installed: false,
      running: false,
      actionTaken: 'prompt_choice',
      canEmbed: true,
      embedUrl: 'https://xiaochun.firetable.tech/embed',
      guide: {
        website: 'https://xiaochun.firetable.tech',
        options: [
          {
            id: 'desktop',
            title: '自动安装桌面端（推荐）',
            description: '体验全屏透明置顶、支持鼠标穿透的完整桌面 3D 桌宠',
            action: 'xiaochun_bootstrap(action="install", mode="desktop")'
          },
          {
            id: 'embed',
            title: '使用 Cindy 内嵌面板模式',
            description: '免安装开箱即用，直接在 Cindy 视窗 Tab 中与小蠢交互',
            action: 'xiaochun_bootstrap(mode="embed")'
          }
        ]
      }
    };
  }

  // 若已安装且用户指定重新安装
  if (status.installed && action !== 'install') {
    return {
      success: true,
      mode: 'desktop',
      installed: true,
      running: isRunning,
      appPath: status.path,
      actionTaken: 'none'
    };
  }

  // 未安装情况：尝试在 PC 端进行静默无缝安装（macOS 支持无 sudo 安装到 ~/Applications）
  if (process.platform === 'darwin') {
    log('开始在 macOS 上执行小蠢客户端自动化安装引导...');
    try {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const dmgUrl = await resolveLatestDmgUrl(arch);
      const tmpDmg = path.join(os.tmpdir(), `XiaoChun_Setup_${Date.now()}.dmg`);

      log(`正在下载客户端镜像: ${dmgUrl}`);
      await downloadFile(dmgUrl, tmpDmg);

      log('正在挂载磁盘镜像...');
      const attachOut = execSync(`hdiutil attach "${tmpDmg}" -nobrowse -readonly`, { encoding: 'utf-8' });
      const mountMatch = attachOut.match(/\/Volumes\/[^\n\t\r]+/);
      const mountPoint = mountMatch ? mountMatch[0].trim() : null;

      if (!mountPoint || !fs.existsSync(mountPoint)) {
        throw new Error('挂载 DMG 失败');
      }

      const files = fs.readdirSync(mountPoint);
      const appName = files.find(f => f.endsWith('.app')) || 'Project XiaoChun.app';
      const srcApp = path.join(mountPoint, appName);

      // 优先安装到 /Applications；若无写权限则回退到当前用户的 ~/Applications
      let destDir = '/Applications';
      try {
        fs.accessSync(destDir, fs.constants.W_OK);
      } catch {
        destDir = path.join(os.homedir(), 'Applications');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      }

      const destApp = path.join(destDir, 'Project XiaoChun.app');
      log(`正在将应用复制到 ${destApp}...`);
      if (fs.existsSync(destApp)) {
        execSync(`rm -rf "${destApp}"`);
      }
      execSync(`cp -R "${srcApp}" "${destApp}"`);

      // 卸载镜像并清理临时文件
      try {
        execSync(`hdiutil detach "${mountPoint}" -quiet`);
        fs.unlinkSync(tmpDmg);
      } catch {}

      // 移除 macOS Gatekeeper 隔离属性
      try {
        execSync(`xattr -cr "${destApp}"`);
      } catch {}

      log('安装完成，启动小蠢桌面端...');
      execSync(`open -a "${destApp}"`);

      savePluginConfig({ preferredMode: 'desktop' });
      return {
        success: true,
        mode: 'desktop',
        installed: true,
        running: true,
        appPath: destApp,
        autoInstalled: true,
        actionTaken: 'auto_installed_and_launched'
      };
    } catch (installErr) {
      log('自动化下载安装失败，回退为手动引导方案:', installErr.message);
      // 回退方案：通过默认浏览器打开官方发布页与快速安装脚本
      return {
        success: false,
        mode: 'desktop',
        installed: false,
        running: false,
        needManualInstall: true,
        canEmbed: true,
        error: installErr.message,
        guide: {
          website: 'https://xiaochun.firetable.tech',
          releases: 'https://github.com/FireTable/project-xiaochun/releases',
          curlScript: 'curl -fsSL https://xiaochun.firetable.tech/scripts/install.sh | bash'
        }
      };
    }
  }

  // Windows / Linux 友好回退
  return {
    success: false,
    mode: 'desktop',
    installed: false,
    running: false,
    needManualInstall: true,
    canEmbed: true,
    guide: {
      website: 'https://xiaochun.firetable.tech',
      releases: 'https://github.com/FireTable/project-xiaochun/releases',
      curlScript: 'curl -fsSL https://xiaochun.firetable.tech/scripts/install.sh | bash'
    }
  };
}

// 发送协议指令到小蠢（支持桌面端与 Cindy 内嵌视窗双模自适应）
async function dispatchProtocol(action, params = {}) {
  const activeMode = resolveActiveMode();

  // A. 内嵌视窗模式：通过 SSE 桥接器直接广播给 panel.html
  if (activeMode === 'embed') {
    log(`[内嵌视窗模式] 派发指令至 Cindy Panel: ${action}`, JSON.stringify(params));
    broadcastToEmbedPanel(action, params);
    return {
      success: true,
      mode: 'embed',
      action,
      target: 'panel',
      hasActivePanel: sseClients.size > 0
    };
  }

  // B. 桌面模式
  const installStatus = checkClientInstalled();
  const wasRunning = checkClientRunning();
  let autoInstalled = false;

  // 1. 如果尚未安装，自动触发一次静默就绪流程
  if (!installStatus.installed) {
    log('未检测到安装，尝试自动冷启动就绪...');
    const bootstrapRes = await bootstrapClient('ensure');
    if (bootstrapRes.needSetupChoice) {
      return bootstrapRes;
    }
    if (bootstrapRes.autoInstalled) {
      autoInstalled = true;
      // 给前端 Webview 冷启动留 1.8 秒准备时间
      await new Promise(r => setTimeout(r, 1800));
    } else if (bootstrapRes.needManualInstall) {
      return {
        needManualInstall: true,
        guide: bootstrapRes.guide
      };
    }
  }

  // 2. 长文本安全处理：超过 400 字符走临时文件模式，彻底杜绝命令行截断
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === 'text' && typeof v === 'string' && v.length > 400) {
      const tmpFile = path.join(os.tmpdir(), `xiaochun_speech_${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, v, 'utf-8');
      query.set('file', tmpFile);
    } else {
      query.set(k, String(v));
    }
  }

  const queryString = query.toString();
  const url = queryString ? `xiaochun://${action}?${queryString}` : `xiaochun://${action}`;
  log(`派发协议指令: ${url}`);
  try {
    await openUrl(url, installStatus.path, installStatus.isDev);
  } catch (err) {
    if (String(err).includes('kLSApplicationNotFoundErr') || String(err).includes('No application knows')) {
      log('LaunchServices 未找到协议注册，尝试执行 bootstrap 就绪...');
      const bootRes = await bootstrapClient('ensure');
      if (bootRes.autoInstalled) {
        await openUrl(url, bootRes.appPath, false);
      } else {
        return {
          success: false,
          needManualInstall: true,
          guide: bootRes.guide,
          error: err.message
        };
      }
    } else {
      throw err;
    }
  }

  return {
    success: true,
    mode: 'desktop',
    action,
    coldStart: !wasRunning,
    autoInstalled,
    appPath: installStatus.path
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
      const installStatus = checkClientInstalled();
      const isRunning = checkClientRunning();
      const runtimeState = readRuntimeState();
      const cfg = readPluginConfig();
      const activeMode = resolveActiveMode();
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          platform: process.platform,
          arch: process.arch,
          mode: activeMode,
          preferredMode: cfg.preferredMode || 'auto',
          canEmbed: true,
          embedUrl: 'https://xiaochun.firetable.tech/embed',
          hasActivePanel: sseClients.size > 0,
          isInstalled: installStatus.installed,
          isRunning,
          appPath: installStatus.path,
          onboardingCompleted: runtimeState ? Boolean(runtimeState.onboardingCompleted) : false,
          onboardingActive: runtimeState ? Boolean(runtimeState.onboardingActive) : false,
          currentScene: runtimeState?.currentScene || 'beach3d',
          currentOutfit: runtimeState?.currentOutfit || null
        }
      });
      return;
    }

    if (method === 'bootstrap') {
      const { action, mode } = params || {};
      const res = await bootstrapClient(action || 'ensure', mode || null);
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
            message: '小蠢当前正在进行新手引导（art0 序章剧情向导）。建议您先在桌面的小蠢窗口完成向导，或传入 force=true 强制插话。'
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
      const { mode } = params || {};
      const isRunning = checkClientRunning();
      if (isRunning) {
        log('小蠢客户端正在运行，通过协议触发原生版本更新与重启流程...');
        const res = await dispatchProtocol('update', { mode: mode || 'install' });
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            ...res,
            updated: true,
            mode: mode || 'install',
            message: mode === 'check' ? '已触发版本更新检测' : '已派发更新指令，桌面端正在下载并即将重启'
          }
        });
        return;
      }

      // 若客户端当前未处于运行状态
      log('小蠢客户端未运行，查询 GitHub Releases 最新版本...');
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const dmgUrl = await resolveLatestDmgUrl(arch);
      if (mode === 'check') {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            isRunning: false,
            latestReleaseAsset: dmgUrl,
            message: `客户端未运行，GitHub Releases 最新资源地址: ${dmgUrl}`
          }
        });
        return;
      }

      // 未运行且模式为 install：自动执行冷启动式静默下载安装并拉起
      log('客户端未运行且要求 install，执行最新版本安装与就绪拉起...');
      const bootRes = await bootstrapClient('install');
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          ...bootRes,
          updated: bootRes.autoInstalled,
          message: bootRes.autoInstalled ? '已自动从 GitHub 下载最新版本完成安装并启动小蠢！' : bootRes.guide?.website
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
