import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
  type VRMSpringBoneColliderGroup,
} from '@pixiv/three-vrm-springbone';

/**
 * Bust morph scales, pitches, and spreads the bust bones. three-vrm collision ignores
 * bone scale, and many outfits keep the bodice on the chest bone, so the skin grows
 * out of the dress.
 *
 * Keep the skin weights. Changing them tears the cloth and the MToon edge shows as a
 * white line. Move the cloth rest pose by the bust bone's change from bind, then take
 * the chest motion back out so skinning does not apply it twice. Fade that follow to
 * nothing a few centimeters out. A sphere on each bust root pushes skirt and ribbon
 * springs clear as the bust grows.
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
 * How much of the bust-bone follow a cloth vertex still needs.
 * A vertex already fully on the bust bone needs none; skinning moves it.
 */
export function clothFollowAmount(bustWeight: number, falloff: number): number {
  const carried = bustWeight < 0 ? 0 : bustWeight > 1 ? 1 : bustWeight;
  const fade = falloff < 0 ? 0 : falloff > 1 ? 1 : falloff;
  return (1 - carried) * fade;
}

const _bustDelta = new THREE.Matrix4();
const _carrierDelta = new THREE.Matrix4();
const _carrierInv = new THREE.Matrix4();
const _relative = new THREE.Matrix4();
const _followTmp = new THREE.Matrix4();
const _stablePos = new THREE.Vector3();
const _stableQuat = new THREE.Quaternion();
const _stableScale = new THREE.Vector3();
const _stableLocal = new THREE.Matrix4();

/**
 * World matrix the spring solver will commit on its next tick.
 *
 * Bust joints set `matrixAutoUpdate` off and write `bone.matrix` from the
 * solved quaternion. A morph slider updates `.scale` and `.position` first.
 * `matrixWorld` still holds the previous tick, so reading it misses this
 * slider change. The solved quaternion stays; the temporary pitch multiply
 * does not, because the next tick replaces it.
 */
export function springStableWorldMatrix(out: THREE.Matrix4, bone: THREE.Object3D): THREE.Matrix4 {
  bone.matrix.decompose(_stablePos, _stableQuat, _stableScale);
  _stableLocal.compose(bone.position, _stableQuat, bone.scale);
  const parent = bone.parent;
  if (!parent) return out.copy(_stableLocal);
  parent.updateWorldMatrix(true, false);
  return out.multiplyMatrices(parent.matrixWorld, _stableLocal);
}

/**
 * Mesh-local matrix that takes a bind-space vertex to where the bust bone would
 * place it, with the carrier bone's own motion removed.
 *
 * Skinning then applies the carrier again. Leaving it in here would scale the
 * bodice twice. With identity binds and no carrier, this is the bust world matrix.
 */
export function composeClothFollowMatrix(
  out: THREE.Matrix4,
  bindMatrix: THREE.Matrix4,
  bindMatrixInverse: THREE.Matrix4,
  bustWorld: THREE.Matrix4,
  bustInverse: THREE.Matrix4,
  carrierWorld: THREE.Matrix4 | null,
  carrierInverse: THREE.Matrix4 | null,
): THREE.Matrix4 {
  _bustDelta.multiplyMatrices(bustWorld, bustInverse);
  if (carrierWorld && carrierInverse) {
    _carrierDelta.multiplyMatrices(carrierWorld, carrierInverse);
    _carrierInv.copy(_carrierDelta).invert();
    _relative.multiplyMatrices(_carrierInv, _bustDelta);
  } else {
    _relative.copy(_bustDelta);
  }
  _followTmp.multiplyMatrices(_relative, bindMatrix);
  return out.multiplyMatrices(bindMatrixInverse, _followTmp);
}

/**
 * Blend a bind-space vertex toward each bust target.
 * `influences` already include clothFollowAmount. Equal influences meet in the middle,
 * so spread does not split the neckline.
 */
export function blendClothRestInto(
  out: THREE.Vector3,
  base: THREE.Vector3,
  targets: readonly THREE.Vector3[],
  influences: ArrayLike<number>,
  count: number,
): void {
  let weightSum = 0;
  let best = 0;
  out.set(0, 0, 0);
  for (let i = 0; i < count; i++) {
    const amount = influences[i] ?? 0;
    if (amount <= 0) continue;
    if (amount > best) best = amount;
    weightSum += amount;
    const target = targets[i]!;
    out.x += target.x * amount;
    out.y += target.y * amount;
    out.z += target.z * amount;
  }
  if (weightSum <= 0 || best <= 0) {
    out.copy(base);
    return;
  }
  const inv = 1 / weightSum;
  out.x = base.x + (out.x * inv - base.x) * best;
  out.y = base.y + (out.y * inv - base.y) * best;
  out.z = base.z + (out.z * inv - base.z) * best;
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

interface ClothBone {
  root: THREE.Object3D;
  parent: THREE.Object3D | null;
  boneInverse: THREE.Matrix4 | null;
  parentInverse: THREE.Matrix4 | null;
}

interface ClothShell {
  position: THREE.BufferAttribute;
  base: Float32Array;
  /** Per vertex, per bust root. 0 where the bone already carries the vertex or the fade ends. */
  influence: Float32Array;
  rootCount: number;
  bindMatrix: THREE.Matrix4;
  bindMatrixInverse: THREE.Matrix4;
  bones: ClothBone[];
  follow: THREE.Matrix4[];
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
  // Step 1: Garments rely 100% on GPU skeletal skinning (SkinnedMesh).
  // CPU-side vertex pushing is detached to preserve author-tailored silhouettes and prevent floating straps.
  if (state.shells.length > 0) {
    applyShells(state.shells);
  }
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

  // Garments are driven 100% by GPU skeletal skinning (SkinnedMesh).
  // Zero geometry duplication; vertex buffers remain 100% pristine for author-crafted fit.
  const shells: ClothShell[] = [];

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
      const influence = shells[i]!.influence;
      const rootCount = shells[i]!.rootCount;
      if (rootCount === 0) continue;
      for (let v = 0; v < influence.length; v += rootCount) {
        let any = false;
        for (let r = 0; r < rootCount; r++) {
          if (influence[v + r]! > 0) any = true;
        }
        if (any) moved++;
      }
    }
    console.info(
      `[bustCloth] roots ${roots.length}, cloth verts ${moved}, springs ${springs}, meat ${meat.toFixed(3)}m`,
    );
  }

  return { tracked, shells };
}

