import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { SceneManager } from '../../three/SceneManager';

// forwardRef + useImperativeHandle is the escape hatch for mixing an
// imperative library (Three.js) with React: App calls
// viewportRef.current.loadModel(...) / selectByUuid(...) directly,
// instead of trying to model the entire 3D scene as React state.
const Viewport = forwardRef(function Viewport({ onSelectionChange, onTreeChange }, ref) {
  const canvasRef = useRef(null);
  const managerRef = useRef(null);

  useEffect(() => {
    const manager = new SceneManager(canvasRef.current);
    manager.onSelectionChange = onSelectionChange;
    managerRef.current = manager;
    return () => manager.dispose();
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
  }));

  return <canvas ref={canvasRef} className="viewport-canvas" />;
});

export default Viewport;
