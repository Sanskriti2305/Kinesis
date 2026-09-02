import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import Viewport from './features/workspace/Viewport';
import ObjectTree from './features/workspace/ObjectTree';
import PropertiesPanel from './features/workspace/PropertiesPanel';
import Toolbar from './features/workspace/Toolbar';
import ToolsBar from './features/workspace/ToolsBar';
import AIAssistant from './features/workspace/AIAssistant';
import SimulationPanel from './features/workspace/SimulationPanel';
import { GestureBridge } from './gesture/GestureBridge';
import './App.css';

const GESTURE_BRIDGE_URL =
  import.meta.env.VITE_GESTURE_BRIDGE_URL ||
  'ws://localhost:8765';

// App owns only the plain-data state that React needs to render UI:
// the object tree snapshot, the selected part's properties, tool state
// (explode/section/measure), and gesture connection status. The live
// Three.js world — and now the live gesture bridge — lives entirely
// inside SceneManager / GestureBridge, reached through viewportRef.
export default function App() {
  const viewportRef = useRef(null);
  const gestureBridgeRef = useRef(null);

  const [tree, setTree] = useState(null);
  const [properties, setProperties] = useState(null);
  const [modelName, setModelName] = useState(null);
  const [error, setError] = useState(null);

  const [explodeFactor, setExplodeFactorState] = useState(0);
  const [explodeAvailable, setExplodeAvailable] = useState(false);

  const [section, setSection] = useState({
    enabled: false,
    axis: 'x',
    offset: 0,
    bounds: {
      min: -1,
      max: 1,
    },
  });

  const [measureActive, setMeasureActive] = useState(false);
  const [measure, setMeasure] = useState(null);

  const [simulation, setSimulation] = useState({
    hasModel: false,
    massKg: null,
    stressIndex: null,
    maxStress: null,
    safety: 'none',
    safetyLabel: 'No model',
  });

  const [heatmap, setHeatmap] = useState(false);

  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureStatus, setGestureStatus] = useState('idle');
  const [activeGesture, setActiveGesture] = useState('NONE');

  const hasModel = !!tree;

  // -------------------------------------------------------------
  // Gesture Bridge
  // -------------------------------------------------------------

  useEffect(() => {
    const manager =
      viewportRef.current?.getManager();

    if (!manager) return undefined;

    const bridge =
      new GestureBridge(manager, {
        url: GESTURE_BRIDGE_URL,
        onStatusChange: setGestureStatus,
        onGestureChange: setActiveGesture,
      });

    gestureBridgeRef.current = bridge;

    manager.onSimulationChange =
      setSimulation;

    return () => bridge.disconnect();
  }, []);

  const handleToggleGesture = () => {
    const bridge =
      gestureBridgeRef.current;

    if (!bridge) return;

    if (gestureEnabled) {
      bridge.disconnect();

      setGestureEnabled(false);
      setGestureStatus('idle');
    } else {
      setGestureEnabled(true);
      bridge.connect();
    }
  };

  // -------------------------------------------------------------
  // Meta Quest 3S / WebXR
  // -------------------------------------------------------------

  const handleEnterVR = async () => {
    const manager =
      viewportRef.current?.getManager();

    if (!manager) {
      throw new Error(
        '3D workspace is not ready yet.'
      );
    }

    await manager.enterVR();
  };

  // -------------------------------------------------------------
  // Model loading
  // -------------------------------------------------------------

  const handleLoad = async (source) => {
    setError(null);

    try {
      await viewportRef.current.loadModel(
        source
      );

      setModelName(
        source instanceof File
          ? source.name
          : source.split('/').pop()
      );

      const manager =
        viewportRef.current.getManager();

      setExplodeFactorState(0);

      setExplodeAvailable(
        manager.getExplodeAvailable()
      );

      const bounds =
        manager.getSectionBounds();

      setSection({
        enabled: false,
        axis: 'x',
        offset: 0,
        bounds,
      });

      manager.setSectionEnabled(false);

      setMeasureActive(false);

      manager.setMeasureActive(false);
    } catch (err) {
      setError(err.message);
    }
  };

  // -------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------

  const handleSelect = (uuid) => {
    viewportRef.current.selectByUuid(
      uuid
    );
  };

  // -------------------------------------------------------------
  // Explode
  // -------------------------------------------------------------

  const handleExplodeChange = (factor) => {
    setExplodeFactorState(factor);

    viewportRef.current
      .getManager()
      .setExplodeFactor(factor);
  };

  // -------------------------------------------------------------
  // Section
  // -------------------------------------------------------------

  const handleSectionToggle = (enabled) => {
    setSection((s) => ({
      ...s,
      enabled,
    }));

    viewportRef.current
      .getManager()
      .setSectionEnabled(enabled);
  };

  const handleSectionAxis = (axis) => {
    const manager =
      viewportRef.current.getManager();

    manager.setSectionAxis(axis);

    setSection((s) => ({
      ...s,
      axis,
      offset: 0,
      bounds:
        manager.getSectionBounds(),
    }));
  };

  const handleSectionOffset = (offset) => {
    setSection((s) => ({
      ...s,
      offset,
    }));

    viewportRef.current
      .getManager()
      .setSectionOffset(offset);
  };

  // -------------------------------------------------------------
  // Measure
  // -------------------------------------------------------------

  const handleMeasureToggle = (active) => {
    setMeasureActive(active);

    viewportRef.current
      .getManager()
      .setMeasureActive(active);

    if (!active) {
      setMeasure(null);
    }
  };

  const handleMeasureChange =
    useCallback(
      (result) => setMeasure(result),
      []
    );

  // -------------------------------------------------------------
  // AI commands
  // -------------------------------------------------------------

  const handleAICommand = (toolCall) => {
    const manager =
      viewportRef.current?.getManager();

    if (!manager || !manager.selected) {
      return;
    }

    const args =
      toolCall?.arguments || {};

    if (
      toolCall.name !==
      'transform_selected_part'
    ) {
      return;
    }

    if (
      args.action === 'scale' &&
      Number.isFinite(args.factor)
    ) {
      manager.scaleSelectedByFactor(
        args.factor
      );
    }

    if (args.action === 'move') {
      manager.translateSelectedBy(
        Number(args.dx || 0),
        Number(args.dy || 0)
      );
    }

    if (args.action === 'rotate') {
      const q =
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(
              Number(args.rx || 0)
            ),
            THREE.MathUtils.degToRad(
              Number(args.ry || 0)
            ),
            THREE.MathUtils.degToRad(
              Number(args.rz || 0)
            )
          )
        );

      manager.rotateSelectedByDelta(q);
    }

    manager.refreshSelectedProperties();
  };

  // -------------------------------------------------------------
  // Heatmap
  // -------------------------------------------------------------

  const handleHeatmapToggle = (
    enabled
  ) => {
    setHeatmap(enabled);

    viewportRef.current
      ?.getManager()
      ?.setHeatmapEnabled(enabled);
  };

  // -------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------

  const handleSimulationRefresh = () =>
    viewportRef.current
      ?.getManager()
      ?.calculateSimulation();

  // -------------------------------------------------------------
  // UI
  // -------------------------------------------------------------

  return (
    <div className="app">
      <Toolbar
        onLoadFile={handleLoad}
        onLoadSample={() =>
          handleLoad(
            '/models/sample_assembly.obj'
          )
        }
        modelName={modelName}
        gestureStatus={gestureStatus}
        activeGesture={activeGesture}
        gestureEnabled={gestureEnabled}
        onToggleGesture={
          handleToggleGesture
        }

        // Meta Quest 3S / WebXR
        onEnterVR={handleEnterVR}
      />

      <div className="app__body">
        <ObjectTree
          tree={tree}
          selectedUuid={
            properties?.uuid
          }
          onSelect={handleSelect}
        />

        <div className="app__viewport-wrap">
          <Viewport
            ref={viewportRef}
            onTreeChange={setTree}
            onSelectionChange={
              setProperties
            }
            onMeasureChange={
              handleMeasureChange
            }
          />

          {error && (
            <div className="viewport-error">
              {error}
            </div>
          )}

          {hasModel && (
            <ToolsBar
              disabled={!hasModel}
              explode={{
                factor: explodeFactor,
                available:
                  explodeAvailable,
                onChange:
                  handleExplodeChange,
              }}
              section={{
                enabled:
                  section.enabled,
                axis: section.axis,
                offset:
                  section.offset,
                bounds:
                  section.bounds,
                onToggle:
                  handleSectionToggle,
                onAxisChange:
                  handleSectionAxis,
                onOffsetChange:
                  handleSectionOffset,
              }}
              measure={{
                active:
                  measureActive,
                distance:
                  measure?.distance,
                onToggle:
                  handleMeasureToggle,
              }}
            />
          )}

          {measure?.pointCount === 2 &&
            measure.screenA &&
            measure.screenB && (
              <div
                className="measure-label"
                style={{
                  left:
                    (measure.screenA.x +
                      measure.screenB.x) /
                    2,

                  top:
                    (measure.screenA.y +
                      measure.screenB.y) /
                    2,
                }}
              >
                {measure.distance.toFixed(
                  3
                )}{' '}
                units
              </div>
            )}

          {measureActive &&
            !hasModel && (
              <div className="viewport-error">
                Load a model before
                measuring.
              </div>
            )}
        </div>

        <div className="app__rightbar">
          <PropertiesPanel
            properties={properties}
          />

          <AIAssistant
            selected={properties}
            onApplyCommand={
              handleAICommand
            }
          />

          <SimulationPanel
            simulation={simulation}
            heatmap={heatmap}
            onToggleHeatmap={
              handleHeatmapToggle
            }
            onRefresh={
              handleSimulationRefresh
            }
          />
        </div>
      </div>
    </div>
  );
}