import * as THREE from 'three';
import { Viewport } from '../core/Viewport.js';
import { G, rad, fx, pressureAtAltitude, P0 } from '../core/physics.js';

/* ============================================================
   托里拆利实验 (1643)
   ------------------------------------------------------------
   灌满水银的玻璃管倒扣在水银槽中，管内水银下降到某个高度就停住：
   此时管内液柱在槽液面处产生的压强 ρgh 恰好等于外界大气压 p。
   于是 h = p / (ρg)，标准大气压对应 760 mm 水银柱。
   管顶留下的空隙就是历史上第一个人造真空。
   ============================================================ */

const LIQUIDS = {
  mercury: { name: '水银', rho: 13600, color: 0xdfe4ea, metal: 1.0, rough: 0.16, tube: 1.0 },
  water: { name: '水', rho: 1000, color: 0x3fa9ff, metal: 0.0, rough: 0.12, tube: 11.5 },
  alcohol: { name: '酒精', rho: 789, color: 0xbdf0d4, metal: 0.0, rough: 0.14, tube: 14.5 },
};

const BOTTOM = -0.08; // 管子插入槽液面以下的深度 (m)

export function create(host, panel) {
  const vp = new Viewport(host, {
    cameraPos: [0.58, 0.74, 1.24],
    target: [0, 0.5, 0],
    maxDistance: 90,
    minDistance: 0.4,
    fog: false,
  });
  vp.addStandardLights({ keyPos: [3, 6, 4] });

  const state = {
    liquid: 'mercury',
    altitude: 0,
    tubeLen: 1.0,
    tilt: 0,
    radius: 0.012, // 管内半径 (m)
  };

  /* ---------------------- 器材 ---------------------- */

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.05, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2540, roughness: 0.9 })
  );
  table.position.y = -0.145;
  table.receiveShadow = true;
  vp.scene.add(table);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xd7ecff,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.85,
    thickness: 0.06,
    ior: 1.5,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });

  // 液体槽
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 40, 1, true), glassMat);
  dish.position.y = -0.05;
  vp.scene.add(dish);
  const dishBottom = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), glassMat);
  dishBottom.rotation.x = -Math.PI / 2;
  dishBottom.position.y = -0.12;
  vp.scene.add(dishBottom);

  const liquidMat = new THREE.MeshStandardMaterial({
    color: LIQUIDS.mercury.color,
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.4,
  });
  const dishLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.166, 0.166, 0.1, 40), liquidMat);
  dishLiquid.position.y = -0.07;
  vp.scene.add(dishLiquid);

  // 玻璃管：绕槽液面上的原点倾斜
  const tubeGroup = new THREE.Group();
  vp.scene.add(tubeGroup);
  let tubeWall = null;
  let tubeCap = null;
  let column = null;

  const vacuumTag = vp.label('托里拆利真空', { className: 'tag3d warm' });
  tubeGroup.add(vacuumTag);

  // 液面标记盘，让"液柱顶在哪里"一眼可辨
  const levelRing = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  tubeGroup.add(levelRing);

  // 标尺
  const rulerGroup = new THREE.Group();
  vp.scene.add(rulerGroup);
  let rulerTicks = null;
  const rulerLabels = [];

  // 液柱竖直高度指示线
  const heightLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 0.03, gapSize: 0.022 })
  );
  vp.scene.add(heightLine);
  const heightTag = vp.label('', { className: 'tag3d warm' });
  vp.scene.add(heightTag);

  // 760 mm 参考线
  const refLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x59c1ff, transparent: true, opacity: 0.7 })
  );
  vp.scene.add(refLine);
  const refTag = vp.label('760 mm = 1 标准大气压', { className: 'tag3d accent' });
  vp.scene.add(refTag);

  // 大气压压住槽液面的示意箭头
  const arrows = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.135;
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(Math.cos(a) * r, 0.19, Math.sin(a) * r),
      0.13,
      0x8fd0ff,
      0.045,
      0.03
    );
    vp.scene.add(arrow);
    arrows.push(arrow);
  }
  const pTag = vp.label('大气压 p₀', { className: 'tag3d', position: [0.26, 0.22, 0] });
  vp.scene.add(pTag);

  /* ---------------------- 物理计算 ---------------------- */

  function physics() {
    const liq = LIQUIDS[state.liquid];
    const p = pressureAtAltitude(state.altitude);
    const hFull = p / (liq.rho * G); // 大气压能支持的竖直高度 (m)
    const cos = Math.cos(state.tilt);
    const needLen = hFull / cos; // 需要的沿管长度
    const full = needLen >= state.tubeLen; // 管子不够长 → 管内充满，没有真空
    const colLen = full ? state.tubeLen : needLen;
    const h = full ? state.tubeLen * cos : hFull; // 实际竖直高度
    return { liq, p, hFull, needLen, full, colLen, h };
  }

  /* ---------------------- 几何构建 ---------------------- */

  function rebuildTube() {
    const r = state.radius;
    const len = state.tubeLen - BOTTOM;

    if (tubeWall) {
      tubeWall.geometry.dispose();
      tubeCap.geometry.dispose();
    } else {
      tubeWall = new THREE.Mesh(new THREE.BufferGeometry(), glassMat);
      tubeCap = new THREE.Mesh(new THREE.BufferGeometry(), glassMat);
      tubeGroup.add(tubeWall, tubeCap);
    }
    tubeWall.geometry = new THREE.CylinderGeometry(r * 1.14, r * 1.14, len, 28, 1, true);
    tubeWall.position.y = BOTTOM + len / 2;
    tubeCap.geometry = new THREE.CircleGeometry(r * 1.14, 28);
    tubeCap.rotation.x = -Math.PI / 2;
    tubeCap.position.y = state.tubeLen;
  }

  function rebuildRuler() {
    const len = state.tubeLen;
    const majorStep = len > 3 ? 1 : 0.1;
    const minorStep = len > 3 ? 0.2 : 0.02;
    const x = 0.06 + state.radius * 3;

    const pts = [];
    for (let v = 0; v <= len + 1e-6; v += minorStep) {
      const isMajor = Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
      const w = (isMajor ? 0.075 : 0.035) * Math.max(1, len / 4);
      pts.push(new THREE.Vector3(x, v, 0), new THREE.Vector3(x + w, v, 0));
    }
    if (rulerTicks) rulerTicks.geometry.dispose();
    else {
      rulerTicks = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x8098c4 })
      );
      rulerGroup.add(rulerTicks);
    }
    rulerTicks.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    for (const l of rulerLabels) rulerGroup.remove(l);
    rulerLabels.length = 0;
    for (let v = majorStep; v <= len + 1e-6; v += majorStep) {
      const text = majorStep >= 1 ? `${Math.round(v)} m` : `${Math.round(v * 1000)}`;
      const tag = vp.label(text, {
        className: 'tag3d plain',
        position: [x + 0.075 * Math.max(1, len / 4) + 0.055 * Math.max(1, len / 6), v, 0],
      });
      rulerGroup.add(tag);
      rulerLabels.push(tag);
    }
  }

  function updateScene() {
    const { liq, colLen, h, full } = physics();

    tubeGroup.rotation.z = -state.tilt;

    liquidMat.color.setHex(liq.color);
    liquidMat.metalness = liq.metal;
    liquidMat.roughness = liq.rough;
    liquidMat.needsUpdate = true;

    // 管内液柱
    const r = state.radius;
    if (column) column.geometry.dispose();
    else {
      column = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat);
      tubeGroup.add(column);
    }
    const cl = colLen - BOTTOM;
    column.geometry = new THREE.CylinderGeometry(r, r, cl, 28);
    column.position.y = BOTTOM + cl / 2;

    vacuumTag.visible = !full;
    vacuumTag.position.set(0, (colLen + state.tubeLen) / 2, 0);

    levelRing.scale.set(r * 1.35, 0.006, r * 1.35);
    levelRing.position.set(0, colLen, 0);
    levelRing.visible = !full;

    // 竖直高度指示（从槽液面到液柱顶端的竖直距离）
    const tip = new THREE.Vector3(0, colLen, 0).applyEuler(tubeGroup.rotation);
    const dx = -0.15 - state.radius;
    heightLine.geometry.dispose();
    heightLine.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(dx, 0, 0),
      new THREE.Vector3(dx, h, 0),
      new THREE.Vector3(tip.x, h, 0),
    ]);
    heightLine.computeLineDistances();
    heightTag.position.set(dx, h / 2, 0);
    heightTag.element.textContent = `h = ${Math.round(h * 1000)} mm`;

    // 760 mm 参考线（量程相近时才显示，避免在 11 m 场景里挤成一团）
    const nearScale = state.tubeLen <= 3;
    refLine.visible = nearScale;
    refTag.visible = nearScale;
    if (nearScale) {
      refLine.geometry.dispose();
      refLine.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.26, 0.76, 0),
        new THREE.Vector3(0.26, 0.76, 0),
      ]);
      refTag.position.set(0, 0.79, 0.2);
    }
    for (const a of arrows) a.visible = nearScale;
    pTag.visible = nearScale;
  }

  function reframe() {
    const len = state.tubeLen;
    vp.flyTo([len * 0.58, len * 0.74, len * 1.24], [0, len * 0.5, 0], 0.8);
  }

  function refresh() {
    rebuildTube();
    rebuildRuler();
    updateScene();
    updateStats();
  }

  /* ---------------------- 侧边栏 ---------------------- */

  panel.section('实验控制');

  const liquidCtl = panel.segmented({
    label: '管内液体',
    value: 'mercury',
    options: [
      { value: 'mercury', label: '水银' },
      { value: 'water', label: '水' },
      { value: 'alcohol', label: '酒精' },
    ],
    onChange: (v) => {
      state.liquid = v;
      state.tubeLen = LIQUIDS[v].tube;
      tubeCtl.set(state.tubeLen);
      refresh();
      reframe();
    },
  });

  const tubeCtl = panel.slider({
    label: '玻璃管长度',
    min: 0.4,
    max: 16,
    step: 0.1,
    value: 1.0,
    fmt: (v) => `${fx(v, 1)} m`,
    onInput: (v) => {
      state.tubeLen = v;
      refresh();
    },
  });

  const altCtl = panel.slider({
    label: '海拔高度',
    min: 0,
    max: 8848,
    step: 1,
    value: 0,
    fmt: (v) => `${v} m`,
    onInput: (v) => {
      state.altitude = v;
      updateScene();
      updateStats();
    },
  });

  const tiltCtl = panel.slider({
    label: '玻璃管倾角',
    min: 0,
    max: 70,
    step: 1,
    value: 0,
    fmt: (v) => `${v}°`,
    onInput: (v) => {
      state.tilt = rad(v);
      updateScene();
      updateStats();
    },
  });

  const radiusCtl = panel.slider({
    label: '玻璃管内径',
    min: 4,
    max: 60,
    step: 1,
    value: 24,
    fmt: (v) => `${v} mm`,
    onInput: (v) => {
      state.radius = v / 2000;
      refresh();
    },
  });

  panel.buttons([
    { label: '重新取景', onClick: () => reframe() },
    {
      label: '恢复标准条件',
      primary: true,
      onClick: () => {
        state.liquid = 'mercury';
        state.altitude = 0;
        state.tubeLen = 1.0;
        state.tilt = 0;
        state.radius = 0.012;
        liquidCtl.set('mercury');
        tubeCtl.set(1.0);
        altCtl.set(0);
        tiltCtl.set(0);
        radiusCtl.set(24);
        refresh();
        reframe();
      },
    },
  ]);

  panel.section('实时数据');
  const stats = panel.statGrid();
  const sP = stats.add('大气压 p', { unit: 'kPa', hi: true });
  const sPm = stats.add('相当于', { unit: 'mmHg' });
  const sRho = stats.add('液体密度 ρ', { unit: 'kg/m³' });
  const sH = stats.add('液柱竖直高度 h', { unit: 'mm', hi: true });
  const sLen = stats.add('沿管方向长度', { unit: 'mm' });
  const sVac = stats.add('管顶真空段', { unit: 'mm' });
  const sRatio = stats.add('占标准大气压', { unit: '%' });
  const sNote = stats.add('管内状态', {});

  function updateStats() {
    const { liq, p, full, colLen, h } = physics();
    sP.set(fx(p / 1000, 2));
    sPm.set(fx((p / (13600 * G)) * 1000, 1));
    sRho.set(liq.rho);
    sH.set(Math.round(h * 1000));
    sLen.set(Math.round(colLen * 1000));
    sVac.set(full ? '0' : Math.round((state.tubeLen - colLen) * 1000));
    sRatio.set(fx((p / P0) * 100, 1));
    sNote.set(full ? '充满·无真空' : '顶端真空');
  }

  panel.section('实验原理');
  panel.html(`
    <p>液柱之所以停住，是因为槽液面处两侧压强必须相等：管外由大气压 <b>p₀</b> 顶着，
    管内则是液柱自身产生的 <b>ρgh</b>（管顶是真空，不贡献压强）。</p>
    <span class="formula">p₀ = ρgh &nbsp;⟹&nbsp; h = p₀ / (ρg)</span>
    <p>代入标准大气压 p₀ = 1.013×10⁵ Pa、ρ<sub>水银</sub> = 1.36×10⁴ kg/m³、g = 9.8 m/s²：</p>
    <span class="formula">h = 101325 ÷ (13600 × 9.8) ≈ 0.760 m = 760 mm</span>
    <p>这正是"760 毫米水银柱"的由来，也是水银气压计的工作原理。</p>
  `);
  panel.callout(`
    <b>三个必考结论</b><br />
    ① <b>与管的粗细无关</b>：拖动"玻璃管内径"，h 纹丝不动——ρgh 里只有高度，没有面积。<br />
    ② <b>与管是否倾斜无关</b>：倾斜后液柱沿管变长，但<b>竖直高度</b>仍是 760 mm。<br />
    ③ <b>换成水要 10.3 m 长的管子</b>：密度小 13.6 倍，高度就大 13.6 倍。托里拆利正是想通这一点才改用水银。
  `);

  panel.section('历史背景');
  panel.html(`
    <p>1643 年，伽利略的学生托里拆利在佛罗伦萨完成了这个实验。当时人们只知道抽水机提水提不过约 10 m，
    并用"自然界厌恶真空"来解释。托里拆利把解释翻了过来：托住液柱的不是什么"厌恶"，
    而是<b>大气本身的重量</b>——"我们生活在空气海洋的底部"。</p>
    <p>管顶那段空隙至今仍被称为<b>托里拆利真空</b>。几年后帕斯卡让人把气压计抬上多姆山，
    发现水银柱随高度明显下降，彻底证实了这个解释。拖动"海拔高度"就能复现那次登山实验：
    珠峰顶上的大气压只剩海平面的三分之一左右。</p>
  `);

  refresh();

  return { dispose: () => vp.dispose() };
}
