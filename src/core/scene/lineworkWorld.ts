import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type BuildingShape = 'box' | 'tower' | 'pyramid' | 'stepped' | 'antenna';
type TreeShape = 'conifer' | 'fan' | 'layered' | 'cypress' | 'oval';

/**
 * LineworkWorld — 3D 白色线稿背景世界
 * 
 * 空间布局：
 * - 远景建筑：Z = -10 (正前方)
 * - 地面与树木：XZ 平面 [-20, 20]
 * - 远景山峦：Z = +13 ~ +16 (建筑正对面，山顶高度约 Y = 3.5 ~ 5.4)
 * - 线描飞鸟：Z = +13.5 ~ +15.5，高度降至 Y = 5.2 ~ 6.5 (紧贴山头上方掠过)
 */
export class LineworkWorld {
  private rootGroup = new THREE.Group();
  private isBuilt = false;
  private disposables: Array<{ dispose: () => void }> = [];

  build(scene: THREE.Scene): void {
    if (this.isBuilt) return;
    this.rootGroup.clear();
    this.disposables = [];

    // ── 0. 第一版原生背景渐变 ──
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, 2);
    grad.addColorStop(0, '#FAFAF5'); // 上
    grad.addColorStop(1, '#F5F3ED'); // 下

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 2);

    const bgTexture = new THREE.CanvasTexture(canvas);
    scene.background = bgTexture;
    this.disposables.push(bgTexture);

    // ── 材质单例池 ──
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const buildingWireMat = new THREE.MeshBasicMaterial({
      color: 0x2a334a,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const groundTreeMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      wireframe: true,
      depthWrite: false,
    });

    this.disposables.push(lineMat, buildingWireMat, groundTreeMat);

    // 几何体分桶
    const lineGeos: THREE.BufferGeometry[] = [];
    const buildingGeos: THREE.BufferGeometry[] = [];
    const groundTreeGeos: THREE.BufferGeometry[] = [];

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    // ── 1. 线描山峦（建筑正对面：Z = +13 与 +16，山脊顶点最高约 Y = 5.4） ──
    const generateMountainSegments = (
      pointsCount: number,
      width: number,
      maxH: number,
      baseY: number,
      z: number,
    ) => {
      const pts: THREE.Vector3[] = [];
      const step = width / (pointsCount - 1);
      const halfW = width / 2;
      for (let i = 0; i < pointsCount - 1; i++) {
        const x1 = -halfW + i * step;
        const x2 = -halfW + (i + 1) * step;
        const h1 = Math.abs(Math.sin(i * 0.45) * 0.65 + Math.cos(i * 0.95) * 0.35) * maxH;
        const h2 = Math.abs(Math.sin((i + 1) * 0.45) * 0.65 + Math.cos((i + 1) * 0.95) * 0.35) * maxH;
        pts.push(new THREE.Vector3(x1, baseY + h1, z), new THREE.Vector3(x2, baseY + h2, z));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };

    lineGeos.push(generateMountainSegments(26, 52, 5.0, 0.4, 16));
    lineGeos.push(generateMountainSegments(30, 46, 3.5, 0.2, 13));

    // ── 2. 线描飞鸟群（高度降至 Y = 5.2 ~ 6.5，紧贴山峦上方盘旋掠过） ──
    const birdPoints: THREE.Vector3[] = [];
    const birds = [
      { x: -3.8, y: 5.6, z: 15.0, s: 0.22 },
      { x: -3.0, y: 6.2, z: 15.0, s: 0.18 },
      { x: -2.2, y: 5.8, z: 15.0, s: 0.20 },
      { x: 4.5, y: 5.4, z: 13.8, s: 0.24 },
      { x: 5.3, y: 6.0, z: 13.8, s: 0.19 },
      { x: 6.0, y: 5.5, z: 13.8, s: 0.21 },
    ];
    for (const b of birds) {
      birdPoints.push(
        new THREE.Vector3(b.x - b.s, b.y + b.s * 0.6, b.z),
        new THREE.Vector3(b.x, b.y, b.z),
        new THREE.Vector3(b.x, b.y, b.z),
        new THREE.Vector3(b.x + b.s, b.y + b.s * 0.6, b.z),
      );
    }
    lineGeos.push(new THREE.BufferGeometry().setFromPoints(birdPoints));

    // ── 3. 远景城市天际线（保持在 Z = -10） ──
    const buildingSpecs: Array<{ x: number; w: number; height: number; d: number; shape: BuildingShape }> = [
      { x: -12, w: 1.4, height: 4.0, d: 1.5, shape: 'box' },
      { x: -10.7, w: 1.2, height: 7.5, d: 1.5, shape: 'tower' },
      { x: -9.4, w: 1.6, height: 5.0, d: 1.5, shape: 'pyramid' },
      { x: -8.1, w: 1.3, height: 6.5, d: 1.5, shape: 'stepped' },
      { x: -6.8, w: 1.4, height: 3.5, d: 1.5, shape: 'box' },
      { x: -5.5, w: 1.0, height: 9.0, d: 1.5, shape: 'antenna' },
      { x: -4.2, w: 1.5, height: 5.5, d: 1.5, shape: 'pyramid' },
      { x: -2.9, w: 1.2, height: 4.5, d: 1.5, shape: 'box' },
      { x: -1.6, w: 1.4, height: 7.0, d: 1.5, shape: 'stepped' },
      { x: -0.3, w: 1.6, height: 11.0, d: 1.5, shape: 'tower' },
      { x: 1.0, w: 1.3, height: 5.5, d: 1.5, shape: 'box' },
      { x: 2.3, w: 1.5, height: 8.0, d: 1.5, shape: 'pyramid' },
      { x: 3.6, w: 1.2, height: 4.0, d: 1.5, shape: 'antenna' },
      { x: 4.9, w: 1.4, height: 6.0, d: 1.5, shape: 'box' },
      { x: 6.2, w: 1.3, height: 8.5, d: 1.5, shape: 'tower' },
      { x: 7.5, w: 1.5, height: 5.5, d: 1.5, shape: 'pyramid' },
      { x: 8.8, w: 1.2, height: 4.0, d: 1.5, shape: 'stepped' },
      { x: 10.1, w: 1.4, height: 6.5, d: 1.5, shape: 'box' },
      { x: 11.4, w: 1.3, height: 4.5, d: 1.5, shape: 'antenna' },
    ];

    const pushBuildingMesh = (geo: THREE.BufferGeometry, tx: number, ty: number, tz: number, rotY = 0) => {
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      pos.set(tx, ty, tz);
      scale.set(1, 1, 1);
      m.compose(pos, quat, scale);
      geo.applyMatrix4(m);
      buildingGeos.push(geo.toNonIndexed());
      geo.dispose();
    };

    const bZ = -10;
    for (const b of buildingSpecs) {
      pushBuildingMesh(new THREE.BoxGeometry(b.w, b.height, b.d), b.x, b.height / 2, bZ);

      if (b.shape === 'pyramid') {
        const roofH = b.height * 0.25;
        pushBuildingMesh(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.75, roofH, 4), b.x, b.height + roofH / 2, bZ, Math.PI / 4);
      } else if (b.shape === 'stepped') {
        const tierW = b.w * 0.55;
        const tierH = b.height * 0.35;
        pushBuildingMesh(new THREE.BoxGeometry(tierW, tierH, b.d * 0.55), b.x, b.height + tierH / 2, bZ);
        pushBuildingMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), b.x, b.height + tierH + 0.3, bZ);
      } else if (b.shape === 'antenna') {
        pushBuildingMesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), b.x, b.height + 0.6, bZ);
      }
    }

    // ── 4. 第一版原生地面大网格 ──
    const groundGeo = new THREE.PlaneGeometry(40, 40, 20, 20);
    quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    pos.set(0, 0.001, 0);
    scale.set(1, 1, 1);
    m.compose(pos, quat, scale);
    groundGeo.applyMatrix4(m);
    groundTreeGeos.push(groundGeo.toNonIndexed());
    groundGeo.dispose();

    // ── 5. 第一版原生抽象线框树木 ──
    const treeSpecs: Array<{ pos: [number, number]; height: number; shape: TreeShape }> = [
      { pos: [5, -3], height: 6.5, shape: 'cypress' },
      { pos: [-4, 4], height: 5.0, shape: 'conifer' },
      { pos: [4, 4], height: 8.0, shape: 'layered' },
      { pos: [6, 0], height: 6.0, shape: 'cypress' },
      { pos: [-5, -2], height: 5.5, shape: 'oval' },
    ];

    const pushTreeMesh = (geo: THREE.BufferGeometry, tx: number, ty: number, tz: number, sx = 1, sy = 1, sz = 1) => {
      quat.identity();
      pos.set(tx, ty, tz);
      scale.set(sx, sy, sz);
      m.compose(pos, quat, scale);
      geo.applyMatrix4(m);
      groundTreeGeos.push(geo.toNonIndexed());
      geo.dispose();
    };

    for (const { pos: treePos, height, shape } of treeSpecs) {
      const trunkH = Math.max(1.7, height * 0.35);
      const topH = height - trunkH;

      pushTreeMesh(new THREE.CylinderGeometry(0.1, 0.14, trunkH, 8), treePos[0], trunkH / 2, treePos[1]);

      if (shape === 'conifer') {
        pushTreeMesh(new THREE.ConeGeometry(0.35 + height * 0.08, topH, 8), treePos[0], trunkH + topH / 2, treePos[1]);
      } else if (shape === 'fan') {
        pushTreeMesh(new THREE.ConeGeometry(topH * 0.65, topH * 0.5, 24, 1, true), treePos[0], trunkH + topH * 0.25, treePos[1]);
      } else if (shape === 'layered') {
        const layers = 3;
        const layerH = topH / (layers + 0.5);
        for (let i = 0; i < layers; i++) {
          const radius = (0.35 + height * 0.08) * (1 - i * 0.25);
          pushTreeMesh(new THREE.ConeGeometry(radius, layerH, 8), treePos[0], trunkH + (i + 0.5) * (layerH * 1.05), treePos[1]);
        }
      } else if (shape === 'cypress') {
        pushTreeMesh(new THREE.ConeGeometry(0.2 + height * 0.04, topH, 6), treePos[0], trunkH + topH / 2, treePos[1]);
      } else if (shape === 'oval') {
        pushTreeMesh(new THREE.IcosahedronGeometry(topH * 0.32, 1), treePos[0], trunkH + topH * 0.448, treePos[1], 0.7, 1.4, 0.7);
      }
    }

    // ── 6. 批量合批装载（全场景严格 3 个 Draw Calls） ──
    const mergeAndAdd = (
      geos: THREE.BufferGeometry[],
      mat: THREE.Material,
      isLines: boolean,
    ) => {
      if (geos.length === 0) return;
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      if (merged) {
        const obj = isLines ? new THREE.LineSegments(merged, mat) : new THREE.Mesh(merged, mat);
        this.rootGroup.add(obj);
        this.disposables.push(merged);
      }
      for (const g of geos) g.dispose();
    };

    mergeAndAdd(lineGeos, lineMat, true);             // Call 1: 山峦与山顶飞鸟
    mergeAndAdd(buildingGeos, buildingWireMat, false); // Call 2: 原生线框大厦
    mergeAndAdd(groundTreeGeos, groundTreeMat, false); // Call 3: 原生线框地面 + 树木

    scene.add(this.rootGroup);
    this.isBuilt = true;
  }

  dispose(scene: THREE.Scene): void {
    if (!this.isBuilt) return;

    if (scene.background instanceof THREE.Texture) {
      scene.background.dispose();
      scene.background = null;
    }

    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];

    scene.remove(this.rootGroup);
    this.rootGroup.clear();
    this.isBuilt = false;
  }
}