const _base = new THREE.Vector3();
const _blended = new THREE.Vector3();
const _bustWorld = new THREE.Matrix4();
const _amounts: number[] = [];
const _targets: THREE.Vector3[] = [];

function applyShells(shells: ClothShell[]): void {
  for (let s = 0; s < shells.length; s++) {
    const shell = shells[s]!;
    const roots = shell.rootCount;
    while (_amounts.length < roots) _amounts.push(0);
    while (_targets.length < roots) _targets.push(new THREE.Vector3());

    for (let r = 0; r < roots; r++) {
      const bone = shell.bones[r]!;
      const follow = shell.follow[r]!;
      if (!bone.boneInverse) {
        follow.identity();
        continue;
      }
      springStableWorldMatrix(_bustWorld, bone.root);
      composeClothFollowMatrix(
        follow,
        shell.bindMatrix,
        shell.bindMatrixInverse,
        _bustWorld,
        bone.boneInverse,
        bone.parent ? bone.parent.matrixWorld : null,
        bone.parentInverse,
      );
    }

    const dst = shell.position.array as Float32Array;
    const base = shell.base;
    const influence = shell.influence;
    const count = base.length / 3;
    for (let i = 0; i < count; i++) {
      _base.fromArray(base, i * 3);
      let any = false;
      for (let r = 0; r < roots; r++) {
        const amount = influence[i * roots + r] ?? 0;
        _amounts[r] = amount;
        if (amount > 0) {
          any = true;
          _targets[r]!.copy(_base).applyMatrix4(shell.follow[r]!);
        }
      }
      if (!any) {
        dst[i * 3] = _base.x;
        dst[i * 3 + 1] = _base.y;
        dst[i * 3 + 2] = _base.z;
        continue;
      }
      blendClothRestInto(_blended, _base, _targets, _amounts, roots);
      dst[i * 3] = _blended.x;
      dst[i * 3 + 1] = _blended.y;
      dst[i * 3 + 2] = _blended.z;
    }
    shell.position.needsUpdate = true;
  }
}

export function _buildShells(vrm: VRM, centers: BustCenter[]): ClothShell[] {
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
  const bones: ClothBone[] = [];
  const bindCenters: THREE.Vector3[] = [];
  const rootPositions: THREE.Vector3[] = [];
  const forwards: THREE.Vector3[] = [];
  const bind = new THREE.Matrix4();
  const invBind = mesh.bindMatrixInverse;

  for (let c = 0; c < centers.length; c++) {
    const center = centers[c]!;
    const boneIndex = indexOfBone(mesh.skeleton, center.root);
    const inverse = boneIndex >= 0 ? mesh.skeleton.boneInverses[boneIndex] : undefined;
    const parent = inverse ? carrierOf(center.root, mesh.skeleton) : null;
    const parentIndex = parent ? indexOfBone(mesh.skeleton, parent) : -1;
    const parentInverse = parentIndex >= 0 ? mesh.skeleton.boneInverses[parentIndex] : undefined;
    bones.push({
      root: center.root,
      parent,
      boneInverse: inverse ? new THREE.Matrix4().copy(inverse) : null,
      parentInverse: parentInverse ? new THREE.Matrix4().copy(parentInverse) : null,
    });
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
  const rootCount = centers.length;
  const influence = new Float32Array(position.count * rootCount);
  const vertex = new THREE.Vector3();
  const away = new THREE.Vector3();
  const count = position.count;

  for (let i = 0; i < count; i++) {
    vertex.fromArray(base, i * 3);
    let bustWeight = 0;
    for (let c = 0; c < rootCount; c++) bustWeight += weightOn(skinIndex, skinWeight, i, chains[c]!);
    if (bustWeight > 1) bustWeight = 1;

    for (let c = 0; c < rootCount; c++) {
      if (!bones[c]!.boneInverse) continue;
      const center = centers[c]!;
      away.subVectors(vertex, rootPositions[c]!);
      // Behind the chest wall. The measured bone axis is the forward, not a fixed world axis.
      if (away.dot(forwards[c]!) < -0.01) continue;
      const dist = vertex.distanceTo(bindCenters[c]!);
      const falloff = bustFalloff(dist, center.inner, center.inner + FADE);
      influence[i * rootCount + c] = clothFollowAmount(bustWeight, falloff);
    }
  }

  return {
    position,
    base,
    influence,
    rootCount,
    bindMatrix: mesh.bindMatrix.clone(),
    bindMatrixInverse: mesh.bindMatrixInverse.clone(),
    bones,
    follow: bones.map(() => new THREE.Matrix4()),
  };
}

/** First non-bust skeleton bone above the bust root. Cloth skinned there must not inherit that motion twice. */
function carrierOf(root: THREE.Object3D, skeleton: THREE.Skeleton): THREE.Object3D | null {
  let node = root.parent;
  while (node) {
    if (!/bust/i.test(node.name) && indexOfBone(skeleton, node) >= 0) return node;
    node = node.parent;
  }
  return null;
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
