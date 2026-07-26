import * as THREE from 'three';
import { Viewport } from '../core/Viewport.js';
import { rad, deg, fx, clamp, cauchy, wavelengthToRGB, colorName } from '../core/physics.js';

/* ============================================================
   牛顿棱镜色散实验 (1666)
   ------------------------------------------------------------
   场景里的每一条光线都由折射定律实时求解：
   在棱镜的每个界面上按 n₁sinθ₁ = n₂sinθ₂ 计算折射方向，
   而玻璃对不同波长的折射率由柯西公式 n(λ) = A + B/λ² 给出。
   紫光 n 大偏折多、红光 n 小偏折少，白光于是散开成光谱。
   ============================================================ */

const GLASSES = {
  crown: { name: '冕牌玻璃', A: 1.5046, B: 0.0042 },
  flint: { name: '火石玻璃', A: 1.69, B: 0.0135 },
  water: { name: '水', A: 1.324, B: 0.0032 },
};

const PRISM_H = 1.25; // 棱镜截面高度（顶点到底边）
const DEPTH = 0.9; // 棱镜沿 z 方向的厚度
const SRC_X = -3.4; // 光源（暗室窗板狭缝）位置
const SCREEN_W = 1.5; // 光屏宽度（沿 z）
const NM_MIN = 400;
const NM_MAX = 700;
const SAMPLES = 56;

/* ---------------------- 二维光线追踪 ---------------------- */

const v2 = (x, y) => new THREE.Vector2(x, y);

/** 三角形棱镜的三个顶点（世界坐标，逆时针），apex 为顶角 */
export function prismVerts(apex, rot, cx, cy) {
  const b = PRISM_H * Math.tan(apex / 2);
  const raw = [v2(0, PRISM_H / 2), v2(-b, -PRISM_H / 2), v2(b, -PRISM_H / 2)];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return raw.map((p) => v2(p.x * c - p.y * s + cx, p.x * s + p.y * c + cy));
}

/** 多边形的边 + 外法线（顶点按逆时针给出） */
export function polyEdges(verts) {
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const e = v2(b.x - a.x, b.y - a.y);
    const n = v2(e.y, -e.x).normalize(); // 逆时针多边形 ⇒ 该向量朝外
    edges.push({ a, b, e, n });
  }
  return edges;
}

function nearestHit(p, d, polys) {
  let best = null;
  for (const poly of polys) {
    for (const ed of poly.edges) {
      const denom = d.x * ed.e.y - d.y * ed.e.x;
      if (Math.abs(denom) < 1e-12) continue;
      const ax = ed.a.x - p.x;
      const ay = ed.a.y - p.y;
      const t = (ax * ed.e.y - ay * ed.e.x) / denom;
      const u = (ax * d.y - ay * d.x) / denom;
      if (t > 1e-5 && u >= -1e-6 && u <= 1 + 1e-6 && (!best || t < best.t)) {
        best = { t, point: v2(p.x + d.x * t, p.y + d.y * t), n: ed.n };
      }
    }
  }
  return best;
}

/** 折射：I 为入射单位向量，N 为指向入射侧的单位法线，eta = n₁/n₂ */
function refract2(I, N, eta) {
  const cosi = -I.dot(N);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null; // 全反射
  return v2(
    eta * I.x + (eta * cosi - Math.sqrt(k)) * N.x,
    eta * I.y + (eta * cosi - Math.sqrt(k)) * N.y
  );
}

function reflect2(I, N) {
  const dot = I.dot(N);
  return v2(I.x - 2 * dot * N.x, I.y - 2 * dot * N.y);
}

/**
 * 让一条光线穿过若干棱镜，直到不再遇到任何界面。
 * @returns {{pts: THREE.Vector2[], p: THREE.Vector2, d: THREE.Vector2, tir: boolean}}
 */
