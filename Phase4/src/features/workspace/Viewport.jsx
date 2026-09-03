import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';

import { SceneManager } from '../../three/SceneManager';

const Viewport = forwardRef(function Viewport(
  {
    onSelectionChange,
    onTreeChange,
    onMeasureChange,
  },
  ref
) {
  const canvasRef = useRef(null);
  const managerRef = useRef(null);

  useEffect(() => {
    const manager =
      new SceneManager(
        canvasRef.current
      );

    manager.onSelectionChange =
      onSelectionChange;

    manager.onMeasureChange =
      onMeasureChange;

    managerRef.current = manager;

    return () => {
      manager.dispose();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async loadModel(source) {
        await managerRef.current.loadModel(
          source
        );

        onTreeChange(
          managerRef.current.getObjectTree()
        );

        onSelectionChange(null);
      },

      selectByUuid(uuid) {
        managerRef.current.selectByUuid(
          uuid
        );
      },

      getManager() {
        return managerRef.current;
      },

      // Meta Quest 3S / WebXR
      async enterVR() {
        return managerRef.current.enterVR();
      },

      async exitVR() {
        return managerRef.current.exitVR();
      },

      isVRPresenting() {
        return managerRef.current.isVRPresenting();
      },
    }),
    [
      onTreeChange,
      onSelectionChange,
    ]
  );

  return (
    <canvas
      ref={canvasRef}
      className="viewport-canvas"
    />
  );
});

export default Viewport;