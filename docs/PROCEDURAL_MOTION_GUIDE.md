# 仿生程序化骨骼动作编写指南 (Procedural Motion & Skeletal Rig Guide)

> **核心文件**:
> - [`src/motion/sources/idle.ts`](../src/motion/sources/idle.ts) (`NaturalIdleSystem` 待机生息基底)
> - [`src/motion/sources/listening.ts`](../src/motion/sources/listening.ts) (`ListeningMotionSystem` 独立倾听动作源)
> - [`src/motion/pipeline/poseBuffer.ts`](../src/motion/pipeline/poseBuffer.ts) (52 根标准人形骨骼索引与姿态缓冲)
> - [`src/motion/pipeline/motionPipeline.ts`](../src/motion/pipeline/motionPipeline.ts) (单一写入者管线调度与分层混合)
> - [`src/motion/biomechanics.ts`](../src/motion/biomechanics.ts) (矢状面俯仰生理极限限幅)

---

## 1. 为什么用代码写动作总是“反的”？

在开发 VRM/Three.js 程序化骨骼驱动时，开发者和 AI 最常遭遇的问题是：**想让手臂垂下却平举成 T 姿、想让手肘往前屈却往后折进后背、想握拳手指却像骨折一样向手背外翻**。

造成这种反常的根本原因在于 **3D 人形骨骼标准坐标系的认知盲区**：

### 盲区一：T 姿零点陷阱 (T-Pose Zero-Baseline Trap)
- VRM 规范化骨骼系统（Normalized Bones）的旋转欧拉角零点 `(0, 0, 0)` **不是人自然垂手的姿势，而是水平大字型 T 姿**！
- 如果你把手臂的旋转直接设为 `0` 或很小的数值，角色绝不会把手放下，而是**像飞机翅膀一样水平展臂**。
- **让双手自然垂落身侧的真实物理欧拉角是**：
  - 左大臂 (`leftUpperArm`): `Z ≈ -1.33 rad` (约 -76°)
  - 右大臂 (`rightUpperArm`): `Z ≈ +1.33 rad` (约 +76°)

### 盲区二：左右手镜像符号的相反性 (Left/Right Asymmetry)
- 在 VRM 标准中：
  - 左臂骨骼延伸向 `+X`，右臂骨骼延伸向 `-X`；
  - 导致**绕 Z 轴垂落大臂时，左臂为负，右臂为正**；
  - 绕 X 轴俯仰向前时，左臂与右臂在局部坐标系中的指向相反；
  - 如果把左臂写好的数值直接照抄给右臂而不做坐标镜像取反，右臂一定会**飞到头顶或反折到背后**。

### 盲区三：肘关节与手指弯曲轴向 (Hinge Joint Orientation)
- 手肘是单自由度铰链关节（Hinge）。当大臂垂顺身侧时：
  - 右小臂向前上方屈肘引向胸前/下巴：必须使用 **`+Y` 轴大角度弯曲（如 `Y ≈ +2.05 rad`）**；
  - 如果误填了 `-Y`，手肘就会穿过肋骨向后背反折；
  - 手指内卷握拳：左手为 `-Z`，右手为 `+Z`；一旦符号写反，手指就会反向超伸外翻。

---

## 2. VRM 骨骼局部旋转欧拉角权威速查表

在 Project XiaoChun 中，统一使用 Three.js 默认的 `'XYZ'` 旋转顺序（除非特殊标注）。以下为经过动力学仿真验证的标准基准值：

### 2.1 躯干与骨盆 (Hips, Spine, Chest)

| 骨骼 | 轴向 | 正值 (`+`) | 负值 (`-`) | 生理极限与推荐范围 |
| :--- | :--- | :--- | :--- | :--- |
| `hips` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | 骨盆后倾<br>骨盆左转<br>骨盆右倾 (左髋抬高) | 骨盆前倾<br>骨盆右转<br>骨盆左倾 (右髋抬高) | 换脚重心摆动: `Roll: -0.026 ~ 0.026`<br>微旋转: `Yaw: -0.03 ~ 0.03` |
| `spine` / `chest` / `upperChest` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | **向前屈躬身**<br>躯干左转<br>躯干右侧弯 | **向后仰身**<br>躯干右转<br>躯干左侧弯 | 俯仰限幅: `biomechanics.ts` 严格限制在前屈 `< 0.025`, 后仰 `> -0.02`<br>自然待机呼吸: `X: 0.01 ~ 0.05` |

### 2.2 头颈部 (Neck, Head)

| 骨骼 | 轴向 | 正值 (`+`) | 负值 (`-`) | 典型姿态参考 |
| :--- | :--- | :--- | :--- | :--- |
| `neck` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | 低头颈前倾<br>向左扭头<br>向右歪颈 | 仰头颈后缩<br>向右扭头<br>向左歪颈 | 倾听探身: `X: 0.03 ~ 0.05` |
| `head` | X (Pitch)<br>Y (Yaw)<br>Z (Roll) | 低头看地面<br>视线向左偏<br>**向右歪头** | 抬头看天空<br>视线向右偏<br>**向左歪头** | 玩味歪头杀: `Z: 0.06 ~ 0.09` (约 4°~6°)<br>点头脉冲: `X: 0.04 ~ 0.08` |

