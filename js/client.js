// 客户端：单人模式（本地运行 Sim）与双人模式（服务器运行 Sim）共用同一套渲染、界面和输入
import { World } from './world.js';
import { View } from './view.js';
import { Input } from './input.js';
import { Sim } from './sim.js';
import { snapshotFor } from './snapshot.js';
import { clampToMap } from './terrain.js';
import { sfx, voice } from './audio.js';

export class ClientBase {
  constructor(team, heroId, opts) {
    this.team = team;
    this.heroId = heroId;
    this.opts = opts;
    this.over = false;
    this.paused = false;
    this.world = new World(team);
    this.view = new View(this);
    this.input = new Input(this);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get me() { return this.world.me; }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) { this.view.render(0); return; }
    this.tick(dt);
  }

  // 表现层出口（录制宣传视频时可以覆盖）
  sfx(name) { sfx(name); }
  voice(name, urgent) { voice(name, urgent); }

  // 播放快照里的事件
  handleEvents(evs) {
    const w = this.world, ui = this.view.ui, me = w.me;
    const mapArg = (a) => {
      if (a && typeof a === 'object') {
        if ('u' in a && Object.keys(a).length === 1) return w.rep(a.u) || null;
        if (Array.isArray(a)) return a.map(mapArg);
        const o = {};
        for (const k in a) o[k] = mapArg(a[k]);
        return o;
      }
      return a;
    };
    for (const ev of evs) {
      const [type, ...a] = ev;
      switch (type) {
        case 'fx': {
          const args = a[1].map(mapArg);
          if (args.some((x) => x === null)) break; // 涉及的单位不可见
          const fn = this.view.fx[a[0]];
          if (typeof fn === 'function') fn.apply(this.view.fx, args);
          break;
        }
        case 'sfx': if (!a[1]?.length || (me && a[1].includes(me.id))) this.sfx(a[0]); break;
        case 'voice': this.voice(a[0]); break;
        case 'shake': this.view.shake(a[0]); break;
        case 'banner': ui.banner(a[0], a[1]); break;
        case 'feed': ui.killFeed(a[0], a[1], a[2], a[3]); break;
        case 'float': { const r = w.rep(a[0]); if (r && !r.hidden) ui.floatText(r, a[1], a[2]); break; }
        case 'dmg': {
          if (!me) break;
          const [src, tgt, amount, cls] = a;
          if (src === me.id) { const r = w.rep(tgt); if (r && !r.hidden) ui.floatText(r, amount, cls); }
          else if (tgt === me.id) { ui.floatText(me, '-' + amount, 'hurt'); if (amount > 150) this.view.shake(0.12); }
          break;
        }
        case 'snap': this.view.snapCamera(); break;
        case 'end': this.onEndEvent(a[0], a[1], a[2]); break;
        default:
      }
    }
  }

  onEndEvent(winner, crystalId, reason) {
    if (this.over) return;
    this.over = true;
    this.view.endFocus = reason === 'crystal' ? this.world.rep(crystalId) || null : null;
    this.input.finishAim(true);
    const win = winner === this.team;
    setTimeout(() => {
      this.sfx(win ? 'win' : 'lose');
      this.voice(win ? 'victory' : 'defeat', true);
      const heroes = this.world.heroes;
      this.opts.onEnd?.({
        win, reason, time: this.world.time,
        player: heroes.find((h) => h.team === this.team),
        enemy: heroes.find((h) => h.team !== this.team),
      });
    }, reason === 'crystal' ? (this.endDelay ?? 2.2) * 1000 : 600);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.view.destroy();
  }
}

// ---------------- 单人：对电脑 ----------------
export class LocalGame extends ClientBase {
  constructor(opts) {
    const sim = new Sim({
      heroes: [opts.heroId, opts.enemyId],
      ai: { 1: opts.difficulty || 'normal', ...(opts.autoplay ? { 0: 'normal' } : {}) },
      humans: opts.autoplay ? [] : [0],
    });
    super(0, opts.heroId, opts);
    this.sim = sim;
    this.speed = opts.speed || 1;
    this.publish(0);
    this.view.snapCamera();
  }

  setInput(s) { this.sim.setInput(0, s); }
  cmd(c) { this.sim.command(0, c); }
  surrender() { this.sim.endGame(1, null, 'surrender'); }

  publish() {
    const snap = snapshotFor(this.sim, 0, this.sim.drainEvents());
    const evs = this.world.apply(snap, 0);
    this.handleEvents(evs);
  }

  tick(dt) {
    this.input.update();
    this.setInput(this.input.state);
    const sdt = dt * (this.over ? Math.min(this.speed, 0.35) : this.speed);
    const steps = Math.max(1, Math.ceil(sdt / 0.034));
    for (let i = 0; i < steps; i++) this.sim.step(sdt / steps);
    this.publish();
    this.world.tick(dt);
    this.view.render(dt);
  }

