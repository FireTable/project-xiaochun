#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 判断平台可执行文件名
const isWindows = process.platform === 'win32';
const binName = isWindows ? 'project-xiaochun.exe' : 'project-xiaochun';
const binPath = path.join(rootDir, 'src-tauri', 'target', 'debug', binName);

if (!fs.existsSync(binPath)) {
  console.error(`\x1b[31m[Error]\x1b[0m 找不到可执行文件: ${binPath}`);
  console.error('请确保已运行过 `pnpm tauri:dev` 或完成编译。');
  process.exit(1);
}

// 获取命令行参数
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
\x1b[36m=== 小春协议快速调用工具 (xiaochun:// Protocol CLI) ===\x1b[0m

用法示例:
  1. 朗读台词:
     \x1b[32mpnpm speak "主人，该休息一下了！"\x1b[0m

  2. 播放动作:
     \x1b[32mpnpm motion waving\x1b[0m
     \x1b[32mpnpm motion joyfulJump --loop\x1b[0m
     \x1b[32mpnpm motion --stop\x1b[0m

  3. 抽取动作组:
     \x1b[32mpnpm motion-group greeting\x1b[0m
     \x1b[32mpnpm motion-group praiseCute\x1b[0m
     \x1b[32mpnpm motion-group dancePerformance\x1b[0m
     (兼容缩写: pnpm group greeting)

  4. 触发面部表情:
     \x1b[32mpnpm expr happy\x1b[0m
     \x1b[32mpnpm expr gentle_smile 0.85\x1b[0m
     \x1b[32mpnpm expr playful\x1b[0m

  5. 电影运镜与景别切换:
     \x1b[32mpnpm camera close_up\x1b[0m
     \x1b[32mpnpm camera full --orbit 45\x1b[0m
     \x1b[32mpnpm camera extreme_close_up --movement push_in\x1b[0m
     \x1b[32mpnpm camera --pan-up\x1b[0m
     \x1b[32mpnpm camera --reset\x1b[0m

  6. 立即停止语音与动作:
     \x1b[32mpnpm stop\x1b[0m

  7. 完整自定义协议 URL:
     \x1b[32mpnpm protocol "xiaochun://motion?name=handHeart&loop=true"\x1b[0m
`);
  process.exit(0);
}

let targetUrl = '';
const cmd = args[0];

if (cmd === 'speak') {
  const text = args.slice(1).join(' ');
  if (!text) {
    console.error('\x1b[31m[Error]\x1b[0m 请输入要朗读的文本，例如: pnpm speak "你好呀"');
    process.exit(1);
  }
  targetUrl = `xiaochun://speak?text=${encodeURIComponent(text)}`;
} else if (cmd === 'motion') {
  const subArgs = args.slice(1);
  if (subArgs.includes('--stop')) {
    targetUrl = 'xiaochun://motion?stop=true';
  } else {
    const name = subArgs.find((a) => !a.startsWith('--'));
    if (!name) {
      console.error('\x1b[31m[Error]\x1b[0m 请指定动作名称，例如: pnpm motion waving');
      process.exit(1);
    }
    const params = new URLSearchParams();
    params.set('name', name);
    if (subArgs.includes('--loop')) params.set('loop', 'true');
    if (subArgs.includes('--upper')) params.set('mask', 'upperBody');
    targetUrl = `xiaochun://motion?${params.toString()}`;
  }
} else if (cmd === 'motion-group' || cmd === 'motionGroup' || cmd === 'group') {
  const groupName = args[1];
  if (!groupName) {
    console.error('\x1b[31m[Error]\x1b[0m 请指定动作组名称，例如: pnpm motion-group greeting');
    console.log('可用组: greeting, idleFlavor, listening, thinking, praiseCute, playfulSulking, dancePerformance, outfitShowcase');
    process.exit(1);
  }
  const params = new URLSearchParams();
  params.set('name', groupName);
  if (args.includes('--loop')) params.set('loop', 'true');
  targetUrl = `xiaochun://motion-group?${params.toString()}`;
} else if (cmd === 'expr' || cmd === 'expression') {
  const name = args[1];
  if (!name) {
    console.error('\x1b[31m[Error]\x1b[0m 请指定表情名称，例如: pnpm expr happy');
    console.log('可用表情: neutral, happy, gentle_smile, smile, shy, playful, surprised, hesitant, sad, angry, relaxed');
    process.exit(1);
  }
  const intensity = args[2] && Number.isFinite(Number(args[2])) ? args[2] : undefined;
  const params = new URLSearchParams();
  params.set('name', name);
  if (intensity) params.set('intensity', intensity);
  targetUrl = `xiaochun://expression?${params.toString()}`;
} else if (cmd === 'camera') {
  const subArgs = args.slice(1);
  if (subArgs.includes('--reset')) {
    targetUrl = 'xiaochun://camera?reset=true';
  } else if (subArgs.includes('--pan-up') || subArgs.includes('--panup')) {
    targetUrl = 'xiaochun://camera?panUp=true';
  } else {
    const shot = subArgs.find((a) => !a.startsWith('--'));
    const params = new URLSearchParams();
    if (shot) params.set('shot', shot);
    const orbitIdx = subArgs.findIndex((a) => a === '--orbit' || a === '-o');
    if (orbitIdx !== -1 && subArgs[orbitIdx + 1]) params.set('orbit', subArgs[orbitIdx + 1]);
    const moveIdx = subArgs.findIndex((a) => a === '--movement' || a === '-m');
    if (moveIdx !== -1 && subArgs[moveIdx + 1]) params.set('movement', subArgs[moveIdx + 1]);
    const durIdx = subArgs.findIndex((a) => a === '--duration' || a === '-d');
    if (durIdx !== -1 && subArgs[durIdx + 1]) params.set('durationSec', subArgs[durIdx + 1]);
    const fovIdx = subArgs.findIndex((a) => a === '--fov');
    if (fovIdx !== -1 && subArgs[fovIdx + 1]) params.set('fov', subArgs[fovIdx + 1]);
    targetUrl = `xiaochun://camera?${params.toString()}`;
  }
} else if (cmd === 'stop') {
  targetUrl = 'xiaochun://stop';
} else if (cmd.startsWith('xiaochun://')) {
  targetUrl = cmd;
} else {
  // 默认作为 speak 内容处理
  const text = args.join(' ');
  targetUrl = `xiaochun://speak?text=${encodeURIComponent(text)}`;
}

console.log(`\x1b[34m[Protocol]\x1b[0m 正在发送指令: ${targetUrl}`);

const child = spawn(binPath, [targetUrl], {
  stdio: 'inherit',
  detached: false,
});

child.on('error', (err) => {
  console.error('\x1b[31m[Error]\x1b[0m 触发失败:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\x1b[32m[Success]\x1b[0m 协议指令已成功传递给运行中的实例！');
  }
  process.exit(code ?? 0);
});
