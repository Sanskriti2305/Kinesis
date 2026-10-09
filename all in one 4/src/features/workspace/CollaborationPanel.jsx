import { useEffect, useRef, useState } from 'react';
import { CollaborationBridge } from '../../collaboration/CollaborationBridge';

export default function CollaborationPanel({ manager }) {
  const bridgeRef = useRef(null);
  const [room, setRoom] = useState('KINESIS-DEMO');
  const [status, setStatus] = useState('offline');
  const [connected, setConnected] = useState(false);
  const pendingStateRef = useRef(null);

  useEffect(() => {
    const bridge = new CollaborationBridge({
      onStatusChange: (next) => { setStatus(next); setConnected(next === 'connected'); },
      onConnected: () => {
        // A client may have loaded the model before joining. Publish the
        // current model + complete transform snapshot so late joiners get
        // the real shared scene, not an empty room.
        if (manager) {
          bridge.broadcastModel(manager.getModelSource?.());
          bridge.broadcastSnapshot(manager.getCollaborationSnapshot?.());
        }
      },
      onRemoteTransform: (msg) => manager?.applySharedTransform(msg.syncId || msg.uuid, msg.transform, msg.uuid),
      onRemoteSelection: (syncId) => manager?.selectBySyncId(syncId),
      onRoomState: (state) => {
        pendingStateRef.current = state || null;
        manager?.applySharedState(state);
      },
      onRemoteModel: async (model) => {
        if (!manager || manager.modelRoot || !model) return;
        try {
          if (model.transfer?.base64) {
            const binary = atob(model.transfer.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const file = new File([bytes], model.transfer.name || 'shared-model.obj', { type: model.transfer.type || 'application/octet-stream' });
            await manager.loadModel(file);
          if (pendingStateRef.current) manager.applySharedState(pendingStateRef.current);
          } else if (model.url) {
            await manager.loadModel(model.url);
          if (pendingStateRef.current) manager.applySharedState(pendingStateRef.current);
          }
        } catch { /* keep local session alive */ }
      },
    });
    bridgeRef.current = bridge;
    return () => bridge.disconnect();
  }, [manager]);

  useEffect(() => {
    if (!manager) return undefined;
    const bridge = bridgeRef.current;
    const oldTransform = manager.onTransformChange;
    const oldSelection = manager.onSelectionSync;
    manager.onTransformChange = (uuid, transform, syncId) => {
      oldTransform?.(uuid, transform, syncId);
      bridge?.broadcastTransform(uuid, transform, syncId);
    };
    manager.onSelectionSync = (uuid, syncId) => {
      oldSelection?.(uuid, syncId);
      bridge?.broadcastSelection(uuid, syncId);
    };
    manager.onModelChange = (model) => {
      bridge?.broadcastModel(model);
      bridge?.broadcastSnapshot(manager.getCollaborationSnapshot?.());
    };
    return () => {
      manager.onTransformChange = oldTransform || null;
      manager.onSelectionSync = oldSelection || null;
      manager.onModelChange = null;
    };
  }, [manager]);

  const toggle = () => {
    if (connected) bridgeRef.current?.disconnect();
    else bridgeRef.current?.connect(room);
  };

  return (
    <aside className="collab-panel">
      <div className="collab-panel__header">
        <div><div className="collab-panel__title">Live Collaboration</div><div className="collab-panel__sub">Phase 6 · shared 3D session</div></div>
        <span className={`collab-status collab-status--${status}`}>{status}</span>
      </div>
      <div className="collab-panel__body">
        <label>Room code</label>
        <div className="collab-panel__row">
          <input value={room} onChange={(e) => setRoom(e.target.value.toUpperCase())} disabled={connected} />
          <button className="btn btn--accent" onClick={toggle}>{connected ? 'Leave' : 'Join'}</button>
        </div>
        <p>{connected ? `Connected to room ${room}. Selection, transforms, and supported model files are shared live.` : 'Run the collaboration server, then use the same room code on two laptops.'}</p>
      </div>
    </aside>
  );
}
