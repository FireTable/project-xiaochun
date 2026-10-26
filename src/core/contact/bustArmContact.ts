import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { APP_CONFIG } from '@/config';
import { shouldConsiderCloth, springStableWorldMatrix } from '../spring/bustClothFit';

/**
 * Slide arm vertices out of the bust after skinning.
 *
 * Growing the spring sphere shoves the breast instead of the arm, and the
 * dinner-dress cup (skinned to the chest) tears. The ellipsoid comes from
 * bust-chain skin, weight >= 0.45, in upperChest space. That bone does not
 * carry bust scale, so the fit runs again when a bust slider changes. Each
 * frame only copies the anchor matrix: the volume follows the body, not the
 * bust spring.
 */

/** 90th percentile of each axis. The farthest vertex is usually a stray. */
const SURFACE_PERCENTILE = 0.9;
/** Fewer samples than this means that side has no measurable breast. */
const MIN_SAMPLES = 12;
/** Keep the ellipsoid from collapsing into a plane. */
const MIN_RADIUS = 0.012;
const BUST_WEIGHT = 0.45;

const bustAnchorWorld = { value: new THREE.Matrix4() };
const bustAnchorInv = { value: new THREE.Matrix4() };
const bustCenterL = { value: new THREE.Vector3() };
const bustRadiusL = { value: new THREE.Vector3() };
const bustCenterR = { value: new THREE.Vector3() };
const bustRadiusR = { value: new THREE.Vector3() };
const bustPushCap = { value: 0.02 };

const SHARED_UNIFORMS: Record<string, THREE.IUniform> = {
  bustAnchorWorld,
  bustAnchorInv,
  bustCenterL,
  bustRadiusL,
  bustCenterR,
  bustRadiusR,
  bustPushCap,
};

const DECL = /* glsl */ `
attribute float armMask;
uniform mat4 bustAnchorWorld;
uniform mat4 bustAnchorInv;
uniform vec3 bustCenterL;
uniform vec3 bustRadiusL;
uniform vec3 bustCenterR;
uniform vec3 bustRadiusR;
uniform float bustPushCap;
`;

const BODY = /* glsl */ `
{
  vec3 bustWorldDelta = vec3(0.0);
  if (armMask > 0.001) {
    vec3 bustWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec3 bustAnchorPos = (bustAnchorInv * vec4(bustWorldPos, 1.0)).xyz;
    float bustBest = 0.0;
    if (bustRadiusL.x > 1e-4) {
      vec3 bustQ = (bustAnchorPos - bustCenterL) / bustRadiusL;
      float bustDist = length(bustQ);
      if (bustDist < 1.0 && bustDist > 1e-4) {
        vec3 bustSurface = bustCenterL + (bustQ / bustDist) * bustRadiusL;
        vec3 bustDelta = mat3(bustAnchorWorld) * (bustSurface - bustAnchorPos);
        float bustLen = dot(bustDelta, bustDelta);
        if (bustLen > bustBest) { bustWorldDelta = bustDelta; bustBest = bustLen; }
      }
    }
    if (bustRadiusR.x > 1e-4) {
      vec3 bustQ = (bustAnchorPos - bustCenterR) / bustRadiusR;
      float bustDist = length(bustQ);
      if (bustDist < 1.0 && bustDist > 1e-4) {
        vec3 bustSurface = bustCenterR + (bustQ / bustDist) * bustRadiusR;
        vec3 bustDelta = mat3(bustAnchorWorld) * (bustSurface - bustAnchorPos);
        float bustLen = dot(bustDelta, bustDelta);
        if (bustLen > bustBest) { bustWorldDelta = bustDelta; bustBest = bustLen; }
      }
    }
    float bustDepth = length(bustWorldDelta);
    if (bustDepth > 1e-5) {
      float bustKeep = min(bustDepth, bustPushCap);
      float bustEase = smoothstep(0.0, bustPushCap, bustDepth);
      bustWorldDelta *= armMask * bustEase * bustKeep / bustDepth;
      transformed += inverse(mat3(modelMatrix)) * bustWorldDelta;
    }
  }
}
`;

const PATCHED = '__bustArmContact';
const _boneWorld: THREE.Matrix4[] = [];
const _bindPoint = new THREE.Vector3();
const _weighted = new THREE.Vector3();
const _skinned = new THREE.Vector3();
const _anchorInv = new THREE.Matrix4();
let depthMaterial: THREE.MeshDepthMaterial | null = null;

export function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Distance an arm vertex actually moves. `depth` is how far it sits inside the bust. */
export function armPushDistance(depth: number, mask: number, cap: number): number {
  if (depth <= 1e-5 || mask <= 0 || cap <= 0) return 0;
  return mask * smoothstep01(0, cap, depth) * Math.min(depth, cap);
}

export interface BustEllipsoid {
  center: THREE.Vector3;
  radius: THREE.Vector3;
}

