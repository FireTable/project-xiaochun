import React, { useState, useEffect, useRef } from 'react';
import { vrmEngine } from '@/core/vrmEngine';

export const SceneCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isAttached, setIsAttached] = useState(false);

  useEffect(() => {
    // 延迟与空闲调度：先让出主线程优先完成 LoadingOverlay 的布局与首次动画渲染，
    // 在浏览器首屏空闲 (requestIdleCallback) 或首帧稳定后再初始化 WebGL 上下文。
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const setupCanvas = () => {
      if (canvasRef.current) {
        vrmEngine.attachCanvas(canvasRef.current);
        setIsAttached(true);
      }
    };

    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (win && typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(setupCanvas, { timeout: 250 });
    } else {
      timerId = setTimeout(setupCanvas, 80);
    }

    return () => {
      if (idleId !== null && win && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="vrm-canvas"
      // ponytail: canvas 一直 opacity-100,只挂载前禁用交互。
      // 渲染后 canvas 显示 scene + linework world + (后续揭示的)VRM。
      // VRM 自身的可见性由 vrmEngine 控制,这里只管 canvas 本身。
      className={`absolute inset-0 w-full h-full block z-0 ${isAttached ? '' : 'pointer-events-none'
        }`}
    />
  );
};
