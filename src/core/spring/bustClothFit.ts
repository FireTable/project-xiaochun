import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
  type VRMSpringBoneColliderGroup,
} from '@pixiv/three-vrm-springbone';

/**
 * Bust morph scales the bust bones. three-vrm collision ignores that scale, and a lot of
 * outfits keep the bodice on the chest bone, so the skin grows out of the dress.
 *
 * Do not retarget skin weights. A hard cut puts neighboring vertices on different bones,
 * the cloth tears, and the MToon edge shows up as a white line. Slide the cloth rest pose
 * instead: full extra scale at the bust, fading to nothing a few centimeters out.
 * A sphere on each bust root pushes skirt and ribbon springs clear as the bust grows.
 */

const CLOTH_HINT = /cloth|dress|skirt|onepiece|tops|shirt|coat|jacket|ribbon|outfit|costume|uniform|pants|sleeve|kimono|gown|robe|apron|vest|blouse|cape|frill|bustier|leotard|swimsuit|bikini|fabric|wear|hoodie|sweater|scarf|bodice|lace|pleat/;
const REJECT_HINT = /hair|eyelash|eyebrow|eyeline|iris|highlight|eye|face|tooth|teeth|tongue|brow|lash/;
const BODY_HINT = /skin|body/;
const SPRING_CLOTH = /skirt|ribbon|cape|coat|dress|cloth|hem|frill|tie|bustier|onepiece|sleeve|tops|apron|lace|bow|belt|pleat|scarf|hood|wear|kimono|gown/;
const SPRING_REJECT = /hair|bang|bust|ear|eye|brow|face|jaw|tooth|tail/;

/** Sphere center sits this far along the bust bone, in the meat rather than on the chest wall. */
const CENTER_ALONG = 0.55;
/** How far past the skin the cloth fade reaches, in meters. */
const FADE = 0.09;

export function bustJointHitRadius(restHit: number, visualScale: number): number {
  return restHit * Math.max(0.2, visualScale);
}

/** Collider radius in meters. Clearance applies only once the bust is larger than its bind size. */
export function scaledBustColliderRadius(restRadius: number, visualScale: number, clearance: number): number {
  const scale = Math.max(0.2, visualScale);
  const grown = Math.max(0, scale - 1);
  return restRadius * scale + (grown > 0 ? clearance : 0);
}

/** 1 inside the bust, 0 outside the fade, smooth in between. */
export function bustFalloff(distance: number, inner: number, outer: number): number {
  if (distance <= inner) return 1;
  if (distance >= outer || outer <= inner) return 0;
  const t = (distance - inner) / (outer - inner);
  const s = t * t * (3 - 2 * t);
  return 1 - s;
}

/**
 * Extra scale applied on top of the bones. A vertex already fully on the bust bone
 * needs none; the bone scale moves it. Returns the multiplier for the vector from the bust center.
 */
export function clothScaleGap(bustWeight: number, falloff: number, visualScale: number): number {
  const follow = bustWeight < 0 ? 0 : bustWeight > 1 ? 1 : bustWeight;
  return (visualScale - 1) * (1 - follow) * falloff;
}

export function shouldConsiderCloth(meshName: string, materialName: string): boolean {
  const blob = `${meshName} ${materialName}`.toLowerCase();
  if (CLOTH_HINT.test(blob)) return true;
  if (REJECT_HINT.test(blob)) return false;
  if (BODY_HINT.test(blob)) return false;
  return true;
}

export function isClothSpringName(name: string): boolean {
  const blob = name.toLowerCase();
  if (SPRING_REJECT.test(blob)) return false;
  if (SPRING_CLOTH.test(blob)) return true;
  return blob.includes('j_sec_');
}

interface TrackedCollider {
  shape: { radius: number };
  rest: number;
}

interface ClothShell {
  position: THREE.BufferAttribute;
  base: Float32Array;
  push: Float32Array;
}

interface BustCenter {
  root: THREE.Object3D;
  localOffset: THREE.Vector3;
  inner: number;
}

interface BustFitState {
  tracked: TrackedCollider[];
  shells: ClothShell[];
}

const states = new WeakMap<VRM, BustFitState>();

export function applyBustClothFit(vrm: VRM, visualScale: number, clearance: number): void {
  const manager = vrm.springBoneManager;
  if (!manager) return;

  let state = states.get(vrm);
  if (!state) {
    state = prepare(vrm);
    states.set(vrm, state);
  }

  const scale = Math.max(0.2, visualScale);
  for (let i = 0; i < state.tracked.length; i++) {
    const item = state.tracked[i]!;
    item.shape.radius = scaledBustColliderRadius(item.rest, scale, clearance);
  }
  applyShells(state.shells, scale);
}

