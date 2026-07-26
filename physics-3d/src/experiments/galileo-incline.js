import * as THREE from 'three';
import { Viewport } from '../core/Viewport.js';
import { G, rad, deg, fx, clamp } from '../core/physics.js';

/* ============================================================
   伽利略斜面实验 (1604)
   ------------------------------------------------------------
   斜面把重力"冲淡"：沿斜面方向的加速度 a = g·sinθ，
   于是自由落体被放慢到用当时的水钟就能测量的程度。
   伽利略由此得到 s = ½at²，并用等时间隔位移比 1:3:5:7 验证。
   ============================================================ */

const L = 4.0; // 斜面长度 (m)
const BALL_R = 0.055; // 小球半径 (m)
const MU = 0.2; // "有摩擦滑块"模式的动摩擦因数

/** 三种运动模型下沿斜面的加速度 */
function accelerationOf(mode, theta) {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  if (mode === 'slide') return G * s; // 理想无摩擦滑块
  if (mode === 'roll') return (5 / 7) * G * s; // 无滑滚动的实心球
  return G * (s - MU * c); // 有摩擦滑块，可能 ≤ 0（静止）
}

export function create(host, panel) {
  const vp = new Viewport(host, {
    cameraPos: [2.5, 2.05, 6.6],
    target: [1.95, 0.95, 0],
    maxDistance: 22,
  });
  vp.addStandardLights({ keyPos: [5, 9, 6] });
  vp.addGroundGrid({ size: 20, divisions: 20 });

  /* ---------------------- 状态 ---------------------- */
  const state = {
    theta: rad(20),
    mode: 'slide',
    running: false,
    t: 0,
    s: 0,
    v: 0,
    timeScale: 0.5,
    showMarks: true,
    compare: true,
    sound: false,
    freeT: 0,
    freeY: 0,
    freeDone: false,
    nextMark: 0,
    finished: false,
  };

  /* ---------------------- 器材 ---------------------- */

  const rampGroup = new THREE.Group(); // 绕原点旋转，局部 +X 指向斜面上方
  vp.scene.add(rampGroup);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.75 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x7c5330, roughness: 0.8 });

  const board = new THREE.Mesh(new THREE.BoxGeometry(L, 0.07, 0.44), woodMat);
  board.position.set(L / 2, -0.035, 0);
  board.castShadow = board.receiveShadow = true;
  rampGroup.add(board);

  // 凹槽两侧的导轨（伽利略在木板上刻了一条羊皮纸衬里的直槽）
  for (const z of [-0.145, 0.145]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.055, 0.045), woodDark);
    rail.position.set(L / 2, 0.027, z);
    rail.castShadow = true;
    rampGroup.add(rail);
  }

  // 运动物体：滚动模式用黄铜球，滑块模式用方块（外层 ball 只负责位置）
  const ball = new THREE.Group();
  rampGroup.add(ball);

  const sphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 40, 28),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.28, metalness: 0.85 })
  );
  sphereMesh.castShadow = true;
  ball.add(sphereMesh);

  const blockMesh = new THREE.Mesh(
    new THREE.BoxGeometry(BALL_R * 2.4, BALL_R * 2, BALL_R * 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.7 })
  );
  blockMesh.castShadow = true;
  ball.add(blockMesh);

  // 速度矢量箭头（沿斜面向下）
  const vArrow = new THREE.ArrowHelper(
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(),
    0.001,
    0x59c1ff,
    0.14,
    0.09
  );
  rampGroup.add(vArrow);

  // 等时标记（伽利略在等时位置系上小铃铛，滚过时"咔"的一声等间隔响起）
  const marks = [];
  for (let k = 1; k <= 4; k++) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.26, 10),
      new THREE.MeshStandardMaterial({ color: 0x5b6b8a, roughness: 0.5, metalness: 0.4 })
    );
    post.position.set(0, 0.13, 0.24);
    g.add(post);
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0xffd166,
        roughness: 0.3,
        metalness: 0.7,
        emissive: 0x000000,
      })
    );
    bell.position.set(0, 0.27, 0.24);
    g.add(bell);
    const tag = vp.label(`t = ${k}Δt`, { className: 'tag3d', position: [0, 0.42, 0.24] });
    g.add(tag);
    rampGroup.add(g);
    marks.push({ group: g, bell, tag, flash: 0 });
  }

  // 相邻标记之间的"位移份数"标签：1 : 3 : 5 : 7
  const gapTags = [];
  for (let k = 0; k < 4; k++) {
    const tag = vp.label(`${2 * k + 1}`, { className: 'tag3d accent', position: [0, 0, -0.3] });
    rampGroup.add(tag);
    gapTags.push(tag);
  }

  // 支撑立柱
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 1, 14),
    new THREE.MeshStandardMaterial({ color: 0x4a5675, roughness: 0.6, metalness: 0.3 })
  );
  post.castShadow = true;
  vp.scene.add(post);

  // 角度圆弧 + 标签
  const arcMat = new THREE.LineBasicMaterial({ color: 0x59c1ff });
  let arcLine = new THREE.Line(new THREE.BufferGeometry(), arcMat);
  vp.scene.add(arcLine);
  const arcTag = vp.label('20°', { className: 'tag3d accent' });
  vp.scene.add(arcTag);

  // 自由落体对比球
  const freeBall = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 22),
    new THREE.MeshStandardMaterial({ color: 0xff8fb1, roughness: 0.3, metalness: 0.6 })
  );
  freeBall.castShadow = true;
  vp.scene.add(freeBall);
  const freeTag = vp.label('自由落体', { className: 'tag3d', position: [0, 0.2, 0] });
  freeBall.add(freeTag);

  // 同高度虚线（提示两球起点等高）
  const guideMat = new THREE.LineDashedMaterial({
    color: 0xff8fb1,
    dashSize: 0.09,
    gapSize: 0.07,
    opacity: 0.7,
    transparent: true,
  });
  let guide = new THREE.Line(new THREE.BufferGeometry(), guideMat);
  vp.scene.add(guide);

  /* ---------------------- 几何更新 ---------------------- */

  function markPositions() {
    // 等时间隔 Δt = T/4 ⇒ s_k = L·k²/16，间隔之比 1:3:5:7
    return [1, 2, 3, 4].map((k) => (L * k * k) / 16);
  }

  function rebuild() {
    const th = state.theta;
    rampGroup.rotation.z = th;

    const topX = L * Math.cos(th);
    const topY = L * Math.sin(th);

    // 支撑柱：撑在斜面高端下方
    post.scale.y = Math.max(0.02, topY);
    post.position.set(topX - 0.12, Math.max(0.01, topY) / 2, 0);

    // 角度圆弧
    const r = 0.75;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (th * i) / 40;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    arcLine.geometry.dispose();
    arcLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    arcTag.position.set(Math.cos(th / 2) * (r + 0.2), Math.sin(th / 2) * (r + 0.2), 0);
    arcTag.element.textContent = `θ = ${Math.round(deg(th))}°`;

    // 等时标记的位置（局部坐标 x = L − s）
    const ms = markPositions();
    marks.forEach((m, i) => {
      m.group.position.x = L - ms[i];
      m.group.visible = state.showMarks;
      m.tag.visible = state.showMarks;
    });
    gapTags.forEach((tag, i) => {
      const from = i === 0 ? 0 : ms[i - 1];
      const to = ms[i];
      tag.position.x = L - (from + to) / 2;
      tag.position.y = 0.02;
      tag.visible = state.showMarks;
    });

    // 自由落体球起点与斜面顶端等高
    freeBall.position.set(topX + 0.55, topY + BALL_R - state.freeY, 0);
    freeBall.visible = state.compare;
    guide.visible = state.compare;
    guide.geometry.dispose();
    guide.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(topX, topY + BALL_R, 0),
      new THREE.Vector3(topX + 0.55, topY + BALL_R, 0),
      new THREE.Vector3(topX + 0.55, BALL_R, 0),
    ]);
    guide.computeLineDistances();

    placeBall();
  }

  function placeBall() {
    const rolling = state.mode === 'roll';
    sphereMesh.visible = rolling;
    blockMesh.visible = !rolling;
    ball.position.set(L - state.s, BALL_R, 0);
    const len = clamp(state.v * 0.16, 0.001, 1.4);
    vArrow.position.set(L - state.s, BALL_R, 0);
    vArrow.setLength(len, Math.min(0.14, len * 0.4), Math.min(0.09, len * 0.28));
    vArrow.visible = state.v > 0.05;
  }

  function reset() {
    state.t = 0;
    state.s = 0;
    state.v = 0;
    state.freeT = 0;
    state.freeY = 0;
    state.freeDone = false;
    state.nextMark = 0;
    state.finished = false;
    state.running = false;
    sphereMesh.rotation.set(0, 0, 0);
    marks.forEach((m) => {
      m.flash = 0;
      m.bell.material.emissive.setHex(0x000000);
    });
    playBtn.textContent = '释放小球';
    rebuild();
    updateStats();
  }

  /* ---------------------- 提示音 ---------------------- */
  let audioCtx = null;
  function ding(freq) {
    if (!state.sound) return;
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain).connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    osc.start(t0);
    osc.stop(t0 + 0.34);
  }

  /* ---------------------- 侧边栏 ---------------------- */

  panel.section('实验控制');

  const angleSlider = panel.slider({
    label: '斜面倾角 θ',
    min: 5,
    max: 45,
    step: 1,
    value: 20,
    fmt: (v) => `${v}°`,
    onInput: (v) => {
      state.theta = rad(v);
      reset();
    },
  });

  panel.segmented({
    label: '运动模型',
    value: 'slide',
    options: [
      { value: 'slide', label: '理想滑块' },
      { value: 'roll', label: '滚动实心球' },
      { value: 'fric', label: `有摩擦 μ=${MU}` },
    ],
    onChange: (v) => {
      state.mode = v;
      reset();
    },
  });

  panel.slider({
    label: '播放速度',
    min: 0.15,
    max: 1.5,
    step: 0.05,
    value: 0.5,
    fmt: (v) => `${v}×`,
    onInput: (v) => (state.timeScale = v),
  });

  const playBtn = panel.buttons([
    {
      key: 'play',
      label: '释放小球',
      primary: true,
      onClick: (btn) => {
        if (state.finished) {
          reset();
          return;
        }
        state.running = !state.running;
        btn.textContent = state.running ? '暂停' : '继续';
      },
    },
    { key: 'reset', label: '重置', onClick: () => reset() },
  ]).play;

  panel.toggle({
    label: '显示等时标记（1:3:5:7）',
    value: true,
    onChange: (v) => {
      state.showMarks = v;
      rebuild();
    },
  });
  panel.toggle({
    label: '同时释放自由落体对比球',
    value: true,
    onChange: (v) => {
      state.compare = v;
      rebuild();
    },
  });
  panel.toggle({
    label: '过铃铛提示音',
    value: false,
    onChange: (v) => (state.sound = v),
  });

  panel.section('实时数据');
  const stats = panel.statGrid();
  const sAccel = stats.add('沿斜面加速度 a', { unit: 'm/s²', hi: true });
  const sTime = stats.add('已用时间 t', { unit: 's' });
  const sDisp = stats.add('位移 s', { unit: 'm' });
  const sVel = stats.add('速度 v', { unit: 'm/s' });
  const sConst = stats.add('2s / t²', { unit: 'm/s²' });
  const sTotal = stats.add('全程用时 T', { unit: 's' });
  const sFree = stats.add('自由落体用时', { unit: 's' });
  const sEnd = stats.add('到达底端速度', { unit: 'm/s' });

  function updateStats() {
    const a = accelerationOf(state.mode, state.theta);
    const h = L * Math.sin(state.theta);
    sAccel.set(a > 0 ? fx(a, 3) : '0（静止）');
    sTime.set(fx(state.t, 2));
    sDisp.set(fx(state.s, 3));
    sVel.set(fx(state.v, 2));
    // 2s/t² 在匀加速运动中恒等于 a，是 s ∝ t² 最直接的证据
    sConst.set(state.t > 0.05 ? fx((2 * state.s) / (state.t * state.t), 3) : '—');
    sTotal.set(a > 0 ? fx(Math.sqrt((2 * L) / a), 2) : '∞');
    sFree.set(fx(Math.sqrt((2 * h) / G), 2));
    sEnd.set(a > 0 ? fx(Math.sqrt(2 * a * L), 2) : '0');
  }

  panel.section('实验原理');
  panel.html(`
    <p>斜面上的物体只受到沿斜面方向的重力分量 <b>mg·sinθ</b>，所以做初速度为零的<b>匀加速直线运动</b>：</p>
    <span class="formula">a = g·sinθ &nbsp;&nbsp; v = at &nbsp;&nbsp; s = ½at²</span>
    <p>由 s = ½at² 可得，从静止开始，<b>相邻等时间隔内的位移之比恒为 1 : 3 : 5 : 7 …</b>（连续奇数），
    与倾角、与小球质量都无关。场景中四个铃铛就装在 t = Δt, 2Δt, 3Δt, 4Δt 的位置上，
    小球滚过它们的时间间隔完全相同。</p>
    <p>选择"滚动实心球"时，一部分能量变成转动动能，实测加速度只有 <b>a = 5/7 · g·sinθ</b>；
    选择"有摩擦滑块"时 <b>a = g(sinθ − μcosθ)</b>，当 tanθ &lt; μ 时物体根本不会下滑。</p>
  `);
  panel.callout(`
    <b>为什么用斜面？</b>17 世纪没有秒表，自由落体太快，无法测量。伽利略用斜面把重力"冲淡"：
    倾角越小，加速度越小，下落被放慢到用水钟（称量流出的水）就能计时。
    再把结论外推到 θ = 90°，就得到了自由落体定律。
  `);

  panel.section('历史背景');
  panel.html(`
    <p>1604 年前后，伽利略在帕多瓦用一条约 12 库比特（约 5.5 m）长的木槽反复实验，
    槽内衬光滑羊皮纸，让黄铜球滚下并称量水钟流出的水量计时。他在《关于两门新科学的对话》中写道，
    实验重复了"整整一百次"，各次测得的比例始终一致。</p>
    <p>这个实验第一次用<b>可重复的定量测量</b>推翻了亚里士多德"重物落得快"的论断，
    也是近代实验物理方法的起点。</p>
  `);

  /* ---------------------- 每帧更新 ---------------------- */

  vp.onFrame((dt) => {
    const a = accelerationOf(state.mode, state.theta);

    if (state.running && !state.finished) {
      const step = dt * state.timeScale;
      if (a > 0) {
        state.t += step;
        state.s = 0.5 * a * state.t * state.t;
        state.v = a * state.t;
        if (state.s >= L) {
          state.s = L;
          state.v = Math.sqrt(2 * a * L);
          state.t = Math.sqrt((2 * L) / a);
          state.finished = true;
          state.running = false;
          playBtn.textContent = '再来一次';
          ding(520);
        }
        // 无滑滚动：ω = v / r（滑块模式不转）
        if (state.mode === 'roll') sphereMesh.rotation.z += (state.v / BALL_R) * step;
      }

      // 自由落体对比球
      if (state.compare && !state.freeDone) {
        const h = L * Math.sin(state.theta);
        state.freeT += step;
        state.freeY = 0.5 * G * state.freeT * state.freeT;
        if (state.freeY >= h) {
          state.freeY = h;
          state.freeDone = true;
          ding(760);
        }
      }

      // 经过铃铛
      const positions = markPositions();
      while (state.nextMark < 4 && state.s >= positions[state.nextMark]) {
        const m = marks[state.nextMark];
        m.flash = 1;
        ding(880 + state.nextMark * 40);
        state.nextMark++;
      }

      placeBall();
      const topX = L * Math.cos(state.theta);
      const topY = L * Math.sin(state.theta);
      freeBall.position.set(topX + 0.55, topY + BALL_R - state.freeY, 0);
      updateStats();
    }

    // 铃铛闪光衰减
    for (const m of marks) {
      if (m.flash > 0) {
        m.flash = Math.max(0, m.flash - dt * 2.2);
        m.bell.material.emissive.setRGB(m.flash * 0.9, m.flash * 0.6, 0);
      }
    }
  });

  rebuild();
  updateStats();
  angleSlider.set(20);

  return { dispose: () => vp.dispose() };
}
