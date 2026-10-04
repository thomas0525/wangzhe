// 双人房间：大厅（选英雄、准备）→ 倒计时 → 对局（服务器运行 Sim，30Hz 推送快照）→ 结束后回到大厅
import crypto from 'node:crypto';
import { Sim } from '../js/sim.js';
import { snapshotFor } from '../js/snapshot.js';
import { HEROES } from '../js/heroes.js';
import { QUICK_CHAT } from '../js/config.js';

const TICK_MS = 1000 / 30;
const RECONNECT_GRACE = 30; // 对局中断线超过 30 秒判负
const LOBBY_GRACE = 90; // 大厅里断线超过 90 秒让出座位

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

export class Room {
  constructor(code, log) {
    this.code = code;
    this.log = log;
    this.seats = [null, null];
    this.phase = 'lobby'; // lobby | countdown | playing
    this.sim = null;
    this.timer = null;
    this.countdown = 0;
    this.lastActive = Date.now();
    this.games = 0;
  }

  get empty() { return this.seats.every((s) => !s); }
  get online() { return this.seats.some((s) => s && s.online); }

  // 新玩家入座；返回座位号，满了返回 -1
  join(ws, hero) {
    const i = this.seats.findIndex((s) => !s);
    if (i < 0) return -1;
    this.seats[i] = { token: crypto.randomBytes(12).toString('hex'), ws, hero: HEROES[hero] ? hero : 'blade', ready: false, online: true, offSince: 0, lastChat: 0 };
    this.attach(i, ws);
    this.log(`room ${this.code}: seat ${i} joined`);
    return i;
  }

  rejoin(ws, token) {
    const i = this.seats.findIndex((s) => s && s.token === token);
    if (i < 0) return -1;
    const s = this.seats[i];
    if (s.ws && s.ws !== ws) { s.ws.seatRef = null; try { s.ws.close(4000, 'replaced'); } catch { /* ignore */ } }
    s.online = true;
    s.offSince = 0;
    this.attach(i, ws);
    if (this.phase === 'playing') send(ws, this.startMsg(i));
    this.log(`room ${this.code}: seat ${i} rejoined`);
    return i;
  }

  attach(i, ws) {
    const s = this.seats[i];
    s.ws = ws;
    ws.seatRef = { room: this, seat: i };
    send(ws, { t: 'room', code: this.code, seat: i, token: s.token });
    this.broadcastLobby();
  }

  leave(i, reason = 'leave') {
    const s = this.seats[i];
    if (!s) return;
    if (s.ws) s.ws.seatRef = null;
    this.seats[i] = null;
    if (this.phase === 'playing' && this.sim && !this.sim.over) this.sim.endGame(1 - i, null, reason);
    if (this.phase === 'countdown') this.phase = 'lobby';
    for (const o of this.seats) if (o) o.ready = false;
    this.log(`room ${this.code}: seat ${i} left (${reason})`);
    this.broadcastLobby();
  }

  disconnected(i) {
    const s = this.seats[i];
    if (!s) return;
    s.online = false;
    s.offSince = Date.now();
    s.ws = null;
    if (this.phase === 'countdown') { this.phase = 'lobby'; s.ready = false; }
    this.broadcastLobby();
  }

  lobbyMsg() {
    return {
      t: 'lobby', code: this.code, phase: this.phase, cd: this.countdown,
      seats: this.seats.map((s) => (s ? { hero: s.hero, ready: s.ready, online: s.online } : null)),
    };
  }

  broadcastLobby() {
    this.lastActive = Date.now();
    const m = JSON.stringify(this.lobbyMsg());
    for (const s of this.seats) if (s) send(s.ws, m);
  }

  startMsg(team) {
    return { t: 'start', team, heroes: this.seats.map((s, i) => s?.hero || this.sim?.heroes[i].def.id) };
  }

