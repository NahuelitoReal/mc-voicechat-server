const http = require('http');
const { WebSocketServer } = require('ws');

const rooms = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

const wss = new WebSocketServer({ server, maxPayload: 262144 });

function newCode() {
  let c;
  do {
    c = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(c));
  return c;
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function users(room) {
  return [...room].map((m) => m.user);
}

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const n = v.trim();
  if (n.length < 1 || n.length > 32) return null;
  return n;
}

function enter(ws, code, user) {
  const room = rooms.get(code);
  if (!room) {
    send(ws, { t: 'error', m: 'sala_no_existe' });
    return;
  }
  if (users(room).includes(user)) {
    send(ws, { t: 'error', m: 'usuario_en_uso' });
    return;
  }
  ws.room = code;
  ws.user = user;
  room.add(ws);
  send(ws, { t: 'joined', room: code, users: users(room) });
  for (const m of room) {
    if (m !== ws) send(m, { t: 'joined_other', user, users: users(room) });
  }
}

function leave(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  room.delete(ws);
  ws.room = null;
  if (room.size === 0) return;
  for (const m of room) send(m, { t: 'left', user: ws.user, users: users(room) });
}

function sweep() {
  for (const [code, room] of rooms) {
    if (room.size === 0) rooms.delete(code);
  }
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.room = null;
  ws.user = null;

  ws.on('pong', () => {
    ws.alive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'create') {
      const user = cleanName(msg.user);
      if (!user || ws.room) return;
      const code = newCode();
      rooms.set(code, new Set());
      enter(ws, code, user);
      return;
    }

    if (msg.t === 'join') {
      const user = cleanName(msg.user);
      const code = typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : '';
      if (!user || !code || ws.room) return;
      enter(ws, code, user);
      return;
    }

    if (msg.t === 'leave') {
      leave(ws);
      return;
    }

    if (msg.t === 'a' && ws.room && typeof msg.d === 'string') {
      const room = rooms.get(ws.room);
      if (!room) return;
      for (const m of room) {
        if (m !== ws) send(m, { t: 'a', from: ws.user, d: msg.d });
      }
    }
  });

  ws.on('close', () => {
    leave(ws);
    sweep();
  });

  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.listen(process.env.PORT || 3000);
