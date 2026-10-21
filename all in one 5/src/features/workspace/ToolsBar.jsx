// Controls for the three Phase 2 CAD tools. Pure render of whatever App
// passes down — same "dumb component" pattern as ObjectTree and
// PropertiesPanel. All the actual geometry work happens in SceneManager;
// this just turns clicks/drags into calls on it via the handlers App wires up.
export default function ToolsBar({
  disabled,
  explode,
  section,
  measure,
}) {
  return (
    <div className="tools-bar">
      <div className="tools-bar__group">
        <span className="tools-bar__label">Explode</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(explode.factor * 100)}
          disabled={disabled || !explode.available}
          onChange={(e) => explode.onChange(Number(e.target.value) / 100)}
        />
        <span className="tools-bar__value">
          {explode.available || disabled ? `${Math.round(explode.factor * 100)}%` : 'single part'}
        </span>
      </div>

      <div className="tools-bar__divider" />

      <div className="tools-bar__group">
        <button
          className={`btn btn--tool${section.enabled ? ' btn--tool-active' : ''}`}
          disabled={disabled}
          onClick={() => section.onToggle(!section.enabled)}
        >
          Section
        </button>
        {section.enabled && (
          <>
            <div className="tools-bar__axis-group">
              {['x', 'y', 'z'].map((axis) => (
                <button
                  key={axis}
                  className={`btn btn--axis${section.axis === axis ? ' btn--axis-active' : ''}`}
                  onClick={() => section.onAxisChange(axis)}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={section.bounds.min}
              max={section.bounds.max}
              step={(section.bounds.max - section.bounds.min) / 200 || 0.01}
              value={section.offset}
              onChange={(e) => section.onOffsetChange(Number(e.target.value))}
            />
          </>
        )}
      </div>

      <div className="tools-bar__divider" />

      <div className="tools-bar__group">
        <button
          className={`btn btn--tool${measure.active ? ' btn--tool-active' : ''}`}
          disabled={disabled}
          onClick={() => measure.onToggle(!measure.active)}
        >
          Measure
        </button>
        {measure.active && (
          <span className="tools-bar__value">
            {measure.distance != null
              ? `${measure.distance.toFixed(3)} units`
              : 'click two points on the model'}
          </span>
        )}
      </div>
    </div>
  );
}
