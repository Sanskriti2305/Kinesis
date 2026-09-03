const DEFAULT_URL = import.meta.env.VITE_COLLAB_URL || 'ws://localhost:8790';

export class CollaborationBridge {
  constructor({ onStatusChange, onRemoteTransform, onRemoteSelection, onRoomState, onRemoteModel, onPresence, onConnected } = {}) {
    this.url = DEFAULT_URL;
    this.ws = null;
    this.room = null;
    this.clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.onStatusChange = onStatusChange;
    this.onRemoteTransform = onRemoteTransform;
    this.onRemoteSelection = onRemoteSelection;
    this.onRoomState = onRoomState;
    this.onRemoteModel = onRemoteModel;
    this.onPresence = onPresence;
    this.onConnected = onConnected;
  }

  connect(room) {
    this.disconnect();
    this.room = String(room || 'kinesis-demo').trim().toUpperCase();
    this.onStatusChange?.('connecting');
    try { this.ws = new WebSocket(this.url); }
    catch { this.onStatusChange?.('offline'); return; }

    this.ws.onopen = () => {
      this.onStatusChange?.('connected');
      this._send({ type: 'join', room: this.room, clientId: this.clientId });
      this.onConnected?.();
    };
    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.clientId === this.clientId) return;
      if (msg.type === 'state') {
        this.onRoomState?.(msg.state || {});
        const model = msg.state?.model;
        if (model?.url || model?.transfer?.base64) this.onRemoteModel?.(model);
      } else if (msg.type === 'transform') {
        this.onRemoteTransform?.(msg);
      } else if (msg.type === 'selection') {
        this.onRemoteSelection?.(msg.syncId || msg.uuid || null);
      } else if (msg.type === 'presence') {
        this.onPresence?.(msg);
      }
    };
    this.ws.onerror = () => this.onStatusChange?.('offline');
    this.ws.onclose = () => this.onStatusChange?.('offline');
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.room = null;
    this.onStatusChange?.('offline');
  }

  isConnected() { return this.ws?.readyState === WebSocket.OPEN; }

  _send(payload) {
    if (!this.isConnected() || !this.room) return false;
    this.ws.send(JSON.stringify({ ...payload, room: this.room, clientId: this.clientId }));
    return true;
  }

  broadcastTransform(uuid, transform, syncId) {
    if (!transform) return;
    this._send({
      type: 'transform',
      uuid: uuid || null,
      syncId: syncId || uuid || null,
      transform,
      timestamp: Date.now(),
    });
  }

  broadcastSelection(uuid, syncId) {
    this._send({ type: 'selection', uuid: uuid || null, syncId: syncId || uuid || null });
  }

  broadcastSnapshot(snapshot) {
    if (!snapshot) return;
    this._send({ type: 'snapshot', snapshot, timestamp: Date.now() });
  }

  broadcastModel(model) {
    if (model?.url || model?.transfer?.base64) this._send({ type: 'model', model });
  }
}
