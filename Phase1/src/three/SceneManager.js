import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// SceneManager owns the raw Three.js world: renderer, camera, controls,
// loaders, and picking. React never touches Three.js objects directly —
// it only reads the plain-data snapshots this class hands back
// (getObjectTree / getProperties). Keeping that boundary is what makes
// the object tree and properties panel a "dumb" render of state instead
// of two components fighting over the same mutable scene graph.
//
// Phase 1 (hand tracking, not started yet) plugs in here, not around it:
// selectByUuid() below is already input-source-agnostic — _onClick calls
// it after a mouse raycast, and MediaPipe's gesture recognizer will call
// the same method after a hand raycast. When Phase 1 adds grab/rotate/
// scale, those become new methods on this class (e.g. translateSelected,
// rotateSelected) that both a future gesture handler AND any mouse-drag
// fallback call — one manipulation API, multiple input sources feeding it.
// Do not let Phase 1 talk to the Three.js scene directly.
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16181b);

    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.01,
      1000
    );
    this.camera.position.set(4, 3, 6);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this._addLights();
    this._addGrid();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.modelRoot = null;       // THREE.Group holding the currently loaded model
    this.selected = null;        // currently selected THREE.Mesh
    this.onSelectionChange = null; // callback(properties|null) set by React

    this._highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x35c9b0,
      emissive: 0x0b3d36,
      metalness: 0.1,
      roughness: 0.5,
    });
    this._originalMaterials = new Map(); // mesh.uuid -> original material

    this.canvas.addEventListener('click', this._onClick);
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas);

    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  _addLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b2e33, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);
  }

  _addGrid() {
    const grid = new THREE.GridHelper(20, 20, 0x3a3d43, 0x24262b);
    this.scene.add(grid);
  }

  // ---- Loading -----------------------------------------------------

  // Accepts either a URL (string) or a browser File object.
  // Format is chosen by file extension, matching the Phase 2 spec
  // (OBJ / STL now, STEP is a separate, non-trivial parser to add later).
  async loadModel(source) {
    const isFile = source instanceof File;
    const name = isFile ? source.name : source;
    const ext = name.split('.').pop().toLowerCase();

    let url = source;
    if (isFile) url = URL.createObjectURL(source);

    this.clearModel();

    if (ext === 'obj') {
      const loader = new OBJLoader();
      const group = await loader.loadAsync(url);
      this._addModel(group);
    } else if (ext === 'stl') {
      const loader = new STLLoader();
      const geometry = await loader.loadAsync(url);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.1, roughness: 0.6 })
      );
      mesh.name = name.replace(/\.[^/.]+$/, '');
      const group = new THREE.Group();
      group.name = mesh.name;
      group.add(mesh);
      this._addModel(group);
    } else {
      throw new Error(`Unsupported format ".${ext}" — Phase 2 supports .obj and .stl. STEP import is a later milestone (needs a dedicated parser, e.g. occt-import-js).`);
    }

    if (isFile) URL.revokeObjectURL(url);
  }

  _addModel(group) {
    // OBJLoader doesn't assign materials by default — give every mesh
    // a visible material so newly imported parts aren't invisible.
    group.traverse((child) => {
      if (child.isMesh && (!child.material || child.material.type === 'MeshBasicMaterial')) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x9aa0a8,
          metalness: 0.1,
          roughness: 0.6,
        });
      }
    });

    this.modelRoot = group;
    this.scene.add(group);
    this._fitCameraToObject(group);
  }

  clearModel() {
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose();
          c.material?.dispose();
        }
      });
      this.modelRoot = null;
    }
    this._clearSelection();
  }

  _fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim * 1.8;

    this.camera.near = maxDim / 100;
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(center.x + distance, center.y + distance * 0.6, center.z + distance);
    this.controls.target.copy(center);
    this.controls.update();
  }

  // ---- Selection / picking ------------------------------------------

  _onClick = (event) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.modelRoot) return;
    const intersects = this.raycaster.intersectObject(this.modelRoot, true);

    if (intersects.length > 0) {
      this.selectByUuid(intersects[0].object.uuid);
    } else {
      this.selectByUuid(null);
    }
  };

  // Called both from canvas clicks and from the React object-tree panel,
  // so clicking a mesh in 3D and clicking its row in the tree do the
  // same thing — one selection model, two entry points.
  selectByUuid(uuid) {
    this._clearSelection();
    if (!uuid || !this.modelRoot) {
      this.onSelectionChange?.(null);
      return;
    }
    let target = null;
    this.modelRoot.traverse((c) => {
      if (c.uuid === uuid) target = c;
    });
    if (!target || !target.isMesh) {
      this.onSelectionChange?.(null);
      return;
    }

    this.selected = target;
    this._originalMaterials.set(target.uuid, target.material);
    target.material = this._highlightMaterial;
    this.onSelectionChange?.(this.getProperties(target));
  }

  _clearSelection() {
    if (this.selected) {
      const original = this._originalMaterials.get(this.selected.uuid);
      if (original) this.selected.material = original;
      this._originalMaterials.delete(this.selected.uuid);
    }
    this.selected = null;
  }

  // ---- Data snapshots for React --------------------------------------

  // Walks the live Three.js graph and returns a plain-object tree.
  // This is the ONLY thing the ObjectTree React component ever sees —
  // it never touches THREE.Object3D instances.
  getObjectTree() {
    if (!this.modelRoot) return null;
    const walk = (obj) => ({
      uuid: obj.uuid,
      name: obj.name || obj.type,
      isMesh: !!obj.isMesh,
      children: obj.children.map(walk),
    });
    return walk(this.modelRoot);
  }

  getProperties(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const pos = mesh.position;
    const rot = mesh.rotation;
    const geo = mesh.geometry;
    const vertexCount = geo?.attributes?.position?.count ?? 0;
    const faceCount = geo?.index ? geo.index.count / 3 : vertexCount / 3;

    return {
      uuid: mesh.uuid,
      name: mesh.name || 'Unnamed part',
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(rot.x),
        y: THREE.MathUtils.radToDeg(rot.y),
        z: THREE.MathUtils.radToDeg(rot.z),
      },
      dimensions: { x: size.x, y: size.y, z: size.z },
      vertexCount,
      faceCount: Math.round(faceCount),
    };
  }

  // ---- Lifecycle -------------------------------------------------------

  _onResize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this._onClick);
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
