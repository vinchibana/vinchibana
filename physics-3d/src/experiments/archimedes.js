import * as THREE from 'three';
import { Viewport } from '../core/Viewport.js';
import { G, fx, clamp } from '../core/physics.js';

/* ============================================================
   阿基米德浮力实验（约公元前 245 年）
   ------------------------------------------------------------
   阿基米德原理：浸在液体里的物体受到向上的浮力，
   大小等于它排开的那部分液体所受的重力。
        F浮 = ρ液 · g · V排
   弹簧测力计的读数（视重）为 F示 = G − F浮。
   王冠之谜：等质量的纯金块与掺银王冠密度不同 ⇒ 体积不同
   ⇒ 排开的水不同，这正是阿基米德识破工匠的办法。
   ------------------------------------------------------------
   场景单位：1 个 three.js 单位 = 10 cm
   ============================================================ */

const U = 10; // cm → 场景单位

const MATERIALS = {
  gold: { name: '纯金', rho: 19320, color: 0xffd166, metal: 1, rough: 0.18 },
  crown: { name: '王冠', rho: 15200, color: 0xf3dc9e, metal: 1, rough: 0.26 },
  silver: { name: '纯银', rho: 10490, color: 0xdfe6f0, metal: 1, rough: 0.2 },
  iron: { name: '铁', rho: 7870, color: 0x9fb0c8, metal: 1, rough: 0.4 },
  aluminum: { name: '铝', rho: 2700, color: 0xc9d4e4, metal: 1, rough: 0.35 },
  ice: { name: '冰', rho: 917, color: 0xa8e6ff, metal: 0, rough: 0.1 },
  wood: { name: '木块', rho: 600, color: 0xb1793f, metal: 0, rough: 0.85 },
};

const FLUIDS = {
  water: { name: '水', rho: 1000, color: 0x2f9cf0 },
  brine: { name: '盐水', rho: 1200, color: 0x2fd0c0 },
  alcohol: { name: '酒精', rho: 789, color: 0xa6e3b8 },
  mercury: { name: '水银', rho: 13600, color: 0xdfe4ea },
};

const BEAKER_R = 5.2; // 烧杯内半径 cm
const BEAKER_H = 16; // 烧杯高 cm
const BASE_LEVEL = 8.5; // 初始液面高度 cm
const AREA = Math.PI * BEAKER_R * BEAKER_R; // 底面积 cm²
const HOOK_Y = (BEAKER_H + 7) / U; // 弹簧测力计挂钩高度（场景单位）
const CROWN_SPAN = 1.395; // 王冠模型的局部总高（冠带 1 + 尖角露出部分）
const CROWN_MID = 0.1975; // 其几何中心相对冠带中心的偏移

