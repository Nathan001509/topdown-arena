// Authoritative game server. Clients submit input only; all game rules run here.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const WIDTH = 1200, HEIGHT = 700, TICK_MS = 1000 / 60, SNAPSHOT_MS = 1000 / 30;
const PLAYER_R = 17, SPEED = 230, BULLET_SPEED = 620, BULLET_R = 5;
const FIRE_MS = 250, RESPAWN_MS = 2000, WIN_SCORE = 10, RESTART_MS = 4000;
const WALLS = [
  { x: 250, y: 135, w: 42, h: 190 }, { x: 250, y: 375, w: 42, h: 190 },
  { x: 908, y: 135, w: 42, h: 190 }, { x: 908, y: 375, w: 42, h: 190 },
  { x: 470, y: 110, w: 260, h: 34 }, { x: 470, y: 556, w: 260, h: 34 },
  { x: 530, y: 270, w: 140, h: 160 }
];
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
  const target = path.join(publicDir, file);
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server });

function makeCode() {
  let code;
  do { code = randomInt(0, 36 ** 5).toString(36).toUpperCase().padStart(5, '0'); } while (rooms.has(code));
  return code;
}
function makeRoom(mode, code = makeCode()) {
  const room = { code, mode, capacity: mode === '2v2' ? 4 : 2, players: new Map(), scores: [0, 0], bullets: [], running: false, winner: null, restartAt: 0 };
  rooms.set(code, room); return room;
}
function teamCounts(room) { return [0, 1].map(t => [...room.players.values()].filter(p => p.team === t).length); }
function resetPlayer(p, now) {
  const lane = p.team === 0 ? 0 : 1;
  p.x = lane === 0 ? 130 + Math.random() * 100 : WIDTH - 230 + Math.random() * 100;
  p.y = 140 + Math.random() * (HEIGHT - 280);
  p.hp = 100; p.deadUntil = 0; p.nextShot = now;
}
function resetMatch(room, now) {
  room.scores = [0, 0]; room.bullets = []; room.winner = null; room.restartAt = 0;
  for (const p of room.players.values()) resetPlayer(p, now);
  room.running = room.players.size === room.capacity;
}
function joinedFull(room) { if (room.players.size === room.capacity) resetMatch(room, Date.now()); }
function roomByJoin(mode, code) {
  if (code) {
    const key = code.trim().toUpperCase();
    let room = rooms.get(key);
    if (room && room.mode !== mode) return { error: 'That room uses a different game mode.' };
    if (!room) room = makeRoom(mode, key);
    if (room.players.size >= room.capacity) return { error: 'That room is full.' };
    return { room };
  }
  const room = [...rooms.values()].find(r => r.mode === mode && r.players.size < r.capacity);
  return { room: room || makeRoom(mode) };
}
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function cleanName(raw) { return String(raw || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Player'; }

wss.on('connection', ws => {
  let player = null, room = null;
  ws.on('message', raw => {
    if (raw.length > 4096) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!player && msg.type === 'join') {
      const mode = msg.mode === '2v2' ? '2v2' : '1v1';
      const found = roomByJoin(mode, typeof msg.code === 'string' ? msg.code.slice(0, 10) : '');
      if (found.error) return send(ws, { type: 'error', message: found.error });
      room = found.room;
      const counts = teamCounts(room), team = counts[0] <= counts[1] ? 0 : 1;
      player = { id: `${Date.now().toString(36)}${randomInt(0, 1e8).toString(36)}`, name: cleanName(msg.name), team, x: 0, y: 0, angle: team ? Math.PI : 0, hp: 100, deadUntil: 0, nextShot: 0, input: { up:false, down:false, left:false, right:false, shoot:false } };
      resetPlayer(player, Date.now()); room.players.set(player.id, player); ws.playerId = player.id; ws.roomCode = room.code;
      send(ws, { type: 'joined', id: player.id, roomCode: room.code, mode: room.mode });
      joinedFull(room); broadcast(room); return;
    }
    if (!player || !room || msg.type !== 'input') return;
    const i = msg.input || {};
    player.input = { up:!!i.up, down:!!i.down, left:!!i.left, right:!!i.right, shoot:!!i.shoot };
    if (Number.isFinite(i.angle)) player.angle = Math.atan2(Math.sin(i.angle), Math.cos(i.angle));
  });
  ws.on('close', () => {
    if (!player || !room) return;
    room.players.delete(player.id);
    if (room.players.size === 0) rooms.delete(room.code);
    else { room.running = false; room.winner = null; room.restartAt = 0; room.bullets = []; room.scores = [0, 0]; for (const p of room.players.values()) resetPlayer(p, Date.now()); broadcast(room); }
  });
});

function circleHitsRect(x, y, r, wall) {
  const cx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
  const cy = Math.max(wall.y, Math.min(y, wall.y + wall.h));
  return (x-cx)**2 + (y-cy)**2 < r*r;
}
function blocked(x, y, r) { return x-r < 0 || y-r < 0 || x+r > WIDTH || y+r > HEIGHT || WALLS.some(w => circleHitsRect(x,y,r,w)); }
function updateRoom(room, now, dt) {
  if (!room.running) return;
  if (room.winner !== null) {
    if (now >= room.restartAt) resetMatch(room, now);
    return;
  }
  for (const p of room.players.values()) {
    if (p.hp <= 0) { if (now >= p.deadUntil) resetPlayer(p, now); continue; }
    const i = p.input;
    let dx = (i.right?1:0) - (i.left?1:0), dy = (i.down?1:0) - (i.up?1:0);
    const mag = Math.hypot(dx,dy) || 1; dx = dx/mag*SPEED*dt; dy = dy/mag*SPEED*dt;
    if (!blocked(p.x+dx,p.y,PLAYER_R)) p.x += dx;
    if (!blocked(p.x,p.y+dy,PLAYER_R)) p.y += dy;
    if (i.shoot && now >= p.nextShot) {
      p.nextShot = now + FIRE_MS;
      room.bullets.push({ x:p.x+Math.cos(p.angle)*(PLAYER_R+7), y:p.y+Math.sin(p.angle)*(PLAYER_R+7), vx:Math.cos(p.angle)*BULLET_SPEED, vy:Math.sin(p.angle)*BULLET_SPEED, team:p.team, owner:p.id, born:now });
    }
  }
  const alive = [];
  for (const b of room.bullets) {
    b.x += b.vx*dt; b.y += b.vy*dt;
    if (b.x<0 || b.y<0 || b.x>WIDTH || b.y>HEIGHT || WALLS.some(w => b.x>=w.x && b.x<=w.x+w.w && b.y>=w.y && b.y<=w.y+w.h) || now-b.born>1800) continue;
    let hit = false;
    for (const p of room.players.values()) {
      if (p.team === b.team || p.hp <= 0) continue;
      if ((p.x-b.x)**2 + (p.y-b.y)**2 <= (PLAYER_R+BULLET_R)**2) {
        p.hp = Math.max(0, p.hp-25); hit = true;
        if (p.hp === 0) {
          p.deadUntil = now + RESPAWN_MS; const killerTeam = b.team; room.scores[killerTeam]++;
          if (room.scores[killerTeam] >= WIN_SCORE) { room.winner = killerTeam; room.restartAt = now + RESTART_MS; room.bullets = []; }
        }
        break;
      }
    }
    if (!hit) alive.push(b);
  }
  room.bullets = alive;
}
function snapshot(room) {
  const now = Date.now();
  return { type:'state', width:WIDTH, height:HEIGHT, walls:WALLS, code:room.code, mode:room.mode, capacity:room.capacity, players:room.players.size, running:room.running, waitingFor:Math.max(0,room.capacity-room.players.size), scores:room.scores, winner:room.winner, restartIn:room.winner===null?0:Math.max(0,room.restartAt-now), playersState:[...room.players.values()].map(p=>({id:p.id,name:p.name,team:p.team,x:p.x,y:p.y,angle:p.angle,hp:p.hp,dead:p.hp<=0})), bullets:room.bullets.map(b=>({x:b.x,y:b.y,team:b.team})) };
}
function broadcast(room) { const state = JSON.stringify(snapshot(room)); for (const ws of wss.clients) if (ws.readyState===WebSocket.OPEN && ws.roomCode===room.code) ws.send(state); }
let last = Date.now(), lastBroadcast = 0;
setInterval(() => {
  const now = Date.now(), dt = Math.min((now-last)/1000, 0.05); last = now;
  for (const room of rooms.values()) updateRoom(room,now,dt);
  if (now-lastBroadcast >= SNAPSHOT_MS) { lastBroadcast=now; for (const room of rooms.values()) broadcast(room); }
}, TICK_MS);
server.listen(PORT, '0.0.0.0', () => console.log(`Topdown Arena listening on ${PORT}`));
