// 单位：英雄、小兵、防御塔、水晶、野怪（纯逻辑，网页和服务器共用；画面由 view.js 根据快照渲染）
import { MINION_TYPES, ITEM_BY_ID, XP_TABLE, MAX_LEVEL, SPRING, BASE, lanePoint, laneT } from './config.js';
import { bushAt } from './terrain.js';
import * as shop from './shop.js';

let UID = 0;

export class Unit {
  constructor(game, o) {
    this.game = game;
    this.id = ++UID;
    this.team = o.team;
    this.kind = o.kind;
    this.name = o.name || '';
    this.x = o.x;
    this.z = o.z;
    this.y = 0;
    this.radius = o.radius || 0.6;
    this.base = { atk: 0, ap: 0, armor: 0, mr: 0, range: 1.5, as: 1, speed: 4, crit: 0, lifesteal: 0, pen: 0, cdr: 0, regen: 0, maxHp: 100, ...o.base };
    this.stats = { ...this.base };
    this.hp = this.stats.maxHp;
    this.alive = true;
    this.buffs = [];
    this.attackCd = 0;
    this.target = null;
    this.facing = 0;
    this.lastDamagedAt = -99;
    this.lastHeroAttackAt = -99;
    this.revealUntil = 0;
    this.anim = { spin: 0, moving: false };
    this.atkSeq = 0; // 每次出手 +1，客户端据此播放攻击动作
    this.movable = o.movable !== false;
    this.mass = o.mass || 1;
    this.dmgMul = 1;
  }

  get maxHp() { return this.stats.maxHp; }

  computeStats() {
    const s = { ...this.base };
    let speedMul = 1, asBonus = 0;
    for (const b of this.buffs) {
      if (b.speedMul) speedMul *= b.speedMul;
      if (b.asBonus) asBonus += b.asBonus * (b.count || 1);
    }
    s.as = this.base.as * (1 + asBonus);
    s.speed = this.base.speed * speedMul;
    this.applyStatMods?.(s);
    this.stats = s;
    if (this.hp > s.maxHp) this.hp = s.maxHp;
  }

  addBuff(b) {
    if (!this.alive) return;
    if (b.stun && this.ccImmune) return;
    const ex = this.buffs.find((x) => x.id === b.id);
    const until = this.game.time + b.dur;
    if (ex) {
      ex.until = Math.max(ex.until, until);
      if (b.stacks) ex.count = Math.min(b.stacks, (ex.count || 1) + 1);
      return;
    }
    this.buffs.push({ ...b, until, count: 1 });
    if (b.stun) {
      this.game.fx.stars(this);
      this.cancelRecall?.();
    }
  }

  hasBuff(id) { return this.buffs.some((b) => b.id === id); }
  get stunned() { return this.buffs.some((b) => b.stun); }
  get damageReduction() {
    let r = 1;
    for (const b of this.buffs) if (b.dr) r *= 1 - b.dr;
    return r;
  }

  heal(n) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    if (this.hp - before > 30 && this.kind === 'hero') this.game.toTeam(this.team, ['float', this.id, '+' + Math.round(this.hp - before), 'heal']);
  }

  dist(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
  edgeDist(o) { return this.dist(o) - o.radius - this.radius; }
  inRange(o, extra = 0) { return this.edgeDist(o) <= this.stats.range + extra; }

  faceTo(x, z) {
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz > 1e-4) this.facing = Math.atan2(dx, dz);
  }

  moveToward(x, z, dt, stopDist = 0) {
    const dx = x - this.x, dz = z - this.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist + 0.01) return true;
    const step = Math.min(d - stopDist, this.stats.speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.facing = Math.atan2(dx, dz);
    this.anim.moving = true;
    return false;
  }

  updateBuffs() {
    const t = this.game.time;
    if (this.buffs.length) this.buffs = this.buffs.filter((b) => b.until > t);
  }

  // 普攻
  performAttack(target) {
    const g = this.game;
    this.attackCd = 1 / this.stats.as;
    this.faceTo(target.x, target.z);
    this.atkSeq++;
    this.revealUntil = g.time + 1;
    if (this.kind === 'hero' && target.kind === 'hero') this.lastHeroAttackAt = g.time;
    const crit = Math.random() < this.stats.crit;
    const amount = this.stats.atk * (crit ? 2 : 1);
    const onHit = () => {
      if (!target.alive) return;
      g.damage(this, target, amount, 'phys', { basic: true, crit });
      this.onBasicHit?.(target);
      if (this.kind === 'hero' && this.hasBuff('redbuff') && target.alive) {
        g.damage(this, target, 20 + this.level * 8, 'true');
        target.addBuff({ id: 'burn', dur: 1.5, speedMul: 0.75 });
        g.fx.burst(target.x, 1, target.z, 0xff6a2a, 6);
      }
    };
    if (this.stats.range > 3) {
      g.addHoming(this, target, this.projectileStyle || {}, onHit);
    } else {
      g.schedule(0.08, onHit);
      g.fx.slashArc(this, this.stats.range + 0.5, this.kind === 'hero' ? 0xffffff : 0xdddddd, 0.6);
    }
    g.sfx(this.stats.range > 3 ? 'shoot' : 'hit', this, target);
  }

  update(dt) {
    this.updateBuffs();
    this.computeStats();
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.anim.spin > 0) this.anim.spin -= dt;
    this.anim.moving = false;
  }

  die(killer) {
    this.alive = false;
    this.hp = 0;
    this.game.onDeath(this, killer);
  }
}

