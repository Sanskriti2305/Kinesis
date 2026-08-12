import { useRef, useState } from 'react';
import Viewport from './features/workspace/Viewport';
import ObjectTree from './features/workspace/ObjectTree';
import PropertiesPanel from './features/workspace/PropertiesPanel';
import Toolbar from './features/workspace/Toolbar';
import './App.css';

// App owns only the plain-data state that React needs to render UI:
// the object tree snapshot, the selected part's properties, and which
// uuid is selected. The live Three.js world lives entirely inside
// SceneManager, reached through viewportRef.
export default function App() {
  const viewportRef = useRef(null);
  const [tree, setTree] = useState(null);
  const [properties, setProperties] = useState(null);
  const [modelName, setModelName] = useState(null);
  const [error, setError] = useState(null);

  const handleLoad = async (source) => {
    setError(null);
    try {
      await viewportRef.current.loadModel(source);
      setModelName(source instanceof File ? source.name : source.split('/').pop());
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSelect = (uuid) => {
    viewportRef.current.selectByUuid(uuid);
  };

  return (
    <div className="app">
      <Toolbar
        onLoadFile={handleLoad}
        onLoadSample={() => handleLoad('/models/sample_assembly.obj')}
        modelName={modelName}
      />
      <div className="app__body">
        <ObjectTree tree={tree} selectedUuid={properties?.uuid} onSelect={handleSelect} />
        <div className="app__viewport-wrap">
          <Viewport
            ref={viewportRef}
            onTreeChange={setTree}
            onSelectionChange={setProperties}
          />
          {error && <div className="viewport-error">{error}</div>}
        </div>
        <PropertiesPanel properties={properties} />
      </div>
    </div>
  );
}
