import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, ArrowUpDown, ZoomIn, Check, Sparkles } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { isMobile } from '@/lib/platform';

interface StoryCameraTaskCardProps {
  onTasksUpdate?: (completedCount: number, totalCount: number) => void;
}

export const StoryCameraTaskCard: React.FC<StoryCameraTaskCardProps> = ({
  onTasksUpdate,
}) => {
  const { t } = useTranslation();
  const isMobileDevice = isMobile();

  const [tasks, setTasks] = useState({
    orbit: false,
    pitch: false,
    zoom: false,
  });

  useEffect(() => {
    let cumTurnDx = 0;
    let cumTurnDy = 0;
    let cumWheel = 0;

    // 1. 订阅手势旋转 (水平 turn 与 垂直 pitch)
    const unsubGesture = vrmEngine.interaction.onGesture((ev) => {
      if (ev.type === 'turn') {
        cumTurnDx += Math.abs(ev.dx);
        cumTurnDy += Math.abs(ev.dy);

        // 累计横向拖动 >= 80px 判定完成水平 360° 探索
        if (cumTurnDx >= 80) {
          setTasks((prev) => (prev.orbit ? prev : { ...prev, orbit: true }));
        }
        // 累计纵向拖动 >= 50px 判定完成俯仰角探索
        if (cumTurnDy >= 50) {
          setTasks((prev) => (prev.pitch ? prev : { ...prev, pitch: true }));
        }
      }
    });

    // 2. 订阅相机缩放 (Controls 视距改变与滚轮)
    const controls = vrmEngine.getControls();
    let lastDist = controls ? controls.getDistance() : 0;
    let cumDistDelta = 0;

    const handleControlsChange = () => {
      if (!controls) return;
      const currentDist = controls.getDistance();
      const delta = Math.abs(currentDist - lastDist);
      if (delta > 0.005) {
        cumDistDelta += delta;
        lastDist = currentDist;
        if (cumDistDelta >= 0.08) {
          setTasks((prev) => (prev.zoom ? prev : { ...prev, zoom: true }));
        }
      }
    };

    if (controls) {
      controls.addEventListener('change', handleControlsChange);
    }

    const handleWheel = (e: WheelEvent) => {
      cumWheel += Math.abs(e.deltaY);
      if (cumWheel >= 50) {
        setTasks((prev) => (prev.zoom ? prev : { ...prev, zoom: true }));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      unsubGesture();
      if (controls) {
        controls.removeEventListener('change', handleControlsChange);
      }
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const taskList = useMemo(() => [
    {
      id: 'orbit',
      num: 1,
      label: t('onboarding.cameraTaskOrbit', '调整 360° 环视'),
      subLabel: t('onboarding.cameraOrbitSub', '水平左右滑动拖拽'),
      done: tasks.orbit,
      icon: RotateCcw,
    },
    {
      id: 'pitch',
      num: 2,
      label: t('onboarding.cameraTaskPitch', '调整俯仰角'),
      subLabel: t('onboarding.cameraPitchSub', '垂直上下滑动拖拽'),
      done: tasks.pitch,
      icon: ArrowUpDown,
    },
    {
      id: 'zoom',
      num: 3,
      label: isMobileDevice
        ? t('onboarding.cameraTaskZoomMobile', '双指缩放')
        : t('onboarding.cameraTaskZoom', '鼠标滚轮缩放'),
      subLabel: isMobileDevice
        ? t('onboarding.cameraZoomSubMobile', '前后推拉镜头视距')
        : t('onboarding.cameraZoomSub', '前后滚动推拉视距'),
      done: tasks.zoom,
      icon: ZoomIn,
    },
  ], [tasks, isMobileDevice, t]);

  const completedCount = useMemo(() => {
    return taskList.filter((item) => item.done).length;
  }, [taskList]);

  useEffect(() => {
    onTasksUpdate?.(completedCount, taskList.length);
  }, [completedCount, taskList.length, onTasksUpdate]);

  const isAllDone = completedCount === taskList.length;

  return (
    <div className="pointer-events-auto w-full p-4 sm:p-5 rounded-2xl bg-black/75 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* 头部标题与完成进度 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-[#ea8377] animate-pulse" />
          <span className="text-xs sm:text-sm font-bold text-white tracking-wide">
            3D 视角探索任务
          </span>
        </div>
        <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] font-mono">
          <span className={isAllDone ? 'text-emerald-400 font-bold' : 'text-[#f5aa9c]'}>
            {completedCount}
          </span>
          <span className="text-white/40">/</span>
          <span className="text-white/70">{taskList.length}</span>
        </div>
      </div>

      {/* 任务列表条目 */}
      <div className="flex flex-col gap-2">
        {taskList.map((task) => {
          const Icon = task.icon;
          return (
            <div
              key={task.id}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all duration-200 ${
                task.done
                  ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-100 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]'
                  : 'bg-slate-950/60 border-white/15 text-white/90'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <span className="text-xs font-mono font-bold text-white/50 w-3 shrink-0">
                  {task.num}.
                </span>
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                    task.done
                      ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-300'
                      : 'bg-white/10 border-white/15 text-white/80'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className={`text-xs sm:text-[13px] font-semibold truncate ${
                      task.done ? 'text-emerald-200' : 'text-white'
                    }`}
                  >
                    {task.label}
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-white/50 truncate">
                    {task.subLabel}
                  </span>
                </div>
              </div>

              {/* 右侧打勾状态 */}
              <div className="shrink-0 pl-2">
                {task.done ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-in zoom-in-75 duration-200">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-white/30 bg-white/5 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