  // —— 兼容测试脚本 / 宣传视频导演脚本 ——
  get player() { return this.sim.heroes[0]; }
  get enemy() { return this.sim.heroes[1]; }
  get units() { return this.sim.units; }
  get heroes() { return this.sim.heroes; }
  get projectiles() { return this.sim.projectiles; }
  get time() { return this.sim.time; }
  set time(v) { this.sim.time = v; }
  get camera() { return this.view.camera; }
  get width() { return this.view.width; }
  get height() { return this.view.height; }
  get ui() { return this.view.ui; }
  get camps() { return this.sim.camps; }
  get ais() { return this.sim.ais; }
  set ais(v) { this.sim.ais = v; }
  isVisibleTo(u, team) { return this.sim.isVisibleTo(u, team); }
  isVulnerable(u) { return this.sim.isVulnerable(u); }
  damage(...a) { return this.sim.damage(...a); }
  spawnMinion(...a) { return this.sim.spawnMinion(...a); }
  snapCamera() { this.view.snapCamera(); }
}

// ---------------- 双人：服务器权威 ----------------
const INPUT_HZ = 30;

export class NetGame extends ClientBase {
  constructor(net, team, heroId, opts) {
    super(team, heroId, opts);
    this.net = net;
    this.seq = 0;
    this.sendT = 0;
    this.pending = []; // 未被服务器确认的输入 { seq, move, dt }
    this.pred = null; // 自己英雄的预测位置
    this.corr = { x: 0, z: 0 }; // 视觉校正偏移，逐渐衰减
    this.lastSent = '';
    this.snapped = false;
  }

  get rtt() { return this.net.rtt; }
  get connected() { return this.net.connected; }

  setInput() {}
  cmd(c) { this.net.send(c); }

  onSnap(snap) {
    const evs = this.world.apply(snap, 1 / 30);
    const me = this.world.me;
    if (me && !this.snapped) { this.snapped = true; this.view.snapCamera(); }
    if (me) this.reconcile(me);
    this.handleEvents(evs);
  }

  // 服务器位置 + 尚未确认的输入 = 预测位置
  reconcile(me) {
    me.predicted = true;
    this.pending = this.pending.filter((f) => f.seq > me.ack);
    const canPredict = me.alive && !me.stunned && !me.dashing;
    let px = me.serverPos.x, pz = me.serverPos.z;
    if (canPredict) {
      for (const f of this.pending) {
        if (!f.move) continue;
        px += f.move.x * me.stats.speed * f.dt;
        pz += f.move.z * me.stats.speed * f.dt;
      }
      const c = clampToMap(px, pz, me.radius * 0.6);
      px = c.x; pz = c.z;
    }
    const old = this.pred ? { x: this.pred.x + this.corr.x, z: this.pred.z + this.corr.z } : { x: px, z: pz };
    if (Math.hypot(old.x - px, old.z - pz) > 4 || !this.pred) { this.corr = { x: 0, z: 0 }; }
    else { this.corr = { x: old.x - px, z: old.z - pz }; }
    this.pred = { x: px, z: pz };
  }

  tick(dt) {
    this.input.update();
    const st = this.input.state;
    const me = this.world.me;
    // 输入：按 30Hz 发送（状态变化时立即发送）
    this.sendT += dt;
    const key = JSON.stringify([st.move && [Math.round(st.move.x * 100), Math.round(st.move.z * 100)], st.atk]);
    if (this.sendT >= 1 / INPUT_HZ || key !== this.lastSent) {
      this.sendT = 0;
      this.lastSent = key;
      this.seq++;
      const mv = st.move ? [Math.round(st.move.x * 1000) / 1000, Math.round(st.move.z * 1000) / 1000] : null;
      this.net.send({ t: 'in', s: this.seq, mv, atk: st.atk ? 1 : 0 });
    }
    this.pending.push({ seq: this.seq, move: st.move, dt });
    if (this.pending.length > 120) this.pending.shift();

    this.world.tick(dt);
    // 自己英雄：本地预测移动
    if (me && this.pred) {
      if (me.alive && !me.stunned && !me.dashing && st.move) {
        const n = clampToMap(this.pred.x + st.move.x * me.stats.speed * dt, this.pred.z + st.move.z * me.stats.speed * dt, me.radius * 0.6);
        this.pred.x = n.x; this.pred.z = n.z;
        me.facing = Math.atan2(st.move.x, st.move.z);
        me.anim.moving = true;
      }
      const k = Math.exp(-dt * 10);
      this.corr.x *= k; this.corr.z *= k;
      me.x = this.pred.x + this.corr.x;
      me.z = this.pred.z + this.corr.z;
    }
    this.view.render(dt);
  }
}
