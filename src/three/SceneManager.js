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

    // -------------------------------------------------------------
    // WebGL Renderer + WebXR support
    // -------------------------------------------------------------

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });

    // Enable WebXR support for Meta Quest 3S.
    this.renderer.xr.enabled = true;

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2)
    );

    this.renderer.setSize(
      canvas.clientWidth,
      canvas.clientHeight,
      false
    );

    this.renderer.localClippingEnabled = true;

    // -------------------------------------------------------------
    // Desktop orbit controls
    // -------------------------------------------------------------

    this.controls = new OrbitControls(
      this.camera,
      this.renderer.domElement
    );

    this.controls.enableDamping = true;

    this._addLights();
    this._addGrid();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.modelRoot = null;
    this.selected = null;

    this._selectedOriginalScale = 1;

    this.onSelectionChange = null;

    this._highlightMaterial =
      new THREE.MeshStandardMaterial({
        color: 0x35c9b0,
        emissive: 0x0b3d36,
        metalness: 0.1,
        roughness: 0.5,
      });

    this._originalMaterials = new Map();

    // -------------------------------------------------------------
    // Explode tool state
    // -------------------------------------------------------------

    this._explodeRig = new Map();
    this._explodeFactor = 0;

    // -------------------------------------------------------------
    // Section tool state
    // -------------------------------------------------------------

    this._sectionPlane = new THREE.Plane(
      new THREE.Vector3(1, 0, 0),
      0
    );

    this._section = {
      enabled: false,
      axis: 'x',
      offset: 0,
      bounds: {
        min: -1,
        max: 1,
      },
    };

    // -------------------------------------------------------------
    // Measure tool state
    // -------------------------------------------------------------

    this._measure = {
      active: false,
      points: [],
      markers: [],
      line: null,
    };

    this.onMeasureChange = null;

    this._measureMarkerGeo =
      new THREE.SphereGeometry(0.02, 12, 12);

    this._measureMarkerMat =
      new THREE.MeshBasicMaterial({
        color: 0xffb84d,
        depthTest: false,
      });

    this._measureLineMat =
      new THREE.LineBasicMaterial({
        color: 0xffb84d,
        depthTest: false,
      });

    // -------------------------------------------------------------
    // Phase 4 live simulation state
    // -------------------------------------------------------------

    this.onSimulationChange = null;

    this._simulation = {
      hasModel: false,
      massKg: null,
      stressIndex: null,
      maxStress: null,
      safety: 'none',
      safetyLabel: 'No model',
    };

    this._heatmapEnabled = false;
    this._heatmapOriginals = new Map();

    // -------------------------------------------------------------
    // WebXR state
    // -------------------------------------------------------------

    this._vrSession = null;
    this._xrRenderCallback = null;

    // -------------------------------------------------------------
    // Events / animation
    // -------------------------------------------------------------

    this.canvas.addEventListener(
      'click',
      this._onClick
    );

    this._resizeObserver = new ResizeObserver(
      () => this._onResize()
    );

    this._resizeObserver.observe(canvas);

    this._animate = this._animate.bind(this);

    this._raf = requestAnimationFrame(
      this._animate
    );
  }

  // =============================================================
  // Lighting
  // =============================================================

  _addLights() {
    const hemi = new THREE.HemisphereLight(
      0xffffff,
      0x2b2e33,
      1.1
    );

    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(
      0xffffff,
      1.2
    );

    dir.position.set(5, 10, 7);

    this.scene.add(dir);
  }

  _addGrid() {
    const grid = new THREE.GridHelper(
      20,
      20,
      0x3a3d43,
      0x24262b
    );

    this.scene.add(grid);
  }

  // =============================================================
  // Loading
  // =============================================================

  async loadModel(source) {
    const isFile = source instanceof File;

    const name = isFile
      ? source.name
      : source;

    const ext = name
      .split('.')
      .pop()
      .toLowerCase();

    if (ext !== 'obj' && ext !== 'stl') {
      throw new Error(
        `Unsupported format ".${ext}" — Phase 2 supports .obj and .stl. STEP import is a later milestone.`
      );
    }

    let url = source;

    if (isFile) {
      url = URL.createObjectURL(source);
    }

    this.clearModel();

    if (ext === 'obj') {
      const loader = new OBJLoader();

      const group =
        await loader.loadAsync(url);

      this._addModel(group);
    } else {
      const loader = new STLLoader();

      const geometry =
        await loader.loadAsync(url);

      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0x9aa0a8,
          metalness: 0.1,
          roughness: 0.6,
        })
      );

      mesh.name = name.replace(
        /\.[^/.]+$/,
        ''
      );

      const group = new THREE.Group();

      group.name = mesh.name;

      group.add(mesh);

      this._addModel(group);
    }

    if (isFile) {
      URL.revokeObjectURL(url);
    }
  }

  _addModel(group) {
    group.traverse((child) => {
      if (
        child.isMesh &&
        (
          !child.material ||
          child.material.type === 'MeshBasicMaterial'
        )
      ) {
        child.material =
          new THREE.MeshStandardMaterial({
            color: 0x9aa0a8,
            metalness: 0.1,
            roughness: 0.6,
          });
      }

      if (child.isMesh) {
        child.material.clippingPlanes = [
          this._sectionPlane,
        ];

        child.material.clipShadows = true;
      }
    });

    this.modelRoot = group;

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

    this._section.enabled = false;

    this._section.offset = 0;

    this._disableHeatmap();

    this._simulation = {
      hasModel: false,
      massKg: null,
      stressIndex: null,
      maxStress: null,
      safety: 'none',
      safetyLabel: 'No model',
    };

    this.onSimulationChange?.(
      this._simulation
    );

    this.clearMeasure();
  }

  _fitCameraToObject(object) {
    const box =
      new THREE.Box3().setFromObject(object);

    const size =
      box.getSize(new THREE.Vector3());

    const center =
      box.getCenter(new THREE.Vector3());

    const maxDim =
      Math.max(
        size.x,
        size.y,
        size.z
      ) || 1;

    const distance =
      maxDim * 1.8;

    this.camera.near =
      maxDim / 100;

    this.camera.far =
      maxDim * 100;

    this.camera.updateProjectionMatrix();

    this.camera.position.set(
      center.x + distance,
      center.y + distance * 0.6,
      center.z + distance
    );

    this.controls.target.copy(center);

    this.controls.update();
  }

  // =============================================================
  // Selection / picking
  // =============================================================

  _onClick = (event) => {
    // Ignore desktop mouse picking while using VR.
    if (this.renderer.xr.isPresenting) {
      return;
    }

    const rect =
      this.canvas.getBoundingClientRect();

    this.pointer.x =
      (
        (event.clientX - rect.left) /
        rect.width
      ) * 2 - 1;

    this.pointer.y =
      -(
        (event.clientY - rect.top) /
        rect.height
      ) * 2 + 1;

    this.raycaster.setFromCamera(
      this.pointer,
      this.camera
    );

    if (!this.modelRoot) return;

    const intersects =
      this.raycaster.intersectObject(
        this.modelRoot,
        true
      );

    if (this._measure.active) {
      if (intersects.length > 0) {
        this._addMeasurePoint(
          intersects[0].point
        );
      }

      return;
    }

    if (intersects.length > 0) {
      this.selectByUuid(
        intersects[0].object.uuid
      );
    } else {
      this.selectByUuid(null);
    }
  };

  selectByUuid(uuid) {
    this._clearSelection();

    if (!uuid || !this.modelRoot) {
      this.onSelectionChange?.(null);
      return;
    }

    let target = null;

    this.modelRoot.traverse((c) => {
      if (c.uuid === uuid) {
        target = c;
      }
    });

    if (!target || !target.isMesh) {
      this.onSelectionChange?.(null);
      return;
    }

    this.selected = target;

    this._selectedOriginalScale =
      target.scale.x || 1;

    this._originalMaterials.set(
      target.uuid,
      target.material
    );

    target.material =
      this._highlightMaterial;

    this.onSelectionChange?.(
      this.getProperties(target)
    );
  }

  _clearSelection() {
    if (this.selected) {
      const original =
        this._originalMaterials.get(
          this.selected.uuid
        );

      if (original) {
        this.selected.material =
          original;
      }

      this._originalMaterials.delete(
        this.selected.uuid
      );
    }

    this.selected = null;
  }

  // =============================================================
  // Data snapshots
  // =============================================================

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
    const box =
      new THREE.Box3().setFromObject(mesh);

    const size =
      box.getSize(new THREE.Vector3());

    const pos = mesh.position;

    const rot = mesh.rotation;

    const geo = mesh.geometry;

    const vertexCount =
      geo?.attributes?.position?.count ?? 0;

    const faceCount =
      geo?.index
        ? geo.index.count / 3
        : vertexCount / 3;

    return {
      uuid: mesh.uuid,
      name: mesh.name || 'Unnamed part',

      position: {
        x: pos.x,
        y: pos.y,
        z: pos.z,
      },

      rotation: {
        x: THREE.MathUtils.radToDeg(rot.x),
        y: THREE.MathUtils.radToDeg(rot.y),
        z: THREE.MathUtils.radToDeg(rot.z),
      },

      dimensions: {
        x: size.x,
        y: size.y,
        z: size.z,
      },

      vertexCount,

      faceCount: Math.round(faceCount),
    };
  }

  // =============================================================
  // Explode tool
  // =============================================================

  _captureExplodeRig(group) {
    this._explodeRig.clear();

    if (group.children.length < 2) {
      return;
    }

    const groupCenter =
      new THREE.Box3()
        .setFromObject(group)
        .getCenter(
          new THREE.Vector3()
        );

    const overallSize =
      new THREE.Box3()
        .setFromObject(group)
        .getSize(
          new THREE.Vector3()
        );

    const spread =
      Math.max(
        overallSize.x,
        overallSize.y,
        overallSize.z,
        0.01
      ) * 0.7;

    group.children.forEach((child) => {
      const childCenter =
        new THREE.Box3()
          .setFromObject(child)
          .getCenter(
            new THREE.Vector3()
          );

      const dir =
        childCenter
          .clone()
          .sub(groupCenter);

      if (dir.lengthSq() < 1e-8) {
        dir.set(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        );
      }

      dir.normalize();

      this._explodeRig.set(
        child.uuid,
        {
          originalPos:
            child.position.clone(),
          dir,
          dist: spread,
        }
      );
    });
  }

  getExplodeAvailable() {
    return this._explodeRig.size > 1;
  }

  setExplodeFactor(factor) {
    this._explodeFactor =
      THREE.MathUtils.clamp(
        factor,
        0,
        1
      );

    this._explodeRig.forEach(
      (rig, uuid) => {
        const child =
          this.modelRoot?.children.find(
            (c) => c.uuid === uuid
          );

        if (!child) return;

        child.position
          .copy(rig.originalPos)
          .addScaledVector(
            rig.dir,
            rig.dist *
              this._explodeFactor
          );
      }
    );
  }

  // =============================================================
  // Section tool
  // =============================================================

  _captureSectionBounds(group) {
    const box =
      new THREE.Box3().setFromObject(group);

    this._recomputeSectionBounds(box);

    this._applySectionPlane();
  }

  _recomputeSectionBounds(box) {
    const axis =
      this._section.axis;

    this._section.bounds = {
      min: box.min[axis],
      max: box.max[axis],
    };

    this._section.offset =
      THREE.MathUtils.clamp(
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

    if (this.modelRoot) {
      this._recomputeSectionBounds(
        new THREE.Box3().setFromObject(
          this.modelRoot
        )
      );
    }

    this._applySectionPlane();
  }

  setSectionOffset(offset) {
    this._section.offset = offset;

    this._applySectionPlane();
  }

  _applySectionPlane() {
    const normals = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    };

    const normal =
      normals[this._section.axis];

    this._sectionPlane.normal.copy(
      normal
    );

    this._sectionPlane.constant =
      -this._section.offset;

    const active =
      this._section.enabled &&
      !!this.modelRoot;

    this.modelRoot?.traverse((c) => {
      if (c.isMesh) {
        c.material.clippingPlanes =
          active
            ? [this._sectionPlane]
            : [];
      }
    });
  }

  // =============================================================
  // Measure tool
  // =============================================================

  setMeasureActive(active) {
    this._measure.active = active;

    if (!active) {
      this.clearMeasure();
    }
  }

  _addMeasurePoint(point) {
    if (this._measure.points.length >= 2) {
      this.clearMeasure(true);
    }

    const marker =
      new THREE.Mesh(
        this._measureMarkerGeo,
        this._measureMarkerMat
      );

    marker.position.copy(point);

    marker.renderOrder = 999;

    this.scene.add(marker);

    this._measure.markers.push(marker);

    this._measure.points.push(
      point.clone()
    );

    if (
      this._measure.points.length === 2
    ) {
      const geo =
        new THREE.BufferGeometry()
          .setFromPoints(
            this._measure.points
          );

      this._measure.line =
        new THREE.Line(
          geo,
          this._measureLineMat
        );

      this._measure.line.renderOrder =
        999;

      this.scene.add(
        this._measure.line
      );
    }

    this._emitMeasure();
  }

  clearMeasure(keepActive = false) {
    this._measure.markers.forEach(
      (m) => this.scene.remove(m)
    );

    this._measure.markers = [];

    if (this._measure.line) {
      this.scene.remove(
        this._measure.line
      );

      this._measure.line.geometry.dispose();

      this._measure.line = null;
    }

    this._measure.points = [];

    if (!keepActive) {
      this.onMeasureChange?.(null);
    }
  }

  _emitMeasure() {
    if (!this.onMeasureChange) return;

    const [a, b] =
      this._measure.points;

    if (!a) {
      this.onMeasureChange(null);
      return;
    }

    const distance =
      b
        ? a.distanceTo(b)
        : null;

    this.onMeasureChange({
      pointCount:
        this._measure.points.length,

      distance,

      screenA:
        this._toScreen(a),

      screenB:
        b
          ? this._toScreen(b)
          : null,
    });
  }

  _toScreen(worldPoint) {
    const v =
      worldPoint
        .clone()
        .project(this.camera);

    const rect =
      this.canvas.getBoundingClientRect();

    return {
      x:
        (v.x * 0.5 + 0.5) *
        rect.width,

      y:
        (-v.y * 0.5 + 0.5) *
        rect.height,
    };
  }

  // =============================================================
  // Gesture manipulation
  // =============================================================

  translateSelectedBy(dx, dy) {
    if (!this.selected) return;

    const size =
      new THREE.Box3()
        .setFromObject(this.selected)
        .getSize(
          new THREE.Vector3()
        );

    const scale =
      Math.max(
        size.x,
        size.y,
        size.z,
        0.01
      ) * 1.5;

    const right =
      new THREE.Vector3();

    const up =
      new THREE.Vector3();

    this.camera.matrixWorld.extractBasis(
      right,
      up,
      new THREE.Vector3()
    );

    this.selected.position
      .addScaledVector(
        right,
        dx * scale
      );

    this.selected.position
      .addScaledVector(
        up,
        -dy * scale
      );

    this.calculateSimulation();
  }

  rotateSelectedByDelta(deltaQuat) {
    if (!this.selected) return;

    this.selected.quaternion
      .premultiply(deltaQuat);

    this.calculateSimulation();
  }

  scaleSelectedByFactor(factor) {
    if (!this.selected) return;

    const next =
      THREE.MathUtils.clamp(
        this.selected.scale.x * factor,
        this._selectedOriginalScale * 0.2,
        this._selectedOriginalScale * 5
      );

    this.selected.scale.setScalar(next);

    this.calculateSimulation();
  }

  // =============================================================
  // Phase 4 Simulation
  // =============================================================

  calculateSimulation() {
    if (!this.modelRoot) {
      this._simulation = {
        hasModel: false,
        massKg: null,
        stressIndex: null,
        maxStress: null,
        safety: 'none',
        safetyLabel: 'No model',
      };

      this.onSimulationChange?.(
        this._simulation
      );

      return this._simulation;
    }

    const DENSITY_ALUMINUM =
      2.7e-6;

    const LOAD_N = 1000;

    let massKg = 0;

    this.modelRoot.traverse(
      (mesh) => {
        if (!mesh.isMesh) return;

        const size =
          new THREE.Box3()
            .setFromObject(mesh)
            .getSize(
              new THREE.Vector3()
            );

        const volumeMm3 =
          Math.max(
            size.x *
              size.y *
              size.z,
            0
          );

        massKg +=
          volumeMm3 *
          DENSITY_ALUMINUM;
      }
    );

    const target =
      this.selected ||
      this.modelRoot;

    const targetSize =
      new THREE.Box3()
        .setFromObject(target)
        .getSize(
          new THREE.Vector3()
        );

    const area =
      Math.max(
        Math.min(
          targetSize.x,
          targetSize.y,
          targetSize.z
        ) ** 2,
        1
      );

    const aspect =
      Math.max(
        targetSize.x,
        targetSize.y,
        targetSize.z
      ) /
      Math.max(
        Math.min(
          targetSize.x,
          targetSize.y,
          targetSize.z
        ),
        0.1
      );

    const concentration =
      Math.min(
        3.5,
        0.65 +
          aspect * 0.18
      );

    const maxStress =
      (LOAD_N / area) *
      concentration;

    const stressIndex =
      Math.round(
        Math.min(
          100,
          maxStress / 8
        )
      );

    const safety =
      stressIndex < 50
        ? 'safe'
        : stressIndex < 80
          ? 'caution'
          : 'high';

    const safetyLabel =
      safety === 'safe'
        ? 'SAFE'
        : safety === 'caution'
          ? 'CAUTION'
          : 'HIGH';

    this._simulation = {
      hasModel: true,
      massKg:
        Number(
          massKg.toFixed(3)
        ),
      stressIndex,
      maxStress:
        Number(
          maxStress.toFixed(1)
        ),
      safety,
      safetyLabel,
    };

    this.onSimulationChange?.(
      this._simulation
    );

    if (this._heatmapEnabled) {
      this._applyHeatmap();
    }

    return this._simulation;
  }

  getSimulation() {
    return this._simulation;
  }

  setHeatmapEnabled(enabled) {
    this._heatmapEnabled =
      !!enabled;

    if (this._heatmapEnabled) {
      this._applyHeatmap();
    } else {
      this._disableHeatmap();
    }
  }

  isHeatmapEnabled() {
    return this._heatmapEnabled;
  }

  _heatColor(t) {
    const stops = [
      [
        0.0,
        new THREE.Color(0x1769e0),
      ],
      [
        0.33,
        new THREE.Color(0x21c7d9),
      ],
      [
        0.66,
        new THREE.Color(0xffd43b),
      ],
      [
        1.0,
        new THREE.Color(0xe53935),
      ],
    ];

    for (
      let i = 1;
      i < stops.length;
      i++
    ) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1];
        const b = stops[i];

        return a[1]
          .clone()
          .lerp(
            b[1],
            (t - a[0]) /
              (b[0] - a[0])
          );
      }
    }

    return stops[
      stops.length - 1
    ][1].clone();
  }

  _applyHeatmap() {
    if (!this.modelRoot) return;

    const base =
      Math.max(
        0.05,
        Math.min(
          1,
          (this._simulation.stressIndex || 0) /
            100
        )
      );

    this.modelRoot.traverse(
      (mesh) => {
        if (!mesh.isMesh) return;

        if (
          !this._heatmapOriginals.has(
            mesh.uuid
          )
        ) {
          this._heatmapOriginals.set(
            mesh.uuid,
            {
              geometry: mesh.geometry,
              material: mesh.material,
            }
          );

          mesh.geometry =
            mesh.geometry.clone();

          mesh.material =
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              metalness: 0.15,
              roughness: 0.55,
              clippingPlanes:
                mesh.material.clippingPlanes ||
                [],
            });
        }

        const geo =
          mesh.geometry;

        const pos =
          geo.attributes.position;

        if (!pos) return;

        const colors =
          new Float32Array(
            pos.count * 3
          );

        const box =
          new THREE.Box3()
            .setFromBufferAttribute(
              pos
            );

        const span =
          Math.max(
            box.max.x -
              box.min.x,
            0.0001
          );

        for (
          let i = 0;
          i < pos.count;
          i++
        ) {
          const x =
            (
              pos.getX(i) -
              box.min.x
            ) / span;

          const local =
            Math.min(
              1,
              Math.max(
                0,
                x * 0.65 +
                  base * 0.35
              )
            );

          const c =
            this._heatColor(
              local
            );

          colors[i * 3] =
            c.r;

          colors[i * 3 + 1] =
            c.g;

          colors[i * 3 + 2] =
            c.b;
        }

        geo.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(
            colors,
            3
          )
        );

        geo.attributes.color.needsUpdate =
          true;
      }
    );
  }

  _disableHeatmap() {
    this._heatmapOriginals.forEach(
      ({ geometry, material }, uuid) => {
        let mesh = null;

        this.modelRoot?.traverse(
          (c) => {
            if (c.uuid === uuid) {
              mesh = c;
            }
          }
        );

        if (!mesh) return;

        mesh.geometry.dispose();

        mesh.geometry =
          geometry;

        mesh.material.dispose();

        mesh.material =
          material;
      }
    );

    this._heatmapOriginals.clear();
  }

  // =============================================================
  // WebXR / Meta Quest 3S
  // =============================================================

  async enterVR() {
    if (!navigator.xr) {
      throw new Error(
        'WebXR is not available in this browser.'
      );
    }

    const supported =
      await navigator.xr.isSessionSupported(
        'immersive-vr'
      );

    if (!supported) {
      throw new Error(
        'Immersive VR is not supported. Connect your Meta Quest 3S using Quest Link, Air Link, or open Kinesis directly in the Quest Browser.'
      );
    }

    // Prevent opening multiple VR sessions.
    if (this.renderer.xr.isPresenting) {
      return;
    }

    // Stop the desktop animation loop.
    if (this._raf) {
      cancelAnimationFrame(
        this._raf
      );

      this._raf = null;
    }

    this.controls.enabled = false;

    const session =
      await navigator.xr.requestSession(
        'immersive-vr',
        {
          optionalFeatures: [
            'local-floor',
            'bounded-floor',
            'hand-tracking',
          ],
        }
      );

    this._vrSession = session;

    // Give Three.js the WebXR session.
    await this.renderer.xr.setSession(
      session
    );

    // Three.js uses setAnimationLoop for XR.
    this._xrRenderCallback = () => {
      if (
        this._measure.points.length > 0
      ) {
        this._emitMeasure();
      }

      this.renderer.render(
        this.scene,
        this.camera
      );
    };

    this.renderer.setAnimationLoop(
      this._xrRenderCallback
    );

    session.addEventListener(
      'end',
      () => {
        this._handleVREnd();
      },
      {
        once: true,
      }
    );
  }

  _handleVREnd() {
    this.renderer.setAnimationLoop(
      null
    );

    this._vrSession = null;
    this._xrRenderCallback = null;

    this.controls.enabled = true;

    // Restart the normal desktop render loop.
    if (!this._raf) {
      this._raf =
        requestAnimationFrame(
          this._animate
        );
    }
  }

  async exitVR() {
    if (this._vrSession) {
      await this._vrSession.end();
    }
  }

  isVRPresenting() {
    return this.renderer.xr.isPresenting;
  }

  // =============================================================
  // Lifecycle
  // =============================================================

  _onResize() {
    const {
      clientWidth,
      clientHeight,
    } = this.canvas;

    if (
      clientWidth === 0 ||
      clientHeight === 0
    ) {
      return;
    }

    this.camera.aspect =
      clientWidth /
      clientHeight;

    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      clientWidth,
      clientHeight,
      false
    );
  }

  _animate() {
    // WebXR has its own render loop through
    // renderer.setAnimationLoop().
    if (this.renderer.xr.isPresenting) {
      return;
    }

    this._raf =
      requestAnimationFrame(
        this._animate
      );

    this.controls.enabled = true;

    this.controls.update();

    if (
      this._measure.points.length > 0
    ) {
      this._emitMeasure();
    }

    this.renderer.render(
      this.scene,
      this.camera
    );
  }

  // =============================================================
  // React / GestureBridge helper
  // =============================================================

  refreshSelectedProperties() {
    if (this.selected) {
      this.onSelectionChange?.(
        this.getProperties(
          this.selected
        )
      );
    }
  }

  // =============================================================
  // Cleanup
  // =============================================================

  dispose() {
    cancelAnimationFrame(
      this._raf
    );

    this._raf = null;

    this.renderer.setAnimationLoop(
      null
    );

    if (this._vrSession) {
      this._vrSession.end().catch(
        () => {}
      );

      this._vrSession = null;
    }

    this._resizeObserver.disconnect();

    this.canvas.removeEventListener(
      'click',
      this._onClick
    );

    this.clearModel();

    this.controls.dispose();

    this.renderer.dispose();
  }
}