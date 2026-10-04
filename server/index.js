// 峡谷对决 3D 服务器：提供网页静态文件 + 双人对战 WebSocket（/ws）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const ROOM_IDLE_MS = 10 * 60 * 1000; // 房间 10 分钟没人在线就回收
const MAX_ROOMS = 5000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};
const ALLOWED = [/^\/index\.html$/, /^\/style\.css$/, /^\/js\/[\w.-]+\.js$/, /^\/vendor\/[\w.-]+\.js$/, /^\/audio\/voice\/[\w.-]+\.mp3$/];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (p === '/api/stats') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ rooms: rooms.size, playing: [...rooms.values()].filter((r) => r.phase === 'playing').length, clients: wss.clients.size }));
    return;
  }
  if (p === '/') p = '/index.html';
  if (!ALLOWED.some((re) => re.test(p))) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : p.startsWith('/vendor/') || p.startsWith('/audio/') ? 'public, max-age=86400' : 'public, max-age=300',
    });
    res.end(data);
  });
});

// ---------- 房间 ----------
const rooms = new Map();

function newCode() {
  for (let k = 0; k < 200; k++) {
    const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!rooms.has(c)) return c;
  }
  return null;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, perMessageDeflate: { threshold: 256 } });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.msgCount = 0;
  ws.msgWindow = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  ws.on('message', (raw) => {
    // 简单限流：每秒最多 120 条
    const now = Date.now();
    if (now - ws.msgWindow > 1000) { ws.msgWindow = now; ws.msgCount = 0; }
    if (++ws.msgCount > 120) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const ref = ws.seatRef;
    switch (m.t) {
      case 'ping': ws.send(JSON.stringify({ t: 'pong', c: m.c })); return;
      case 'create': {
        if (ref) ref.room.leave(ref.seat);
        if (rooms.size >= MAX_ROOMS) { ws.send(JSON.stringify({ t: 'err', msg: '服务器房间已满，请稍后再试' })); return; }
        const code = newCode();
        if (!code) { ws.send(JSON.stringify({ t: 'err', msg: '暂时无法创建房间，请重试' })); return; }
        const room = new Room(code, log);
        rooms.set(code, room);
        room.join(ws, m.hero);
        log(`room ${code} created by ${ip}`);
        return;
      }
      case 'join': {
        const code = String(m.code || '').trim();
        const room = rooms.get(code);
        if (!/^\d{4}$/.test(code) || !room) { ws.send(JSON.stringify({ t: 'err', msg: `房间 ${code} 不存在` })); return; }
        if (ref && ref.room === room) return;
        if (ref) ref.room.leave(ref.seat);
        if (room.join(ws, m.hero) < 0) ws.send(JSON.stringify({ t: 'err', msg: '房间已满' }));
        return;
      }
      case 'rejoin': {
        const room = rooms.get(String(m.code || ''));
        if (!room || room.rejoin(ws, String(m.token || '')) < 0) ws.send(JSON.stringify({ t: 'err', msg: '房间已失效', gone: 1 }));
        return;
      }
      case 'leave':
        if (ref) ref.room.leave(ref.seat);
        return;
      default:
        if (ref) ref.room.onMessage(ref.seat, m);
    }
  });

  ws.on('close', () => {
    const ref = ws.seatRef;
    if (ref) ref.room.disconnected(ref.seat);
  });
});

// 心跳：清理掉线的连接
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// 回收空房间
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.sweep();
    if (room.empty || (!room.online && now - room.lastActive > ROOM_IDLE_MS)) {
      room.destroy();
      rooms.delete(code);
      log(`room ${code} removed`);
    }
  }
}, 15000);

server.listen(PORT, () => log(`峡谷对决服务器已启动：http://localhost:${PORT}`));