// ---------------- 英雄 ----------------
export class Hero extends Unit {
  constructor(game, def, team) {
    const sp = SPRING[team];
    super(game, {
      team, kind: 'hero', name: def.name, x: sp.x, z: sp.z, radius: 0.7,
      base: {}, mass: 3,
    });
    this.def = def;
    this.level = 1;
    this.xp = 0;
    this.gold = 300;
    this.items = [];
    this.kills = 0; this.deaths = 0; this.cs = 0; this.streak = 0;
    this.skillCd = [0, 0, 0];
    this.flashCd = 0;
    this.respawnAt = 0;
    this.recall = null;
    this.dash = null;
    this.intent = { move: null, attack: null };
    this.onBasicHit = (t) => def.onBasicHit?.(game, this, t);
    this.projectileStyle = def.weapon === 'staff' ? { color: 0xd9a6ff, size: 0.28, speed: 26 } : { color: 0xeaffc0, size: 0.18, speed: 34, arrow: true };
    this.computeStats();
    this.hp = this.stats.maxHp;
    this.inBush = -1;
  }

  applyStatMods(s) {
    const d = this.def, L = this.level - 1;
    s.maxHp = d.hp + d.hpGrow * L;
    s.atk = d.atk + d.atkGrow * L;
    s.ap = (d.ap || 0) + (d.apGrow || 0) * L;
    s.armor = d.armor + d.armorGrow * L;
    s.mr = 60 + 6 * L;
    s.range = d.range;
    s.regen = d.regen + L * 2;
    let as = d.atkSpeed * (1 + 0.025 * L), speed = d.speed, asPct = 0, speedAdd = 0;
    for (const id of this.items) {
      const st = ITEM_BY_ID[id].stats;
      if (st.atk) s.atk += st.atk;
      if (st.ap) s.ap += st.ap;
      if (st.hp) s.maxHp += st.hp;
      if (st.armor) s.armor += st.armor;
      if (st.as) asPct += st.as;
      if (st.speed) speedAdd += st.speed;
      if (st.crit) s.crit += st.crit;
      if (st.lifesteal) s.lifesteal += st.lifesteal;
      if (st.pen) s.pen = Math.max(s.pen, st.pen);
      if (st.cdr) s.cdr += st.cdr;
      if (st.regen) s.regen += st.regen;
    }
    let speedMul = 1, buffAs = 0;
    for (const b of this.buffs) {
      if (b.speedMul) speedMul *= b.speedMul;
      if (b.asBonus) buffAs += b.asBonus * (b.count || 1);
      if (b.atkMul) s.atk *= b.atkMul;
      if (b.id === 'bluebuff') { s.cdr += 0.2; s.regen += 25; }
    }
    s.as = Math.min(2.5, as * (1 + asPct + buffAs));
    s.speed = (speed + speedAdd) * speedMul;
  }

