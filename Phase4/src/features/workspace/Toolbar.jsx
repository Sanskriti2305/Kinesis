const GESTURE_STATUS_LABEL = {
  idle: 'Gesture: off',
  connecting: 'Gesture: connecting…',
  connected: 'Gesture: connected',
  disconnected: 'Gesture: relay offline',
};

export default function Toolbar({
  onLoadFile,
  onLoadSample,
  modelName,
  gestureStatus,
  activeGesture,
  gestureEnabled,
  onToggleGesture,
  onEnterVR,
}) {
  const handleQuest3S = async () => {
    if (!onEnterVR) {
      alert('VR is not connected to the workspace yet.');
      return;
    }

    try {
      await onEnterVR();

      alert(
        'Meta Quest 3S VR session started.'
      );
    } catch (error) {
      console.error(
        'Quest 3S VR connection failed:',
        error
      );

      alert(
        error?.message ||
        'Unable to start VR. Connect your Meta Quest 3S using Quest Link, Air Link, or open Kinesis in the Quest Browser.'
      );
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar__brand">
        KINESIS <span>/ Phase 2 — 3D Workspace</span>
      </div>

      <div className="toolbar__actions">
        {gestureEnabled ? (
          <button
            className={`gesture-pill gesture-pill--${gestureStatus}`}
            onClick={onToggleGesture}
            title="Click to turn off gesture control"
          >
            {GESTURE_STATUS_LABEL[gestureStatus] ||
              gestureStatus}

            {gestureStatus === 'connected' &&
              activeGesture &&
              activeGesture !== 'NONE' && (
                <em>{activeGesture}</em>
              )}
          </button>
        ) : (
          <button
            className="btn btn--ghost"
            onClick={onToggleGesture}
          >
            Enable Gestures
          </button>
        )}

        {/* Meta Quest 3S */}
        <button
          className="btn btn--ghost"
          onClick={handleQuest3S}
          title="Connect Meta Quest 3S"
        >
          🥽 Quest 3S
        </button>

        <span className="toolbar__model-name">
          {modelName || 'No model loaded'}
        </span>

        <button
          className="btn btn--ghost"
          onClick={onLoadSample}
        >
          Load Sample Assembly
        </button>

        <label className="btn btn--accent">
          Import Model

          <input
            type="file"
            accept=".obj,.stl"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];

              if (file) {
                onLoadFile(file);
              }

              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}