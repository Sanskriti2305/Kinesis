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
// Phase 1 (hand tracking) shipped separately in Unity + Python, driving
// a hardcoded cube over UDP — not this app. src/gesture/GestureBridge.js
// listens to the same gesture stream (via a small UDP->WebSocket relay,
// see /bridge) and calls the manipulation methods below on whatever is
// currently selected here, exactly as this comment originally planned:
// selectByUuid() is input-source-agnostic — _onClick calls it after a
// mouse raycast, GestureBridge calls it after a hand raycast is added
// later — and translateSelectedBy / rotateSelectedByDelta /
// scaleSelectedByFactor are the "one manipulation API, multiple input
// sources" methods this file called for. Gesture code never touches
// the Three.js scene directly — it only calls these.
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
    this.renderer.localClippingEnabled = true; // needed for the section tool

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this._addLights();
    this._addGrid();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.modelRoot = null;       // THREE.Group holding the currently loaded model
    this.selected = null;        // currently selected THREE.Mesh
    this._selectedOriginalScale = 1;
    this._selectedOriginalTransform = null; // captured on select, used to clamp gesture scaling
    this.onSelectionChange = null; // callback(properties|null) set by React
    this.onSelectionSync = null;
    this.onTransformChange = null;
    this.onModelChange = null;
    this._modelSource = null;

    this._highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x35c9b0,
      emissive: 0x0b3d36,
      metalness: 0.1,
      roughness: 0.5,
    });
    this._originalMaterials = new Map(); // mesh.uuid -> original material

    // ---- Explode tool state ----
    // originalLocalPos/direction captured once per model load (_captureExplodeRig);
    // explode always displaces from that as-loaded layout, regardless of any
    // gesture/manual edits made afterwards.
    this._explodeRig = new Map(); // child.uuid -> { originalPos: Vector3, dir: Vector3, dist: number }
    this._explodeFactor = 0;

    // ---- Section (clipping plane) tool state ----
    this._sectionPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this._section = { enabled: false, axis: 'x', offset: 0, bounds: { min: -1, max: 1 } };

    // ---- Measure tool state ----
    this._measure = { active: false, points: [], markers: [], line: null };
    this.onMeasureChange = null; // callback({ pointCount, distance, screenA, screenB }) set by React
    this._measureMarkerGeo = new THREE.SphereGeometry(0.02, 12, 12);
    this._measureMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, depthTest: false });
    this._measureLineMat = new THREE.LineBasicMaterial({ color: 0xffb84d, depthTest: false });

    // ---- Phase 4 live simulation state -------------------------------
    this.onSimulationChange = null;
    this._simulation = { hasModel: false, massKg: null, stressIndex: null, maxStress: null, safety: 'none', safetyLabel: 'No model' };
    this._heatmapEnabled = false;
    this._heatmapOriginals = new Map();

    this.canvas.addEventListener('click', this._onClick);
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas);

    this._animate = this._animate.bind(this);
    this._vrSession = null;
    this._xrRenderCallback = null;
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

    if (ext !== 'obj' && ext !== 'stl') {
      throw new Error(`Unsupported format ".${ext}" — Phase 2 supports .obj and .stl. STEP import is a later milestone (needs a dedicated parser, e.g. occt-import-js).`);
    }

    let url = source;
    if (isFile) url = URL.createObjectURL(source);
    this._pendingModelSource = source;
    this._pendingModelTransfer = null;
    if (isFile && source.size <= 8 * 1024 * 1024) {
      const bytes = new Uint8Array(await source.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      this._pendingModelTransfer = {
        name: source.name,
        type: source.type || (ext === 'stl' ? 'model/stl' : 'text/plain'),
        base64: btoa(binary),
      };
    }

    this.clearModel(); // only clear once we know the new file will actually load

    if (ext === 'obj') {
      const loader = new OBJLoader();
      const group = await loader.loadAsync(url);
      this._addModel(group);
    } else {
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
    }

    if (isFile) URL.revokeObjectURL(url);
    this._pendingModelSource = null;
    this.onModelChange?.(this._modelSource);
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
      if (child.isMesh) {
        child.material.clippingPlanes = [this._sectionPlane];
        child.material.clipShadows = true;
      }
    });

    // Three.js UUIDs are generated independently in each browser, so they
    // cannot be used as collaboration identifiers. Build a deterministic
    // path from object names + sibling indexes; identical copies of the same
    // model therefore resolve to the same stable id on every client.
    this._assignSyncIds(group);

    this.modelRoot = group;
    this._modelSource = {
      name: group.name || 'model',
      url: typeof this._pendingModelSource === 'string' && !this._pendingModelSource.startsWith('blob:') ? this._pendingModelSource : null,
      transfer: this._pendingModelTransfer || null,
    };
    this.scene.add(group);
    this._fitCameraToObject(group);
    this._captureExplodeRig(group);
    this._captureSectionBounds(group);
    this.calculateSimulation();
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
    this._explodeRig.clear();
    this._explodeFactor = 0;
    this._modelSource = null;
    this._section.enabled = false;
    this._section.offset = 0;
    this._disableHeatmap();
    this._simulation = { hasModel: false, massKg: null, stressIndex: null, maxStress: null, safety: 'none', safetyLabel: 'No model' };
    this.onSimulationChange?.(this._simulation);
    this.clearMeasure();
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

  _assignSyncIds(root) {
    const visit = (object, parentId = 'model') => {
      const name = String(object.name || object.type || 'object').trim().replace(/\s+/g, '_');
      const counts = new Map();
      object.children.forEach((child) => {
        const childName = String(child.name || child.type || 'object').trim().replace(/\s+/g, '_');
        counts.set(childName, (counts.get(childName) || 0) + 1);
      });
      const seen = new Map();
      object.children.forEach((child) => {
        const childName = String(child.name || child.type || 'object').trim().replace(/\s+/g, '_');
        const occurrence = seen.get(childName) || 0;
        seen.set(childName, occurrence + 1);
        child.userData.kinesisSyncId = `${parentId}/${childName}#${occurrence}`;
        visit(child, child.userData.kinesisSyncId);
      });
      if (!object.userData.kinesisSyncId) object.userData.kinesisSyncId = parentId;
    };
    root.userData.kinesisSyncId = 'model';
    visit(root, 'model');
  }

  getSyncIdForUuid(uuid) {
    if (!uuid || !this.modelRoot) return null;
    let result = null;
    this.modelRoot.traverse((c) => { if (c.uuid === uuid) result = c.userData.kinesisSyncId || null; });
    return result;
  }

  findBySyncId(syncId) {
    if (!syncId || !this.modelRoot) return null;
    let result = null;
    this.modelRoot.traverse((c) => { if (c.userData?.kinesisSyncId === syncId) result = c; });
    return result;
  }

  // ---- Selection / picking ------------------------------------------

  _onClick = (event) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.modelRoot) return;
    const intersects = this.raycaster.intersectObject(this.modelRoot, true);

    if (this._measure.active) {
      if (intersects.length > 0) this._addMeasurePoint(intersects[0].point);
      return;
    }

    if (intersects.length > 0) {
      this.selectByUuid(intersects[0].object.uuid);
    } else {
      this.selectByUuid(null);
    }
  };

  // Called both from canvas clicks and from the React object-tree panel,
  // so clicking a mesh in 3D and clicking its row in the tree do the
  // same thing — one selection model, two entry points.
  selectByUuid(uuid, options = {}) {
    this._clearSelection();
    if (!uuid || !this.modelRoot) {
      this.onSelectionChange?.(null);
      if (!options.remote) this.onSelectionSync?.(null, null);
      return;
    }
    let target = null;
    this.modelRoot.traverse((c) => {
      if (c.uuid === uuid) target = c;
    });
    if (!target || !target.isMesh) {
      this.onSelectionChange?.(null);
      if (!options.remote) this.onSelectionSync?.(null, null);
      return;
    }

    this.selected = target;
    this._selectedOriginalScale = target.scale.x || 1;
    this._selectedOriginalTransform = { position: target.position.clone(), quaternion: target.quaternion.clone(), scale: target.scale.clone() };
    this._originalMaterials.set(target.uuid, target.material);
    target.material = this._highlightMaterial;
    this.onSelectionChange?.(this.getProperties(target));
    if (!options.remote) this.onSelectionSync?.(target.uuid, target.userData?.kinesisSyncId || target.uuid);
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

  // ---- Explode tool ---------------------------------------------------

  // Records each top-level child's as-loaded position and its outward
  // direction from the assembly center. Explode always displaces from
  // this recorded layout, so dialing the factor back to 0 exactly
  // restores the imported model regardless of what happened in between.
  _captureExplodeRig(group) {
    this._explodeRig.clear();
    if (group.children.length < 2) return; // nothing to explode — single-part model

    const groupCenter = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    const overallSize = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    const spread = Math.max(overallSize.x, overallSize.y, overallSize.z, 0.01) * 0.7;

    group.children.forEach((child) => {
      const childCenter = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
      const dir = childCenter.clone().sub(groupCenter);
      if (dir.lengthSq() < 1e-8) dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      dir.normalize();
      this._explodeRig.set(child.uuid, {
        originalPos: child.position.clone(),
        dir,
        dist: spread,
      });
    });
  }

  // True when the current model has more than one top-level part, i.e.
  // explode would actually move something. React uses this to disable
  // the Explode control for single-mesh (STL) imports instead of
  // showing a slider that visibly does nothing.
  getExplodeAvailable() {
    return this._explodeRig.size > 1;
  }

  setExplodeFactor(factor) {
    this._explodeFactor = THREE.MathUtils.clamp(factor, 0, 1);
    this._explodeRig.forEach((rig, uuid) => {
      const child = this.modelRoot?.children.find((c) => c.uuid === uuid);
      if (!child) return;
      child.position.copy(rig.originalPos).addScaledVector(rig.dir, rig.dist * this._explodeFactor);
      this.onTransformChange?.(child.uuid, { position: { x: child.position.x, y: child.position.y, z: child.position.z }, quaternion: { x: child.quaternion.x, y: child.quaternion.y, z: child.quaternion.z, w: child.quaternion.w }, scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z }, uuid: child.uuid }, child.userData?.kinesisSyncId || child.uuid);
    });
  }

  // ---- Section (clipping plane) tool -----------------------------------

  _captureSectionBounds(group) {
    const box = new THREE.Box3().setFromObject(group);
    this._recomputeSectionBounds(box);
    this._applySectionPlane();
  }

  _recomputeSectionBounds(box) {
    const axis = this._section.axis;
    this._section.bounds = { min: box.min[axis], max: box.max[axis] };
    this._section.offset = THREE.MathUtils.clamp(
      this._section.offset,
      this._section.bounds.min,
      this._section.bounds.max
    );
  }

  getSectionBounds() {
    return this._section.bounds;
  }

  setSectionEnabled(enabled) {
    this._section.enabled = enabled;
    this._applySectionPlane();
  }

  setSectionAxis(axis) {
    this._section.axis = axis;
    if (this.modelRoot) this._recomputeSectionBounds(new THREE.Box3().setFromObject(this.modelRoot));
    this._applySectionPlane();
  }

  setSectionOffset(offset) {
    this._section.offset = offset;
    this._applySectionPlane();
  }

  _applySectionPlane() {
    const normals = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const normal = normals[this._section.axis];
    this._sectionPlane.normal.copy(normal);
    this._sectionPlane.constant = -this._section.offset;
    const active = this._section.enabled && !!this.modelRoot;
    this.modelRoot?.traverse((c) => {
      if (c.isMesh) c.material.clippingPlanes = active ? [this._sectionPlane] : [];
    });
  }

  // ---- Measure tool -----------------------------------------------------

  setMeasureActive(active) {
    this._measure.active = active;
    if (!active) this.clearMeasure();
  }

  _addMeasurePoint(point) {
    if (this._measure.points.length >= 2) this.clearMeasure(true);

    const marker = new THREE.Mesh(this._measureMarkerGeo, this._measureMarkerMat);
    marker.position.copy(point);
    marker.renderOrder = 999;
    this.scene.add(marker);
    this._measure.markers.push(marker);
    this._measure.points.push(point.clone());

    if (this._measure.points.length === 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(this._measure.points);
      this._measure.line = new THREE.Line(geo, this._measureLineMat);
      this._measure.line.renderOrder = 999;
      this.scene.add(this._measure.line);
    }
    this._emitMeasure();
  }

  // keepActive: true when a 3rd click should start a fresh measurement
  // without leaving measure mode; false when the tool itself is toggled off.
  clearMeasure(keepActive = false) {
    this._measure.markers.forEach((m) => this.scene.remove(m));
    this._measure.markers = [];
    if (this._measure.line) {
      this.scene.remove(this._measure.line);
      this._measure.line.geometry.dispose();
      this._measure.line = null;
    }
    this._measure.points = [];
    if (!keepActive) this.onMeasureChange?.(null);
  }

  _emitMeasure() {
    if (!this.onMeasureChange) return;
    const [a, b] = this._measure.points;
    if (!a) {
      this.onMeasureChange(null);
      return;
    }
    const distance = b ? a.distanceTo(b) : null;
    this.onMeasureChange({
      pointCount: this._measure.points.length,
      distance,
      screenA: this._toScreen(a),
      screenB: b ? this._toScreen(b) : null,
    });
  }

  _toScreen(worldPoint) {
    const v = worldPoint.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  getModelSource() {
    return this._modelSource;
  }

  getCollaborationSnapshot() {
    const transforms = {};
    if (this.modelRoot) {
      this.modelRoot.traverse((child) => {
        if (!child.isMesh) return;
        const syncId = child.userData?.kinesisSyncId;
        if (!syncId) return;
        transforms[syncId] = {
          position: { x: child.position.x, y: child.position.y, z: child.position.z },
          quaternion: { x: child.quaternion.x, y: child.quaternion.y, z: child.quaternion.z, w: child.quaternion.w },
          scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z },
          uuid: child.uuid,
        };
      });
    }
    return {
      transforms,
      selection: this.selected?.userData?.kinesisSyncId || null,
    };
  }

  getSelectedTransformSnapshot() {
    if (!this.selected) return null;
    return {
      position: { x: this.selected.position.x, y: this.selected.position.y, z: this.selected.position.z },
      quaternion: { x: this.selected.quaternion.x, y: this.selected.quaternion.y, z: this.selected.quaternion.z, w: this.selected.quaternion.w },
      scale: { x: this.selected.scale.x, y: this.selected.scale.y, z: this.selected.scale.z },
    };
  }

  applySharedTransform(syncId, transform, fallbackUuid = null) {
    if (!this.modelRoot || !syncId || !transform) return;
    const target = this.findBySyncId(syncId) || (fallbackUuid ? (() => {
      let found = null;
      this.modelRoot.traverse((c) => { if (c.uuid === fallbackUuid) found = c; });
      return found;
    })() : null);
    if (!target) return;
    target.position.set(Number(transform.position?.x || 0), Number(transform.position?.y || 0), Number(transform.position?.z || 0));
    target.quaternion.set(Number(transform.quaternion?.x || 0), Number(transform.quaternion?.y || 0), Number(transform.quaternion?.z || 0), Number(transform.quaternion?.w ?? 1));
    target.scale.set(Number(transform.scale?.x || 1), Number(transform.scale?.y || 1), Number(transform.scale?.z || 1));
    if (this.selected?.uuid === target.uuid) this.refreshSelectedProperties();
    this.calculateSimulation();
  }

  selectBySyncId(syncId) {
    if (!syncId) {
      this.selectByUuid(null, { remote: true });
      return;
    }
    const target = this.findBySyncId(syncId);
    this.selectByUuid(target?.uuid || null, { remote: true });
  }

  applySharedState(state) {
    const transforms = state?.transforms || {};
    Object.entries(transforms).forEach(([syncId, transform]) => this.applySharedTransform(syncId, transform, transform.uuid || null));
    if (Object.prototype.hasOwnProperty.call(state || {}, 'selection')) this.selectBySyncId(state.selection || null);
  }

  _emitTransformChange() {
    if (this.selected) this.onTransformChange?.(this.selected.uuid, this.getSelectedTransformSnapshot(), this.selected.userData?.kinesisSyncId || this.selected.uuid);
  }

  resetSelectedTransform() {
    if (!this.selected || !this._selectedOriginalTransform) return;
    const t = this._selectedOriginalTransform;
    this.selected.position.copy(t.position);
    this.selected.quaternion.copy(t.quaternion);
    this.selected.scale.copy(t.scale);
    this.calculateSimulation();
    this.refreshSelectedProperties();
    this._emitTransformChange();
  }

  // ---- Gesture manipulation ---------------------------------------------
  // Called only by src/gesture/GestureBridge.js, only on `this.selected`.
  // Mouse interaction never calls these — they're additive, not a
  // replacement for click-to-select.

  // dx/dy: frame-to-frame delta of the tracked hand's normalized (0..1)
  // image position. Moves the selected part along the camera's own
  // right/up vectors, scaled by the part's own size, so a given hand
  // motion feels like the same-sized nudge regardless of whether the
  // imported model is measured in millimetres or metres.
  translateSelectedBy(dx, dy, dz = 0) {
    if (!this.selected) return;
    const size = new THREE.Box3().setFromObject(this.selected).getSize(new THREE.Vector3());
    const scale = Math.max(size.x, size.y, size.z, 0.01) * 1.5;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());

    this.selected.position.addScaledVector(right, dx * scale);
    this.selected.position.addScaledVector(up, -dy * scale);
    this.selected.position.addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), dz * scale);
    this.calculateSimulation();
    this._emitTransformChange();
  }

  // deltaQuat: rotation since the previous gesture frame (not since
  // gesture start) — mirrors the hand's orientation change 1:1 each frame.
  rotateSelectedByDelta(deltaQuat) {
    if (!this.selected) return;
    this.selected.quaternion.premultiply(deltaQuat);
    this.calculateSimulation();
    this._emitTransformChange();
  }

  // factor: multiplicative scale change since the previous frame.
  // Clamped to 0.2x-5x the scale the part had when it was selected, so
  // a jittery gesture can't shrink a part to zero or blow it up unbounded.
  scaleSelectedByFactor(factor) {
    if (!this.selected) return;
    const next = THREE.MathUtils.clamp(
      this.selected.scale.x * factor,
      this._selectedOriginalScale * 0.2,
      this._selectedOriginalScale * 5
    );
    this.selected.scale.setScalar(next);
    this.calculateSimulation();
    this._emitTransformChange();
  }

  // ---- Phase 4: simplified live simulation ----------------------------

  // This is intentionally a lightweight project/demo physics proxy rather
  // than certified finite-element analysis. It reacts immediately to the
  // same geometry changes made by mouse or gestures.
  calculateSimulation() {
    if (!this.modelRoot) {
      this._simulation = { hasModel: false, massKg: null, stressIndex: null, maxStress: null, safety: 'none', safetyLabel: 'No model' };
      this.onSimulationChange?.(this._simulation);
      return this._simulation;
    }

    const DENSITY_ALUMINUM = 2.7e-6; // kg / mm^3; demo default
    const LOAD_N = 1000;
    let massKg = 0;
    this.modelRoot.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      const volumeMm3 = Math.max(size.x * size.y * size.z, 0);
      massKg += volumeMm3 * DENSITY_ALUMINUM;
    });

    const target = this.selected || this.modelRoot;
    const targetSize = new THREE.Box3().setFromObject(target).getSize(new THREE.Vector3());
    const area = Math.max(Math.min(targetSize.x, targetSize.y, targetSize.z) ** 2, 1);
    const aspect = Math.max(targetSize.x, targetSize.y, targetSize.z) / Math.max(Math.min(targetSize.x, targetSize.y, targetSize.z), 0.1);
    const concentration = Math.min(3.5, 0.65 + aspect * 0.18);
    const maxStress = (LOAD_N / area) * concentration;
    const stressIndex = Math.round(Math.min(100, maxStress / 8));
    const safety = stressIndex < 50 ? 'safe' : stressIndex < 80 ? 'caution' : 'high';
    const safetyLabel = safety === 'safe' ? 'SAFE' : safety === 'caution' ? 'CAUTION' : 'HIGH';

    this._simulation = {
      hasModel: true,
      massKg: Number(massKg.toFixed(3)),
      stressIndex,
      maxStress: Number(maxStress.toFixed(1)),
      safety,
      safetyLabel,
    };
    this.onSimulationChange?.(this._simulation);
    if (this._heatmapEnabled) this._applyHeatmap();
    return this._simulation;
  }

  getSimulation() { return this._simulation; }

  setHeatmapEnabled(enabled) {
    this._heatmapEnabled = !!enabled;
    if (this._heatmapEnabled) this._applyHeatmap();
    else this._disableHeatmap();
  }

  isHeatmapEnabled() { return this._heatmapEnabled; }

  _heatColor(t) {
    // blue -> cyan -> yellow -> red stress scale
    const stops = [
      [0.0, new THREE.Color(0x1769e0)],
      [0.33, new THREE.Color(0x21c7d9)],
      [0.66, new THREE.Color(0xffd43b)],
      [1.0, new THREE.Color(0xe53935)],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        return a[1].clone().lerp(b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return stops[stops.length - 1][1].clone();
  }

  _applyHeatmap() {
    if (!this.modelRoot) return;
    const base = Math.max(0.05, Math.min(1, (this._simulation.stressIndex || 0) / 100));
    this.modelRoot.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (!this._heatmapOriginals.has(mesh.uuid)) {
        this._heatmapOriginals.set(mesh.uuid, { geometry: mesh.geometry, material: mesh.material });
        mesh.geometry = mesh.geometry.clone();
        mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.55, clippingPlanes: mesh.material.clippingPlanes || [] });
      }
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (!pos) return;
      const colors = new Float32Array(pos.count * 3);
      const box = new THREE.Box3().setFromBufferAttribute(pos);
      const span = Math.max(box.max.x - box.min.x, 0.0001);
      for (let i = 0; i < pos.count; i++) {
        const x = (pos.getX(i) - box.min.x) / span;
        const local = Math.min(1, Math.max(0, x * 0.65 + base * 0.35));
        const c = this._heatColor(local);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.attributes.color.needsUpdate = true;
    });
  }

  _disableHeatmap() {
    this._heatmapOriginals.forEach(({ geometry, material }, uuid) => {
      let mesh = null;
      this.modelRoot?.traverse((c) => { if (c.uuid === uuid) mesh = c; });
      if (!mesh) return;
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.material.dispose();
      mesh.material = material;
    });
    this._heatmapOriginals.clear();
  }

  // ---- Phase 8: Meta Quest / WebXR ---------------------------------
  async enterVR() {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser.');
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!supported) throw new Error('Immersive VR is not supported. Connect the Meta Quest 3S using Quest Link, Air Link, or open Kinesis in the Quest Browser.');
    if (this._vrSession) return;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this._vrSession = session;
    session.addEventListener('end', () => {
      this._vrSession = null;
      this.renderer.setAnimationLoop(null);
      if (!this._raf) this._raf = requestAnimationFrame(this._animate);
    }, { once: true });
    await this.renderer.xr.setSession(session);
    this._raf = null;
    this.renderer.setAnimationLoop(this._xrRenderCallback || (() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }));
  }

  async exitVR() {
    if (this._vrSession) await this._vrSession.end();
  }

  isVRPresenting() { return !!this._vrSession; }

  // ---- Lifecycle -------------------------------------------------------

  _onResize() {
    const { clientWidth, clientHeight } = this.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  _animate() {
    if (this._vrSession) return;
    this._raf = requestAnimationFrame(this._animate);
    this.controls.update();
    if (this._measure.points.length > 0) this._emitMeasure();
    this.renderer.render(this.scene, this.camera);
  }

  // Called by GestureBridge after it moves/rotates/scales the selection,
  // so the Properties panel updates live instead of only on click-select.
  refreshSelectedProperties() {
    if (this.selected) this.onSelectionChange?.(this.getProperties(this.selected));
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this._onClick);
    this.clearModel();
    this.controls.dispose();
    this.renderer.setAnimationLoop(null);
    if (this._vrSession) { this._vrSession.end().catch(() => {}); this._vrSession = null; }
    this.renderer.dispose();
  }
}
