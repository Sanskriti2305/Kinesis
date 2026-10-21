function fmt(n) {
  return Number(n).toFixed(2);
}

function Vector3Row({ label, v, suffix = '' }) {
  return (
    <div className="prop-row">
      <span className="prop-row__label">{label}</span>
      <span className="prop-row__value">
        {fmt(v.x)}{suffix} &nbsp;{fmt(v.y)}{suffix} &nbsp;{fmt(v.z)}{suffix}
      </span>
    </div>
  );
}

export default function PropertiesPanel({ properties }) {
  return (
    <div className="panel">
      <div className="panel__header">Properties</div>
      <div className="panel__body">
        {properties ? (
          <>
            <div className="prop-row">
              <span className="prop-row__label">Name</span>
              <span className="prop-row__value">{properties.name}</span>
            </div>
            <Vector3Row label="Position" v={properties.position} />
            <Vector3Row label="Rotation" v={properties.rotation} suffix="°" />
            <Vector3Row label="Dimensions" v={properties.dimensions} />
            <div className="prop-row">
              <span className="prop-row__label">Vertices</span>
              <span className="prop-row__value">{properties.vertexCount}</span>
            </div>
            <div className="prop-row">
              <span className="prop-row__label">Faces</span>
              <span className="prop-row__value">{properties.faceCount}</span>
            </div>
          </>
        ) : (
          <div className="panel__empty">Select a part in the viewport or the tree.</div>
        )}
      </div>
    </div>
  );
}
