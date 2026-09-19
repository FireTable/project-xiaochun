import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type BuildingShape = 'box' | 'tower' | 'pyramid' | 'stepped' | 'antenna';

/**
 * LineworkWorld — 3D 白色/暗黑线稿背景世界
 * 
 * 空间布局（沿相机正面 -Z 轴层层递进，纵深拉开，层次分明）：
 * - 前景中心：角色本体 (Z = 0)
 * - 地面网格：超大无边界正交平直透视地坪 (X: [-52, 52], Z: [-52, 22], 间距 2m, Y = 0.0015)
 * - 中景建筑：往后深推、低平错落的都市天际线 (Z = -26, 高度 2.4 ~ 5.6m，带有实体遮罩)
 * - 远景飞鸟：在雄伟山峦顶端开阔高空盘旋 (Z = -30 ~ -40, 高度 15.0 ~ 24.0m)
 * - 远景群山：高耸入云的两重起伏叠嶂山脊 (Z = -34 与 Z = -46, 宽度 84 ~ 115m, 峰顶高 16.0 ~ 26.0m)
 */
export type LineworkTheme = 'light' | 'dark' | 'transparent';

export class LineworkWorld {
  private rootGroup = new THREE.Group();
  private isBuilt = false;
  private disposables: Array<{ dispose: () => void }> = [];
  private sceneRef: THREE.Scene | null = null;

  public currentTheme: LineworkTheme = 'light';
  private bgTextureLight: THREE.CanvasTexture | null = null;
  private bgColorDark: THREE.Color = new THREE.Color(0x202020);
  private buildingColorLight: THREE.Color = new THREE.Color(0xdbd0d4);
  private groundColorLight: THREE.Color = new THREE.Color(0xc7bac0);

  private lineMat: THREE.LineBasicMaterial | null = null;
  private mountainSolidMat: THREE.MeshBasicMaterial | null = null;
  private buildingWireMat: THREE.MeshBasicMaterial | null = null;
  private buildingSolidMat: THREE.MeshBasicMaterial | null = null;
  private groundMat: THREE.LineBasicMaterial | null = null;
  private groundSolidMat: THREE.MeshBasicMaterial | null = null;
  private groundSolidMesh: THREE.Mesh | null = null;

  // ── 圆形喷水花坛动态系统 (位于 Z = -15.5 黄金中景，极简八边形结构 + 宽幅水花喷射粒子群 + 水面扩散涟漪) ──
  private fountainGroup: THREE.Group | null = null;
  private fountainRippleMats: THREE.LineBasicMaterial[] = [];
  private fountainRipples: THREE.LineLoop[] = [];
  private fountainParticleMat: THREE.PointsMaterial | null = null;
  private fountainParticleGeo: THREE.BufferGeometry | null = null;
  private fountainParticleCount = 200; // 紧凑凝聚于盆内的晶莹水花群
  private fountainParticlePositions: Float32Array | null = null;
  private fountainParticleVelocities: Float32Array | null = null;
  private fountainParticleLifes: Float32Array | null = null;
  private fountainParticleMaxLifes: Float32Array | null = null;
  private fountainOrigin = new THREE.Vector3(0, 1.32, -15.5); // 紧贴立柱喷嘴顶端

  // ── 飞鸟动态扑翼与空间漂移系统 ──
  private birdsGeo: THREE.BufferGeometry | null = null;
  private birdsPositions: Float32Array | null = null;
  private birdsConfigs: Array<{
    baseX: number;
    baseY: number;
    baseZ: number;
    s: number;
    phase: number;
    flapSpeed: number;
    driftRangeX: number;
    driftRangeZ: number;
  }> = [];

