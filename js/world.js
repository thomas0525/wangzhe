// 客户端世界：根据快照维护各单位的副本（位置插值、动画触发），供渲染 / 界面 / 输入使用
import { MINION_TYPES, MONSTERS } from './config.js';
import { HEROES } from './heroes.js';
import { KIND, KIND_NAME } from './snapshot.js';

const TOWER_NAME = { outer: '外塔', inner: '高地塔', crystal: '水晶' };

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class Rep {
  constructor(id, kind, team, model) {
    this.id = id;
    this.kind = KIND_NAME[kind];
    this.team = team;
    this.model = model;
    this.alive = true;
    this.hidden = false;
    this.x = 0; this.z = 0; this.y = 0; this.facing = 0;
    this.hp = 1;
    this.stats = { maxHp: 1, range: 1.5, speed: 0 };
    this.buffIds = [];
    this.fl = 0;
    this.atkSeq = -1;
    this.anim = { atk: 0, walk: 0, spin: 0, moving: false };
    this.interp = null;
    this.level = 1;
    this.inBush = -1;
    if (this.kind === 'hero') {
      this.def = HEROES[model];
      this.name = this.def.name;
      this.radius = 0.7;
      this.barHeight = 2.9;
    } else if (this.kind === 'minion') {
      const d = MINION_TYPES[model];
      this.type = model;
      this.name = d.name;
      this.radius = d.radius;
      this.barHeight = model === 'cannon' ? 2 : 1.8;
    } else if (this.kind === 'monster') {
      this.def = MONSTERS[model];
      this.name = this.def.name;
      this.radius = this.def.radius;
      this.barHeight = this.def.barHeight;
    } else {
      this.tier = model;
      this.name = TOWER_NAME[model] || '';
      this.radius = this.kind === 'crystal' ? 2.6 : 1.5;
      this.barHeight = this.kind === 'crystal' ? 7.5 : 7.8;
      this.stats.range = 9.5;
    }
  }

  hasBuff(id) { return this.buffIds.includes(id); }
  get stunned() { return !!(this.fl & 2); }
  get dashing() { return !!(this.fl & 8); }
  dist(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
  edgeDist(o) { return this.dist(o) - o.radius - this.radius; }

  // 设定新的目标位置；interval>0 时在这段时间内平滑过去
  moveTo(x, z, y, f, interval, first) {
    this.serverPos = { x, z };
    if (this.predicted && !first) {
      // 自己的英雄：位置由客户端预测，这里只记录服务器位置
      this.y = y;
      this.facing = f;
      this.interp = null;
      return;
    }
    if (first || interval <= 0) {
      this.x = x; this.z = z; this.y = y; this.facing = f;
      this.interp = null;
      return;
    }
    if (Math.hypot(x - this.x, z - this.z) > 8) { this.x = x; this.z = z; this.y = y; this.facing = f; this.interp = null; return; }
    this.interp = { x0: this.x, z0: this.z, y0: this.y, f0: this.facing, x, z, y, f, t: 0, dur: interval * 1.15 };
  }

  tick(dt) {
    const p = this.interp;
    if (p) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      this.x = p.x0 + (p.x - p.x0) * k;
      this.z = p.z0 + (p.z - p.z0) * k;
      this.y = p.y0 + (p.y - p.y0) * k;
      this.facing = lerpAngle(p.f0, p.f, k);
      if (k >= 1) this.interp = null;
    }
  }
}

export class World {
  constructor(team) {
    this.team = team;
    this.reps = new Map();
    this.units = [];
    this.heroes = [];
    this.proj = new Map();
    this.me = null;
    this.time = 0;
    this.onAdd = null;
    this.onRemove = null;
    this.onHeroDeath = null;
    this.onTowerDeath = null;
  }

  rep(id) { return this.reps.get(id); }

