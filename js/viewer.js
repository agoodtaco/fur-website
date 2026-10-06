import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Viewer {
  constructor(host) {
    this.host = host;
    this.mode = 'solid';

    // Section plane: horizontal slice (normal +Y). THREE.js clips geometry
    // where the signed distance is negative, so we store the plane's Y
    // position and convert to `constant` in setSectionOffset().
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.sectionCenter = new THREE.Vector3();
    this.sectionRange = 0.25;

    // Flat lists — never store arrays of materials.
    this.materials = [];
    this.meshes = [];

    this.modelRoot = null;
    this.preview = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12141a);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0.45, 0.25, 0.55);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.05, 0);

    this._addLights();
    this._addGrid();

    this.preview = this._buildPreviewHead();
    this.scene.add(this.preview);
    this._collectMaterials(this.preview);
    this._updateSectionBounds(this.preview);

    this._onResize = this._onResize.bind(this);
    addEventListener('resize', this._onResize);

    // Resize when the host element actually changes size (grid layout,
    // panel collapse, window resize, DPR change, etc.).
    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(host);
    }

    // Defer the first sizing pass to the next frame so the grid has
    // computed layout and clientWidth/clientHeight are non-zero.
    requestAnimationFrame(() => {
      this._onResize();
      this._frame(this.preview);
    });

    this._animate();
  }

  // ------------------------------------------------------------------
  // Scene setup
  // ------------------------------------------------------------------

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.4, 1);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff7a3d, 0.5);
    rim.position.set(-1, 0.4, -0.8);
    this.scene.add(rim);
  }

  _addGrid() {
    const grid = new THREE.GridHelper(2, 40, 0x2c313d, 0x1e222b);
    grid.position.y = -0.25;
    this.scene.add(grid);
  }

  _buildPreviewHead() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9cbd4,
      roughness: 0.75,
      metalness: 0.05,
      side: THREE.DoubleSide,   // closed solid, safe to render both sides
    });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 48, 36), mat);
    skull.scale.set(0.92, 1.05, 1.0);
    g.add(skull);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.18, 32), mat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.015, 0.17);
    g.add(snout);

    const earGeo = new THREE.ConeGeometry(0.055, 0.13, 20);
    for (const x of [-0.09, 0.09]) {
      const ear = new THREE.Mesh(earGeo, mat);
      ear.position.set(x, 0.17, -0.01);
      g.add(ear);
    }
    g.position.y = 0.05;
    return g;
  }

  // ------------------------------------------------------------------
  // Material collection — FrontSide default, flatten arrays
  // ------------------------------------------------------------------

  _collectMaterials(root) {
    this.materials = [];
    this.meshes = [];
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        // FrontSide, not DoubleSide. DoubleSide on a single-surface shell
        // causes depth-buffer z-fighting that reads as a wireframe mess.
        // The preview head already set its own material to DoubleSide,
        // so this guard leaves it alone.
        if (m.side !== THREE.DoubleSide) m.side = THREE.FrontSide;
        m.clippingPlanes = [];
        this.materials.push(m);
      }
      this.meshes.push(o);
    });
  }

  // ------------------------------------------------------------------
  // Display modes
  // ------------------------------------------------------------------

  setDisplayMode(mode) {
    this.mode = mode;
    for (const m of this.materials) {
      m.wireframe = mode === 'wireframe';
      m.transparent = mode === 'xray';
      m.opacity = mode === 'xray' ? 0.35 : 1;
      m.depthWrite = mode !== 'xray';
      m.clippingPlanes = mode === 'section' ? [this.sectionPlane] : [];
      m.needsUpdate = true;
    }
    console.debug(`[viewer] display mode → ${mode}, ${this.materials.length} material(s)`);
  }

  // ------------------------------------------------------------------
  // Section plane
  // ------------------------------------------------------------------

  _updateSectionBounds(object) {
    const box = new THREE.Box3().setFromObject(object);
    box.getCenter(this.sectionCenter);
    const size = box.getSize(new THREE.Vector3());
    this.sectionRange = Math.max(size.y * 0.5, 0.01);
    this.setSectionOffset(0);
  }

  setSectionOffset(t) {
    // t in [-1, 1] — 0 slices through the model center.
    const yPlane = this.sectionCenter.y + t * this.sectionRange;
    this.sectionPlane.constant = -yPlane;
  }

  // ------------------------------------------------------------------
  // Unit normalisation
  // ------------------------------------------------------------------

  // Most STL exporters emit millimetres. Three.js has no units, so a
  // 2655-unit model is either 2655 mm or 2.655 m — we can't tell. Detect
  // the likely unit from the raw bounding box and rescale to metres so
  // downstream math (estimate, print-bed fit) is consistent.
  _normaliseScale(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest === 0) return;

    let factor = 1;
    if (longest > 1.0 && longest < 5000) factor = 0.001;   // mm → m
    else if (longest > 0.01 && longest < 1.0) factor = 1;  // already m
    else if (longest <= 0.01) factor = 100;                // cm → m

    if (factor !== 1) object.scale.multiplyScalar(factor);
    object.updateMatrixWorld(true);

    const after = new THREE.Box3()
      .setFromObject(object)
      .getSize(new THREE.Vector3());
    console.info(
      `[viewer] raw longest=${longest.toFixed(3)} → scale×${factor} → ` +
      `longest=${(Math.max(after.x, after.y, after.z) * 1000).toFixed(0)} mm`
    );
  }

  // ------------------------------------------------------------------
  // File loading
  // ------------------------------------------------------------------

  async loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    let object;

    if (ext === 'stl') {
      const geo = new STLLoader().parse(buf);
      geo.computeVertexNormals();
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xc9cbd4,
        roughness: 0.75,
        metalness: 0.05,
      }));
    } else if (ext === 'obj') {
      object = new OBJLoader().parse(new TextDecoder().decode(buf));
    } else if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      object = gltf.scene;
    } else {
      throw new Error(`Unsupported format: .${ext}`);
    }

    this._normaliseScale(object);
    this._replaceModel(object);
    this._frame(object);
    this._updateSectionBounds(object);
    return object;
  }

  _replaceModel(object) {
    if (this.preview && this.preview.parent) {
      this.scene.remove(this.preview);
    }
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse(o => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose?.();
        }
      });
    }
    this.modelRoot = object;
    this.scene.add(object);
    this._collectMaterials(object);
    this.setDisplayMode(this.mode);
  }

  _frame(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(size, size * 0.5, size));
    this.camera.near = size / 100;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  getBoundingBox() {
    const target = this.modelRoot ?? this.preview;
    return new THREE.Box3().setFromObject(target);
  }

  // ------------------------------------------------------------------
  // Resize / render loop
  // ------------------------------------------------------------------

  _onResize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;                 // wait for layout instead of clamping to 1×1

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);          // default updateStyle=true keeps CSS in sync
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._animate());
  }
}