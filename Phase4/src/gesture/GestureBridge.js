import * as THREE from 'three';

// GestureBridge converts hand-tracking packets into smooth
// transformations for the Kinesis workspace.
//
// Packet shape from Hand_tracking/hand_tracker.py:
// { x, y, index_x, index_y, thumb_x, thumb_y, pinch_distance,
//   openness, qx, qy, qz, qw, gesture: "MOVE"|"SCALE"|"ROTATE"|"NONE", pinch }

const RECONNECT_DELAY_MS = 2000;

// -----------------------------
// SCALE SETTINGS
// -----------------------------

// How strongly hand openness affects model size.
const SCALE_SENSITIVITY = 4.0;

// Ignore very small tracking fluctuations.
const SCALE_DEADZONE = 0.004;

// Smooth webcam tracking noise.
const SCALE_SMOOTHING = 0.20;

// Maximum size change allowed from the gesture.
const MIN_GESTURE_SCALE = 0.50;
const MAX_GESTURE_SCALE = 2.00;

export class GestureBridge {
  constructor(
    sceneManager,
    { url = 'ws://localhost:8765', onStatusChange, onGestureChange } = {}
  ) {
    this.sceneManager = sceneManager;
    this.url = url;
    this.onStatusChange = onStatusChange;
    this.onGestureChange = onGestureChange;

    this.ws = null;
    this._reconnectTimer = null;
    this._closedByUser = false;

    this._prevGesture = 'NONE';
    this._prev = null;

    // SCALE state
    this._scaleBaseline = null;
    this._scaleSmoothed = null;
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

    this.ws.onopen = () => {
      this._setStatus('connected');
    };

    this.ws.onmessage = (event) => {
      this._handleMessage(event.data);
    };

    this.ws.onerror = () => {};

    this.ws.onclose = () => {
      this._setStatus('disconnected');

      if (!this._closedByUser) {
        this._scheduleReconnect();
      }
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

    this._reconnectTimer = setTimeout(
      () => this.connect(),
      RECONNECT_DELAY_MS
    );
  }

  _setStatus(status) {
    this.onStatusChange?.(status);
  }

  _handleMessage(raw) {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const gesture = data.gesture || 'NONE';

    const quat = new THREE.Quaternion(
      data.qx,
      data.qy,
      data.qz,
      data.qw
    );

    // -----------------------------------------
    // NEW GESTURE
    // -----------------------------------------

    if (gesture !== this._prevGesture) {
      this._prevGesture = gesture;

      this._prev = {
        x: data.x,
        y: data.y,
        openness: Number(data.openness) || 0,
        quat,
      };

      // When SCALE begins, create a fresh baseline.
      if (gesture === 'SCALE') {
        const openness = Number(data.openness);

        if (Number.isFinite(openness)) {
          this._scaleBaseline = openness;
          this._scaleSmoothed = openness;
        } else {
          this._scaleBaseline = null;
          this._scaleSmoothed = null;
        }
      } else {
        this._scaleBaseline = null;
        this._scaleSmoothed = null;
      }

      this.onGestureChange?.(gesture);

      return;
    }

    // -----------------------------------------
    // APPLY GESTURE
    // -----------------------------------------

    if (this._prev && this.sceneManager.selected) {

      // ---------------------------------------
      // MOVE
      // ---------------------------------------

      if (gesture === 'MOVE') {
        const dx = data.x - this._prev.x;
        const dy = data.y - this._prev.y;

        this.sceneManager.translateSelectedBy(dx, dy);
      }

      // ---------------------------------------
      // SCALE
      // ---------------------------------------

      else if (gesture === 'SCALE') {
        const openness = Number(data.openness);

        if (
          Number.isFinite(openness) &&
          Number.isFinite(this._scaleBaseline)
        ) {
          // Smooth the raw webcam value.
          this._scaleSmoothed =
            this._scaleSmoothed +
            (openness - this._scaleSmoothed) *
              SCALE_SMOOTHING;

          // Difference from the point where SCALE started.
          const opennessDelta =
            this._scaleSmoothed - this._scaleBaseline;

          // Ignore tiny tracking noise.
          if (Math.abs(opennessDelta) > SCALE_DEADZONE) {

            /*
             * Positive opennessDelta:
             * hand opens wider → model gets BIGGER
             *
             * Negative opennessDelta:
             * hand closes → model gets SMALLER
             */

            let gestureScale =
              1 + opennessDelta * SCALE_SENSITIVITY;

            gestureScale = THREE.MathUtils.clamp(
              gestureScale,
              MIN_GESTURE_SCALE,
              MAX_GESTURE_SCALE
            );

            /*
             * Convert the desired scale relative to the
             * previous gesture scale into a per-frame factor.
             */
            const previousDelta =
              this._prev.openness - this._scaleBaseline;

            let previousGestureScale =
              1 + previousDelta * SCALE_SENSITIVITY;

            previousGestureScale =
              THREE.MathUtils.clamp(
                previousGestureScale,
                MIN_GESTURE_SCALE,
                MAX_GESTURE_SCALE
              );

            let factor =
              gestureScale / previousGestureScale;

            // Safety clamp for one frame.
            factor = THREE.MathUtils.clamp(
              factor,
              0.98,
              1.02
            );

            this.sceneManager.scaleSelectedByFactor(
              factor
            );
          }
        }
      }

      // ---------------------------------------
      // ROTATE
      // ---------------------------------------

      else if (gesture === 'ROTATE') {
        const delta = quat
          .clone()
          .multiply(
            this._prev.quat.clone().invert()
          );

        this.sceneManager.rotateSelectedByDelta(delta);
      }

      if (gesture !== 'NONE') {
        this.sceneManager.refreshSelectedProperties();
      }
    }

    // -----------------------------------------
    // SAVE CURRENT FRAME
    // -----------------------------------------

    this._prev = {
      x: data.x,
      y: data.y,
      openness:
        this._scaleSmoothed ?? Number(data.openness) ?? 0,
      quat,
    };
  }
}