  apply(snap, interval) {
    this.time = snap.time;
    const seen = new Set();
    for (const e of snap.u) {
      const [id, k, team, x, z, y, f, hp, mhp, fl, as, model] = e;
      seen.add(id);
      let r = this.reps.get(id);
      const first = !r;
      if (first) {
        r = new Rep(id, k, team, model);
        this.reps.set(id, r);
      }
      r.moveTo(x, z, y, f, interval, first);
      r.hp = hp;
      r.stats.maxHp = mhp;
      r.fl = fl;
      r.anim.moving = !!(fl & 1);
      if (r.atkSeq >= 0 && as !== r.atkSeq) r.anim.atk = 0.25;
      r.atkSeq = as;
      if (k === KIND.tower || k === KIND.crystal) {
        const alive = !!e[12];
        if (r.alive && !alive && !first) this.onTowerDeath?.(r);
        r.alive = alive;
        r.inv = !!e[13];
        r.targetId = e[14];
      }
      if (first) this.onAdd?.(r);
    }
    for (const h of snap.h) {
      seen.add(h.id);
      let r = this.reps.get(h.id);
      const first = !r;
      if (first) {
        r = new Rep(h.id, KIND.hero, h.tm, h.d);
        this.reps.set(h.id, r);
      }
      const wasAlive = r.alive;
      r.alive = !!h.al;
      r.hidden = !!h.hid;
      r.level = h.lv;
      r.kills = h.k; r.deaths = h.de; r.cs = h.cs; r.totalGold = h.tg; r.heroDamage = h.hd;
      if (h.x !== undefined) {
        r.moveTo(h.x, h.z, h.y, h.f, interval, first || !wasAlive);
        r.hp = h.hp;
        r.stats.maxHp = h.mhp;
        r.stats.speed = h.spd;
        r.fl = h.fl;
        r.anim.moving = !!(h.fl & 1);
        if (r.atkSeq >= 0 && h.as !== r.atkSeq) r.anim.atk = 0.25;
        r.atkSeq = h.as;
        if (h.sp > r.anim.spin + 0.2 || h.sp === 0) r.anim.spin = h.sp;
        r.buffIds = h.bf;
        r.recall = h.rc >= 0 ? { t: h.rc, dur: 1 } : null;
        r.inBush = h.ib;
      } else if (!r.alive) {
        r.hp = 0;
        r.recall = null;
      }
      if (wasAlive && !r.alive && !first) this.onHeroDeath?.(r);
      if (first) this.onAdd?.(r);
    }
    for (const [id, r] of this.reps) {
      if (seen.has(id)) continue;
      this.reps.delete(id);
      this.onRemove?.(r);
    }
    this.units = [...this.reps.values()];
    this.heroes = this.units.filter((r) => r.kind === 'hero').sort((a, b) => a.team - b.team);

    // 投射物
    const pseen = new Set();
    for (const q of snap.p) {
      const [id, x, y, z, color, size, arrow, kind, yaw] = q;
      pseen.add(id);
      let p = this.proj.get(id);
      if (!p) {
        p = { id, x, y, z, color, size, arrow: !!arrow, skill: !!kind, yaw, interp: null, isNew: true };
        this.proj.set(id, p);
      } else if (interval > 0) {
        p.interp = { x0: p.x, y0: p.y, z0: p.z, x, y, z, t: 0, dur: interval };
      } else { p.x = x; p.y = y; p.z = z; }
      p.yaw = yaw;
    }
    for (const id of [...this.proj.keys()]) if (!pseen.has(id)) { this.proj.get(id).gone = true; }

    // 自己英雄的私有信息
    if (snap.me) {
      const m = snap.me;
      const r = this.reps.get(m.id);
      if (r) {
        r.gold = m.gold; r.xp = m.xp; r.items = m.items; r.skillCd = m.cd; r.flashCd = m.fcd;
        r.stats.cdr = m.cdr; r.stats.range = m.rng; r.respawnAt = m.rsp;
        r.buffs = m.bu.map(([id, until]) => ({ id, until }));
        if (r.recall) r.recall = { t: r.recall.t * m.rd, dur: m.rd };
        r.ack = m.ack;
        this.me = r;
      }
    }
    this.over = snap.over;
    return snap.ev || [];
  }

  tick(dt) {
    for (const r of this.units) r.tick(dt);
    for (const p of this.proj.values()) {
      const q = p.interp;
      if (!q) continue;
      q.t += dt;
      const k = Math.min(1, q.t / q.dur);
      p.x = q.x0 + (q.x - q.x0) * k;
      p.y = q.y0 + (q.y - q.y0) * k;
      p.z = q.z0 + (q.z - q.z0) * k;
    }
  }

  // 与服务器同样的自动选目标逻辑（仅用于客户端瞄准方向）
  autoTarget(hero, radius, preferHero = false, heroOnly = false) {
    let bestHero = null, bh = Infinity, bestUnit = null, bu = Infinity, bestStruct = null, bs = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.hidden || u.team === hero.team) continue;
      const d = hero.edgeDist(u);
      if (d > radius) continue;
      if (u.kind === 'hero') { if (d < bh) { bh = d; bestHero = u; } }
      else if (u.kind === 'tower' || u.kind === 'crystal') { if (!u.inv && d < bs) { bs = d; bestStruct = u; } }
      else if (d < bu) { bu = d; bestUnit = u; }
    }
    if (heroOnly) return bestHero;
    if (preferHero && bestHero) return bestHero;
    return bestUnit || bestStruct || bestHero;
  }
}
