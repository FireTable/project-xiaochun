import { describe, it, expect, beforeEach } from 'vitest';
import { VocalAudioProcessor } from './vocalProcessor';
import { APP_CONFIG, VOCAL_PRESETS } from '@/config';
import { zhCN } from '@/i18n/zh-CN';
import { en } from '@/i18n/en';
import { ja } from '@/i18n/ja';
import { SECTIONS } from '@/components/dev-drawer/schema';

describe('VocalAudioProcessor', () => {
  let processor: VocalAudioProcessor;

  beforeEach(() => {
    processor = new VocalAudioProcessor();
  });

  it('initializes with default config from APP_CONFIG', () => {
    const config = processor.getConfig();
    expect(config.enabled).toBe(APP_CONFIG.vocal.default.enabled);
    expect(config.sceneLinkage).toBe(false);
    expect(config.preset).toBe(APP_CONFIG.vocal.default.preset);
    expect(config.chestResonance).toBe(APP_CONFIG.vocal.default.chestResonance);
    expect(config.airGain).toBe(APP_CONFIG.vocal.default.airGain);
  });

  it('updates parameters and maintains config state', () => {
    processor.updateParam('chestResonance', 3.5);
    expect(processor.getConfig().chestResonance).toBe(3.5);

    processor.updateParam('airGain', 1.5);
    expect(processor.getConfig().airGain).toBe(1.5);

    processor.updateParam('enabled', false);
    expect(processor.getConfig().enabled).toBe(false);

    processor.updateParam('sceneLinkage', false);
    expect(processor.getConfig().sceneLinkage).toBe(false);
  });

  it('updates configuration via batch updateConfig', () => {
    processor.updateConfig({
      chestResonance: 4.0,
      airGain: 2.0,
      compressorThreshold: -24,
      reverbWet: 0.12,
    });

    const c = processor.getConfig();
    expect(c.chestResonance).toBe(4.0);
    expect(c.airGain).toBe(2.0);
    expect(c.compressorThreshold).toBe(-24);
    expect(c.reverbWet).toBe(0.12);
  });

  it('switches presets accurately (sweet, oneesan, radio, whisper, bypass)', () => {
    // Switch to oneesan (知性御姐)
    processor.setPreset('oneesan');
    let c = processor.getConfig();
    expect(c.preset).toBe('oneesan');
    expect(c.chestResonance).toBe(VOCAL_PRESETS.oneesan.chestResonance);
    expect(c.compressorThreshold).toBe(VOCAL_PRESETS.oneesan.compressorThreshold);

    // Switch to radio
    processor.setPreset('radio');
    c = processor.getConfig();
    expect(c.preset).toBe('radio');
    expect(c.lowCutFreq).toBe(VOCAL_PRESETS.radio.lowCutFreq);

    // Switch to whisper
    processor.setPreset('whisper');
    c = processor.getConfig();
    expect(c.preset).toBe('whisper');
    expect(c.airGain).toBe(VOCAL_PRESETS.whisper.airGain);

    // Switch to bypass (完全原声直通：零压缩、全频直通、零EQ、零混响，但不改变上方系统开关)
    processor.setPreset('bypass');
    c = processor.getConfig();
    expect(c.preset).toBe('bypass');
    expect(c.enabled).toBe(true); // 保持原有开关状态，不篡改上面的 checkbox
    expect(c.compressorThreshold).toBe(0);
    expect(c.lowCutFreq).toBe(20);
    expect(c.chestResonance).toBe(0);
    expect(c.airGain).toBe(0);
    expect(c.midGain).toBe(0);
    expect(c.reverbWet).toBe(0);
    expect(c.outputGain).toBe(1.0);

    // Switch back to sweet
    processor.setPreset('sweet');
    c = processor.getConfig();
    expect(c.preset).toBe('sweet');
    expect(c.enabled).toBe(true);
  });

  it('preset switching (including bypass) only changes acoustic sliders without altering checkbox switches', () => {
    // 模拟用户自定义配置上方 checkbox 状态
    processor.updateParam('enabled', true);
    processor.updateParam('distanceAttenuation', false);
    processor.updateParam('sceneLinkage', true);

    // 1. 切换到 bypass (原声直通)
    processor.setPreset('bypass');
    let c = processor.getConfig();
    // 上方 3 个 checkbox 保持绝对不变
    expect(c.enabled).toBe(true);
    expect(c.distanceAttenuation).toBe(false);
    expect(c.sceneLinkage).toBe(true);
    // 下方滑块全归为原声中性值 (flat / bypass)
    expect(c.chestResonance).toBe(0);
    expect(c.airGain).toBe(0);
    expect(c.midGain).toBe(0);
    expect(c.compressorThreshold).toBe(0);
    expect(c.reverbWet).toBe(0);
    expect(c.outputGain).toBe(1.0);

    // 2. 切换到 radio (复古电台)
    processor.setPreset('radio');
    c = processor.getConfig();
    // 上方 3 个 checkbox 依然保持不变
    expect(c.enabled).toBe(true);
    expect(c.distanceAttenuation).toBe(false);
    expect(c.sceneLinkage).toBe(true);
    // 下方滑块变成电台音色
    expect(c.chestResonance).toBe(VOCAL_PRESETS.radio.chestResonance);
    expect(c.midGain).toBe(VOCAL_PRESETS.radio.midGain);

    // 3. 用户在关闭 enabled 的状态下切换音色
    processor.updateParam('enabled', false);
    processor.setPreset('oneesan');
    c = processor.getConfig();
    expect(c.enabled).toBe(false); // 绝不强制变成 true
    expect(c.preset).toBe('oneesan');
    expect(c.chestResonance).toBe(VOCAL_PRESETS.oneesan.chestResonance);
  });

  it('handles custom preset flag', () => {
    processor.setPreset('custom');
    expect(processor.getConfig().preset).toBe('custom');
  });

  it('adapts acoustic profile based on 3D scenes when sceneLinkage is active', () => {
    processor.updateParam('enabled', true);
    processor.setPreset('sweet');
    processor.updateParam('sceneLinkage', true);

    // 1. 海滩场景 (开阔室外，极低混响去回音)
    processor.applySceneTheme('beach3d');
    let c = processor.getConfig();
    expect(c.reverbWet).toBe(0.03);
    expect(c.reverbRoomSize).toBe(0.15);
    expect(c.lowCutFreq).toBe(95);

    // 2. 透明桌宠 (近身陪伴，零混响贴耳)
    processor.applySceneTheme('transparent');
    c = processor.getConfig();
    expect(c.reverbWet).toBe(0.0);
    expect(c.compressorThreshold).toBe(-20);

    // 3. 虚空场景 (深邃空灵，大空间延展)
    processor.applySceneTheme('void');
    c = processor.getConfig();
    expect(c.reverbWet).toBe(0.16);
    expect(c.reverbRoomSize).toBe(0.55);

    // 4. 室内极简画室 (舒适日常微混响)
    processor.applySceneTheme('light');
    c = processor.getConfig();
    expect(c.reverbWet).toBe(0.07);

    // 5. 当 sceneLinkage 为 false 时，切换场景不应改变用户自定参数
    processor.updateParam('sceneLinkage', false);
    processor.updateParam('reverbWet', 0.25);
    processor.applySceneTheme('beach3d');
    expect(processor.getConfig().reverbWet).toBe(0.25); // 依然保持用户自定的 0.25
  });

  it('modulates volume and chest resonance dynamically based on camera distance when distanceAttenuation is true', () => {
    processor.updateParam('enabled', true);
    processor.setPreset('sweet');
    processor.updateParam('distanceAttenuation', true);

    // 1. 镜头推近测试 (0.6m 贴耳近场特写: 音量饱满增大至 +3.0dB + 胸腔低频共鸣提升至 +3.0dB)
    processor.updateCameraAcoustics({ distance: 0.6 });
    let offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBeCloseTo(3.0, 1);  // 近场低频胸腔共鸣提升至 +3.0dB (贴耳浑厚)
    expect(offsets.gainOffset).toBeCloseTo(1.413, 2); // 音量饱满增大至 +3.0dB (约 1.41x)

    let summary = processor.getCameraAcousticSummary();
    expect(summary.distanceMode).toBe('near');

    // 2. 标准机位测试 (2.2m: 标准基准视距，共鸣偏移为0，音量为 1.0x 标准电平)
    processor.updateCameraAcoustics({ distance: 2.2 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBe(0);
    expect(offsets.gainOffset).toBeCloseTo(1.0, 2);
    summary = processor.getCameraAcousticSummary();
    expect(summary.distanceMode).toBe('standard');

    // 3. 中景空间测试 (5.5m: 适度中景，8m 以前音量完全不衰减，低频共鸣清爽归零)
    processor.updateCameraAcoustics({ distance: 5.5 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBe(0);              // 远距离胸腔共鸣平滑归零
    expect(offsets.gainOffset).toBe(1.0);             // 8m 之前完全不衰减，保持 1.0x 标准电平
    summary = processor.getCameraAcousticSummary();
    expect(summary.distanceMode).toBe('mid');

    // 4. 远景空间起始点测试 (8.0m: 声音衰减从 8m 以后才开始，8.0m 依然为 1.0x)
    processor.updateCameraAcoustics({ distance: 8.0 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.gainOffset).toBe(1.0);

    // 5. 远景空间测试 (8m 以后开始声音衰减，拉远至 15.0m 时音量平滑衰减至 -8.0dB 约 0.4x)
    processor.updateCameraAcoustics({ distance: 11.5 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.gainOffset).toBeCloseTo(0.631, 2); // 11.5m 衰减 -4.0dB (约 0.63x)
    summary = processor.getCameraAcousticSummary();
    expect(summary.distanceMode).toBe('far');

    processor.updateCameraAcoustics({ distance: 15.0 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBe(0);              // 低频共鸣保持 0，清爽干净
    expect(offsets.gainOffset).toBeCloseTo(0.398, 2); // 15m 衰减至 -8.0dB (约 0.40x)
    summary = processor.getCameraAcousticSummary();
    expect(summary.distanceMode).toBe('far');

    // 3. 当关闭 distanceAttenuation 时，所有镜头声学偏移归零
    processor.updateParam('distanceAttenuation', false);
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBe(0);
    expect(offsets.gainOffset).toBe(1.0);

    // 4. 原声直通 (bypass) 模式下，若开启 distanceAttenuation，仍支持纯净原声的镜头远近音量自适应
    processor.setPreset('bypass');
    processor.updateParam('enabled', true);
    processor.updateParam('distanceAttenuation', true);
    processor.updateCameraAcoustics({ distance: 1.0 });
    offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.gainOffset).toBeGreaterThan(1.0); // 原声推近依然有饱满近场提升
  });

  it('guarantees 100% bit-exact dry bypass routing in bypass preset even with distanceAttenuation enabled at standard distance', () => {
    // 模拟用户配置：enabled = true, distanceAttenuation = true, distance = 4.3m, preset = 'bypass'
    processor.updateParam('enabled', true);
    processor.updateParam('distanceAttenuation', true);
    processor.setPreset('bypass');
    processor.updateCameraAcoustics({ distance: 4.3 });

    const offsets = processor.computeCameraAcousticOffsets();
    expect(offsets.chestOffset).toBe(0);
    expect(offsets.gainOffset).toBe(1.0);

    // 此时无论开启或关闭语音美化，都走纯干声 dryGain (gain=1.0)，绝不经过任何低切、EQ3、压限器或混响效果器
    expect(processor.getConfig().preset).toBe('bypass');
    expect(processor.getConfig().chestResonance).toBe(0);
    expect(processor.getConfig().airGain).toBe(0);
    expect(processor.getConfig().compressorThreshold).toBe(0);
    expect(processor.getConfig().reverbWet).toBe(0);
    expect(processor.getConfig().outputGain).toBe(1.0);
  });

  it('notifies subscribers upon parameter changes and scene theme transitions', () => {
    let notifiedConfig: any = null;
    const unsubscribe = processor.subscribe((cfg) => {
      notifiedConfig = cfg;
    });

    processor.setPreset('sweet');
    processor.updateParam('sceneLinkage', true);
    processor.applySceneTheme('beach3d');
    expect(notifiedConfig).not.toBeNull();
    expect(notifiedConfig.reverbWet).toBe(0.03);

    unsubscribe();
    notifiedConfig = null;
    processor.applySceneTheme('void');
    expect(notifiedConfig).toBeNull(); // 已解绑订阅
  });

  it('gracefully handles headless / mock AudioContext without throwing', () => {
    const fakeCtx = {
      state: 'running',
    } as unknown as AudioContext;

    expect(() => processor.init(fakeCtx)).not.toThrow();
    expect(processor.ready).toBe(false);

    const fakeSource = {} as unknown as AudioNode;
    const fakeDest = {} as unknown as AudioNode;
    expect(() => processor.connectChain(fakeSource, fakeDest)).not.toThrow();

    expect(() => processor.dispose()).not.toThrow();
  });
});

describe('Vocal Processing i18n & DevDrawer Integration', () => {
  it('registers vocal section in dev-drawer schema', () => {
    const vocalSec = SECTIONS.find((s) => s.id === 'vocal');
    expect(vocalSec).toBeDefined();
    expect(vocalSec?.defaultCollapsed).toBe(false);
  });

  it('verifies all vocal and scene linkage i18n keys resolve in zh-CN, en, and ja', () => {
    const keysToCheck = [
      'panel.vocalLabel',
      'panel.vocalEnabledToggle',
      'panel.vocalEnabledHint',
      'panel.vocalSceneLinkage',
      'panel.vocalSceneLinkageHint',
      'panel.vocalCurrentAcousticZone',
      'panel.vocalDistanceAttenuation',
      'panel.vocalDistanceAttenuationHint',
      'panel.vocalCameraAcousticState',
      'panel.vocalCameraDistanceModes.near',
      'panel.vocalCameraDistanceModes.standard',
      'panel.vocalCameraDistanceModes.far',
      'panel.vocalCameraPitchModes.topDown',
      'panel.vocalCameraPitchModes.bottomUp',
      'panel.vocalCameraPitchModes.backFacing',
      'panel.vocalSceneAcoustics.beach3d',
      'panel.vocalSceneAcoustics.transparent',
      'panel.vocalSceneAcoustics.void',
      'panel.vocalSceneAcoustics.light',
      'panel.vocalSceneAcoustics.dark',
      'panel.vocalTestingLive',
      'panel.vocalTestHeading',
      'panel.vocalTestHint',
      'panel.vocalPlayTest',
      'panel.vocalStopTest',
      'panel.vocalTestSample',
      'panel.vocalPresetsLabel',
      'panel.vocalPresets.sweet',
      'panel.vocalPresets.oneesan',
      'panel.vocalPresets.radio',
      'panel.vocalPresets.whisper',
      'panel.vocalPresets.bypass',
      'panel.vocalPresets.custom',
      'panel.vocalSliders.chestResonance',
      'panel.vocalSliders.airGain',
      'panel.vocalSliders.midGain',
      'panel.vocalSliders.compressor',
      'panel.vocalSliders.reverb',
      'panel.vocalSliders.outputGain',
      'panel.vocalSliderLabels.chestResonance.min',
      'panel.vocalSliderLabels.chestResonance.max',
      'panel.vocalSliderLabels.airGain.min',
      'panel.vocalSliderLabels.airGain.max',
      'panel.vocalSliderLabels.midGain.min',
      'panel.vocalSliderLabels.midGain.max',
      'panel.vocalSliderLabels.compressor.min',
      'panel.vocalSliderLabels.compressor.max',
      'panel.vocalSliderLabels.reverb.min',
      'panel.vocalSliderLabels.reverb.max',
      'panel.vocalSliderLabels.outputGain.min',
      'panel.vocalSliderLabels.outputGain.max',
    ];

    const getVal = (obj: any, path: string) =>
      path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);

    for (const [lang, dict] of Object.entries({ 'zh-CN': zhCN, en, ja })) {
      for (const k of keysToCheck) {
        const val = getVal(dict, k);
        expect(typeof val, `Key "${k}" in ${lang} must be a non-empty string`).toBe('string');
        expect(val.length, `Key "${k}" in ${lang} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});
