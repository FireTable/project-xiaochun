export { createXiaochun } from './client';
export type {
  XiaochunOptions,
  XiaochunInstance,
  XiaochunEvents,
  XiaochunError,
  XiaochunErrorCode,
  XiaochunPosition,
  XiaochunLazy,
  XiaochunAudioOptions,
  XiaochunAudioSource,
  XiaochunAudioStream,
} from './client';
// 注意: 这里只导出 define 函数, 不自动注册 (保持 sideEffects: false 友好)。需要自定义元素请 import '@firetable/project-xiaochun/element'。
export { defineXiaochunElement, XIAOCHUN_ELEMENT_TAG } from './avatar-element';
export type { XiaochunAvatarElement } from './avatar-element';
export * from './protocol';
export { toProtocolUrl, parseProtocolUrl, XIAOCHUN_PROTOCOL_SCHEME } from './protocol-url';
export type { XiaochunSpeakAction } from './protocol-url';
