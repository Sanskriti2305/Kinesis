import * as THREE from 'three';

// GestureBridge is the ONLY thing in the React app that knows the shape
// of the hand-tracking JSON packets. It never touches Three.js objects
// directly — it just turns consecutive packets into frame-to-frame
// deltas and calls SceneManager.translateSelectedBy / rotateSelectedByDelta /
// scaleSelectedByFactor, same as this file's header comment always
// intended for "a future gesture handler."
//
// It talks to a small relay (see /bridge) over WebSocket, not to the
// hand-tracking UDP stream directly — browsers cannot open raw UDP
// sockets. The relay is a dumb forwarder: UDP in, WebSocket out,
// no gesture logic of its own.
//
// Packet shape (unchanged from Hand_tracking/hand_tracker.py):
// { x, y, index_x, index_y, thumb_x, thumb_y, pinch_distance,
//   openness, qx, qy, qz, qw, gesture: "MOVE"|"SCALE"|"ROTATE"|"NONE", pinch }

const RECONNECT_DELAY_MS = 2000;

export class GestureBridge {
  constructor(sceneManager, { url = 'ws://localhost:8765', onStatusChange, onGestureChange } = {}) {
    this.sceneManager = sceneManager;
    this.url = url;
    this.onStatusChange = onStatusChange;
    this.onGestureChange = onGestureChange;

    this.ws = null;
    this._reconnectTimer = null;
    this._closedByUser = false;

    // Frame-to-frame delta tracking. Reset whenever the gesture type
    // changes so a MOVE->ROTATE transition doesn't read as a jump.
    this._prevGesture = 'NONE';
    this._prev = null; // { x, y, openness, quat: THREE.Quaternion }
  }

  connect() {
    this._closedByUser = false;
    this._setStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => this._setStatus('connected');
    this.ws.onmessage = (event) => this._handleMessage(event.data);
    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      this._setStatus('disconnected');
      if (!this._closedByUser) this._scheduleReconnect();
    };
  }

  disconnect() {
    this._closedByUser = true;
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  _setStatus(status) {
    this.onStatusChange?.(status);
  }

  _handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // malformed packet — drop it, don't crash the session
    }

    const gesture = data.gesture || 'NONE';
    const quat = new THREE.Quaternion(data.qx, data.qy, data.qz, data.qw);

    if (gesture !== this._prevGesture) {
      // First frame of a new gesture: record a baseline, apply nothing.
      // Applying a delta here would use a baseline from a *different*
      // gesture type and jump the object.
      this._prev = { x: data.x, y: data.y, openness: data.openness, quat };
      this._prevGesture = gesture;
      this.onGestureChange?.(gesture);
      return;
    }

    if (this._prev && this.sceneManager.selected) {
      if (gesture === 'MOVE') {
        this.sceneManager.translateSelectedBy(data.x - this._prev.x, data.y - this._prev.y);
      } else if (gesture === 'SCALE') {
        const factor = this._prev.openness > 0.001 ? data.openness / this._prev.openness : 1;
        this.sceneManager.scaleSelectedByFactor(factor);
      } else if (gesture === 'ROTATE') {
        const delta = quat.clone().multiply(this._prev.quat.clone().invert());
        this.sceneManager.rotateSelectedByDelta(delta);
      }
      if (gesture !== 'NONE') this.sceneManager.refreshSelectedProperties();
    }

    this._prev = { x: data.x, y: data.y, openness: data.openness, quat };
  }
}