  addXp(n) {
    if (this.level >= MAX_LEVEL) return;
    // 落后追赶：等级低于对手时获得额外经验
    const foe = this.game.heroes.find((h) => h.team !== this.team);
    const behind = foe ? foe.level - this.level : 0;
    if (behind > 0) n *= 1 + Math.min(0.8, behind * 0.25);
    this.xp += n;
    while (this.level < MAX_LEVEL && this.xp >= XP_TABLE[this.level]) {
      this.level++;
      const before = this.stats.maxHp;
      this.computeStats();
      this.hp += this.stats.maxHp - before;
      this.game.fx.levelUp(this);
      this.game.toTeam(this.team, ['sfx', 'level']);
      const sk = this.def.skills.find((k) => k.unlock === this.level);
      if (sk) this.game.toTeam(this.team, ['banner', `解锁技能：${sk.name}`, 'info']);
    }
  }

  canCast(i) {
    const sk = this.def.skills[i];
    return this.alive && !this.stunned && !this.dash && this.level >= sk.unlock && this.skillCd[i] <= 0;
  }

  castSkill(i, aim) {
    if (!this.canCast(i)) return false;
    const sk = this.def.skills[i];
    this.cancelRecall();
    if (aim.dir) {
      this.facing = Math.atan2(aim.dir.x, aim.dir.z);
    }
    this.skillCd[i] = sk.cd * (1 - Math.min(0.4, this.stats.cdr));
    this.atkSeq++;
    this.revealUntil = this.game.time + 1.5;
    sk.cast(this.game, this, aim);
    return true;
  }

  castFlash(dir) {
    if (!this.alive || this.flashCd > 0 || this.stunned || this.dash) return false;
    const g = this.game;
    const p = g.clamp(this.x + dir.x * 6, this.z + dir.z * 6);
    g.fx.burst(this.x, 1, this.z, 0xfff2a8, 14);
    this.x = p.x; this.z = p.z;
    this.facing = Math.atan2(dir.x, dir.z);
    g.fx.burst(this.x, 1, this.z, 0xfff2a8, 14);
    this.flashCd = 60;
    this.cancelRecall();
    g.sfx('flash');
    return true;
  }

  startRecall() {
    if (!this.alive || this.recall || this.dash) return;
    this.recall = { t: 0, dur: 4 };
    this.game.toTeam(this.team, ['sfx', 'recall']);
  }

  cancelRecall() {
    this.recall = null;
  }

  dashTo(x, z, dur, opts = {}) {
    const p = this.game.clamp(x, z);
    this.cancelRecall();
    this.dash = { sx: this.x, sz: this.z, tx: p.x, tz: p.z, t: 0, dur, ...opts };
    this.faceTo(p.x, p.z);
  }

