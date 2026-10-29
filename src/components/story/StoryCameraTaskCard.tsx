import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, ArrowUpDown, ZoomIn, Check } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { isMobile } from '@/lib/platform';
import { CameraTaskProgress } from './cameraTaskProgress';

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
    // 只认用户输入：指针拖动 (turn) 和画布上的滚轮 / 双指 / 中键缩放；绝不读相机视距或 OrbitControls 的 change
    const progress = new CameraTaskProgress();
    const apply = (changed: boolean) => {
      if (changed) setTasks({ ...progress.state });
    };
    const unsubGesture = vrmEngine.interaction.onGesture((ev) => {
      if (ev.type === 'turn') apply(progress.onTurn(ev.dx, ev.dy));
    });
    const unsubZoom = vrmEngine.interaction.onUserZoom((ev) => apply(progress.onZoom(ev.amount)));
    return () => {
      unsubGesture();
      unsubZoom();
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
    <div className="pointer-events-auto w-full p-2.5 sm:p-3 rounded-xl bg-[#0b0e1b]/85 backdrop-blur-xl border border-white/14 shadow-[0_8px_24px_rgba(0,0,0,0.5)] flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* 头部标题与完成进度 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white tracking-wide">
          {t('story.cameraExplore')}
        </span>

        <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[11px] font-medium">
          <span className={isAllDone ? 'text-brand-300 font-bold' : 'text-white/90'}>
            {completedCount}
          </span>
          <span className="text-white/30"> / </span>
          <span className="text-white/60">{taskList.length}</span>
        </div>
      </div>

      {/* 任务列表条目 (紧凑细长排列) */}
      <div className="flex flex-col gap-1.5">
        {taskList.map((task) => {
          const Icon = task.icon;
          return (
            <div
              key={task.id}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all duration-200 ${
                task.done
                  ? 'bg-brand-500/10 border-brand-400/40 text-white shadow-sm'
                  : 'bg-[#101426]/60 border-white/10 text-white/90 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 pr-1.5">
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-all ${
                    task.done
                      ? 'bg-brand-500/20 border-brand-400/40 text-brand-300'
                      : 'bg-white/[0.06] border-white/10 text-white/70'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[11px] sm:text-xs font-medium tracking-wide truncate ${task.done ? 'text-white' : 'text-white/90'}`}>
                    {task.label}
                  </span>
                  <span className="text-[10px] text-white/40 truncate hidden xs:inline">
                    · {task.subLabel}
                  </span>
                </div>
              </div>

              {/* 右侧打勾状态 */}
              <div className="shrink-0 pl-1">
                {task.done ? (
                  <div className="w-4 h-4 rounded-full bg-brand-400 text-slate-950 flex items-center justify-center shadow-sm">
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  </div>
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-white/30 bg-white/[0.04]" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