  onMessage(i, m) {
    const s = this.seats[i];
    if (!s) return;
    this.lastActive = Date.now();
    switch (m.t) {
      case 'pick':
        if (this.phase !== 'lobby' || !HEROES[m.hero]) return;
        s.hero = m.hero;
        this.broadcastLobby();
        break;
      case 'ready':
        if (this.phase === 'playing') return;
        s.ready = !!m.v;
        if (!s.ready && this.phase === 'countdown') this.phase = 'lobby';
        this.broadcastLobby();
        if (this.seats.every((x) => x && x.ready && x.online) && this.phase === 'lobby') this.startCountdown();
        break;
      case 'chat': {
        const now = Date.now();
        if (now - s.lastChat < 1000 || !(m.id >= 0 && m.id < QUICK_CHAT.length)) return;
        s.lastChat = now;
        const msg = JSON.stringify({ t: 'chat', team: i, id: m.id | 0 });
        for (const o of this.seats) if (o) send(o.ws, msg);
        break;
      }
      case 'surrender':
        if (this.phase === 'playing' && this.sim && !this.sim.over) this.sim.endGame(1 - i, null, 'surrender');
        break;
      case 'in':
        if (this.phase === 'playing' && this.sim) {
          const mv = Array.isArray(m.mv) ? { x: +m.mv[0], z: +m.mv[1] } : null;
          this.sim.setInput(i, { move: mv, atk: !!m.atk, seq: +m.s || 0 });
        }
        break;
      case 'tap': case 'cast': case 'flash': case 'recall': case 'buy':
        if (this.phase === 'playing' && this.sim && !this.sim.over) this.sim.command(i, m);
        break;
      default:
    }
  }

  startCountdown() {
    this.phase = 'countdown';
    this.countdown = 3;
    this.broadcastLobby();
    const step = () => {
      if (this.phase !== 'countdown') return;
      this.countdown--;
      if (this.countdown <= 0) this.startGame();
      else { this.broadcastLobby(); setTimeout(step, 1000); }
    };
    setTimeout(step, 1000);
  }

  startGame() {
    this.phase = 'playing';
    this.games++;
    this.sim = new Sim({ heroes: [this.seats[0].hero, this.seats[1].hero], humans: [0, 1] });
    this.endAt = 0;
    this.log(`room ${this.code}: game ${this.games} start (${this.seats[0].hero} vs ${this.seats[1].hero})`);
    for (let i = 0; i < 2; i++) send(this.seats[i]?.ws, this.startMsg(i));
    this.broadcastLobby();
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;
    const steps = dt > 0.04 ? 2 : 1;
    for (let k = 0; k < steps; k++) sim.step(dt / steps);
    // 对局中断线过久判负
    if (!sim.over) {
      for (let i = 0; i < 2; i++) {
        const s = this.seats[i];
        if (s && !s.online && Date.now() - s.offSince > RECONNECT_GRACE * 1000) sim.endGame(1 - i, null, 'disconnect');
      }
    }
    const events = sim.drainEvents();
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (!s || !s.online) continue;
      const off = this.seats[1 - i];
      const extra = off && !off.online ? { opp: Math.max(0, Math.ceil(RECONNECT_GRACE - (Date.now() - off.offSince) / 1000)) } : {};
      send(s.ws, JSON.stringify({ t: 'snap', ...snapshotFor(sim, i, events, extra) }));
    }
    if (sim.over) {
      if (!this.endAt) { this.endAt = now; this.log(`room ${this.code}: game over, winner ${sim.winner}`); }
      if (now - this.endAt > 4000) this.stopGame();
    }
  }

  stopGame() {
    clearInterval(this.timer);
    this.timer = null;
    this.sim = null;
    this.phase = 'lobby';
    for (const s of this.seats) if (s) s.ready = false;
    this.broadcastLobby();
  }

  // 定时清理：大厅里断线太久让出座位
  sweep() {
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s && !s.online && this.phase !== 'playing' && Date.now() - s.offSince > LOBBY_GRACE * 1000) this.leave(i, 'timeout');
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
