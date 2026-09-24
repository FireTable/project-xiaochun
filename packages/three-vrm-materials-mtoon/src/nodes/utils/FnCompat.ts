import * as THREE_TSL from 'three/tsl';
import * as THREE_WEBGPU from 'three/webgpu';

/**
 * A compat function for `Fn()` / `tslFn()`.
 * `tslFn()` has been renamed to `Fn()` in r168.
 * We are going to use this compat for a while.
 *
 * See: https://github.com/mrdoob/three.js/pull/29064
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const FnCompat: typeof THREE_TSL.Fn = (jsFunc: any) => {
  // COMPAT r168: `tslFn()` has been renamed to `Fn()`
  // See: https://github.com/mrdoob/three.js/pull/29064
  const threeRevision = parseInt(THREE_WEBGPU.REVISION, 10);
  if (threeRevision >= 168) {
    return (THREE_TSL as any).Fn(jsFunc);
  } else {
    return (THREE_WEBGPU as any).tslFn(jsFunc);
  }
};