  // 商店规则见 shop.js
  priceOf(id) { return shop.priceOf(this.items, id); }
  canBuy(id) { return shop.canBuy(this.items, this.gold, id); }
  nextBuild() { return shop.nextBuild(this.def.build, this.items, this.gold); }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.gold -= this.priceOf(id);
    for (const c of shop.componentsOwned(this.items, id)) this.items.splice(this.items.indexOf(c), 1);
    this.items.push(id);
    const before = this.stats.maxHp;
    this.computeStats();
    this.hp += this.stats.maxHp - before;
    this.game.toTeam(this.team, ['sfx', 'buy']);
    return true;
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) {
      if (g.time >= this.respawnAt) this.respawn();
      return;
    }
    super.update(dt);
    for (let i = 0; i < 3; i++) if (this.skillCd[i] > 0) this.skillCd[i] -= dt;
    if (this.flashCd > 0) this.flashCd -= dt;

    // 回血
    const regen = this.stats.regen * (g.time - this.lastDamagedAt > 5 ? 2 : 1);
    this.hp = Math.min(this.stats.maxHp, this.hp + regen * dt);

    // 草丛
    this.inBush = bushAt(this.x, this.z);

    // 冲刺
    if (this.dash) {
      const d = this.dash;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      this.x = d.sx + (d.tx - d.sx) * k;
      this.z = d.sz + (d.tz - d.sz) * k;
      this.y = d.arc ? Math.sin(k * Math.PI) * d.arc : 0;
      this.anim.moving = true;
      d.each?.(this);
      if (k >= 1) {
        this.dash = null;
        this.y = 0;
        d.end?.(this);
      }
      return;
    }
    if (this.stunned) return;

    // 回城
    if (this.recall) {
      this.recall.t += dt;
      if (this.recall.t >= this.recall.dur) {
        this.cancelRecall();
        const sp = SPRING[this.team];
        this.x = sp.x; this.z = sp.z;
        g.fx.burst(this.x, 1, this.z, 0x9fdcff, 24);
        g.toTeam(this.team, ['snap']);
      }
    }

    const it = this.intent;
    let tgt = it.attack;
    if (tgt && (!tgt.alive || !g.isTargetable(tgt, this.team))) tgt = it.attack = null;
    const mv = it.move;

    if (tgt) {
      const inR = this.inRange(tgt);
      if (inR && this.attackCd <= 0) {
        this.cancelRecall();
        this.performAttack(tgt);
        it.attackDone = true;
      } else if (mv) {
        this.cancelRecall();
        this.applyMove(mv, dt);
      } else if (!inR) {
        this.cancelRecall();
        this.moveToward(tgt.x, tgt.z, dt, 0);
      } else {
        this.faceTo(tgt.x, tgt.z);
      }
    } else if (mv) {
      this.cancelRecall();
      this.applyMove(mv, dt);
    } else if (it.moveTo) {
      this.cancelRecall();
      if (this.moveToward(it.moveTo.x, it.moveTo.z, dt, 0.3)) it.moveTo = null;
    }
  }

  applyMove(mv, dt) {
    const sp = this.stats.speed * dt;
    this.x += mv.x * sp;
    this.z += mv.z * sp;
    this.facing = Math.atan2(mv.x, mv.z);
    this.anim.moving = true;
  }

  respawn() {
    const sp = SPRING[this.team];
    this.alive = true;
    this.x = sp.x; this.z = sp.z; this.y = 0;
    this.buffs = [];
    this.computeStats();
    this.hp = this.stats.maxHp;
    this.intent = { move: null, attack: null };
    this.game.fx.burst(sp.x, 1, sp.z, 0xffffff, 20);
    this.game.toTeam(this.team, ['snap']);
  }
}

// ---------------- 小兵 ----------------
export class Minion extends Unit {
  constructor(game, type, team, offset) {
    const def = MINION_TYPES[type];
    const p = lanePoint(team === 0 ? 0.08 : 0.92, offset);
    super(game, {
      team, kind: 'minion', name: def.name, x: p.x, z: p.z, radius: def.radius,
      base: { maxHp: def.hp, atk: def.atk, armor: def.armor, range: def.range, as: def.atkSpeed, speed: def.speed },
    });
    this.type = type;
    this.def = def;
    this.offset = offset;
    this.projectileStyle = type === 'cannon' ? { color: 0xffaa33, size: 0.35, speed: 18 } : { color: team === 0 ? 0x7fb8ff : 0xff8a8a, size: 0.2, speed: 22 };
    this.retarget = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.stunned) return;
    const g = this.game;
    this.retarget -= dt;
    if (this.target && (!this.target.alive || !g.isTargetable(this.target, this.team) || this.edgeDist(this.target) > 9)) this.target = null;
    if (this.retarget <= 0 || !this.target) {
      this.retarget = 0.4;
      this.target = g.minionPickTarget(this);
    }
    if (this.target) {
      if (this.inRange(this.target)) {
        this.faceTo(this.target.x, this.target.z);
        if (this.attackCd <= 0) this.performAttack(this.target);
      } else {
        this.moveToward(this.target.x, this.target.z, dt);
      }
    } else {
      // 沿兵线推进
      const t = laneT(this.x, this.z);
      const nt = this.team === 0 ? Math.min(1, t + 0.08) : Math.max(0, t - 0.08);
      const p = lanePoint(nt, this.offset * 0.6);
      this.moveToward(p.x, p.z, dt);
    }
  }
}

