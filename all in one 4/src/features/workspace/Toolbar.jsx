const GESTURE_STATUS_LABEL = {
  idle: 'Gesture: off',
  connecting: 'Gesture: connecting…',
  connected: 'Gesture: connected',
  disconnected: 'Gesture: relay offline',
};

export default function Toolbar({
  onLoadFile,
  onLoadSample,
  onLoadCar,
  modelName,
  gestureStatus,
  activeGesture,
  gestureEnabled,
  onToggleGesture,
  onEnterVR,
  onToggleAR,
  arActive,
  hasModel,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar__brand">KINESIS <span>/ Phase 1–9 Spatial Workspace</span></div>
      <div className="toolbar__actions">
        {gestureEnabled ? (
          <button
            className={`gesture-pill gesture-pill--${gestureStatus}`}
            onClick={onToggleGesture}
            title="Click to turn off gesture control"
          >
            {GESTURE_STATUS_LABEL[gestureStatus] || gestureStatus}
            {gestureStatus === 'connected' && activeGesture && activeGesture !== 'NONE' && (
              <em>{activeGesture}</em>
            )}
          </button>
        ) : (
          <button className="btn btn--ghost" onClick={onToggleGesture}>
            Enable Gestures
          </button>
        )}
        <button className="btn btn--ghost" onClick={onEnterVR}>🥽 Quest 3S</button>
        <button
          className="btn btn--ghost"
          onClick={onToggleAR}
          disabled={!hasModel && !arActive}
          title={!hasModel && !arActive ? 'Load a model first' : 'Start an AR session on this phone'}
        >
          {arActive ? '📱 Exit AR' : '📱 AR'}
        </button>
        <span className="toolbar__model-name">{modelName || 'No model loaded'}</span>
        <button className="btn btn--ghost" onClick={onLoadSample}>Load Sample Assembly</button>
        <button className="btn btn--ghost" onClick={onLoadCar}>Load Car Assembly</button>
        <label className="btn btn--accent">
          Import Model
          <input
            type="file"
            accept=".obj,.stl,.dxf,.dwg"
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
