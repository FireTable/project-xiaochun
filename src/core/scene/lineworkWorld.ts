import * as THREE from 'three';

type BuildingShape = 'box' | 'tower' | 'pyramid' | 'stepped' | 'antenna';
type TreeShape = 'conifer' | 'fan' | 'layered' | 'cypress' | 'oval';

/**
 * LineworkWorld — 3D 白色线稿背景世界
 * 
 * 特性：
 * 纯代码程序化生成，零外部 3D 资产依赖。
 * 包含远处太阳与发散光线、远景摩天大楼天际线、地面网格以及抽象多形态树木。
 */
export class LineworkWorld {
  private rootGroup = new THREE.Group();
  private isBuilt = false;

  build(scene: THREE.Scene): void {
    if (this.isBuilt) return;
    this.rootGroup.clear();

    scene.background = new THREE.Color(0xffffff);

    // ── 1. 太阳与辐射线 ──
    const sunGroup = new THREE.Group();
    const sunFill = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 64),
      new THREE.MeshBasicMaterial({ color: 0x222222 }),
    );
    sunFill.position.set(10, 14, -22);
    sunGroup.add(sunFill);

    const sunRays = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const inner = new THREE.Vector3(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
          const outer = new THREE.Vector3(Math.cos(a) * 2.7, Math.sin(a) * 2.7, 0);
          return [inner, outer];
        }).flat(),
      ),
      new THREE.LineBasicMaterial({ color: 0x222222 }),
    );
    sunRays.position.copy(sunFill.position);
    sunGroup.add(sunRays);
    this.rootGroup.add(sunGroup);

    // ── 2. 远景城市天际线 ──
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x2a334a,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });

    const buildBuilding = (
      shape: BuildingShape,
      w: number,
      height: number,
      d: number,
    ): THREE.Group => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), wireMat);
      box.position.y = height / 2;
      g.add(box);

      if (shape === 'pyramid') {
        const roofH = height * 0.25;
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(w, d) * 0.75, roofH, 4),
          wireMat,
        );
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        g.add(roof);
      } else if (shape === 'stepped') {
        const tierW = w * 0.55;
        const tierH = height * 0.35;
        const tier = new THREE.Mesh(
          new THREE.BoxGeometry(tierW, tierH, d * 0.55),
          wireMat,
        );
        tier.position.y = height + tierH / 2;
        g.add(tier);
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4),
          wireMat,
        );
        pole.position.y = height + tierH + 0.3;
        g.add(pole);
      } else if (shape === 'antenna') {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4),
          wireMat,
        );
        pole.position.y = height + 0.6;
        g.add(pole);
      }
      return g;
    };

    const buildingSpecs: Array<{
      x: number; w: number; height: number; d: number; shape: BuildingShape;
    }> = [
      { x: -12,   w: 1.4, height: 4.0,  d: 1.5, shape: 'box' },
      { x: -10.7, w: 1.2, height: 7.5,  d: 1.5, shape: 'tower' },
      { x: -9.4,  w: 1.6, height: 5.0,  d: 1.5, shape: 'pyramid' },
      { x: -8.1,  w: 1.3, height: 6.5,  d: 1.5, shape: 'stepped' },
      { x: -6.8,  w: 1.4, height: 3.5,  d: 1.5, shape: 'box' },
      { x: -5.5,  w: 1.0, height: 9.0,  d: 1.5, shape: 'antenna' },
      { x: -4.2,  w: 1.5, height: 5.5,  d: 1.5, shape: 'pyramid' },
      { x: -2.9,  w: 1.2, height: 4.5,  d: 1.5, shape: 'box' },
      { x: -1.6,  w: 1.4, height: 7.0,  d: 1.5, shape: 'stepped' },
      { x: -0.3,  w: 1.6, height: 11.0, d: 1.5, shape: 'tower' },
      { x: 1.0,   w: 1.3, height: 5.5,  d: 1.5, shape: 'box' },
      { x: 2.3,   w: 1.5, height: 8.0,  d: 1.5, shape: 'pyramid' },
      { x: 3.6,   w: 1.2, height: 4.0,  d: 1.5, shape: 'antenna' },
      { x: 4.9,   w: 1.4, height: 6.0,  d: 1.5, shape: 'box' },
      { x: 6.2,   w: 1.3, height: 8.5,  d: 1.5, shape: 'tower' },
      { x: 7.5,   w: 1.5, height: 5.5,  d: 1.5, shape: 'pyramid' },
      { x: 8.8,   w: 1.2, height: 4.0,  d: 1.5, shape: 'stepped' },
      { x: 10.1,  w: 1.4, height: 6.5,  d: 1.5, shape: 'box' },
      { x: 11.4,  w: 1.3, height: 4.5,  d: 1.5, shape: 'antenna' },
    ];

    const cityGroup = new THREE.Group();
    for (const { x, w, height, d, shape } of buildingSpecs) {
      const building = buildBuilding(shape, w, height, d);
      building.position.set(x, 0, -10);
      cityGroup.add(building);
    }
    this.rootGroup.add(cityGroup);

    // ── 3. 地面大网格 ──
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.rootGroup.add(ground);

    // ── 4. 抽象树林 ──
    const treeMat = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });

    const buildTree = (shape: TreeShape, totalH: number): THREE.Group => {
      const trunkH = Math.max(1.7, totalH * 0.35);
      const topH = totalH - trunkH;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, trunkH, 8),
        treeMat,
      );
      trunk.position.y = trunkH / 2;
      tree.add(trunk);

      if (shape === 'conifer') {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.35 + totalH * 0.08, topH, 8),
          treeMat,
        );
        cone.position.y = trunkH + topH / 2;
        tree.add(cone);
      } else if (shape === 'fan') {
        const fan = new THREE.Mesh(
          new THREE.ConeGeometry(topH * 0.65, topH * 0.5, 24, 1, true),
          treeMat,
        );
        fan.position.y = trunkH + topH * 0.25;
        tree.add(fan);
      } else if (shape === 'layered') {
        const layers = 3;
        const layerH = topH / (layers + 0.5);
        for (let i = 0; i < layers; i++) {
          const radius = (0.35 + totalH * 0.08) * (1 - i * 0.25);
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(radius, layerH, 8),
            treeMat,
          );
          cone.position.y = trunkH + (i + 0.5) * (layerH * 1.05);
          tree.add(cone);
        }
      } else if (shape === 'cypress') {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.2 + totalH * 0.04, topH, 6),
          treeMat,
        );
        cone.position.y = trunkH + topH / 2;
        tree.add(cone);
      } else if (shape === 'oval') {
        const oval = new THREE.Mesh(
          new THREE.IcosahedronGeometry(topH * 0.32, 1),
          treeMat,
        );
        oval.scale.set(0.7, 1.4, 0.7);
        oval.position.y = trunkH + topH * 0.448;
        tree.add(oval);
      }
      return tree;
    };

    const treeSpecs: Array<{ pos: [number, number]; height: number; shape: TreeShape }> = [
      { pos: [5, -3],  height: 6.5, shape: 'cypress' },
      { pos: [-4, 4],  height: 5.0, shape: 'conifer' },
      { pos: [4, 4],   height: 8.0, shape: 'layered' },
      { pos: [6, 0],   height: 6.0, shape: 'cypress' },
      { pos: [-5, -2], height: 5.5, shape: 'oval' },
    ];

    for (const { pos, height, shape } of treeSpecs) {
      const tree = buildTree(shape, height);
      tree.position.set(pos[0], 0, pos[1]);
      this.rootGroup.add(tree);
    }

    scene.add(this.rootGroup);
    this.isBuilt = true;
  }

  dispose(scene: THREE.Scene): void {
    if (!this.isBuilt) return;
    scene.remove(this.rootGroup);
    this.rootGroup.clear();
    this.isBuilt = false;
  }
}
