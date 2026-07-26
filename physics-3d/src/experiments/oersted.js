import * as THREE from 'three';
import { Viewport } from '../core/Viewport.js';
import { MU0, deg, fx } from '../core/physics.js';

/* ============================================================
   奥斯特电流磁效应实验 (1820)
   ------------------------------------------------------------
   通电直导线周围的磁感应强度：
        B = μ₀I / (2πr)
   方向由安培定则（右手螺旋）给出：磁感线是以导线为轴的同心圆。
   桌面上每一枚小磁针都停在"地磁场 + 电流磁场"的合矢量方向上，
   偏转角满足 tanα = B电流 / B地磁。
   ------------------------------------------------------------
   坐标约定：+y 向上，−z 为北，+x 为东。电流为正时沿 −z（向北）流动。
   ============================================================ */

const WIRE_LEN = 0.92;
const COLS = [-0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18]; // 磁针阵列：垂直于导线的方向
const ROWS = [-0.26, -0.13, 0, 0.13, 0.26]; // 磁针阵列：沿导线的方向

export function create(host, panel) {
  const vp = new Viewport(host, {
    cameraPos: [0.5, 0.42, 0.62],
    target: [0, 0.02, 0],
    maxDistance: 3,
    minDistance: 0.15,
  });
  vp.addStandardLights({ keyPos: [3, 6, 4] });
  vp.addGroundGrid({ y: -0.13, size: 2.4, divisions: 24 });

  const state = {
    current: 8, // A
    height: 0.05, // 导线与磁针的距离 (m)
    above: true, // 导线在磁针上方 / 下方
    earth: 5e-5, // 地磁场水平分量 (T)
    showField: true,
    showFilings: false,
  };

  /* ---------------------- 器材 ---------------------- */

  // 半透明实验台（这样导线下方的磁感线也看得见）
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.008, 0.72),
    new THREE.MeshPhysicalMaterial({
      color: 0x2b3c66,
      roughness: 0.35,
      transparent: true,
      opacity: 0.34,
    })
  );
  bench.position.y = -0.006;
  vp.scene.add(bench);

  // 导线：南北放置，与静止时的磁针平行——这正是奥斯特的摆法
  const wireGroup = new THREE.Group();
  vp.scene.add(wireGroup);
  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.0035, WIRE_LEN, 16),
    new THREE.MeshStandardMaterial({ color: 0xd98c4a, roughness: 0.3, metalness: 0.95 })
  );
  wire.rotation.x = Math.PI / 2;
  wireGroup.add(wire);

  // 沿导线流动的电流箭头
  const flow = [];
  for (let i = 0; i < 11; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.009, 0.026, 12),
      new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x7a5500, roughness: 0.4 })
    );
    wireGroup.add(cone);
    flow.push(cone);
  }

  const wireTag = vp.label('通电直导线', { className: 'tag3d', position: [0, 0.05, -0.5] });
  wireGroup.add(wireTag);

  vp.scene.add(vp.label('北 N', { className: 'tag3d plain', position: [0, -0.1, -0.46] }));
  vp.scene.add(vp.label('南 S', { className: 'tag3d plain', position: [0, -0.1, 0.46] }));

  /** 一枚小磁针：红色一端为北极，静止时指北(−z) */
  function makeNeedle(scale = 1) {
    const g = new THREE.Group();
    const north = new THREE.Mesh(
      new THREE.ConeGeometry(0.007 * scale, 0.036 * scale, 4),
      new THREE.MeshStandardMaterial({ color: 0xff5470, roughness: 0.45, metalness: 0.25 })
    );
    north.rotation.x = -Math.PI / 2;
    north.position.z = -0.018 * scale;
    const south = new THREE.Mesh(
      new THREE.ConeGeometry(0.007 * scale, 0.036 * scale, 4),
      new THREE.MeshStandardMaterial({ color: 0xe8edf9, roughness: 0.45, metalness: 0.25 })
    );
    south.rotation.x = Math.PI / 2;
    south.position.z = 0.018 * scale;
    const pivot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003 * scale, 0.0045 * scale, 0.012 * scale, 12),
      new THREE.MeshStandardMaterial({ color: 0x8fa4cc, metalness: 0.85, roughness: 0.25 })
    );
    pivot.position.y = -0.008 * scale;
    g.add(north, south, pivot);
    return g;
  }

  const needles = [];
  for (const z of ROWS) {
    for (const x of COLS) {
      const main = x === 0 && z === 0;
      const obj = makeNeedle(main ? 1.7 : 1);
      obj.position.set(x, 0.008, z);
      vp.scene.add(obj);
      needles.push({ obj, x, angle: 0, target: 0, main });
    }
  }
  vp.scene.add(vp.label('主磁针', { className: 'tag3d accent', position: [0.075, 0.03, 0.05] }));

  // 磁感线：以导线为轴的同心圆
  const fieldGroup = new THREE.Group();
  vp.scene.add(fieldGroup);
  const fieldArrows = [];
  for (const zPos of [-0.33, -0.11, 0.11, 0.33]) {
    for (const r of [0.028, 0.055, 0.095, 0.15]) {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, zPos));
      }
      fieldGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.38 })
        )
      );
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.008, 0.022, 10),
        new THREE.MeshBasicMaterial({ color: 0x4ade80 })
      );
      arrow.position.set(r, 0, zPos);
      fieldGroup.add(arrow);
      fieldArrows.push(arrow);
    }
  }

  // 铁屑：垂直于导线的一块板，铁屑自动排成同心圆
  const filings = new THREE.Group();
  filings.position.z = -0.44;
  vp.scene.add(filings);
  {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshStandardMaterial({
        color: 0x18233d,
        roughness: 0.95,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    filings.add(card);

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.008, 0.0016, 0.002),
      new THREE.MeshStandardMaterial({ color: 0xaebbd6, roughness: 0.6, metalness: 0.7 }),
      1000
    );
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let ring = 0; ring < 26 && i < 1000; ring++) {
      const r = 0.018 + ring * 0.0068;
      const count = Math.max(8, Math.round(r * 330));
      for (let k = 0; k < count && i < 1000; k++) {
        const a = (k / count) * Math.PI * 2 + ring * 0.35;
        dummy.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.004);
        dummy.rotation.set(0, 0, a + Math.PI / 2);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.count = i;
    filings.add(mesh);
  }

  /* ---------------------- 物理计算 ---------------------- */

  /**
   * 导线沿 z 轴、位于磁针上方 dy 处，电流为正时沿 −z 流动。
   * B = μ₀I/(2π r²) · (Î × r)，r 为从导线指向该点的位矢。
   * 代入 Î = (0,0,−1)、r = (x, −dy, 0) 得 B = k·(−dy, −x, 0)。
   */
  function fieldAt(x) {
    const dy = state.above ? state.height : -state.height;
    const r2 = x * x + dy * dy;
    const k = (MU0 * state.current) / (2 * Math.PI * r2);
    return { bx: -k * dy, r: Math.sqrt(r2) };
  }

  /** 磁针停在地磁场(指北)与电流磁场(东西向)的合方向上 */
  function needleAngle(x) {
    return Math.atan2(-fieldAt(x).bx, state.earth);
  }

  /* ---------------------- 场景更新 ---------------------- */

  function updateScene() {
    const y = state.above ? state.height : -state.height;
    wireGroup.position.y = y;
    fieldGroup.position.y = y;
    filings.position.y = y;

    const on = state.current !== 0;
    fieldGroup.visible = state.showField && on;
    filings.visible = state.showFilings && on;

    // 电流反向时磁感线的环绕方向也反向
    const dirSign = state.current >= 0 ? 1 : -1;
    for (const a of fieldArrows) a.rotation.z = dirSign > 0 ? Math.PI : 0;

    for (const n of needles) n.target = needleAngle(n.x);
    updateStats();
  }

  /* ---------------------- 侧边栏 ---------------------- */

  panel.section('实验控制');

  let lastCurrent = 8;
  const currentCtl = panel.slider({
    label: '电流 I（负号表示反向）',
    min: -20,
    max: 20,
    step: 0.5,
    value: 8,
    fmt: (v) => (v === 0 ? '断开' : `${fx(v, 1)} A`),
    onInput: (v) => {
      state.current = v;
      if (v !== 0) lastCurrent = v;
      updateScene();
    },
  });

  panel.buttons([
    {
      label: '接通 / 断开',
      primary: true,
      onClick: () => {
        state.current = state.current === 0 ? lastCurrent || 8 : 0;
        currentCtl.set(state.current);
        updateScene();
      },
    },
    {
      label: '改变电流方向',
      onClick: () => {
        state.current = -state.current;
        if (state.current !== 0) lastCurrent = state.current;
        currentCtl.set(state.current);
        updateScene();
      },
    },
  ]);

  panel.segmented({
    label: '导线位置',
    value: 'above',
    options: [
      { value: 'above', label: '磁针上方' },
      { value: 'below', label: '磁针下方' },
    ],
    onChange: (v) => {
      state.above = v === 'above';
      updateScene();
    },
  });

  panel.slider({
    label: '导线与磁针的距离 r',
    min: 1,
    max: 20,
    step: 0.5,
    value: 5,
    fmt: (v) => `${fx(v, 1)} cm`,
    onInput: (v) => {
      state.height = v / 100;
      updateScene();
    },
  });

  panel.slider({
    label: '地磁场水平分量 B₀',
    min: 0,
    max: 100,
    step: 1,
    value: 50,
    fmt: (v) => (v === 0 ? '无地磁场' : `${v} μT`),
    onInput: (v) => {
      state.earth = v * 1e-6;
      updateScene();
    },
  });

  panel.toggle({
    label: '显示磁感线（同心圆）',
    value: true,
    onChange: (v) => {
      state.showField = v;
      updateScene();
    },
  });
  panel.toggle({
    label: '显示铁屑分布',
    value: false,
    onChange: (v) => {
      state.showFilings = v;
      updateScene();
    },
  });

  panel.section('实时数据');
  const stats = panel.statGrid();
  const sI = stats.add('电流 I', { unit: 'A' });
  const sR = stats.add('磁针到导线距离', { unit: 'cm' });
  const sB = stats.add('电流磁场 B', { unit: 'μT', hi: true });
  const sBe = stats.add('地磁场 B₀', { unit: 'μT' });
  const sAngle = stats.add('主磁针偏转角 α', { unit: '°', hi: true });
  const sDir = stats.add('偏转方向', {});
  const sRatio = stats.add('tanα = B ÷ B₀', { wide: true });

  function updateStats() {
    const { bx } = fieldAt(0);
    const b = Math.abs(bx);
    sI.set(fx(state.current, 1));
    sR.set(fx(state.height * 100, 1));
    sB.set(fx(b * 1e6, 2));
    sBe.set(fx(state.earth * 1e6, 1));
    sAngle.set(fx(Math.abs(deg(needleAngle(0))), 1));
    sDir.set(b < 1e-12 ? '不偏转' : bx > 0 ? '北极偏向东' : '北极偏向西');
    sRatio.set(
      state.earth > 0
        ? `${fx(b * 1e6, 2)} ÷ ${fx(state.earth * 1e6, 1)} = ${fx(b / state.earth, 3)}`
        : '地磁场为 0 ⇒ 磁针完全垂直于导线'
    );
  }

  panel.section('实验原理');
  panel.html(`
    <p>通电直导线周围会产生磁场，距导线 r 处的磁感应强度为：</p>
    <span class="formula">B = μ₀I / (2πr)　（μ₀ = 4π×10⁻⁷ T·m/A）</span>
    <p>磁感线是<b>以导线为轴的一圈圈同心圆</b>，方向用<b>安培定则（右手螺旋定则）</b>判断：
    右手握住导线，大拇指指向电流方向，弯曲的四指所指就是磁感线的环绕方向。</p>
    <p>桌面上的小磁针同时受到地磁场 B₀（指北）和电流磁场 B（东西向）的作用，
    最终停在两者的<b>合矢量</b>方向上：</p>
    <span class="formula">tanα = B / B₀ = μ₀I / (2πr·B₀)</span>
    <p>于是：电流越大、离导线越近，偏转角越大；<b>电流反向，偏转随之反向</b>；
    把导线移到磁针下方，偏转方向也反过来——这正是奥斯特反复验证的三件事。
    注意阵列中不同位置的磁针偏转角并不相同，离导线越远（x 越大）偏得越小。</p>
  `);
  panel.callout(`
    <b>把地磁场调到 0 试试</b><br />
    没有地磁场"拉住"磁针时，磁针会完全转到<b>垂直于导线</b>的方向。
    这说明电流的磁场本身就是绕着导线打转的，既不指向导线也不背离导线——
    这种"横向力"在 1820 年之前从未有人见过。
  `);

  panel.section('历史背景');
  panel.html(`
    <p>1820 年 4 月的一堂课上，哥本哈根大学教授奥斯特正在演示电流的热效应。
    接通电路的一瞬间，讲台上一枚碰巧摆在导线附近的小磁针<b>轻轻抖动了一下</b>。
    在场几乎没有学生注意到，但奥斯特抓住了它。</p>
    <p>此后三个月他反复实验，确认磁针的偏转既不指向导线、也不背离导线，
    而是<b>垂直于导线</b>。1820 年 7 月 21 日，他用拉丁文发表了仅四页的报告，电磁学就此诞生。</p>
    <p>消息传到巴黎，安培在一周之内做出自己的实验并总结出安培定则；
    十余年后法拉第由此发现电磁感应，人类最终造出了发电机。</p>
  `);

  /* ---------------------- 动画 ---------------------- */

  let t = 0;
  vp.onFrame((dt) => {
    t += dt;

    // 磁针带阻尼地转向目标方向
    for (const n of needles) {
      n.angle += (n.target - n.angle) * Math.min(1, dt * 6);
      n.obj.rotation.y = n.angle;
    }

    // 电流箭头沿导线流动（正电流向北 = −z）
    const speed = -state.current * 0.014;
    const visible = state.current !== 0;
    for (let i = 0; i < flow.length; i++) {
      const base = (i / flow.length) * WIRE_LEN;
      const z = (((base + t * speed) % WIRE_LEN) + WIRE_LEN) % WIRE_LEN;
      flow[i].position.z = z - WIRE_LEN / 2;
      // 电流为正时向北(−z)流动，圆锥须朝 −z
      flow[i].rotation.x = state.current >= 0 ? -Math.PI / 2 : Math.PI / 2;
      flow[i].visible = visible;
    }
  });

  updateScene();

  return { dispose: () => vp.dispose() };
}
