import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * 所有实验共用的 3D 视口：渲染器、相机、轨道控制器、标签层与渲染循环。
 * 每个实验只需要往 viewport.scene 里塞东西，并用 onFrame 注册每帧逻辑。
 */
export class Viewport {
  constructor(host, opts = {}) {
    this.host = host;
    this.callbacks = [];
    this.clock = new THREE.Clock();
    this.running = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.background ?? 0x080d1a);
    if (opts.fog !== false) {
      this.scene.fog = new THREE.Fog(opts.background ?? 0x080d1a, 14, 46);
    }

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 400);
    this.camera.position.fromArray(opts.cameraPos ?? [4.2, 2.6, 6]);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = opts.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = opts.exposure ?? 1.05;
    host.appendChild(this.renderer.domElement);

    // CSS2D 标签层（用于 3D 空间中的文字标注，始终清晰可读）
    this.labelRenderer = new CSS2DRenderer();
    this.labelLayer = this.labelRenderer.domElement;
    this.labelLayer.className = 'labels-layer';
    host.appendChild(this.labelLayer);

    // 环境贴图：金属与玻璃没有它会渲染成一团死黑
    if (opts.environment !== false) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTexture;
      this.scene.environmentIntensity = opts.environmentIntensity ?? 0.75;
      pmrem.dispose();
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = opts.minDistance ?? 1.2;
    this.controls.maxDistance = opts.maxDistance ?? 60;
    this.controls.maxPolarAngle = opts.maxPolarAngle ?? Math.PI * 0.495;
    this.controls.target.fromArray(opts.target ?? [0, 0.7, 0]);

    this._onResize = this._onResize.bind(this);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(host);
    this._onResize();

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  /** 通用三点布光 + 可选地面阴影承接 */
  addStandardLights({ intensity = 1, keyPos = [4, 8, 5], ambient = 0.55 } = {}) {
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x1b2440, ambient);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.7 * intensity);
    key.position.fromArray(keyPos);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    const d = 9;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88b4ff, 0.45 * intensity);
    fill.position.set(-6, 3, -4);
    this.scene.add(fill);

    this.keyLight = key;
    return key;
  }

  /** 实验台面（带网格），y 为台面高度 */
  addGroundGrid({ y = 0, size = 24, divisions = 24 } = {}) {
    const grid = new THREE.GridHelper(size, divisions, 0x3c568c, 0x1e2a45);
    grid.position.y = y + 0.001;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x121a2e, roughness: 0.95, metalness: 0 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.receiveShadow = true;
    this.scene.add(plane);
    return { grid, plane };
  }

  /**
   * 创建一个跟随 3D 位置的文字标签。
   * @returns {CSS2DObject} 可 add 到任意 Object3D 上，用 .element.textContent 更新文字
   */
  label(text, { className = 'tag3d', position = [0, 0, 0] } = {}) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.fromArray(position);
    obj.center.set(0.5, 0.5);
    return obj;
  }

  /** 注册每帧回调：(dt, elapsed) => void */
  onFrame(fn) {
    this.callbacks.push(fn);
    return fn;
  }

  /** 平滑地把相机与目标点移动到新的位置 */
  flyTo(position, target, duration = 0.7) {
    this._fly = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3().fromArray(position),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3().fromArray(target),
    };
  }

  _onResize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this._fly) {
      const f = this._fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2; // easeInOutQuad
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      if (f.t >= 1) this._fly = null;
    }

    for (const cb of this.callbacks) cb(dt, elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    this.envTexture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
    this.callbacks.length = 0;
  }
}
