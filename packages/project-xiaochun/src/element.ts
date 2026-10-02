// 副作用入口: import '@firetable/project-xiaochun/element' 即注册 <xiaochun-avatar>。
import { defineXiaochunElement } from './avatar-element';

defineXiaochunElement();

export { defineXiaochunElement, XIAOCHUN_ELEMENT_TAG } from './avatar-element';
export type { XiaochunAvatarElement } from './avatar-element';
