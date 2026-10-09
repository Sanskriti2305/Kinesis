import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { SceneManager } from '../../three/SceneManager';

// forwardRef + useImperativeHandle is the escape hatch for mixing an
// imperative library (Three.js) with React: App calls
// viewportRef.current.loadModel(...) / selectByUuid(...) directly,
// instead of trying to model the entire 3D scene as React state.
const Viewport = forwardRef(function Viewport({ onSelectionChange, onTreeChange, onMeasureChange, onManagerReady }, ref) {
  const canvasRef = useRef(null);
  const managerRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    const manager = new SceneManager(canvasRef.current);
    manager.onSelectionChange = onSelectionChange;
    manager.onMeasureChange = onMeasureChange;
    managerRef.current = manager;
    onManagerReady?.(manager);
    return () => {
      onManagerReady?.(null);
      manager.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    async loadModel(source) {
      await managerRef.current.loadModel(source);
      onTreeChange(managerRef.current.getObjectTree());
      onSelectionChange(null);
    },
    selectByUuid(uuid) {
      managerRef.current.selectByUuid(uuid);
    },
    // Exposes the raw SceneManager for the tool controls (explode/section/
    // measure) and the gesture bridge — everything else in this component
    // keeps going through the plain-data callbacks above.
    getManager() {
      return managerRef.current;
    },
    async enterVR() { return managerRef.current.enterVR(); },
    async exitVR() { return managerRef.current.exitVR(); },
    isVRPresenting() { return managerRef.current?.isVRPresenting() || false; },
    async enterAR() { return managerRef.current.enterAR(overlayRef.current); },
    async exitAR() { return managerRef.current.exitAR(); },
    isARPresenting() { return managerRef.current?.isARPresenting() || false; },
    isARPlaced() { return managerRef.current?.isARPlaced() || false; },
  }));

  return (
    <>
      <canvas ref={canvasRef} className="viewport-canvas" />
      {/* WebXR dom-overlay root for AR: reticle hint + placement/scale
          instructions render here, and this element (not the canvas)
          is what receives the pinch/rotate/pan pointer events during
          an immersive-ar session — see SceneManager._onArPointer*. */}
      <div ref={overlayRef} id="kinesis-ar-overlay" className="ar-overlay" />
    </>
  );
});

export default Viewport;