export function tracePrisms(origin, dir, polys, n, maxBounce = 8) {
  const pts = [origin.clone()];
  let p = origin.clone();
  let d = dir.clone().normalize();
  let tir = false;

  for (let i = 0; i < maxBounce; i++) {
    const hit = nearestHit(p, d, polys);
    if (!hit) break;
    pts.push(hit.point.clone());
    const entering = hit.n.dot(d) < 0;
    const N = entering ? hit.n.clone() : hit.n.clone().negate();
    const eta = entering ? 1 / n : n;
    const refracted = refract2(d, N, eta);
    if (!refracted) tir = true;
    d = refracted || reflect2(d, N);
    p = v2(hit.point.x + d.x * 1e-4, hit.point.y + d.y * 1e-4);
  }
  return { pts, p, d, tir };
}

/** 光线与一块平面屏（过 Q、法线 N）的交点，返回沿屏面方向的偏移量 u */
function hitScreenPlane(p, d, Q, N) {
  const denom = d.dot(N);
  if (Math.abs(denom) < 1e-6) return null;
  const t = Q.clone().sub(p).dot(N) / denom;
  if (t <= 0) return null;
  const point = v2(p.x + d.x * t, p.y + d.y * t);
  const u = v2(-N.y, N.x); // 屏面内的方向
  return { point, u: point.clone().sub(Q).dot(u), dist: t };
}

/* ---------------------- 实验场景 ---------------------- */