function prepare(vrm: VRM): BustFitState {
  const roots = findBustRoots(vrm.scene);
  const tracked: TrackedCollider[] = [];
  const centers: BustCenter[] = [];
  const manager = vrm.springBoneManager;

  if (manager) {
    const existing = manager.colliders;
    for (let i = 0; i < existing.length; i++) {
      const collider = existing[i]!;
      if (!hasBustRootAncestor(collider)) continue;
      const shape = collider.shape as { radius?: number };
      if (typeof shape.radius !== 'number') continue;
      tracked.push({ shape: shape as { radius: number }, rest: shape.radius });
    }
  }

  const clothGroup: VRMSpringBoneColliderGroup = { name: 'bust-cloth', colliders: [] };
  let meat = 0;

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!;
    const child = root.children.find((node) => /bust/i.test(node.name)) ?? root.children[0] ?? null;
    const localOffset = child ? child.position.clone().multiplyScalar(CENTER_ALONG) : new THREE.Vector3();
    const measured = measureMeatRadius(vrm, root, localOffset);
    const rest = Math.max(measured, child ? child.position.length() * 0.65 : 0.05, 0.02);
    if (rest > meat) meat = rest;
    centers.push({ root, localOffset, inner: rest });

    const shape = new VRMSpringBoneColliderShapeSphere({ radius: rest, offset: localOffset });
    const collider = new VRMSpringBoneCollider(shape);
    collider.name = 'bust-cloth';
    root.add(collider);
    clothGroup.colliders.push(collider);
    tracked.push({ shape, rest });
  }

  const shells = centers.length > 0 ? buildShells(vrm, centers) : [];

  let springs = 0;
  if (manager && clothGroup.colliders.length > 0) {
    for (const joint of manager.joints) {
      if (!isClothSpringName(joint.bone?.name ?? '')) continue;
      if (joint.colliderGroups.includes(clothGroup)) continue;
      joint.colliderGroups = [...joint.colliderGroups, clothGroup];
      springs++;
    }
    // New collider parents are not picked up until the joint sort runs again.
    (manager as unknown as { _isSortedJointsDirty: boolean })._isSortedJointsDirty = true;
  }

  if (roots.length > 0) {
    let moved = 0;
    for (let i = 0; i < shells.length; i++) {
      const push = shells[i]!.push;
      for (let k = 0; k < push.length; k += 3) {
        if (push[k]! !== 0 || push[k + 1]! !== 0 || push[k + 2]! !== 0) moved++;
      }
    }
    console.info(
      `[bustCloth] roots ${roots.length}, cloth verts ${moved}, springs ${springs}, meat ${meat.toFixed(3)}m`,
    );
  }

  return { tracked, shells };
}

function applyShells(shells: ClothShell[], visualScale: number): void {
  const gap = visualScale - 1;
  for (let s = 0; s < shells.length; s++) {
    const shell = shells[s]!;
    const dst = shell.position.array as Float32Array;
    const base = shell.base;
    const push = shell.push;
    for (let i = 0; i < dst.length; i++) dst[i] = base[i]! + push[i]! * gap;
    shell.position.needsUpdate = true;
  }
}

function buildShells(vrm: VRM, centers: BustCenter[]): ClothShell[] {
  const meshes: THREE.SkinnedMesh[] = [];
  vrm.scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });

  const byGeometry = new Map<THREE.BufferGeometry, THREE.SkinnedMesh[]>();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!;
    const list = byGeometry.get(mesh.geometry);
    if (list) list.push(mesh);
    else byGeometry.set(mesh.geometry, [mesh]);
  }

  const shells: ClothShell[] = [];
  for (const [geometry, group] of byGeometry) {
    const cloth = group.filter((mesh) => shouldConsiderCloth(mesh.name, materialName(mesh)));
    if (cloth.length === 0) continue;
    const mesh = cloth[0]!;
    if (cloth.length < group.length) mesh.geometry = geometry.clone();
    // Primitives often share one position buffer. Editing it would slide the skin too.
    const position = mesh.geometry.getAttribute('position');
    if (position && meshes.some((other) => other !== mesh && other.geometry.getAttribute('position')?.array === position.array)) {
      mesh.geometry.setAttribute('position', position.clone());
    }
    const shell = buildShell(mesh, centers);
    if (shell) shells.push(shell);
  }
  return shells;
}