// ---------------- 防御塔 / 水晶 ----------------
export class Tower extends Unit {
  constructor(game, team, t, tier) {
    const p = lanePoint(t);
    const isCrystal = tier === 'crystal';
    super(game, {
      team, kind: isCrystal ? 'crystal' : 'tower', name: isCrystal ? '水晶' : (tier === 'outer' ? '外塔' : '高地塔'),
      x: p.x, z: p.z, radius: isCrystal ? 2.6 : 1.5,
      base: { maxHp: isCrystal ? 5500 : (tier === 'outer' ? 4200 : 4800), atk: isCrystal ? 420 : 360, armor: 150, range: 9.5, as: 1, speed: 0 },
      movable: false,
    });
    this.tier = tier;
    this.heroHits = 0;
    this.projectileStyle = { color: team === 0 ? 0x8fc6ff : 0xff9a9a, size: 0.5, speed: 26, fromY: isCrystal ? 4.2 : 6.6 };
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    const t = this.target;
    if (t && (!t.alive || !g.isTargetable(t, this.team) || this.edgeDist(t) > this.stats.range)) {
      this.target = null;
      this.heroHits = 0;
    }
    // 敌方英雄攻击我方英雄时，切换仇恨
    for (const h of g.heroes) {
      if (h.team !== this.team && h.alive && g.time - h.lastHeroAttackAt < 0.8 && this.edgeDist(h) <= this.stats.range && g.isTargetable(h, this.team)) {
        if (this.target !== h) { this.target = h; this.heroHits = 0; }
      }
    }
    if (!this.target) {
      let best = null, bd = Infinity;
      for (const u of g.units) {
        if (u.team !== 1 - this.team || !u.alive || u.kind !== 'minion') continue;
        const d = this.edgeDist(u);
        if (d <= this.stats.range && d < bd) { bd = d; best = u; }
      }
      if (!best) {
        for (const h of g.heroes) {
          if (h.team !== this.team && h.alive && this.edgeDist(h) <= this.stats.range && g.isTargetable(h, this.team)) best = h;
        }
      }
      this.target = best;
      this.heroHits = 0;
    }
    if (this.target && this.attackCd <= 0) {
      const tg = this.target;
      this.attackCd = 1 / this.stats.as;
      let amount = this.stats.atk;
      if (tg.kind === 'hero') {
        amount *= 1 + Math.min(1, this.heroHits * 0.25);
        this.heroHits++;
      } else {
        amount *= 1.1;
      }
      g.addHoming(this, tg, this.projectileStyle, () => g.damage(this, tg, amount, 'phys', { tower: true }));
      if (tg.kind === 'hero') g.sfx('tower', tg);
    }
  }
}

// ---------------- 野怪：峡谷巨兽、红蓝魔像 ----------------
export class Monster extends Unit {
  constructor(game, def, x, z) {
    super(game, {
      team: 2, kind: 'monster', name: def.name, x, z, radius: def.radius,
      base: { maxHp: def.hp, atk: def.atk, armor: def.armor, range: def.range, as: def.as, speed: 5 }, mass: 8,
    });
    this.def = def;
    this.home = { x, z };
    this.facing = Math.atan2(-x, -z);
    this.computeStats();
    this.hp = this.stats.maxHp;
  }

  applyStatMods(s) {
    const m = Math.floor(this.game.time / 60);
    s.maxHp = this.base.maxHp + m * this.def.hpGrow;
    s.atk = this.base.atk + m * this.def.atkGrow;
  }

  update(dt) {
    super.update(dt);
    if (this.stunned) return;
    const g = this.game;
    const t = this.target;
    const homeD = Math.hypot(this.x - this.home.x, this.z - this.home.z);
    if (t && (!t.alive || Math.hypot(t.x - this.home.x, t.z - this.home.z) > 11 || !g.isTargetable(t, 2))) {
      this.target = null;
    }
    if (!this.target && g.time - this.lastDamagedAt < 0.3 && this.lastAttacker?.alive && this.lastAttacker.kind === 'hero') {
      this.target = this.lastAttacker;
    }
    if (this.target) {
      if (this.inRange(this.target)) {
        this.faceTo(this.target.x, this.target.z);
        if (this.attackCd <= 0) {
          this.performAttack(this.target);
          g.fx.shockwave(this.target.x, this.target.z, 1.6, this.def.fxColor);
        }
      } else this.moveToward(this.target.x, this.target.z, dt);
    } else if (homeD > 0.5) {
      this.moveToward(this.home.x, this.home.z, dt);
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.3 * dt);
    } else {
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.05 * dt);
      this.facing = Math.atan2(-this.x, -this.z);
    }
  }
}

