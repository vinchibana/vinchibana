import './styles.css';
import { experiments, findExperiment } from './experiments/registry.js';
import { Panel } from './core/ui.js';

const app = document.querySelector('#app');

let activeExperiment = null; // 当前实验实例（含 dispose）

/* ----------------------------- 应用外壳 ----------------------------- */

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand" data-link="">
        <span class="dot"></span><span>经典物理实验 · 3D 实验室</span>
      </div>
      <div class="spacer"></div>
      <nav id="nav"></nav>
    </header>
    <div id="view"></div>
  `;

  const nav = app.querySelector('#nav');
  nav.innerHTML =
    `<a data-link="" href="#/">全部实验</a>` +
    experiments
      .map((e) => `<a data-link="${e.id}" href="#/${e.id}">${e.title.replace('实验', '')}</a>`)
      .join('');

  app.querySelector('.brand').addEventListener('click', () => {
    location.hash = '#/';
  });
}

function syncNav(id) {
  app.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.link === (id ?? ''));
  });
}

/* ------------------------------ 首页 ------------------------------ */

function renderHome(view) {
  view.innerHTML = `
    <div class="home">
      <div class="hero">
        <div class="tagline">🔬 five classic experiments · 可交互的 3D 复现</div>
        <h1>把课本里的经典实验<br />搬进浏览器</h1>
        <p>
          五个改变了物理学面貌、又完全在初高中知识范围内的实验。每一个都用 three.js
          重建了真实器材与真实数据：拖动鼠标绕着实验台观察，调节参数，看物理规律怎样自己显现出来。
        </p>
      </div>
      <div class="card-grid">
        ${experiments
          .map(
            (e, i) => `
          <div class="card" data-go="${e.id}" style="--glow:${e.accent}">
            <span class="idx">EXPERIMENT ${String(i + 1).padStart(2, '0')} · ${e.year}</span>
            <h3>${e.title}</h3>
            <span class="who">${e.scientist} · ${e.field}</span>
            <p>${e.summary}</p>
            <div class="chips">${e.tags.map((t) => `<span class="chip">${t}</span>`).join('')}</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="home-foot">
        <p>
          说明：所有场景中的运动、折射、磁场与浮力都由真实公式实时计算，而非预录动画；
          数值取自标准中学物理教材（<code>g = 9.8 m/s²</code>、<code>p₀ = 101.325 kPa</code>、<code>ρ水银 = 13.6 g/cm³</code> 等）。
        </p>
        <p>技术栈：three.js · Vite · 原生 ES 模块，无任何后端依赖。</p>
      </div>
    </div>
  `;

  view.querySelectorAll('[data-go]').forEach((card) => {
    card.addEventListener('click', () => {
      location.hash = `#/${card.dataset.go}`;
    });
  });
}

/* ----------------------------- 实验页 ----------------------------- */

async function renderExperiment(view, meta) {
  view.innerHTML = `
    <div class="lab">
      <div class="stage" id="stage">
        <div class="stage-title">
          <h2>${meta.title}</h2>
          <span>${meta.scientist} · ${meta.year}</span>
        </div>
        <div class="stage-hint">拖动旋转视角 · 滚轮缩放 · 右键平移</div>
      </div>
      <aside class="sidebar" id="sidebar"></aside>
    </div>
  `;

  const stage = view.querySelector('#stage');
  const sidebar = view.querySelector('#sidebar');
  const panel = new Panel(sidebar);

  const mod = await meta.load();
  // 路由可能在动态加载期间已经改变
  if (!location.hash.includes(meta.id)) return;
  activeExperiment = mod.create(stage, panel, meta);
}

/* ------------------------------ 路由 ------------------------------ */

function route() {
  if (activeExperiment) {
    activeExperiment.dispose?.();
    activeExperiment = null;
  }

  const id = location.hash.replace(/^#\/?/, '').trim();
  const view = app.querySelector('#view');
  const meta = id ? findExperiment(id) : null;

  if (!meta) {
    if (id) location.replace('#/');
    syncNav('');
    renderHome(view);
    window.scrollTo(0, 0);
    return;
  }

  syncNav(meta.id);
  renderExperiment(view, meta);
  window.scrollTo(0, 0);
}

renderShell();
window.addEventListener('hashchange', route);
route();
