function TreeNode({ node, depth, selectedUuid, onSelect }) {
  const isSelectable = node.isMesh;
  const isSelected = node.uuid === selectedUuid;

  return (
    <div>
      <div
        className={`tree-row${isSelected ? ' tree-row--selected' : ''}${isSelectable ? ' tree-row--mesh' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => isSelectable && onSelect(node.uuid)}
      >
        <span className="tree-row__icon">{isSelectable ? '▢' : '▾'}</span>
        <span className="tree-row__label">{node.name}</span>
      </div>
      {node.children.map((child) => (
        <TreeNode
          key={child.uuid}
          node={child}
          depth={depth + 1}
          selectedUuid={selectedUuid}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// Pure render of whatever SceneManager.getObjectTree() produced.
// No Three.js imports here on purpose — this panel doesn't know or
// care that the data came from a 3D scene; it just renders a tree.
export default function ObjectTree({ tree, selectedUuid, onSelect }) {
  return (
    <div className="panel">
      <div className="panel__header">Object Tree</div>
      <div className="panel__body">
        {tree ? (
          <TreeNode node={tree} depth={0} selectedUuid={selectedUuid} onSelect={onSelect} />
        ) : (
          <div className="panel__empty">No model loaded. Import an .obj or .stl file to begin.</div>
        )}
      </div>
    </div>
  );
}