/** Axis-aligned ellipsoid around a point cloud. Radii are the 90th percentile on each axis. */
export function fitBustEllipsoid(points: ArrayLike<number>, minCount = MIN_SAMPLES): BustEllipsoid | null {
  const count = Math.floor(points.length / 3);
  if (count < minCount) return null;
  const center = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    center.x += points[i * 3]!;
    center.y += points[i * 3 + 1]!;
    center.z += points[i * 3 + 2]!;
  }
  center.multiplyScalar(1 / count);
  const axis = [[] as number[], [] as number[], [] as number[]];
  for (let i = 0; i < count; i++) {
    axis[0]!.push(Math.abs(points[i * 3]! - center.x));
    axis[1]!.push(Math.abs(points[i * 3 + 1]! - center.y));
    axis[2]!.push(Math.abs(points[i * 3 + 2]! - center.z));
  }
  const radius = new THREE.Vector3();
  for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
    const values = axis[axisIndex]!.sort((a, b) => a - b);
    const index = Math.min(values.length - 1, Math.round(SURFACE_PERCENTILE * (values.length - 1)));
    radius.setComponent(axisIndex, Math.max(MIN_RADIUS, values[index]!));
  }
  return { center, radius };
}

function anchorOf(vrm: VRM): THREE.Object3D | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  return humanoid.getNormalizedBoneNode('upperChest') ?? humanoid.getNormalizedBoneNode('chest');
}

function materialNames(mesh: THREE.SkinnedMesh): string {
  const material = mesh.material;
  if (Array.isArray(material)) return material.map((item) => item.name).join(' ');
  return material?.name ?? '';
}

function component(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, channel: number): number {
  if (channel === 0) return attr.getX(vertex);
  if (channel === 1) return attr.getY(vertex);
  if (channel === 2) return attr.getZ(vertex);
  return attr.getW(vertex);
}

function armRoots(vrm: VRM): THREE.Object3D[] {
  const humanoid = vrm.humanoid;
  if (!humanoid) return [];
  const roots: THREE.Object3D[] = [];
  for (const name of ['leftUpperArm', 'rightUpperArm'] as const) {
    const bone = humanoid.getNormalizedBoneNode(name);
    if (bone) roots.push(bone);
  }
  return roots;
}

function isUnder(bone: THREE.Object3D, roots: THREE.Object3D[]): boolean {
  let node: THREE.Object3D | null = bone;
  while (node) {
    if (roots.includes(node)) return true;
    node = node.parent;
  }
  return false;
}

function bustSide(name: string): 'l' | 'r' | '' {
  if (/_l_|left/i.test(name)) return 'l';
  if (/_r_|right/i.test(name)) return 'r';
  return '';
}

function ensureBoneWorlds(bones: THREE.Object3D[]): THREE.Matrix4[] {
  while (_boneWorld.length < bones.length) _boneWorld.push(new THREE.Matrix4());
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i]!;
    const out = _boneWorld[i]!;
    if (/bust/i.test(bone.name)) springStableWorldMatrix(out, bone);
    else out.copy(bone.matrixWorld);
  }
  return _boneWorld;
}

function writeEllipsoid(side: 'l' | 'r', fit: BustEllipsoid | null): void {
  const center = side === 'l' ? bustCenterL.value : bustCenterR.value;
  const radius = side === 'l' ? bustRadiusL.value : bustRadiusR.value;
  if (!fit) {
    center.set(0, 0, 0);
    radius.set(0, 0, 0);
    return;
  }
  center.copy(fit.center);
  radius.copy(fit.radius);
}

function refitEllipsoids(vrm: VRM, anchor: THREE.Object3D): void {
  anchor.updateWorldMatrix(true, false);
  _anchorInv.copy(anchor.matrixWorld).invert();
  const left: number[] = [];
  const right: number[] = [];
  vrm.scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (shouldConsiderCloth(mesh.name, materialNames(mesh))) return;
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;
    const bones = mesh.skeleton.bones;
    const worlds = ensureBoneWorlds(bones);
    const leftChain = new Set<number>();
    const rightChain = new Set<number>();
    bones.forEach((bone, index) => {
      if (!/bust/i.test(bone.name)) return;
      const side = bustSide(bone.name);
      if (side === 'l') leftChain.add(index);
      else if (side === 'r') rightChain.add(index);
    });
    if (leftChain.size === 0 && rightChain.size === 0) return;
    const seen = new Uint8Array(position.count);
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    const channels = Math.min(4, skinIndex.itemSize, skinWeight.itemSize);
    for (let k = 0; k < count; k++) {
      const vertex = index ? index.getX(k) : k;
      if (seen[vertex]) continue;
      seen[vertex] = 1;
      let leftWeight = 0;
      let rightWeight = 0;
      for (let c = 0; c < channels; c++) {
        const boneIndex = Math.round(component(skinIndex, vertex, c));
        const weight = component(skinWeight, vertex, c);
        if (leftChain.has(boneIndex)) leftWeight += weight;
        else if (rightChain.has(boneIndex)) rightWeight += weight;
      }
      const side = leftWeight >= BUST_WEIGHT ? 'l' : rightWeight >= BUST_WEIGHT ? 'r' : '';
      if (!side) continue;
      _bindPoint.fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix);
      _skinned.set(0, 0, 0);
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const boneIndex = Math.round(component(skinIndex, vertex, c));
        const weight = component(skinWeight, vertex, c);
        if (weight <= 0) continue;
        const inverse = mesh.skeleton.boneInverses[boneIndex];
        const world = worlds[boneIndex];
        if (!inverse || !world) continue;
        _weighted.copy(_bindPoint).applyMatrix4(inverse).applyMatrix4(world);
        _skinned.addScaledVector(_weighted, weight);
        sum += weight;
      }
      if (sum <= 0) continue;
      if (Math.abs(sum - 1) > 0.05) _skinned.multiplyScalar(1 / sum);
      _skinned.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld).applyMatrix4(_anchorInv);
      const bucket = side === 'l' ? left : right;
      bucket.push(_skinned.x, _skinned.y, _skinned.z);
    }
  });
  writeEllipsoid('l', fitBustEllipsoid(left));
  writeEllipsoid('r', fitBustEllipsoid(right));
}