export function create(host, panel) {
  const vp = new Viewport(host, {
    cameraPos: [1.05, 1.7, 3.6],
    target: [0, 1.12, 0],
    maxDistance: 14,
    minDistance: 0.8,
  });
  vp.addStandardLights({ keyPos: [3, 7, 5] });
  vp.addGroundGrid({ y: 0, size: 12, divisions: 12 });

  const state = {
    mode: 'single',
    material: 'gold',
    fluid: 'water',
    volume: 120, // cm³
    depth: 0.55, // 浸入比例
    released: false,
  };

  /* ---------------------- 器材 ---------------------- */

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdaf0ff,
    metalness: 0,
    roughness: 0.04,
    transmission: 0.88,
    thickness: 0.3,
    ior: 1.5,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });

  /** 一套「烧杯 + 液体 + 物体 + 弹簧测力计」装置 */
  function makeStation() {
    const group = new THREE.Group();
    vp.scene.add(group);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAKER_R / U, BEAKER_R / U, BEAKER_H / U, 44, 1, true),
      glassMat
    );
    wall.position.y = BEAKER_H / U / 2;
    group.add(wall);

    const bottom = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAKER_R / U, BEAKER_R / U, 0.4 / U, 44),
      glassMat
    );
    bottom.position.y = 0.2 / U;
    group.add(bottom);

    const fluidMat = new THREE.MeshPhysicalMaterial({
      color: FLUIDS.water.color,
      transmission: 0.5,
      thickness: 1.0,
      roughness: 0.08,
      ior: 1.33,
      transparent: true,
      opacity: 0.62,
      metalness: 0,
    });
    const fluid = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 44), fluidMat);
    group.add(fluid);

    // 杯壁刻度：每 2 cm 一格
    const tickPts = [];
    for (let v = 2; v <= BEAKER_H - 2; v += 2) {
      const long = v % 4 === 0;
      const a0 = -0.36;
      const a1 = a0 + (long ? 0.32 : 0.17);
      for (let i = 0; i < 8; i++) {
        const a = a0 + ((a1 - a0) * i) / 8;
        const b = a0 + ((a1 - a0) * (i + 1)) / 8;
        tickPts.push(
          new THREE.Vector3((Math.cos(a) * BEAKER_R) / U, v / U, (Math.sin(a) * BEAKER_R) / U),
          new THREE.Vector3((Math.cos(b) * BEAKER_R) / U, v / U, (Math.sin(b) * BEAKER_R) / U)
        );
      }
    }
    group.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(tickPts),
        new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.8 })
      )
    );

    const objMat = new THREE.MeshStandardMaterial({
      color: MATERIALS.gold.color,
      metalness: 1,
      roughness: 0.18,
      envMapIntensity: 1.35,
    });

    const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), objMat);
    block.castShadow = true;
    group.add(block);

    // 王冠：一圈冠带 + 八个尖角
    // 冠带 y∈[−0.5,0.5]、尖角顶到 0.895，整体下移使外形以原点为中心，
    // 这样按 side/CROWN_SPAN 缩放后总高正好等于等效立方体的边长。
    const crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), objMat);
    band.position.y = -CROWN_MID;
    crown.add(band);
    for (let i = 0; i < 8; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 8), objMat);
      const a = (i / 8) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.94, 0.62 - CROWN_MID, Math.sin(a) * 0.94);
      crown.add(spike);
    }
    group.add(crown);

    const string = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xcbd6ea })
    );
    group.add(string);

    const spring = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xa8b6d4, metalness: 0.9, roughness: 0.25 })
    );
    group.add(spring);

    const scaleBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.2, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x2c3a5c, roughness: 0.6 })
    );
    scaleBody.position.y = HOOK_Y + 0.1;
    group.add(scaleBody);

    const scaleTag = vp.label('', { className: 'tag3d accent', position: [0, HOOK_Y + 0.1, 0.22] });
    group.add(scaleTag);
    const levelTag = vp.label('', { className: 'tag3d warm' });
    group.add(levelTag);
    const titleTag = vp.label('', { className: 'tag3d', position: [0, HOOK_Y + 0.42, 0] });
    group.add(titleTag);

    return { group, fluid, fluidMat, objMat, block, crown, string, spring, scaleBody, scaleTag, levelTag, titleTag };
  }

  const stationA = makeStation();
  const stationB = makeStation();

  // 王冠模式下的水位差参考线
  const deltaLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 0.04, gapSize: 0.03 })
  );
  vp.scene.add(deltaLine);
  const deltaTag = vp.label('', { className: 'tag3d warm' });
  vp.scene.add(deltaTag);

  /* ---------------------- 物理计算 ---------------------- */

  /**
   * @param volume 物体体积 cm³
   * @param rhoObj 物体密度 kg/m³
   * @param rhoFl  液体密度 kg/m³
   * @param sub    浸没体积比例 0~1
   */
  function solve(volume, rhoObj, rhoFl, sub) {
    const V = volume * 1e-6; // m³
    const Gw = rhoObj * V * G; // 重力 N
    const Vsub = V * sub;
    const F = rhoFl * G * Vsub; // 浮力 N
    return {
      V,
      m: rhoObj * V,
      Gw,
      F,
      Vsub,
      apparent: Math.max(0, Gw - F),
      rise: (volume * sub) / AREA, // 液面上升 cm
    };
  }

  const sideOf = (volume) => Math.cbrt(volume); // 立方体边长 cm

  /**
   * 物体沉底时，浸没比例与液面高度互相牵制，迭代几次即可收敛。
   */
  function settleOnBottom(volume, rhoFl) {
    const side = sideOf(volume);
    let sub = 1;
    for (let i = 0; i < 6; i++) {
      const level = BASE_LEVEL + (volume * sub) / AREA;
      sub = clamp((level - 0.4) / side, 0, 1);
    }
    return sub;
  }

  /* ---------------------- 场景更新 ---------------------- */

  function updateStation(st, { volume, matKey, fluidKey, sub, place, title, crownShape }) {
    const mat = MATERIALS[matKey];
    const fl = FLUIDS[fluidKey];
    const r = solve(volume, mat.rho, fl.rho, sub);

    st.objMat.color.setHex(mat.color);
    st.objMat.metalness = mat.metal;
    st.objMat.roughness = mat.rough;
    st.fluidMat.color.setHex(fl.color);

    const level = BASE_LEVEL + r.rise;
    st.fluid.geometry.dispose();
    st.fluid.geometry = new THREE.CylinderGeometry(
      (BEAKER_R - 0.1) / U,
      (BEAKER_R - 0.1) / U,
      level / U,
      44
    );
    st.fluid.position.y = level / U / 2;

    // 物体外形
    const side = sideOf(volume);
    st.block.visible = !crownShape;
    st.crown.visible = crownShape;
    const shown = crownShape ? st.crown : st.block;
    if (crownShape) {
      const h = side / CROWN_SPAN; // 缩放后王冠总高 = side
      const rr = Math.sqrt(volume / (Math.PI * side)); // 与体积相当的冠带半径
      st.crown.scale.set(rr / U, h / U, rr / U);
    } else {
      st.block.scale.setScalar(side / U);
    }

    // 竖直位置：沉底时贴着杯底，其余情况按浸入比例挂在液面处
    const centerY = place === 'bottom' ? 0.4 + side / 2 : level - sub * side + side / 2;
    shown.position.y = centerY / U;

    // 弹簧测力计（松手后隐藏）
    const hanging = place === 'hang';
    st.spring.visible = hanging;
    st.string.visible = hanging;
    st.scaleBody.visible = hanging;
    if (hanging) {
      const springTop = HOOK_Y;
      const springBottom = springTop - 0.1 - clamp(r.apparent * 0.004, 0, 0.34);
      st.string.geometry.dispose();
      st.string.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, springBottom, 0),
        new THREE.Vector3(0, (centerY + side / 2) / U, 0),
      ]);

      const turns = 12;
      const pts = [];
      for (let i = 0; i <= turns * 12; i++) {
        const t = i / (turns * 12);
        const a = t * turns * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            Math.cos(a) * 0.045,
            springTop + (springBottom - springTop) * t,
            Math.sin(a) * 0.045
          )
        );
      }
      st.spring.geometry.dispose();
      st.spring.geometry = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts),
        turns * 12,
        0.007,
        6,
        false
      );
    }

    st.scaleTag.visible = hanging;
    st.scaleTag.element.textContent = `示数 ${fx(r.apparent, 2)} N`;
    st.levelTag.element.textContent = `液面 ${fx(level, 2)} cm`;
    st.levelTag.position.set(-(BEAKER_R + 2.6) / U, level / U, 0);
    st.titleTag.element.textContent = title || '';
    st.titleTag.visible = !!title;

    return { ...r, level, side };
  }

  function update() {
    const single = state.mode === 'single';
    stationB.group.visible = !single;
    deltaLine.visible = !single;
    deltaTag.visible = !single;
    stationA.group.position.x = single ? 0 : -0.75;
    stationB.group.position.x = 0.75;

    if (single) {
      const mat = MATERIALS[state.material];
      const fl = FLUIDS[state.fluid];
      let sub = state.depth;
      let place = 'hang';
      if (state.released) {
        if (mat.rho < fl.rho) {
          sub = mat.rho / fl.rho; // 漂浮：浸入比例 = 密度比
          place = 'float';
        } else {
          sub = settleOnBottom(state.volume, fl.rho);
          place = 'bottom';
        }
      }
      const r = updateStation(stationA, {
        volume: state.volume,
        matKey: state.material,
        fluidKey: state.fluid,
        sub,
        place,
        title: '',
        crownShape: state.material === 'crown',
      });
      updateStats(r, sub);
    } else {
      // 王冠之谜：两块质量都是 2 kg
      const mass = 2.0;
      const vGold = (mass / MATERIALS.gold.rho) * 1e6;
      const vCrown = (mass / MATERIALS.crown.rho) * 1e6;
      const a = updateStation(stationA, {
        volume: vGold,
        matKey: 'gold',
        fluidKey: state.fluid,
        sub: 1,
        place: 'hang',
        title: '纯金块 2 kg',
        crownShape: false,
      });
      const b = updateStation(stationB, {
        volume: vCrown,
        matKey: 'crown',
        fluidKey: state.fluid,
        sub: 1,
        place: 'hang',
        title: '王冠 2 kg',
        crownShape: true,
      });

      // 把纯金块的液面高度横向拉过去，直观显示水位差
      deltaLine.geometry.dispose();
      deltaLine.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.75 - BEAKER_R / U, a.level / U, 0),
        new THREE.Vector3(0.75 + BEAKER_R / U, a.level / U, 0),
      ]);
      deltaLine.computeLineDistances();
      deltaTag.position.set(0.75, (a.level + (b.level - a.level) / 2) / U, 0.62);
      deltaTag.element.textContent = `水位差 ${fx(b.level - a.level, 2)} cm`;
      updateCrownStats(a, b, vGold, vCrown);
    }
  }

  /* ---------------------- 侧边栏 ---------------------- */

  panel.section('实验控制');

  panel.segmented({
    label: '实验模式',
    value: 'single',
    options: [
      { value: 'single', label: '浮力探究' },
      { value: 'crown', label: '王冠之谜' },
    ],
    onChange: (v) => {
      state.mode = v;
      state.released = false;
      const showSingle = v === 'single';
      for (const el of [matCtl.el, volCtl.el, depthCtl.el, btnRow, singleSec]) {
        el.style.display = showSingle ? '' : 'none';
      }
      crownSec.style.display = showSingle ? 'none' : '';
      depthCtl.set(55);
      state.depth = 0.55;
      update();
      vp.flyTo(showSingle ? [1.05, 1.7, 3.6] : [0.15, 2.1, 5.0], [0, 1.12, 0], 0.8);
    },
  });

  const matCtl = panel.segmented({
    label: '物体材料',
    value: 'gold',
    options: Object.entries(MATERIALS).map(([k, v]) => ({ value: k, label: v.name })),
    onChange: (v) => {
      state.material = v;
      update();
    },
  });

  const volCtl = panel.slider({
    label: '物体体积 V',
    min: 40,
    max: 300,
    step: 5,
    value: 120,
    fmt: (v) => `${v} cm³`,
    onInput: (v) => {
      state.volume = v;
      update();
    },
  });

  panel.segmented({
    label: '液体',
    value: 'water',
    options: Object.entries(FLUIDS).map(([k, v]) => ({ value: k, label: v.name })),
    onChange: (v) => {
      state.fluid = v;
      update();
    },
  });

  const depthCtl = panel.slider({
    label: '浸入深度',
    min: 0,
    max: 100,
    step: 1,
    value: 55,
    fmt: (v) => `${v}%`,
    onInput: (v) => {
      state.depth = v / 100;
      state.released = false;
      update();
    },
  });

  const btnRow = panel.buttons([
    {
      key: 'release',
      label: '松手 · 看沉浮',
      primary: true,
      onClick: () => {
        state.released = true;
        update();
      },
    },
    {
      key: 'hang',
      label: '重新挂上',
      onClick: () => {
        state.released = false;
        update();
      },
    },
  ]).release.parentElement;

  panel.section('实时数据');
  const singleSec = panel.current;
  const stats = panel.statGrid();
  const sG = stats.add('物体重力 G', { unit: 'N' });
  const sRho = stats.add('物体密度', { unit: 'kg/m³' });
  const sVsub = stats.add('排开液体体积', { unit: 'cm³', hi: true });
  const sF = stats.add('浮力 F浮', { unit: 'N', hi: true });
  const sW = stats.add('排开液体的重力', { unit: 'N' });
  const sApp = stats.add('测力计示数', { unit: 'N' });
  const sRise = stats.add('液面上升', { unit: 'cm' });
  const sState = stats.add('沉浮状态', {});

  panel.section('王冠之谜 · 对比');
  const crownSec = panel.current;
  const cstats = panel.statGrid();
  const cVg = cstats.add('纯金块体积', { unit: 'cm³' });
  const cVc = cstats.add('王冠体积', { unit: 'cm³', hi: true });
  const cFg = cstats.add('纯金块浮力', { unit: 'N' });
  const cFc = cstats.add('王冠浮力', { unit: 'N', hi: true });
  const cRg = cstats.add('纯金块液面上升', { unit: 'cm' });
  const cRc = cstats.add('王冠液面上升', { unit: 'cm', hi: true });
  const cVerdict = cstats.add('结论', { wide: true });
  crownSec.style.display = 'none';

  function updateStats(r, sub) {
    const mat = MATERIALS[state.material];
    const fl = FLUIDS[state.fluid];
    sG.set(fx(r.Gw, 2));
    sRho.set(mat.rho);
    sVsub.set(fx(state.volume * sub, 1));
    sF.set(fx(r.F, 3));
    sW.set(fx(fl.rho * r.Vsub * G, 3));
    sApp.set(fx(r.apparent, 3));
    sRise.set(fx(r.rise, 2));
    if (!state.released) {
      sState.set(sub >= 0.999 ? '完全浸没' : sub <= 0.001 ? '悬在空中' : '部分浸入');
    } else if (mat.rho < fl.rho) {
      sState.set(`漂浮 · 露出 ${fx((1 - mat.rho / fl.rho) * 100, 0)}%`);
    } else {
      sState.set('沉底');
    }
  }

  function updateCrownStats(a, b, vGold, vCrown) {
    cVg.set(fx(vGold, 1));
    cVc.set(fx(vCrown, 1));
    cFg.set(fx(a.F, 3));
    cFc.set(fx(b.F, 3));
    cRg.set(fx(a.rise, 2));
    cRc.set(fx(b.rise, 2));
    cVerdict.set(
      `同样是 2 kg，王冠却多排开 <b>${fx(vCrown - vGold, 1)} cm³</b> 液体，
       密度只有 ${MATERIALS.crown.rho} kg/m³，远低于纯金的 ${MATERIALS.gold.rho} —— <b>掺假了</b>`
    );
  }

  panel.section('实验原理');
  panel.html(`
    <p><b>阿基米德原理：</b>浸在液体中的物体受到竖直向上的浮力，
    大小等于它<b>排开的液体所受的重力</b>。</p>
    <span class="formula">F浮 = G排 = ρ液 · g · V排</span>
    <p>公式里只有<b>液体密度</b>和<b>排开的体积</b>——与物体本身的密度、形状、
    以及浸入多深都没有关系。对照右侧读数：<b>浮力</b>与<b>排开液体的重力</b>始终相等。</p>
    <p>用弹簧测力计称量时读到的是<b>视重</b>：</p>
    <span class="formula">F示 = G − F浮 = (ρ物 − ρ液)·g·V　（完全浸没时）</span>
    <p>由此得到<b>沉浮条件</b>：ρ物 &gt; ρ液 下沉；ρ物 = ρ液 悬浮；ρ物 &lt; ρ液 上浮，
    最终漂浮时<b>浸入水中的体积比例正好等于 ρ物 / ρ液</b>。
    试试冰（917）在水（1000）里——露出水面约 8.3%，这就是"冰山一角"。
    再试试把铁块放进水银，连铁都会浮起来。</p>
  `);
  panel.callout(`
    <b>王冠之谜</b><br />
    国王怀疑工匠在金冠里掺了银，但王冠<b>不能损坏</b>。阿基米德想通的是：
    等质量的纯金与掺银王冠，密度不同 ⇒ 体积不同 ⇒ <b>排开的水不同</b>。
    切到"王冠之谜"模式，看看两只质量相同的物体让液面各升高了多少。
  `);

  panel.section('历史背景');
  panel.html(`
    <p>公元前 3 世纪，叙拉古国王希伦二世请工匠打造纯金王冠，完工后怀疑对方掺了银，
    于是委托阿基米德在不损坏王冠的前提下查明真相。</p>
    <p>据维特鲁威记载，阿基米德在浴盆里注意到身体浸入时水会溢出，
    突然意识到<b>排开水的体积正等于浸入部分的体积</b>，于是赤身跑上街高呼
    "Eureka（我找到了）"。</p>
    <p>他在《论浮体》中把这一发现整理成严格的命题，这是流体静力学的开端。
    今天造船的排水量、潜艇的沉浮、热气球的升空，用的仍是同一条原理。</p>
  `);

  update();

  return { dispose: () => vp.dispose() };
}