export function create(host, panel) {
  const vp = new Viewport(host, {
    cameraPos: [0.8, 0.6, 8.4],
    target: [1.0, -1.1, 0],
    background: 0x04060d,
    maxDistance: 40,
    fog: false,
    shadows: false,
    environmentIntensity: 0.35,
  });
  vp.addStandardLights({ intensity: 0.45, ambient: 0.35, keyPos: [2, 7, 6] });

  const state = {
    mode: 'single',
    incidence: rad(42),
    apex: rad(60),
    glass: 'crown',
    dist: 3.6,
    slitNm: 620,
    showNormals: true,
  };

  /* ---------------------- 器材 ---------------------- */

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff0ff,
    metalness: 0,
    roughness: 0.03,
    ior: 1.5,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  function makePrism() {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), glassMat);
    const edges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8 })
    );
    const group = new THREE.Group();
    group.add(mesh, edges);
    vp.scene.add(group);
    return { group, mesh, edges };
  }

  const prism1 = makePrism();
  const prism2 = makePrism();

  function shapePrism(prismObj, apex, rot, cx, cy) {
    const b = PRISM_H * Math.tan(apex / 2);
    const shape = new THREE.Shape();
    shape.moveTo(0, PRISM_H / 2);
    shape.lineTo(-b, -PRISM_H / 2);
    shape.lineTo(b, -PRISM_H / 2);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false });
    geo.translate(0, 0, -DEPTH / 2);
    prismObj.mesh.geometry.dispose();
    prismObj.mesh.geometry = geo;
    prismObj.edges.geometry.dispose();
    prismObj.edges.geometry = new THREE.EdgesGeometry(geo, 20);
    prismObj.group.position.set(cx, cy, 0);
    prismObj.group.rotation.z = rot;
  }

  // 暗室窗板与狭缝
  const shutter = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 3.2, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x18203a, roughness: 0.9 })
  );
  shutter.position.set(SRC_X, 0, 0);
  vp.scene.add(shutter);
  vp.scene.add(vp.label('暗室窗板上的狭缝', { className: 'tag3d', position: [SRC_X, 0.62, 0] }));

  const beamMat = (color, opacity = 0.9) =>
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

  const whiteBeam = new THREE.Line(new THREE.BufferGeometry(), beamMat(0xffffff, 0.95));
  vp.scene.add(whiteBeam);

  const rayLines = [];
  for (let i = 0; i < SAMPLES; i++) {
    const nm = NM_MIN + ((NM_MAX - NM_MIN) * i) / (SAMPLES - 1);
    const [r, g, b] = wavelengthToRGB(nm);
    const line = new THREE.Line(new THREE.BufferGeometry(), beamMat(new THREE.Color(r, g, b)));
    vp.scene.add(line);
    rayLines.push({ nm, line });
  }

  const secondLine = new THREE.Line(new THREE.BufferGeometry(), beamMat(0xffffff));
  vp.scene.add(secondLine);

  // 法线与角度标注
  const normalLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0x8fa4cc, dashSize: 0.08, gapSize: 0.06 })
  );
  vp.scene.add(normalLine);
  const angleTag1 = vp.label('', { className: 'tag3d' });
  const angleTag2 = vp.label('', { className: 'tag3d' });
  vp.scene.add(angleTag1, angleTag2);

  /* ---------------------- 光屏 ---------------------- */

  function makeScreen(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 512;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.PlaneGeometry(SCREEN_W, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture }));
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x51689a })
    );
    const group = new THREE.Group();
    group.add(mesh, frame);
    vp.scene.add(group);

    const tag = vp.label(label, { className: 'tag3d' });
    vp.scene.add(tag);
    return { group, mesh, frame, tag, canvas, texture, ctx: canvas.getContext('2d'), height: 1 };
  }

  const screenA = makeScreen('光屏');
  const screenB = makeScreen('第二光屏');

  /** 把屏摆到 Q 处并让它正对光束（法线 = −dir） */
  function placeScreen(screen, Q, dir, height, labelText) {
    const yAxis = new THREE.Vector3(-dir.y, dir.x, 0).normalize(); // 屏面内竖直方向
    const zAxis = new THREE.Vector3(-dir.x, -dir.y, 0).normalize(); // 屏的法线
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    screen.group.quaternion.setFromRotationMatrix(m);
    screen.group.position.set(Q.x, Q.y, 0);
    screen.group.scale.set(1, height, 1);
    screen.height = height;
    screen.tag.position.set(
      Q.x + yAxis.x * (height / 2 + 0.22),
      Q.y + yAxis.y * (height / 2 + 0.22),
      0
    );
    if (labelText) screen.tag.element.textContent = labelText;
  }

  /** hits: [{nm, u}]，u 为落点相对屏中心的偏移(m)；hole 为光阑位置 */
  function paintScreen(screen, hits, hole) {
    const { ctx, canvas, height } = screen;
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#0a0e18';
    ctx.fillRect(0, 0, W, H);

    const toV = (u) => ((height / 2 - u) / height) * H;

    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(4px)';
    for (const hit of hits) {
      const v = toV(hit.u);
      if (v < -20 || v > H + 20) continue;
      const [r, g, b] = wavelengthToRGB(hit.nm);
      ctx.fillStyle = `rgb(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0})`;
      ctx.fillRect(0, v - 6, W, 12);
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    if (hole != null) {
      const v = toV(hole);
      ctx.fillStyle = '#04060c';
      ctx.fillRect(0, v - 8, W, 16);
      ctx.strokeStyle = '#6d82ad';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, v - 8, W - 2, 16);
    }
    screen.texture.needsUpdate = true;
  }

  /* ---------------------- 主计算 ---------------------- */

  let readout = null;

  function compute() {
    const glass = GLASSES[state.glass];
    const apex = state.apex;
    // 入射光保持水平（射进暗室的一束阳光），靠转动棱镜来改变入射角
    const rot = apex / 2 - state.incidence;

    const verts1 = prismVerts(apex, rot, 0, 0);
    const poly1 = { edges: polyEdges(verts1) };
    shapePrism(prism1, apex, rot, 0, 0);

    const entry = v2((verts1[0].x + verts1[1].x) / 2, (verts1[0].y + verts1[1].y) / 2);
    const origin = v2(SRC_X, entry.y);
    const inDir = v2(1, 0);

    // ---- 逐波长穿过棱镜 1 ----
    const traced = rayLines.map(({ nm }) => {
      const n = cauchy(nm, glass.A, glass.B);
      return { nm, n, res: tracePrisms(origin.clone(), inDir.clone(), [poly1], n) };
    });

    // 以中间波长的出射方向作为光屏的朝向
    const mid = traced[Math.floor(SAMPLES / 2)];
    const beamDir = mid.res.d.clone().normalize();
    const Q1 = v2(mid.res.p.x + beamDir.x * state.dist, mid.res.p.y + beamDir.y * state.dist);
    const N1 = v2(-beamDir.x, -beamDir.y);

    // ---- 各色光在屏上的落点 ----
    const hits = [];
    for (const item of traced) {
      item.hit = hitScreenPlane(item.res.p, item.res.d, Q1, N1);
      if (item.hit) hits.push({ nm: item.nm, u: item.hit.u });
    }
    const us = hits.map((h) => h.u);
    const band = us.length > 1 ? Math.max(...us) - Math.min(...us) : 0;
    const screenH = clamp(band * 2.6, 0.35, 2.4);
    const twoStage = state.mode === 'crucis';
    placeScreen(screenA, Q1, beamDir, screenH, twoStage ? '带孔光阑（第一光屏）' : '光屏');

    // ---- 判决性实验：光阑选出一种颜色，再送入第二块棱镜 ----
    let picked = null;
    let second = null;
    if (twoStage) {
      let best = Infinity;
      for (const item of traced) {
        const d = Math.abs(item.nm - state.slitNm);
        if (item.hit && d < best) {
          best = d;
          picked = item;
        }
      }
    }
    if (picked) {
      const p0 = picked.hit.point;
      const d0 = picked.res.d.clone().normalize();
      const c2 = v2(p0.x + d0.x * 1.5, p0.y + d0.y * 1.5); // 棱镜 2 摆在这条光线的必经之处
      const verts2 = prismVerts(apex, rot, c2.x, c2.y);
      shapePrism(prism2, apex, rot, c2.x, c2.y);
      prism2.group.visible = true;

      const res2 = tracePrisms(p0.clone(), d0, [{ edges: polyEdges(verts2) }], picked.n);
      const dir2 = res2.d.clone().normalize();
      const Q2 = v2(res2.p.x + dir2.x * 1.8, res2.p.y + dir2.y * 1.8);
      const hit2 = hitScreenPlane(res2.p, res2.d, Q2, v2(-dir2.x, -dir2.y));
      placeScreen(screenB, Q2, dir2, 0.5, '第二光屏');
      second = { res2, dir2, hit2, dirIn: d0.clone() };

      const pts = res2.pts.map((p) => new THREE.Vector3(p.x, p.y, 0));
      if (hit2) pts.push(new THREE.Vector3(hit2.point.x, hit2.point.y, 0));
      const [r, g, b] = wavelengthToRGB(picked.nm);
      secondLine.material.color.setRGB(r, g, b);
      secondLine.geometry.dispose();
      secondLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      secondLine.visible = true;
      paintScreen(screenB, hit2 ? [{ nm: picked.nm, u: hit2.u }] : []);
    } else {
      prism2.group.visible = false;
      secondLine.visible = false;
    }
    screenB.group.visible = !!picked;
    screenB.tag.visible = !!picked;

    // ---- 绘制光线 ----
    whiteBeam.geometry.dispose();
    whiteBeam.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, 0),
      new THREE.Vector3(entry.x, entry.y, 0),
    ]);

    rayLines.forEach(({ line }, i) => {
      const item = traced[i];
      const pts = item.res.pts.slice(1).map((p) => new THREE.Vector3(p.x, p.y, 0));
      if (item.hit) pts.push(new THREE.Vector3(item.hit.point.x, item.hit.point.y, 0));
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      line.material.opacity = picked && Math.abs(item.nm - picked.nm) > 6 ? 0.3 : 0.92;
    });

    paintScreen(screenA, hits, picked ? picked.hit.u : null);

    // ---- 法线与角度 ----
    const faceN = poly1.edges[0].n;
    normalLine.visible = state.showNormals;
    angleTag1.visible = state.showNormals;
    angleTag2.visible = state.showNormals;
    if (state.showNormals) {
      normalLine.geometry.dispose();
      normalLine.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(entry.x + faceN.x, entry.y + faceN.y, 0),
        new THREE.Vector3(entry.x - faceN.x, entry.y - faceN.y, 0),
      ]);
      normalLine.computeLineDistances();
      const nMid = cauchy(589, glass.A, glass.B);
      angleTag1.element.textContent = `θ₁ = ${Math.round(deg(state.incidence))}°`;
      angleTag1.position.set(entry.x - 0.62, entry.y + 0.46, 0);
      angleTag2.element.textContent = `θ₂ = ${fx(deg(Math.asin(Math.sin(state.incidence) / nMid)), 1)}°`;
      angleTag2.position.set(entry.x + 0.5, entry.y - 0.34, 0);
    }

    readout = { glass, traced, band, picked, second, Q1, entry };
    updateStats();
  }

  function reframe() {
    if (!readout) return;
    const { Q1, second } = readout;
    const far = second?.hit2?.point ?? Q1;
    const cx = (SRC_X + far.x) / 2;
    const cy = (0 + far.y) / 2;
    const span = Math.hypot(far.x - SRC_X, far.y) + 2.6;
    vp.flyTo([cx + span * 0.02, cy + span * 0.2, span * 0.72], [cx, cy, 0], 0.9);
  }

  /* ---------------------- 侧边栏 ---------------------- */

  panel.section('实验控制');

  panel.segmented({
    label: '实验模式',
    value: 'single',
    options: [
      { value: 'single', label: '单棱镜色散' },
      { value: 'crucis', label: '判决性实验' },
    ],
    onChange: (v) => {
      state.mode = v;
      slitCtl.el.style.display = v === 'crucis' ? '' : 'none';
      compute();
      reframe();
    },
  });

  panel.slider({
    label: '入射角 θ₁',
    min: 15,
    max: 72,
    step: 1,
    value: 42,
    fmt: (v) => `${v}°`,
    onInput: (v) => {
      state.incidence = rad(v);
      compute();
    },
  });

  panel.slider({
    label: '棱镜顶角 A',
    min: 30,
    max: 75,
    step: 1,
    value: 60,
    fmt: (v) => `${v}°`,
    onInput: (v) => {
      state.apex = rad(v);
      compute();
    },
  });

  panel.slider({
    label: '棱镜到光屏的距离',
    min: 1,
    max: 7,
    step: 0.1,
    value: 3.6,
    fmt: (v) => `${fx(v, 1)} m`,
    onInput: (v) => {
      state.dist = v;
      compute();
    },
  });

  panel.segmented({
    label: '棱镜材料',
    value: 'crown',
    options: [
      { value: 'crown', label: '冕牌玻璃' },
      { value: 'flint', label: '火石玻璃' },
      { value: 'water', label: '水' },
    ],
    onChange: (v) => {
      state.glass = v;
      compute();
    },
  });

  const slitCtl = panel.slider({
    label: '光阑选出的颜色',
    min: NM_MIN,
    max: NM_MAX,
    step: 1,
    value: 620,
    fmt: (v) => `${v} nm · ${colorName(v)}`,
    onInput: (v) => {
      state.slitNm = v;
      compute();
    },
  });
  slitCtl.el.style.display = 'none';

  panel.toggle({
    label: '显示法线与折射角',
    value: true,
    onChange: (v) => {
      state.showNormals = v;
      compute();
    },
  });

  panel.buttons([{ label: '重新取景', onClick: () => reframe() }]);

  panel.section('实时数据');
  const stats = panel.statGrid();
  const sNr = stats.add('红光折射率 n₍₆₈₀₎', {});
  const sNv = stats.add('紫光折射率 n₍₄₁₀₎', {});
  const sDr = stats.add('红光偏向角', { unit: '°' });
  const sDv = stats.add('紫光偏向角', { unit: '°' });
  const sSpread = stats.add('角色散 Δδ', { unit: '°', hi: true });
  const sBand = stats.add('光屏上光带长', { unit: 'cm', hi: true });
  const sPick = stats.add('光阑选出的单色光', { wide: true });

  const deviationOf = (item) => deg(Math.acos(clamp(item.res.d.x, -1, 1)));

  function updateStats() {
    if (!readout) return;
    const { glass, traced, band, picked, second } = readout;
    sNr.set(fx(cauchy(680, glass.A, glass.B), 4));
    sNv.set(fx(cauchy(410, glass.A, glass.B), 4));
    sDr.set(fx(deviationOf(traced[traced.length - 3]), 2));
    sDv.set(fx(deviationOf(traced[2]), 2));
    sSpread.set(fx(Math.abs(deviationOf(traced[2]) - deviationOf(traced[traced.length - 3])), 2));
    sBand.set(band > 0 ? fx(band * 100, 1) : '—');

    if (picked && second) {
      // 第二块棱镜自身造成的偏折：入射方向与出射方向的夹角
      const d2 = fx(deg(Math.acos(clamp(second.dirIn.dot(second.dir2), -1, 1))), 1);
      sPick.set(
        `${picked.nm | 0} nm ${colorName(picked.nm)}光 → 被第二块棱镜再偏折 ${d2}°，<b>颜色不变、不再分解</b>`
      );
    } else {
      sPick.set('切换到"判决性实验"启用');
    }
  }

  panel.section('实验原理');
  panel.html(`
    <p>光斜射入玻璃会发生折射，遵循折射定律：</p>
    <span class="formula">n₁·sinθ₁ = n₂·sinθ₂</span>
    <p>关键在于：同一块玻璃对不同颜色的光，折射率<b>并不相同</b>。波长越短，折射率越大：</p>
    <span class="formula">n(λ) = A + B / λ²　（柯西公式）</span>
    <p>所以紫光偏折最厉害、红光最少。棱镜的两个折射面让偏折叠加，白光穿过后就按
    <b>红橙黄绿蓝靛紫</b>散开成一条光带——这就是<b>色散</b>。</p>
    <p>拉动"棱镜到光屏的距离"可以看到：角色散 Δδ 是固定的，但距离越远，
    光带被拉得越长（光带长 ≈ 距离 × tanΔδ）。把材料换成火石玻璃，色散会明显变宽；
    换成水，折射率和色散都变小——彩虹正是阳光在小水滴中色散的结果。</p>
  `);
  panel.callout(`
    <b>判决性实验（experimentum crucis）</b><br />
    当时流行的看法是"玻璃把白光染上了颜色"。牛顿在光屏上开一个小孔，
    只让<b>一种颜色</b>的光通过，再射入第二块棱镜——结果它只是整体又偏折了一些，
    <b>颜色没变，也没有再分解</b>。这说明颜色是光本身的属性，白光才是七色光的混合。
  `);

  panel.section('历史背景');
  panel.html(`
    <p>1666 年，剑桥因瘟疫停课，23 岁的牛顿回到乡下老家。他在窗板上开了一个小孔，
    让一束阳光射进暗室，穿过三棱镜后在对面墙上得到一条长长的彩色光带。</p>
    <p>他把这条光带称为 <b>spectrum</b>（光谱）——这个词沿用至今。这一年后来被称为牛顿的"奇迹年"：
    微积分、万有引力和光的色散都始于此。这项研究也直接促使他放弃折射望远镜，
    转而发明了<b>反射望远镜</b>，因为反射不会产生色散造成的彩色边缘。</p>
  `);

  compute();
  reframe();

  return { dispose: () => vp.dispose() };
}
