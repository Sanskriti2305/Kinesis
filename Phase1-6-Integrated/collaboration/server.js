const { WebSocketServer } = require('ws');
const PORT = Number(process.env.COLLAB_PORT || 8790);
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { clients: new Set(), transforms: new Map(), selection: null, model: null });
  }
  return rooms.get(name);
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) {
  room.clients.forEach((client) => { if (client !== except) send(client.ws, msg); });
}

function cleanTransform(transform) {
  return {
    position: {
      x: Number(transform?.position?.x || 0),
      y: Number(transform?.position?.y || 0),
      z: Number(transform?.position?.z || 0),
    },
    quaternion: {
      x: Number(transform?.quaternion?.x || 0),
      y: Number(transform?.quaternion?.y || 0),
      z: Number(transform?.quaternion?.z || 0),
      w: Number(transform?.quaternion?.w ?? 1),
    },
    scale: {
      x: Number(transform?.scale?.x || 1),
      y: Number(transform?.scale?.y || 1),
      z: Number(transform?.scale?.z || 1),
    },
    uuid: transform?.uuid || null,
  };
}

function stateFor(room) {
  const transforms = {};
  for (const [syncId, item] of room.transforms.entries()) transforms[syncId] = item.transform;
  return { transforms, selection: room.selection, model: room.model };
}

wss.on('connection', (ws) => {
  const client = { ws, room: null, clientId: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      client.room = String(msg.room || 'KINESIS-DEMO').trim().toUpperCase();
      client.clientId = String(msg.clientId || `${Date.now()}-${Math.random()}`);
      const room = getRoom(client.room);
      room.clients.add(client);
      send(ws, { type: 'state', clientId: 'server', state: stateFor(room) });
      broadcast(room, { type: 'presence', clientId: client.clientId, joined: true }, client);
      return;
    }

    if (!client.room) return;
    const room = getRoom(client.room);

    if (msg.type === 'transform' && msg.syncId && msg.transform) {
      const key = String(msg.syncId);
      const stamp = Number(msg.timestamp || Date.now());
      const previous = room.transforms.get(key);
      if (!previous || stamp >= previous.timestamp) {
        const transform = cleanTransform(msg.transform);
        room.transforms.set(key, { transform, timestamp: stamp, clientId: client.clientId });
        broadcast(room, {
          type: 'transform',
          syncId: key,
          uuid: msg.uuid || transform.uuid || null,
          transform,
          timestamp: stamp,
          clientId: client.clientId,
        }, client);
      }
      return;
    }

    if (msg.type === 'selection') {
      room.selection = msg.syncId || msg.uuid || null;
      broadcast(room, {
        type: 'selection',
        syncId: room.selection,
        uuid: msg.uuid || null,
        clientId: client.clientId,
      }, client);
      return;
    }

    if (msg.type === 'model' && (msg.model?.url || msg.model?.transfer?.base64)) {
      room.model = {
        name: String(msg.model.name || 'model'),
        url: msg.model.url ? String(msg.model.url) : null,
        transfer: msg.model.transfer || null,
      };
      broadcast(room, { type: 'state', state: stateFor(room), clientId: client.clientId }, client);
      return;
    }

    if (msg.type === 'snapshot' && msg.snapshot) {
      const transforms = msg.snapshot.transforms || {};
      const stamp = Number(msg.timestamp || Date.now());
      Object.entries(transforms).forEach(([syncId, transform]) => {
        room.transforms.set(String(syncId), { transform: cleanTransform(transform), timestamp: stamp, clientId: client.clientId });
      });
      if (Object.prototype.hasOwnProperty.call(msg.snapshot, 'selection')) room.selection = msg.snapshot.selection || null;
      broadcast(room, { type: 'state', state: stateFor(room), clientId: client.clientId }, client);
    }
  });

  ws.on('close', () => {
    if (!client.room) return;
    const room = getRoom(client.room);
    room.clients.delete(client);
    broadcast(room, { type: 'presence', clientId: client.clientId, left: true }, client);
    if (room.clients.size === 0) rooms.delete(client.room);
  });
});

console.log(`[kinesis-collab] listening on ws://localhost:${PORT}`);
