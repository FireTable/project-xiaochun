import React, { useEffect } from 'react';

export const WebConsole: React.FC = () => {
  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env.SSR) return;

    // 启用判定：
    // 1. 本地 dev 模式
    // 2. 局域网 IP 访问 (例如 192.168.x.x, 10.x.x.x)
    // 3. URL Query 带 ?debug=1 或 ?vconsole=1
    const isDev = import.meta.env.DEV;
    const isLan = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const hasDebugParam = window.location.search.includes('debug') || window.location.search.includes('vconsole');

    if (isDev || isLan || hasDebugParam) {
      import('vconsole')
        .then(({ default: VConsole }) => {
          if (!(window as any).__vconsole__) {
            const vc = new VConsole({ theme: 'dark' });
            (window as any).__vconsole__ = vc;

            // 输出针对移动端 WebGPU 调试的核心诊断信息
            const isSecure = window.isSecureContext;
            const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
            const hasCaches = typeof caches !== 'undefined';

            console.log(
              `%c[移动端环境诊断]%c
• isSecureContext: ${isSecure ? '✅ 安全(Secure)' : '❌ 非安全(Insecure)'}
• WebGPU (navigator.gpu): ${hasGpu ? '✅ 支持' : '❌ 不可用'}
• Cache API (caches): ${hasCaches ? '✅ 支持' : '❌ 不可用'}
• Host: ${window.location.host}
• Protocol: ${window.location.protocol}`,
              'color: #ea8377; font-weight: bold; font-size: 14px;',
              'color: #94a3b8; font-size: 12px;'
            );

            import('@/llm/deviceDetection').then(({ detectGpuDeviceProfile }) => {
              detectGpuDeviceProfile().then((profile) => {
                console.log(
                  `%c[WebGPU 硬件与模型裁决]%c
• 评估等级: ${profile.tier === 'high' ? '🟢 充足 (High)' : '🟡 受限 (Low)'}
• 推荐模型: ${profile.recommendedModelId}
• 裁决理由: ${profile.reason}
• 单缓冲区上限: ${profile.maxBufferSizeMB} MB
• 存储绑定上限: ${profile.maxStorageBufferMB} MB
• 设备内存: ${profile.deviceMemoryGB ? profile.deviceMemoryGB + ' GB' : '未暴露'}
• 硬件核心: ${profile.hardwareConcurrency} 核
• 设备形态: ${profile.isMobile ? '移动端' : '桌面端'}`,
                  'color: #38bdf8; font-weight: bold; font-size: 14px;',
                  'color: #94a3b8; font-size: 12px;'
                );
              }).catch(() => {});
            }).catch(() => {});

            if (!isSecure && !hasGpu) {
              console.warn(
                '[WebLLM 警告] 手机通过 HTTP 局域网 IP 访问时，浏览器判定为非安全上下文(Insecure Context)，会自动禁用 WebGPU！\n' +
                '解决方案：\n' +
                '1. 使用 Chrome 端口转发：手机连电脑 USB，电脑 chrome://inspect 映射 5185 端口，手机直接访问 http://localhost:5185\n' +
                '2. 或在手机 Chrome 打开 chrome://flags/#unsafely-treat-insecure-origin-as-secure 填入当前局域网地址\n' +
                '3. 或开启 Vite HTTPS 模式'
              );
            }
          }
        })
        .catch((err) => {
          console.warn('[WebConsole] 加载失败:', err);
        });
    }
  }, []);

  return null;
};