function injectVertex(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  if (shader.vertexShader.includes('bustArmContactApplied')) return;
  if (!shader.vertexShader.includes('#include <skinning_vertex>')) return;
  shader.vertexShader = `${DECL}// bustArmContactApplied\n${shader.vertexShader.replace(
    '#include <skinning_vertex>',
    `#include <skinning_vertex>\n${BODY}`,
  )}`;
  for (const key of Object.keys(SHARED_UNIFORMS)) shader.uniforms[key] = SHARED_UNIFORMS[key]!;
}

function patchMaterial(material: THREE.Material): void {
  const tagged = material as THREE.Material & { [PATCHED]?: boolean; uniforms?: Record<string, THREE.IUniform> };
  if (tagged[PATCHED]) return;
  tagged[PATCHED] = true;
  if (tagged.uniforms) {
    for (const key of Object.keys(SHARED_UNIFORMS)) tagged.uniforms[key] = SHARED_UNIFORMS[key]!;
  }
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectVertex(shader);
  };
  material.customProgramCacheKey = () => `${previousKey()}|bustArm1`;
  material.needsUpdate = true;
}

function sharedDepthMaterial(): THREE.MeshDepthMaterial {
  if (depthMaterial) return depthMaterial;
  const material = new THREE.MeshDepthMaterial();
  depthMaterial = material;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectVertex(shader);
  };
  material.customProgramCacheKey = () => 'bust-arm-depth-v1';
  return material;
}

function writeArmMask(mesh: THREE.SkinnedMesh, roots: THREE.Object3D[]): number {
  const position = mesh.geometry.getAttribute('position');
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  if (!position || !skinIndex || !skinWeight) return 0;
  const armBones = new Set<number>();
  mesh.skeleton.bones.forEach((bone, index) => {
    if (isUnder(bone, roots)) armBones.add(index);
  });
  let existing = mesh.geometry.getAttribute('armMask') as THREE.BufferAttribute | undefined;
  if (!existing || existing.count !== position.count) {
    existing = new THREE.BufferAttribute(new Float32Array(position.count), 1);
    mesh.geometry.setAttribute('armMask', existing);
  }
  const array = existing.array as Float32Array;
  array.fill(0);
  if (armBones.size === 0) {
    existing.needsUpdate = true;
    return 0;
  }
  const seen = new Uint8Array(position.count);
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const channels = Math.min(4, skinIndex.itemSize, skinWeight.itemSize);
  let peak = 0;
  for (let k = 0; k < count; k++) {
    const vertex = index ? index.getX(k) : k;
    if (seen[vertex]) continue;
    seen[vertex] = 1;
    let weight = 0;
    for (let c = 0; c < channels; c++) {
      if (armBones.has(Math.round(component(skinIndex, vertex, c)))) weight += component(skinWeight, vertex, c);
    }
    array[vertex] = weight;
    if (weight > peak) peak = weight;
  }
  existing.needsUpdate = true;
  return peak;
}

/** Fit the bust ellipsoids and mark arm vertices. Call on load and when the bust sliders change. */
export function bindBustArmContact(vrm: VRM): void {
  const anchor = anchorOf(vrm);
  const roots = armRoots(vrm);
  if (!anchor || roots.length === 0) return;
  vrm.scene.updateMatrixWorld(true);
  refitEllipsoids(vrm, anchor);
  bustPushCap.value = APP_CONFIG.springBone.bust.armPushCap;
  const depth = sharedDepthMaterial();
  vrm.scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const peak = writeArmMask(mesh, roots);
    if (peak < 0.02) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < materials.length; i++) patchMaterial(materials[i]!);
    mesh.customDepthMaterial = depth;
  });
  updateBustArmContact(vrm);
}

/** Copy the chest bone into the shader uniforms. No allocation. */
export function updateBustArmContact(vrm: VRM): void {
  const anchor = anchorOf(vrm);
  if (!anchor) return;
  anchor.updateWorldMatrix(true, false);
  bustAnchorWorld.value.copy(anchor.matrixWorld);
  bustAnchorInv.value.copy(anchor.matrixWorld).invert();
  bustPushCap.value = APP_CONFIG.springBone.bust.armPushCap;
}
