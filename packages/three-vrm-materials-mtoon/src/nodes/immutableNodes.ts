import * as THREE from 'three/webgpu';
import { nodeImmutable } from 'three/tsl';

export const shadeColor = nodeImmutable(THREE.PropertyNode, 'vec3').toVar('ShadeColor');
export const shadingShift = nodeImmutable(THREE.PropertyNode, 'float').toVar('ShadingShift');
export const shadingToony = nodeImmutable(THREE.PropertyNode, 'float').toVar('ShadingToony');
export const rimLightingMix = nodeImmutable(THREE.PropertyNode, 'float').toVar('RimLightingMix');
export const rimMultiply = nodeImmutable(THREE.PropertyNode, 'vec3').toVar('RimMultiply');
export const matcap = nodeImmutable(THREE.PropertyNode, 'vec3').toVar('matcap');
export const parametricRim = nodeImmutable(THREE.PropertyNode, 'vec3').toVar('ParametricRim');