function buildShell(mesh: THREE.SkinnedMesh, centers: BustCenter[]): ClothShell | null {
  const position = mesh.geometry.getAttribute('position');
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  if (!(position instanceof THREE.BufferAttribute)) return null;
  if (!skinIndex || !skinWeight) return null;
  if (!(position.array instanceof Float32Array)) return null;

  const chains = centers.map((center) => chainIndices(mesh.skeleton, center.root));
  const bindCenters: THREE.Vector3[] = [];
  const rootPositions: THREE.Vector3[] = [];
  const forwards: THREE.Vector3[] = [];
  const bind = new THREE.Matrix4();
  const invBind = mesh.bindMatrixInverse;

  for (let c = 0; c < centers.length; c++) {
    const center = centers[c]!;
    const boneIndex = indexOfBone(mesh.skeleton, center.root);
    const inverse = boneIndex >= 0 ? mesh.skeleton.boneInverses[boneIndex] : undefined;
    if (!inverse) {
      bindCenters.push(new THREE.Vector3());
      rootPositions.push(new THREE.Vector3());
      forwards.push(new THREE.Vector3(0, 0, 1));
      continue;
    }
    bind.copy(inverse).invert();
    const at = center.localOffset.clone().applyMatrix4(bind).applyMatrix4(invBind);
    const rootPos = new THREE.Vector3().setFromMatrixPosition(bind).applyMatrix4(invBind);
    const forward = at.clone().sub(rootPos);
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();
    bindCenters.push(at);
    rootPositions.push(rootPos);
    forwards.push(forward);
  }

  const base = new Float32Array(position.array);
  const push = new Float32Array(base.length);
  const vertex = new THREE.Vector3();
  const away = new THREE.Vector3();
  const count = position.count;

  for (let i = 0; i < count; i++) {
    vertex.fromArray(base, i * 3);
    let best = 0;
    let bestCenter = 0;
    for (let c = 0; c < centers.length; c++) {
      const center = centers[c]!;
      away.subVectors(vertex, rootPositions[c]!);
      if (away.dot(forwards[c]!) < -0.01) continue;
      const dist = vertex.distanceTo(bindCenters[c]!);
      const falloff = bustFalloff(dist, center.inner, center.inner + FADE);
      if (falloff > best) {
        best = falloff;
        bestCenter = c;
      }
    }
    if (best <= 0) continue;
    const bustWeight = weightOn(skinIndex, skinWeight, i, chains[bestCenter]!);
    // Unit of extra scale. applyShells multiplies by (visualScale - 1).
    const gap = clothScaleGap(bustWeight, best, 2);
    if (gap === 0) continue;
    away.subVectors(vertex, bindCenters[bestCenter]!).multiplyScalar(gap);
    push[i * 3] = away.x;
    push[i * 3 + 1] = away.y;
    push[i * 3 + 2] = away.z;
  }

  return { position, base, push };
}

function findBustRoots(scene: THREE.Object3D): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (!/bust/i.test(node.name)) return;
    if (node.parent && /bust/i.test(node.parent.name)) return;
    roots.push(node);
  });
  return roots;
}

function hasBustRootAncestor(node: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = node.parent;
  while (current) {
    if (/bust/i.test(current.name) && !(current.parent && /bust/i.test(current.parent.name))) return true;
    current = current.parent;
  }
  return false;
}

function measureMeatRadius(vrm: VRM, root: THREE.Object3D, localOffset: THREE.Vector3): number {
  let maxDist = 0;
  const center = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const bind = new THREE.Matrix4();

  vrm.scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const boneIndex = indexOfBone(mesh.skeleton, root);
    if (boneIndex < 0) return;
    const inverse = mesh.skeleton.boneInverses[boneIndex];
    if (!inverse) return;
    bind.copy(inverse).invert();
    center.copy(localOffset).applyMatrix4(bind);

    const chain = chainIndices(mesh.skeleton, root);
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;

    const seen = new Uint8Array(position.count);
    const index = mesh.geometry.index;
    const n = index ? index.count : position.count;
    for (let k = 0; k < n; k++) {
      const i = index ? index.getX(k) : k;
      if (seen[i]) continue;
      seen[i] = 1;
      if (weightOn(skinIndex, skinWeight, i, chain) < 0.45) continue;
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
      const dist = vertex.distanceTo(center);
      if (dist > maxDist) maxDist = dist;
    }
  });

  return maxDist;
}

function indexOfBone(skeleton: THREE.Skeleton, bone: THREE.Object3D): number {
  const direct = skeleton.bones.indexOf(bone as THREE.Bone);
  if (direct >= 0) return direct;
  if (!bone.name) return -1;
  return skeleton.bones.findIndex((item) => item.name === bone.name);
}

function chainIndices(skeleton: THREE.Skeleton, root: THREE.Object3D): Set<number> {
  const names = new Set<string>();
  if (root.name) names.add(root.name);
  root.traverse((node) => {
    if (node.name && /bust/i.test(node.name)) names.add(node.name);
  });
  const indices = new Set<number>();
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    if (bone === root || (bone.name !== '' && names.has(bone.name))) indices.add(i);
  }
  return indices;
}

type SkinAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function weightOn(skinIndex: SkinAttr, skinWeight: SkinAttr, vertex: number, bones: Set<number>): number {
  const n = Math.min(4, skinIndex.itemSize, skinWeight.itemSize);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const bone = component(skinIndex, vertex, k);
    if (bones.has(bone)) sum += component(skinWeight, vertex, k);
  }
  return sum;
}

function component(attr: SkinAttr, vertex: number, channel: number): number {
  if (channel === 0) return attr.getX(vertex);
  if (channel === 1) return attr.getY(vertex);
  if (channel === 2) return attr.getZ(vertex);
  return attr.getW(vertex);
}

function materialName(mesh: THREE.SkinnedMesh): string {
  const material = mesh.material;
  if (Array.isArray(material)) return material.map((item) => item.name).join(' ');
  return material?.name ?? '';
}
