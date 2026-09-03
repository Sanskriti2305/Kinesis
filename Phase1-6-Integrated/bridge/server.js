// Gesture bridge relay.
//
// Dumb forwarder, on purpose: UDP packet in -> same bytes out to every
// connected WebSocket client. No gesture logic, no parsing beyond what's
// needed to forward. Runs as its own process, independent of Vite and
// independent of Unity — start/stop it without touching either.
//
// Listens on UDP :5052, which Hand_tracking/hand_tracker.py now sends
// to *in addition to* Unity's UDP :5051 (see the one small addition
// made to that file). Unity keeps listening on :5051 exactly as before
// and is completely unaffected by this running or not.
//
// Usage:
//   cd bridge
//   npm install
//   npm start
//
// Override ports with env vars if 5052/8765 are taken:
//   GESTURE_UDP_PORT=5052 GESTURE_WS_PORT=8765 npm start

const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const UDP_PORT = Number(process.env.GESTURE_UDP_PORT || 5052);
const WS_PORT = Number(process.env.GESTURE_WS_PORT || 8765);

const udpSocket = dgram.createSocket('udp4');
const wss = new WebSocketServer({ port: WS_PORT });

let lastPacketAt = null;

udpSocket.on('message', (msg) => {
  lastPacketAt = Date.now();
  const text = msg.toString('utf8');
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) client.send(text);
  });
});

udpSocket.on('error', (err) => {
  console.error('[gesture-bridge] UDP socket error:', err.message);
});

udpSocket.bind(UDP_PORT, () => {
  console.log(`[gesture-bridge] listening for hand-tracker packets on UDP :${UDP_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[gesture-bridge] React app connected');
  ws.on('close', () => console.log('[gesture-bridge] React app disconnected'));
});

console.log(`[gesture-bridge] forwarding to WebSocket clients on ws://localhost:${WS_PORT}`);

// Friendly heads-up if the Python tracker doesn't seem to be running —
// checked lazily, doesn't block anything.
setInterval(() => {
  if (lastPacketAt === null) {
    console.log('[gesture-bridge] no packets received yet — is hand_tracker.py running?');
  }
}, 10000);