  /** 创建高采样双色阶竖向渐变 CanvasTexture */
  private createGradientTexture(topColor: string, bottomColor: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 512);
    const texture = new THREE.CanvasTexture(canvas);
    this.disposables.push(texture);
    return texture;
  }

  /** 创建高清晰度、晶莹剔透的水珠微形贴图（微椭圆水滴，核心凝聚高亮，远景清晰立现） */
  private createDropletTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 48);

    const grad = ctx.createRadialGradient(16, 24, 0, 16, 24, 15);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.90, 'rgba(255, 255, 255, 0.40)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(16, 24, 11, 17, 0, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    this.disposables.push(texture);
    return texture;
  }

  build(scene: THREE.Scene, initialTheme: LineworkTheme = 'light'): void {
    if (this.isBuilt) return;
    this.sceneRef = scene;
    this.rootGroup.clear();
    this.disposables = [];
    this.currentTheme = initialTheme;

    // ── 0. 预制薄暮粉灰渐变背景与中性纯净炭黑纯色背景 ──
    // 昼白线稿（Daylight Linework - 薄暮粉灰）：采用低饱和莫兰迪浅烟粉灰阶渐变（温润治愈，护眼且白色滑块清晰醒目）
    this.bgTextureLight = this.createGradientTexture('#E2D9DB', '#D5CACD');
    this.bgColorDark = new THREE.Color(0x202020);

    if (initialTheme === 'transparent') {
      scene.background = null;
      this.rootGroup.visible = false;
    } else {
      scene.background = initialTheme === 'dark' ? this.bgColorDark : this.bgTextureLight;
      this.rootGroup.visible = true;
    }

    // ── 材质单例池 ──
    const isDark = initialTheme === 'dark';
    // 远山山脊轮廓与飞鸟材质（清晰挺拔的深石榴灰线框）
    this.lineMat = new THREE.LineBasicMaterial({
      color: isDark ? 0xd4d4d8 : 0x4b3d44,
      transparent: true,
      opacity: isDark ? 0.70 : 0.65,
      depthTest: true,
      depthWrite: false,
    });
    // 远山实体剪影填充面（莫兰迪浅紫灰叠嶂剪影）
    this.mountainSolidMat = new THREE.MeshBasicMaterial({
      color: isDark ? 0x191a20 : 0xb9a9b0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // 建筑物表面实体遮罩（柔和暖灰粉建筑立面）
    this.buildingSolidMat = new THREE.MeshBasicMaterial({
      color: isDark ? this.bgColorDark : this.buildingColorLight,
      wireframe: false,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // 建筑物外观线框（雅致的深紫灰工程建筑线稿）
    this.buildingWireMat = new THREE.MeshBasicMaterial({
      color: isDark ? 0xa1a1aa : 0x52434a,
      wireframe: true,
      transparent: true,
      opacity: isDark ? 0.60 : 0.62,
      depthTest: true,
      depthWrite: false,
    });
    // 地面平直正交网格（沉着清晰的透视线）
    this.groundMat = new THREE.LineBasicMaterial({
      color: isDark ? 0xb0b0b8 : 0x66545b,
      transparent: true,
      opacity: isDark ? 0.40 : 0.45,
      depthTest: true,
      depthWrite: false,
    });
    // 实体地面基底面（稳重扎实的莫兰迪粉灰地面基底）
    this.groundSolidMat = new THREE.MeshBasicMaterial({
      color: isDark ? this.bgColorDark : this.groundColorLight,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });

    this.disposables.push(this.lineMat, this.mountainSolidMat, this.buildingSolidMat, this.buildingWireMat, this.groundMat, this.groundSolidMat);
    const lineMat = this.lineMat;
    const mountainSolidMat = this.mountainSolidMat;
    const buildingSolidMat = this.buildingSolidMat;
    const buildingWireMat = this.buildingWireMat;
    const groundMat = this.groundMat;

    // 几何体分桶
    const lineGeos: THREE.BufferGeometry[] = [];
    const mountainMeshGeos: THREE.BufferGeometry[] = [];
    const buildingGeos: THREE.BufferGeometry[] = [];

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    // ── 1. 巍峨延绵远山轮廓与水墨实体剪影（紧贴地表 Y=0，峰顶完整可见且绝不低于地面） ──
    interface MountainPeakSpec {
      cx: number;
      h: number;
      r: number;
      sharpness?: number;
    }

    const buildMountainPeaks = (
      pointsCount: number,
      width: number,
      baseY: number,
      peaks: MountainPeakSpec[],
      z: number,
      noiseScale = 0.6,
    ) => {
      const linePts: THREE.Vector3[] = [];
      const positions: number[] = [];
      const indices: number[] = [];
      const bottomY = 0.0; // 严格止步于地平面 Y=0，杜绝任何山体穿透下陷至地下

      const step = width / (pointsCount - 1);
      const halfW = width / 2;

      const evalHeight = (x: number) => {
        let peakH = 0;
        for (const p of peaks) {
          const dist = Math.abs(x - p.cx);
          if (dist < p.r) {
            const t = 1 - dist / p.r;
            const sharp = p.sharpness ?? 1.35;
            // 峰尖锐化，山脊坚挺耸拔
            const val = Math.pow(t, sharp) * p.h;
            peakH = Math.max(peakH, val);
          }
        }
        // 自然山体岩脉微起伏，增加质感
        const nx = x * 0.35;
        const micro = (Math.sin(nx * 3.2) * 0.5 + Math.cos(nx * 7.6) * 0.25) * noiseScale;
        return Math.max(baseY, baseY + peakH + micro);
      };

      for (let i = 0; i < pointsCount; i++) {
        const x = -halfW + i * step;
        const y = evalHeight(x);

        positions.push(x, y, z);
        positions.push(x, bottomY, z);

        if (i < pointsCount - 1) {
          const nextX = x + step;
          const nextY = evalHeight(nextX);

          // 坚挺山脊轮廓线段
          linePts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(nextX, nextY, z));

          // 实体水墨剪影填充面
          const tl = 2 * i;
          const bl = 2 * i + 1;
          const tr = 2 * (i + 1);
          const br = 2 * (i + 1) + 1;
          indices.push(tl, bl, tr);
          indices.push(tr, bl, br);
        }
      }

      const mGeo = new THREE.BufferGeometry();
      mGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      mGeo.setIndex(indices);
      mGeo.computeVertexNormals();
      mountainMeshGeos.push(mGeo);

      lineGeos.push(new THREE.BufferGeometry().setFromPoints(linePts));
    };

    // ──【第一道：近山屏障 (Z = -32.0)】──
    // 左右有秀丽侧峰（峰顶 4.2~5.0m），中央 X: -4 ~ +3 降至低缓谷地（1.2~2.0m），让出小春身后视线
    buildMountainPeaks(44, 88, 1.2, [
      { cx: -12.5, h: 3.8, r: 7.0, sharpness: 1.3 },
      { cx: -6.5,  h: 2.0, r: 4.5, sharpness: 1.2 },
      { cx: 7.5,   h: 3.5, r: 6.5, sharpness: 1.3 },
      { cx: 14.0,  h: 2.2, r: 5.0, sharpness: 1.2 },
    ], -32.0, 0.25);

    // ──【第二道：中山群峰 (Z = -38.0)】──
    // 中央主峰总高 7.0 米（峰尖完整可见，耸立在建筑物上方天空），左右次峰 5.0~6.0 米
    buildMountainPeaks(50, 108, 1.8, [
      { cx: -15.5, h: 3.4, r: 7.0, sharpness: 1.3 },
      { cx: -9.0,  h: 4.2, r: 6.5, sharpness: 1.35 },
      { cx: -0.5,  h: 5.2, r: 8.5, sharpness: 1.45 }, // 中央巍峨大主峰 (总高 7.0m，峰尖挺拔)
      { cx: 5.5,   h: 4.4, r: 6.5, sharpness: 1.35 },
      { cx: 12.5,  h: 3.2, r: 6.0, sharpness: 1.3 },
    ], -38.0, 0.35);

    // ──【第三道：远山雪岭 (Z = -45.0)】──
    // 雄浑磅礴的雪山天际线，最高峰拔高至 8.6 米（恰好位于屏幕顶部下方，峰顶完完整整、绝不削顶），侧峰 6.5~7.8 米
    buildMountainPeaks(56, 132, 2.8, [
      { cx: -14.0, h: 4.8, r: 9.0,  sharpness: 1.4 },
      { cx: -5.0,  h: 3.6, r: 6.5,  sharpness: 1.3 },
      { cx: 2.5,   h: 5.8, r: 10.0, sharpness: 1.5 }, // 天际第一神峰 (总高 8.6m，峰顶完整展现在画面天际)
      { cx: 9.5,   h: 4.6, r: 8.0,  sharpness: 1.35 },
      { cx: 17.5,  h: 5.0, r: 9.0,  sharpness: 1.4 },
    ], -45.0, 0.40);

    // ── 2. 动态飞鸟群系统（轻量线稿飞鸟，扇动翅膀 + 微微左右前后漂移） ──
    this.birdsConfigs = [
      // 左侧高空群（峰巅云海）
      { baseX: -10.5, baseY: 7.8, baseZ: -35.0, s: 0.50, phase: 0.0, flapSpeed: 4.8, driftRangeX: 0.8, driftRangeZ: 0.5 },
      { baseX: -8.0,  baseY: 8.8, baseZ: -36.0, s: 0.58, phase: 1.6, flapSpeed: 4.2, driftRangeX: 1.0, driftRangeZ: 0.6 },
      { baseX: -6.0,  baseY: 8.1, baseZ: -35.5, s: 0.46, phase: 3.2, flapSpeed: 5.2, driftRangeX: 0.7, driftRangeZ: 0.4 },
      // 右侧高空群
      { baseX: 7.0,   baseY: 7.6, baseZ: -34.5, s: 0.52, phase: 0.8, flapSpeed: 4.5, driftRangeX: 0.9, driftRangeZ: 0.5 },
      { baseX: 10.5,  baseY: 9.0, baseZ: -35.0, s: 0.60, phase: 2.4, flapSpeed: 4.0, driftRangeX: 1.1, driftRangeZ: 0.7 },
      { baseX: 12.8,  baseY: 8.2, baseZ: -34.0, s: 0.48, phase: 4.5, flapSpeed: 5.0, driftRangeX: 0.8, driftRangeZ: 0.4 },
      // 极高空云巅双鸟（翱翔于神山上方）
      { baseX: 1.5,   baseY: 10.2, baseZ: -43.0, s: 0.52, phase: 1.2, flapSpeed: 3.8, driftRangeX: 1.2, driftRangeZ: 0.8 },
      { baseX: -14.0, baseY: 9.2,  baseZ: -38.0, s: 0.55, phase: 5.1, flapSpeed: 4.4, driftRangeX: 1.0, driftRangeZ: 0.6 },
    ];

    const totalBirdVertices = this.birdsConfigs.length * 4;
    this.birdsPositions = new Float32Array(totalBirdVertices * 3);
    this.birdsGeo = new THREE.BufferGeometry();
    this.birdsGeo.setAttribute('position', new THREE.BufferAttribute(this.birdsPositions, 3));

    const birdsMesh = new THREE.LineSegments(this.birdsGeo, lineMat);
    birdsMesh.renderOrder = 3;
    this.rootGroup.add(birdsMesh);
    this.disposables.push(this.birdsGeo);

    // ── 3. 现代都市天际线建筑群（三重纵深层次 Z: -20 ~ -31，高低节奏鲜明 1.6m ~ 6.5m，疏密聚散留白，错落有致） ──
    const buildingSpecs: Array<{
      x: number;
      z: number;
      w: number;
      height: number;
      d: number;
      shape: BuildingShape;
      rotY?: number;
    }> = [
      // ──【左翼远端聚落】前后深浅咬合，高低互现 ──
      // 深处高耸阶梯塔楼（高耸挺拔，与远山山脚相映）
      { x: -16.8, z: -30.5, w: 1.6, height: 5.4, d: 1.8, shape: 'stepped', rotY: 0.12 },
      // 中景典雅四棱顶建筑
      { x: -14.6, z: -25.5, w: 2.0, height: 3.4, d: 2.0, shape: 'pyramid', rotY: -0.10 },
      // 前景低矮现代小体块（极矮，建立前景深度标尺）
      { x: -12.8, z: -20.5, w: 2.4, height: 2.0, d: 2.2, shape: 'box', rotY: 0.08 },

      // ──【视线通廊一：X = -11.5 ~ -7.5 留出宽达 4 米的山谷峡谷，远山全景露出】──

      // ──【左中核心聚落】──
      // 后方耸立的纤细天线塔（宛如城市天际线针尖）
      { x: -5.8,  z: -29.0, w: 1.4, height: 6.2, d: 1.5, shape: 'antenna', rotY: -0.14 },
      // 【红框位置补建】：位于天线塔与小春之间，高挑挺拔的现代阶梯大厦，完美填补左侧视线
      { x: -3.4,  z: -25.5, w: 1.8, height: 5.0, d: 2.0, shape: 'stepped', rotY: 0.10 },

      // ──【中央通透区域】彻底腾空正后方视野，给后移的喷水花坛和远山主峰让出纯净纵深 ──

      // ──【右中核心聚落】中景错落台阶楼 + 前景斜错体块 ──
      // 后景错位的现代阶梯建筑
      { x: 3.8,   z: -28.0, w: 1.9, height: 4.6, d: 1.9, shape: 'stepped', rotY: 0.15 },
      // 前景小体块（前后错位咬合）
      { x: 5.4,   z: -21.2, w: 2.0, height: 2.2, d: 2.0, shape: 'box', rotY: -0.08 },

      // ──【视线通廊二：X = +6.8 ~ +10.2 留出开阔天幕峡谷，显露右侧雄伟山体与飞鸟】──

      // ──【右翼远端聚落】地标尖塔 + 中低错落群 ──
      // 右侧后景纤细地标塔
      { x: 11.8,  z: -29.8, w: 1.5, height: 5.8, d: 1.6, shape: 'antenna', rotY: 0.10 },
      // 中景金字塔四棱建筑
      { x: 14.2,  z: -25.0, w: 2.2, height: 3.6, d: 2.2, shape: 'pyramid', rotY: -0.12 },
      // 前景超低平层现代小品
      { x: 16.5,  z: -19.8, w: 2.5, height: 1.9, d: 2.5, shape: 'box', rotY: 0.07 },
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

    for (const b of buildingSpecs) {
      const rot = b.rotY ?? 0;
      pushBuildingMesh(new THREE.BoxGeometry(b.w, b.height, b.d), b.x, b.height / 2, b.z, rot);

      if (b.shape === 'pyramid') {
        const roofH = b.height * 0.25;
        pushBuildingMesh(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.75, roofH, 4), b.x, b.height + roofH / 2, b.z, rot + Math.PI / 4);
      } else if (b.shape === 'stepped') {
        const tierW = b.w * 0.55;
        const tierH = b.height * 0.35;
        pushBuildingMesh(new THREE.BoxGeometry(tierW, tierH, b.d * 0.55), b.x, b.height + tierH / 2, b.z, rot);
        pushBuildingMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), b.x, b.height + tierH + 0.3, b.z, rot);
      } else if (b.shape === 'antenna') {
        pushBuildingMesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), b.x, b.height + 0.6, b.z, rot);
      }
    }

    // ── 3.5 极简八边形喷水花坛（挪至深景 Z = -15.5，8边形现代几何体，彻底解决面数过多蜘蛛网问题） ──
    const fX = 0.0;
    const fZ = -15.5;
    // 1. 外层宽台阶八角底座（分段数仅为 8，线条硬朗干练）
    pushBuildingMesh(new THREE.CylinderGeometry(2.5, 2.6, 0.22, 8), fX, 0.11, fZ);
    // 2. 蓄水池八角外壁
    pushBuildingMesh(new THREE.CylinderGeometry(2.2, 2.25, 0.38, 8), fX, 0.19, fZ);
    // 3. 水池实心内胆（写入深度，遮挡身后地面线条）
    pushBuildingMesh(new THREE.CylinderGeometry(1.95, 1.95, 0.30, 8), fX, 0.15, fZ);
    // 4. 中央八角立柱基座
    pushBuildingMesh(new THREE.CylinderGeometry(0.32, 0.40, 0.75, 8), fX, 0.375, fZ);
    // 5. 中层落水圆盘（8 边形）
    pushBuildingMesh(new THREE.CylinderGeometry(0.70, 0.40, 0.16, 8), fX, 0.83, fZ);
    // 6. 顶层喷嘴立柱（8 边形）
    pushBuildingMesh(new THREE.CylinderGeometry(0.08, 0.12, 0.40, 8), fX, 1.12, fZ);

    // ── 喷泉动态水花系统（纯净晶莹水花喷洒，移除水线，范围大幅扩大） ──
    this.fountainGroup = new THREE.Group();

    // 中层八角落水盆内微涟漪（2 道八边形小水环在盆内轻漾）
    this.fountainRipples = [];
    this.fountainRippleMats = [];
    for (let r = 0; r < 2; r++) {
      const rPts: THREE.Vector3[] = [];
      for (let s = 0; s <= 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        rPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      }
      const rGeo = new THREE.BufferGeometry().setFromPoints(rPts);
      const rMat = new THREE.LineBasicMaterial({
        color: isDark ? 0xd4d4d8 : 0xffffff,
        transparent: true,
        opacity: isDark ? 0.40 : 0.60,
        depthWrite: false,
      });
      const rLoop = new THREE.LineLoop(rGeo, rMat);
      rLoop.position.set(fX, 0.915, fZ); // 置于盆内水面高度
      rLoop.scale.set(0.3, 1, 0.3);
      rLoop.renderOrder = 4;
      this.fountainGroup.add(rLoop);
      this.fountainRipples.push(rLoop);
      this.fountainRippleMats.push(rMat);
      this.disposables.push(rGeo, rMat);
    }

    // ── 花坛盆内水花喷洒粒子系统（200 颗晶莹水滴，自立柱喷嘴喷出后呈伞状优雅落入中层盆内，清晰醒目） ──
    const dropletTex = this.createDropletTexture();
    this.fountainParticleMat = new THREE.PointsMaterial({
      color: isDark ? 0xd4d4d8 : 0xffffff, // 浅色线稿下采用纯白高亮水滴，晶莹剔透、灵动醒目
      size: 0.08, // 恰当适中、晶莹清晰的粒子尺寸，清晰可见
      map: dropletTex,
      transparent: true,
      opacity: isDark ? 0.95 : 0.90,
      depthWrite: false,
    });

    const pCount = this.fountainParticleCount;
    this.fountainParticlePositions = new Float32Array(pCount * 3);
    this.fountainParticleVelocities = new Float32Array(pCount * 3);
    this.fountainParticleLifes = new Float32Array(pCount);
    this.fountainParticleMaxLifes = new Float32Array(pCount);

    const nozzlePos = this.fountainOrigin;
    for (let i = 0; i < pCount; i++) {
      const i3 = i * 3;
      this.fountainParticlePositions[i3] = nozzlePos.x + (Math.random() - 0.5) * 0.04;
      this.fountainParticlePositions[i3 + 1] = nozzlePos.y + (Math.random() - 0.5) * 0.03;
      this.fountainParticlePositions[i3 + 2] = nozzlePos.z + (Math.random() - 0.5) * 0.04;

      const maxLife = 0.55 + Math.random() * 0.40;
      this.fountainParticleMaxLifes[i] = maxLife;
      this.fountainParticleLifes[i] = Math.random() * maxLife;

      const a = Math.random() * Math.PI * 2;
      // 水花只在中层落水盆（半径 0.70m）内部飘落飞溅
      const spd = 0.22 + Math.random() * 0.32;
      const vy = 1.35 + Math.random() * 0.50;

      this.fountainParticleVelocities[i3] = Math.cos(a) * spd;
      this.fountainParticleVelocities[i3 + 1] = vy;
      this.fountainParticleVelocities[i3 + 2] = Math.sin(a) * spd;
    }

    this.fountainParticleGeo = new THREE.BufferGeometry();
    this.fountainParticleGeo.setAttribute('position', new THREE.BufferAttribute(this.fountainParticlePositions, 3));
    const pMesh = new THREE.Points(this.fountainParticleGeo, this.fountainParticleMat);
    pMesh.renderOrder = 5;
    this.fountainGroup.add(pMesh);
    this.disposables.push(this.fountainParticleGeo, this.fountainParticleMat);

    this.rootGroup.add(this.fountainGroup);

    // ── 4. 超大无边界正交平直透视地面网格（延伸至 Z = -52 到 +22，绝对无穿版黑边） ──
    const gridPts: THREE.Vector3[] = [];
    const minX = -52;
    const maxX = 52;
    const minZ = -52;
    const maxZ = 22;
    const step = 2.0;
    const groundY = 0.0015;

    for (let x = minX; x <= maxX; x += step) {
      gridPts.push(new THREE.Vector3(x, groundY, minZ), new THREE.Vector3(x, groundY, maxZ));
    }
    for (let z = minZ; z <= maxZ; z += step) {
      gridPts.push(new THREE.Vector3(minX, groundY, z), new THREE.Vector3(maxX, groundY, z));
    }
    const groundGeo = new THREE.BufferGeometry().setFromPoints(gridPts);

    // ── 5. 批量合批与深度遮挡装载 ──
    // Call 1: 远山实体剪影填充面（水墨意境剪影面，写入深度，层层遮挡身后山峦与远端地面）
    const mergedMountainMesh = BufferGeometryUtils.mergeGeometries(mountainMeshGeos, false);
    if (mergedMountainMesh) {
      const mountainSolidMesh = new THREE.Mesh(mergedMountainMesh, mountainSolidMat);
      mountainSolidMesh.renderOrder = 1;
      this.rootGroup.add(mountainSolidMesh);
      this.disposables.push(mergedMountainMesh);
    }
    for (const g of mountainMeshGeos) g.dispose();

    // Call 2: 山脊挺拔轮廓线段与高空飞鸟群
    const mergedLines = BufferGeometryUtils.mergeGeometries(lineGeos, false);
    if (mergedLines) {
      const lineMesh = new THREE.LineSegments(mergedLines, lineMat);
      lineMesh.renderOrder = 2;
      this.rootGroup.add(lineMesh);
      this.disposables.push(mergedLines);
    }
    for (const g of lineGeos) g.dispose();

    // 建筑物合批：同时生成实体遮挡面与外表线框
    const mergedBuildings = BufferGeometryUtils.mergeGeometries(buildingGeos, false);
    if (mergedBuildings) {
      // Call 3: 建筑物实体遮挡面（背景色填充 + 深度写入，挡住背后的山脚与杂线）
      const solidMesh = new THREE.Mesh(mergedBuildings, buildingSolidMat);
      solidMesh.renderOrder = 3;
      this.rootGroup.add(solidMesh);

      // Call 4: 建筑物线框（低调优雅的几何体边缘）
      const wireMesh = new THREE.Mesh(mergedBuildings, buildingWireMat);
      wireMesh.renderOrder = 4;
      this.rootGroup.add(wireMesh);

      this.disposables.push(mergedBuildings);
    }
    for (const g of buildingGeos) g.dispose();

    // Call 5: 实体地面基底（填充当前背景底色，写入深度，彻底封死地下空间，消除任何下透伪影）
    if (this.groundSolidMat) {
      const groundPlaneGeo = new THREE.PlaneGeometry(140, 140);
      groundPlaneGeo.rotateX(-Math.PI / 2);
      groundPlaneGeo.translate(0, -0.001, -15);
      this.groundSolidMesh = new THREE.Mesh(groundPlaneGeo, this.groundSolidMat);
      this.groundSolidMesh.renderOrder = 0;
      this.rootGroup.add(this.groundSolidMesh);
      this.disposables.push(groundPlaneGeo);
    }

    // Call 6: 地面正交网格（置于高层级，永不穿版，永不冲突）
    const groundLineMesh = new THREE.LineSegments(groundGeo, groundMat);
    groundLineMesh.renderOrder = 5;
    this.rootGroup.add(groundLineMesh);
    this.disposables.push(groundGeo);

    scene.add(this.rootGroup);
    this.isBuilt = true;
  }

  /** 动态更新：持续驱动大范围水花喷洒下落与八角水面同心涟漪扩展 (极速零分配，耗时 < 0.015ms) */
  update(_delta: number, time: number): void {
    // 透明桌宠 root 不可见：喷泉/飞鸟用户看不到，不必每帧积分
    if (!this.isBuilt || !this.rootGroup.visible) return;

    const nozzle = this.fountainOrigin;

    // 1. 花坛盆内水花喷洒模拟（水珠只在中层落水盆内部循环飞溅）
    if (this.fountainParticlePositions && this.fountainParticleVelocities && this.fountainParticleGeo) {
      const pPos = this.fountainParticlePositions;
      const pVel = this.fountainParticleVelocities;
      const lifes = this.fountainParticleLifes!;
      const maxLifes = this.fountainParticleMaxLifes!;
      const pCount = this.fountainParticleCount;
      const gravity = 4.8;
      const basinY = 0.90; // 中层落水盆水面高度（严禁穿漏掉至底层）
      const basinR = 0.65; // 盆沿最大半径

      for (let i = 0; i < pCount; i++) {
        lifes[i] += _delta;
        const i3 = i * 3;

        const dx = pPos[i3] - nozzle.x;
        const dz = pPos[i3 + 2] - nozzle.z;
        const rDist = Math.sqrt(dx * dx + dz * dz);

        // 当水珠落入中层盆内 (Y <= 0.90)、飞离盆外 (rDist > basinR) 或寿命耗尽时，重置回立柱顶端重新喷出
        if (lifes[i] >= maxLifes[i] || pPos[i3 + 1] <= basinY || rDist > basinR) {
          pPos[i3] = nozzle.x + (Math.random() - 0.5) * 0.04;
          pPos[i3 + 1] = nozzle.y + (Math.random() - 0.5) * 0.03;
          pPos[i3 + 2] = nozzle.z + (Math.random() - 0.5) * 0.04;

          lifes[i] = 0;
          maxLifes[i] = 0.55 + Math.random() * 0.40;

          const a = Math.random() * Math.PI * 2;
          const spd = 0.22 + Math.random() * 0.32;
          const vy = 1.35 + Math.random() * 0.50;

          pVel[i3] = Math.cos(a) * spd;
          pVel[i3 + 1] = vy;
          pVel[i3 + 2] = Math.sin(a) * spd;
        } else {
          pVel[i3 + 1] -= gravity * _delta;
          pPos[i3] += pVel[i3] * _delta;
          pPos[i3 + 1] += pVel[i3 + 1] * _delta;
          pPos[i3 + 2] += pVel[i3 + 2] * _delta;
        }
      }
      this.fountainParticleGeo.attributes.position.needsUpdate = true;
    }

    // 2. 动态八边形中层盆内微涟漪扩散淡出
    const rippleCount = this.fountainRipples.length;
    for (let r = 0; r < rippleCount; r++) {
      const phase = (time * 0.85 + (r / rippleCount)) % 1.0;
      const radius = 0.15 + phase * 0.40; // 紧锁在盆内 (0.15m ~ 0.55m)
      this.fountainRipples[r].scale.set(radius, 1, radius);
      const alpha = Math.sin(phase * Math.PI) * 0.40;
      this.fountainRippleMats[r].opacity = Math.max(0, alpha);
    }

    // 4. 动态飞鸟群：轻灵煽动翅膀 + 微微左右前后翱翔漂移 (耗时 < 0.005ms)
    if (this.birdsPositions && this.birdsGeo && this.birdsConfigs.length > 0) {
      const bPos = this.birdsPositions;
      let bIdx = 0;
      for (const b of this.birdsConfigs) {
        // 空间微微左右/前后漂移
        const curX = b.baseX + Math.sin(time * 0.65 + b.phase) * b.driftRangeX;
        const curZ = b.baseZ + Math.cos(time * 0.52 + b.phase) * b.driftRangeZ;
        const curY = b.baseY + Math.sin(time * 0.85 + b.phase * 1.5) * 0.16;

        // 翅膀煽动动画：真实鸟翼上下拍动起伏
        const flap = Math.sin(time * b.flapSpeed + b.phase);
        const wingY = b.s * (0.20 + flap * 0.60);

        // 顶点 0: 左翼端点
        bPos[bIdx++] = curX - b.s;
        bPos[bIdx++] = curY + wingY;
        bPos[bIdx++] = curZ;

        // 顶点 1: 鸟身中心
        bPos[bIdx++] = curX;
        bPos[bIdx++] = curY;
        bPos[bIdx++] = curZ;

        // 顶点 2: 鸟身中心
        bPos[bIdx++] = curX;
        bPos[bIdx++] = curY;
        bPos[bIdx++] = curZ;

        // 顶点 3: 右翼端点
        bPos[bIdx++] = curX + b.s;
        bPos[bIdx++] = curY + wingY;
        bPos[bIdx++] = curZ;
      }
      this.birdsGeo.attributes.position.needsUpdate = true;
    }
  }

  /** 动态无缝切换背景主题 (0ms 开销，无需重建几何体) */
  setTheme(theme: LineworkTheme, scene?: THREE.Scene): void {
    this.currentTheme = theme;
    const targetScene = scene || this.sceneRef;

    if (theme === 'transparent') {
      if (targetScene) {
        targetScene.background = null;
      }
      this.rootGroup.visible = false;
      return;
    }

    this.rootGroup.visible = true;
    if (targetScene) {
      targetScene.background = theme === 'dark' ? this.bgColorDark : this.bgTextureLight;
    }

    if (this.lineMat && this.buildingSolidMat && this.buildingWireMat && this.groundMat) {
      const isDark = theme === 'dark';
      this.lineMat.color.setHex(isDark ? 0xd4d4d8 : 0x4b3d44);
      this.lineMat.opacity = isDark ? 0.70 : 0.65;
      this.lineMat.needsUpdate = true;

      if (this.mountainSolidMat) {
        this.mountainSolidMat.color.setHex(isDark ? 0x191a20 : 0xb9a9b0);
        this.mountainSolidMat.needsUpdate = true;
      }

      this.buildingSolidMat.color.copy(isDark ? this.bgColorDark : this.buildingColorLight);
      this.buildingSolidMat.needsUpdate = true;

      this.buildingWireMat.color.setHex(isDark ? 0xa1a1aa : 0x52434a);
      this.buildingWireMat.opacity = isDark ? 0.60 : 0.62;
      this.buildingWireMat.needsUpdate = true;

      this.groundMat.color.setHex(isDark ? 0xb0b0b8 : 0x66545b);
      this.groundMat.opacity = isDark ? 0.40 : 0.45;
      this.groundMat.needsUpdate = true;

      if (this.groundSolidMat) {
        this.groundSolidMat.color.copy(isDark ? this.bgColorDark : this.groundColorLight);
        this.groundSolidMat.needsUpdate = true;
      }

      if (this.fountainParticleMat) {
        this.fountainParticleMat.color.setHex(isDark ? 0xd4d4d8 : 0xffffff);
        this.fountainParticleMat.opacity = isDark ? 0.95 : 0.90;
        this.fountainParticleMat.needsUpdate = true;
      }

      for (const rm of this.fountainRippleMats) {
        rm.color.setHex(isDark ? 0xd4d4d8 : 0xffffff);
        rm.opacity = isDark ? 0.40 : 0.60;
        rm.needsUpdate = true;
      }
    }
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
    this.bgTextureLight = null;
    this.lineMat = null;
    this.mountainSolidMat = null;
    this.buildingSolidMat = null;
    this.buildingWireMat = null;
    this.groundMat = null;
    this.groundSolidMat = null;
    this.groundSolidMesh = null;
    this.fountainGroup = null;
    this.fountainParticleMat = null;
    this.fountainRippleMats = [];
    this.fountainRipples = [];
    this.fountainParticleGeo = null;
    this.fountainParticlePositions = null;
    this.fountainParticleVelocities = null;
    this.fountainParticleLifes = null;
    this.fountainParticleMaxLifes = null;
    this.birdsGeo = null;
    this.birdsPositions = null;
    this.birdsConfigs = [];
    this.sceneRef = null;

    scene.remove(this.rootGroup);
    this.rootGroup.clear();
    this.isBuilt = false;
  }
}