### 2.3 双臂动力链（最容易写反的部分）

#### 左臂 (Left Arm，骨骼伸向 +X)
- **自然垂顺在身侧 (Resting at side)**:
  - `leftUpperArm`: `Euler(X: 0.04, Y: 0.02, Z: -1.33)` （**Z 是负数**）
  - `leftLowerArm`: `Euler(X: 0.0, Y: 0.0, Z: 0.08)` （手肘自然微屈）
  - `leftHand`: `Euler(X: 0.04, Y: 0.0, Z: 0.0)` （手腕自然悬垂）

#### 右臂 (Right Arm，骨骼伸向 -X)
- **自然垂顺在身侧 (Resting at side)**:
  - `rightUpperArm`: `Euler(X: 0.04, Y: -0.02, Z: 1.33)` （**Z 是正数**）
  - `rightLowerArm`: `Euler(X: 0.0, Y: 0.0, Z: -0.08)` （手肘自然微屈）
  - `rightHand`: `Euler(X: 0.04, Y: 0.0, Z: 0.0)` （手腕自然悬垂）
- **单手托腮折叠动作 (Chin-Rest Pose)**:
  - `rightUpperArm`: `Euler(X: -1.15, Y: 0.55, Z: 1.30)` （大臂前扬贴胸）
  - `rightLowerArm`: `Euler(X: 0.0, Y: 2.05, Z: 0.25)` （**手肘深屈折叠向上，手掌直奔下巴**）
  - `rightHand`: `Euler(X: 0.15, Y: -0.10, Z: 0.05)` （手腕微托下颌底缘）

### 2.4 手指关节内卷 (Finger Flexion)

手指骨骼分为三段：`Proximal`（近节）、`Intermediate`（中节）、`Distal`（远节），拇指含 `Metacarpal`。

- **内卷蜷曲（握拳/贴颌）法则**：
  - **左手五指**：围绕 Z 轴往**负向 (`-Z`)** 旋转是向手心内卷；
  - **右手五指**：围绕 Z 轴往**正向 (`+Z`)** 旋转是向手心内卷；
  - 弯曲幅度参考：微握 `Z: 0.15 ~ 0.25`，半握 `Z: 0.35 ~ 0.55`，深握/拳 `Z: 0.70 ~ 0.95`。

---

## 3. 编写程序化动作的黄金法则

### 法则 1：动作源独立建文件，严禁污染约束层与单例写入规范
在小蠢架构中，管线分两层：
- **`sources/` (动作源，仅产生数据)**: 如 `idle.ts`、`listening.ts`、`vrma.ts`、`emage.ts`。它们只能将姿态输出到 `PoseBuffer`，**绝对不能直接修改 VRM 骨骼 Object3D**。
- **`constraints/` (约束层，后置修正)**: 如 `gaze.ts`（眼睛视线）、`footIK.ts`（脚踏实地）、`bodyTurn.ts`（物理转向）。约束层不得承载全身动作逻辑。

### 法则 2：永远从垂落基准出发，禁止从 `(0,0,0)` 脑补
写任何手臂动作，起点必须是大臂垂顺基准（`Left Z: -1.33`, `Right Z: +1.33`）。
- 绝不能将大臂的 Roll 写为 `0` 或接近 `0` 的极小值；
- 绝不能复制完左臂参数直接粘给右臂。

### 法则 3：动作阻尼与呼吸共振 (Zero-Statue Rule)
- 机械死板的本质在于“瞬间到达”和“静止如石膏”；
- 必须使用五次平滑或临界阻尼弹簧：
  ```typescript
  this.weight = THREE.MathUtils.damp(this.weight, target, rate, delta);
  ```
- 手部托腮、搭腰等肢体接触动作，必须将呼吸项（`Math.sin(time * 1.25)`）叠加在 `chest` 驱动源，使头颈与手臂**同频浮沉**，杜绝下巴穿模或手悬空。

### 法则 4：提交前必须跑正向运动学 (FK) 快速验证脚本
无需每次都启动前端肉眼排查，在终端运行 1 行 Node 命令即可瞬间验证手掌世界坐标是否落在预期位置（例如下巴高度 `y ≈ +0.07`，身前 `z ≈ +0.18`）：

```bash
node -e '
const THREE = require("three");
const u = new THREE.Vector3(-0.23, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0.55, 1.30)));
const l = u.clone().add(new THREE.Vector3(-0.21, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0.55, 1.30)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.05, 0.25)))));
console.log("右大臂手肘位置:", u.toArray().map(v=>v.toFixed(2)));
console.log("右手手掌落点位置:", l.toArray().map(v=>v.toFixed(2)));
'
```
- 若输出 `y < -0.30`：说明手垂在身下；
- 若输出 `y > 0.05, z > 0.10`：说明手顺利抬起托在身前的下巴位置；
- 若输出 `x < -0.20`：说明手臂朝身体右侧外展伸出去了，需要检查符号。
