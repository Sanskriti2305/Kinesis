export default function Toolbar({ onLoadFile, onLoadSample, modelName }) {
  return (
    <div className="toolbar">
      <div className="toolbar__brand">KINESIS <span>/ Phase 2 — 3D Workspace</span></div>
      <div className="toolbar__actions">
        <span className="toolbar__model-name">{modelName || 'No model loaded'}</span>
        <button className="btn btn--ghost" onClick={onLoadSample}>Load Sample Assembly</button>
        <label className="btn btn--accent">
          Import Model
          <input
            type="file"
            accept=".obj,.stl"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadFile(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
