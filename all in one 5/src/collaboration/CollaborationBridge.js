const DEFAULT_URL = import.meta.env.VITE_COLLAB_URL
  || (typeof location !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`
    : 'ws://localhost:8790');
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 6; // stop retrying automatically after this many; user can rejoin

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

    // Phase 9: a dropped WiFi packet mid-demo used to just kill collab
    // silently (status went to 'offline' and stayed there). Now it
    // retries with a short backoff, same pattern GestureBridge already
    // used for the hand-tracking relay, and gives up after a bounded
    // number of attempts rather than hammering the server forever.
    this._reconnectTimer = null;
    this._closedByUser = false;
    this._reconnectAttempts = 0;
  }

  connect(room) {
    this.disconnect();
    this._closedByUser = false;
    this._reconnectAttempts = 0;
    this.room = String(room || 'kinesis-demo').trim().toUpperCase();
    this._open();
  }

  _open() {
    this.onStatusChange?.('connecting');
    try { this.ws = new WebSocket(this.url); }
    catch { this._scheduleReconnect(); return; }

    this.ws.onopen = () => {
      this._reconnectAttempts = 0;
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
    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      this.onStatusChange?.('offline');
      if (!this._closedByUser && this.room) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onStatusChange?.('failed');
      return;
    }
    this._reconnectAttempts += 1;
    this._reconnectTimer = setTimeout(() => { if (!this._closedByUser && this.room) this._open(); }, RECONNECT_DELAY_MS);
  }

  disconnect() {
    this._closedByUser = true;
    clearTimeout(this._reconnectTimer);
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
