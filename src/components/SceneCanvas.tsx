import React, { useEffect, useRef } from 'react';
import { vrmEngine } from '@/core/vrmEngine';

export const SceneCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      vrmEngine.attachCanvas(canvasRef.current);
    }
  }, []);

  return <canvas ref={canvasRef} id="vrm-canvas" className="absolute inset-0 w-full h-full block z-0" />;
};
