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

if (args.length === 0) {
  console.log(`
\x1b[36m=== 小春协议快速调用工具 ===\x1b[0m

用法示例:
  1. 直接朗读台词 (自动 URL Encode):
     \x1b[32mpnpm speak "主人，该休息一下了！"\x1b[0m

  2. 触发完整自定义协议:
     \x1b[32mpnpm protocol "xiaochun://speak?text=测试"\x1b[0m
`);
  process.exit(0);
}

let targetUrl = '';

if (args[0] === 'speak') {
  // 形式: pnpm speak "台词"
  const text = args.slice(1).join(' ');
  if (!text) {
    console.error('\x1b[31m[Error]\x1b[0m 请输入要朗读的文本，例如: pnpm speak "你好呀"');
    process.exit(1);
  }
  targetUrl = `xiaochun://speak?text=${encodeURIComponent(text)}`;
} else if (args[0].startsWith('xiaochun://')) {
  // 形式: pnpm protocol "xiaochun://..."
  targetUrl = args[0];
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
