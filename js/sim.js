// 对局模拟（纯逻辑，不依赖 DOM / three.js）：单人模式在浏览器里运行，双人模式在服务器上运行
// 表现层的东西（特效、音效、横幅、飘字、语音）都以事件形式发出，由客户端按自己的视角播放
import {
  BLUE, RED, SPRING, TOWER_T, LANE_NORMAL, POCKETS, JUNGLE, MONSTERS, BUFF_INFO, WAVE_INTERVAL, FIRST_WAVE, PASSIVE_GOLD, DIFFICULTY,
} from './config.js';
import { clampToMap } from './terrain.js';
import { Unit, Hero, Minion, Tower, Monster } from './units.js';
import { HEROES } from './heroes.js';
import { AI } from './ai.js';

const STREAK_TEXT = { 2: '双杀！', 3: '大杀特杀！', 4: '主宰比赛！', 5: '无人能挡！', 6: '横扫千军！' };
const STREAK_VOICE = { 2: 'double_kill', 3: 'triple_kill', 4: 'quadra_kill', 5: 'penta_kill', 6: 'rampage' };
const DUMMY_FX = { remove() {}, dead: false };
const TEAMS = [BLUE, RED];

const r2 = (v) => Math.round(v * 100) / 100;
function encodeArg(a) {
  if (a instanceof Unit) return { u: a.id };
  if (Array.isArray(a)) return a.map(encodeArg);
  if (a && typeof a === 'object') {
    const o = {};
    for (const k in a) o[k] = encodeArg(a[k]);
    return o;
  }
  return typeof a === 'number' && !Number.isInteger(a) ? r2(a) : a;
}

let PID = 0;

export class Sim {
  // opts: { heroes: [heroId蓝, heroId红], ai: { [team]: 难度 }, humans: [team...] }
  constructor(opts) {
    this.opts = opts;
    this.time = 0;
    this.over = false;
    this.winner = -1;
    this.units = [];
    this.projectiles = [];
    this.timers = [];
    this.events = [];
    this.firstBlood = false;
    this.wave = 0;
    this.nextWave = FIRST_WAVE;
    this.announced = new Set();
    this.crystalWarnAt = [-99, -99];
    this.camps = [
      { def: MONSTERS.tyrant, x: POCKETS[0].x, z: POCKETS[0].z, nextAt: MONSTERS.tyrant.first, unit: null },
      ...JUNGLE.map((j) => ({ def: MONSTERS[j.kind], x: j.x, z: j.z, side: j.side, nextAt: MONSTERS[j.kind].first, unit: null })),
    ];
    // 特效记录器：任何 fx.xxx(...) 调用都变成事件
    this.fx = new Proxy({}, { get: (_, name) => (...args) => { this.emit(-1, ['fx', name, args.map(encodeArg)]); return DUMMY_FX; } });

    for (const team of TEAMS) {
      const [innerT, outerT] = TOWER_T[team];
      this.addUnit(new Tower(this, team, outerT, 'outer'));
      this.addUnit(new Tower(this, team, innerT, 'inner'));
      this.addUnit(new Tower(this, team, team === BLUE ? 0 : 1, 'crystal'));
    }
    this.heroes = TEAMS.map((team) => this.addUnit(new Hero(this, HEROES[opts.heroes[team]], team)));
    this.ais = [];
    for (const team of TEAMS) {
      const key = opts.ai?.[team];
      if (!key) continue;
      const diff = DIFFICULTY[key] || DIFFICULTY.normal;
      const h = this.heroes[team];
      if (!(opts.humans || []).includes(team)) { h.dmgMul = diff.dmg; h.goldMul = diff.goldMul; }
      this.ais.push(new AI(this, h, diff));
    }
    this.controllers = {};
    for (const team of opts.humans || []) this.controllers[team] = new PlayerController(this, this.heroes[team]);

    this.toAll(['banner', '欢迎来到峡谷对决', 'info']);
    this.schedule(0.6, () => this.voice('welcome'));
  }

  // ---------- 事件（发给客户端） ----------
  emit(to, ev) { this.events.push({ to, ev }); }
  toAll(ev) { this.emit(-1, ev); }
  toTeam(team, ev) { if (team === 0 || team === 1) this.emit(team, ev); }
  // 按队伍发不同内容：fn(team) 返回该队的事件列表
  perTeam(fn) { for (const team of TEAMS) for (const ev of fn(team)) if (ev) this.toTeam(team, ev); }
  sfx(name, ...units) { this.emit(-1, ['sfx', name, units.map((u) => u.id)]); }
  voice(name, team = -1) { this.emit(team, ['voice', name]); }
  shake(a, team = -1) { this.emit(team, ['shake', r2(a)]); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- 玩家指令 ----------
  setInput(team, input) { this.controllers[team]?.setInput(input); }
  command(team, cmd) { this.controllers[team]?.command(cmd); }

  addUnit(u) { this.units.push(u); return u; }
  schedule(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }
  clamp(x, z) { return clampToMap(x, z); }

  // ---------- 查询 ----------
  isVulnerable(u) {
    if (u.kind === 'tower') {
      if (u.tier === 'outer') return true;
      return !this.units.some((o) => o.alive && o.kind === 'tower' && o.team === u.team && o.tier === 'outer');
    }
    if (u.kind === 'crystal') return !this.units.some((o) => o.alive && o.kind === 'tower' && o.team === u.team);
    return true;
  }

  isVisibleTo(u, team) {
    if (u.team === team || u.kind !== 'hero') return true;
    if (u.inBush < 0 || this.time < u.revealUntil) return true;
    for (const h of this.heroes) {
      if (h.team === team && h.alive && h.inBush === u.inBush) return true;
    }
    return false;
  }

  isTargetable(u, team) {
    return u.alive && u.team !== team && this.isVisibleTo(u, team);
  }

  enemiesInCircle(team, x, z, r) {
    const out = [];
    for (const u of this.units) {
      if (!u.alive || u.team === team || u.kind === 'tower' || u.kind === 'crystal') continue;
      if (Math.hypot(u.x - x, u.z - z) <= r + u.radius) out.push(u);
    }
    return out;
  }

  autoTarget(hero, radius, preferHero = false, heroOnly = false) {
    let bestHero = null, bh = Infinity, bestUnit = null, bu = Infinity, bestStruct = null, bs = Infinity;
    for (const u of this.units) {
      if (!this.isTargetable(u, hero.team)) continue;
      const d = hero.edgeDist(u);
      if (d > radius) continue;
      if (u.kind === 'hero') { if (d < bh) { bh = d; bestHero = u; } }
      else if (u.kind === 'tower' || u.kind === 'crystal') { if (this.isVulnerable(u) && d < bs) { bs = d; bestStruct = u; } }
      else if (d < bu) { bu = d; bestUnit = u; }
    }
    if (heroOnly) return bestHero;
    if (preferHero && bestHero) return bestHero;
    return bestUnit || bestStruct || bestHero;
  }

  minionPickTarget(m) {
    const foeTeam = 1 - m.team;
    for (const h of this.heroes) {
      if (h.team === foeTeam && h.alive && this.time - h.lastHeroAttackAt < 1.2 && m.edgeDist(h) < 7 && this.isVisibleTo(h, m.team)) return h;
    }
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team !== foeTeam || u.kind !== 'minion') continue;
      const d = m.edgeDist(u);
      if (d < 7 && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    for (const u of this.units) {
      if (!u.alive || u.team !== foeTeam || (u.kind !== 'tower' && u.kind !== 'crystal')) continue;
      const d = m.edgeDist(u);
      if (d < 7 && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    for (const h of this.heroes) {
      if (h.team === foeTeam && h.alive && m.edgeDist(h) < 5 && this.isVisibleTo(h, m.team)) return h;
    }
    return null;
  }

  // ---------- 伤害 ----------
  damage(src, target, amount, type, o = {}) {
    if (!target.alive || this.over) return 0;
    if ((target.kind === 'tower' || target.kind === 'crystal') && !this.isVulnerable(target)) {
      if (src.kind === 'hero' && o.basic) this.toTeam(src.team, ['float', target.id, '无敌', 'immune']);
      return 0;
    }
    let a = amount * (src.dmgMul || 1);
    if (src.hasBuff?.('tyrant')) a *= 1.15;
    const pen = src.stats?.pen || 0;
    if (type === 'phys') a *= 602 / (602 + target.stats.armor * (1 - pen));
    else if (type === 'magic') a *= 602 / (602 + target.stats.mr * (1 - pen));
    a *= target.damageReduction;
    if (target.kind === 'tower' || target.kind === 'crystal') {
      if (src.kind === 'minion') a *= src.def.siege * (1 + this.time / 900);
      if (src.kind === 'hero') {
        const protectedByNoMinions = !this.units.some((u) => u.alive && u.kind === 'minion' && u.team === src.team && u.dist(target) < 14);
        if (protectedByNoMinions) a *= 0.5;
      }
    }
    if (target.kind === 'minion' && src.kind === 'tower') a = Math.max(a, target.stats.maxHp * 0.36);
    a = Math.max(1, a);
    target.hp -= a;
    if (target.kind === 'crystal' && this.time - this.crystalWarnAt[target.team] > 20 && target.hp > 0) {
      this.crystalWarnAt[target.team] = this.time;
      this.toTeam(target.team, ['banner', '我方水晶正在遭受攻击！', 'bad']);
      this.voice('crystal_attack', target.team);
    }
    target.lastDamagedAt = this.time;
    target.lastAttacker = src;
    if (target.kind === 'hero') {
      target.cancelRecall();
      if (src.kind === 'hero') { target.lastHeroDamager = src; target.lastHeroDamageAt = this.time; src.heroDamage = (src.heroDamage || 0) + a; }
    }
    if (src.kind === 'hero' && target.kind === 'hero') src.lastHeroAttackAt = this.time;
    if (src.kind === 'hero') src.revealUntil = Math.max(src.revealUntil, this.time + 0.8);
    if (src.stats?.lifesteal && o.basic) src.heal(a * src.stats.lifesteal);
    // 伤害数字：客户端按自己的英雄决定显示（我打出的 / 我受到的）
    if (src.kind === 'hero' || target.kind === 'hero') {
      this.toAll(['dmg', src.id, target.id, Math.round(a), o.crit ? 'crit' : type === 'magic' ? 'magic' : 'dmg']);
    }
    if (target.hp <= 0) target.die(src);
    return a;
  }

  awardGold(hero, n, text = true) {
    n *= hero.goldMul || 1;
    hero.gold += n;
    hero.totalGold = (hero.totalGold || 0) + n;
    if (text && n >= 10) this.toTeam(hero.team, ['float', hero.id, '+' + Math.round(n) + '💰', 'gold']);
  }

  onDeath(u, killer) {
    const enemyHero = this.heroes.find((h) => h.team !== u.team);
    if (u.kind === 'minion') {
      for (const h of this.heroes) {
        if (h.team === u.team || !h.alive) continue;
        if (h.dist(u) < 15) h.addXp(u.def.xp);
        if (killer === h) { this.awardGold(h, u.def.gold); h.cs++; }
        else if (h.dist(u) < 15) this.awardGold(h, u.def.gold * 0.3, false);
      }
    } else if (u.kind === 'monster') {
      const h = killer?.kind === 'hero' ? killer : null;
      const def = u.def;
      if (h) {
        this.awardGold(h, def.gold);
        h.addXp(def.xp);
        h.addBuff({ ...def.buff });
        this.perTeam((team) => {
          const mine = h.team === team;
          if (def.id === 'tyrant') {
            return [
              ['banner', mine ? '我方击败了峡谷巨兽！' : '敌方击败了峡谷巨兽！', mine ? 'good' : 'bad'],
              ['voice', mine ? 'tyrant_ally' : 'tyrant_enemy'],
            ];
          }
          const info = BUFF_INFO[def.buff.id];
          return [['banner', mine ? `获得${info.name}：${info.desc}` : `敌方拿下了${info.name}`, mine ? 'good' : 'bad']];
        });
        this.toAll(['feed', h.name, h.team, u.name, u.team]);
      }
      const camp = this.camps.find((c) => c.unit === u);
      if (camp) camp.nextAt = this.time + def.respawn;
      this.sfx('destroy');
    } else if (u.kind === 'hero') {
      u.deaths++;
      u.streak = 0;
      u.cancelRecall();
      u.dash = null;
      u.y = 0;
      u.respawnAt = this.time + Math.min(30, 5 + u.level * 1.6);
      let credit = killer?.kind === 'hero' ? killer : null;
      if (!credit && u.lastHeroDamager && this.time - u.lastHeroDamageAt < 10) credit = u.lastHeroDamager;
      if (credit) {
        credit.kills++;
        credit.streak++;
        this.awardGold(credit, 300 + (u.bountyStreak || 0) * 80);
        credit.addXp(180 + u.level * 50);
        credit.bountyStreak = (credit.bountyStreak || 0) + 1;
        u.bountyStreak = 0;
        let text, line;
        if (!this.firstBlood) { text = '第一滴血！'; line = 'first_blood'; this.firstBlood = true; }
        else {
          text = STREAK_TEXT[Math.min(6, credit.streak)] || (credit.streak > 6 ? '天下无双！' : '');
          line = credit.streak > 6 ? 'legendary' : STREAK_VOICE[credit.streak];
        }
        this.perTeam((team) => {
          const mine = credit.team === team;
          return [
            ['voice', line || (u.team === team ? 'killed' : 'kill')],
            ['banner', text ? `${credit.name} ${text}` : `${credit.name} 击败了 ${u.name}`, mine ? 'good' : 'bad'],
            ['sfx', mine ? 'kill' : 'death', []],
          ];
        });
      } else {
        this.perTeam((team) => [
          ['banner', `${u.name} 被击败了`, u.team === team ? 'bad' : 'good'],
          ['voice', u.team === team ? 'executed' : 'kill'],
        ]);
        if (enemyHero) enemyHero.addXp(100);
      }
      const k = credit || killer;
      this.toAll(['feed', k ? k.name : '?', k ? k.team : -1, u.name, u.team]);
    } else if (u.kind === 'tower') {
      this.fx.explosion(u.x, u.z, u.team === 0 ? 0x3f8cff : 0xff4a4a);
      this.shake(0.6);
      this.sfx('destroy');
      if (enemyHero) { this.awardGold(enemyHero, 220); enemyHero.addXp(200); }
      this.perTeam((team) => [
        ['banner', u.team === team ? '我方防御塔被摧毁！' : '摧毁了敌方防御塔！', u.team === team ? 'bad' : 'good'],
        ['voice', u.team === team ? 'ally_tower' : 'enemy_tower'],
      ]);
    } else if (u.kind === 'crystal') {
      this.fx.explosion(u.x, u.z, u.team === 0 ? 0x3f8cff : 0xff4a4a);
      this.fx.explosion(u.x, u.z, 0xffffff);
      this.shake(1);
      this.sfx('destroy');
      this.endGame(1 - u.team, u, 'crystal');
    }
  }

  // 结束对局：winner 为获胜队伍；reason: crystal / surrender / disconnect
  endGame(winner, crystal, reason = 'crystal') {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.endTime = this.time;
    const c = crystal || this.units.find((u) => u.kind === 'crystal' && u.team === 1 - winner);
    this.toAll(['end', winner, c ? c.id : 0, reason]);
  }

  // ---------- 投射物（只有逻辑；画面由客户端根据快照绘制） ----------
  addHoming(owner, target, style, onHit) {
    const y = style.fromY ?? 1.4;
    this.projectiles.push({
      id: ++PID, kind: 'homing', owner, target, speed: style.speed || 24, onHit, x: owner.x, y, z: owner.z,
      color: style.color ?? 0xffffff, size: style.size || 0.25, arrow: !!style.arrow,
    });
  }

  addSkillShot(o) {
    const p = { id: ++PID, kind: 'skill', ...o, y: 1.2, traveled: 0, hit: new Set(), color: o.color, size: o.size || 0.4, arrow: !!o.arrow };
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.kind === 'homing') {
        const t = p.target;
        if (!t.alive) { p.done = true; continue; }
        const ty = t.y + (t.kind === 'tower' ? 3 : t.kind === 'crystal' ? 3.5 : 1.1);
        const dx = t.x - p.x, dy = ty - p.y, dz = t.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        const step = p.speed * dt;
        if (d <= step + 0.3) { p.done = true; p.onHit(); continue; }
        p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step;
        p.yaw = Math.atan2(dx, dz);
      } else {
        const step = p.speed * dt;
        p.x += p.dir.x * step;
        p.z += p.dir.z * step;
        p.yaw = Math.atan2(p.dir.x, p.dir.z);
        p.traveled += step;
        for (const e of this.enemiesInCircle(p.owner.team, p.x, p.z, p.radius)) {
          if (p.hit.has(e)) continue;
          p.hit.add(e);
          const stop = p.onHit(e, p);
          if (stop || !p.pierce) { p.done = true; break; }
        }
        if (p.traveled >= p.range) p.done = true;
      }
    }
    if (this.projectiles.some((p) => p.done)) this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  // ---------- 刷兵 ----------
  spawnWave() {
    this.wave++;
    if (this.wave === 1) { this.toAll(['banner', '全军出击！', 'info']); this.voice('wave'); }
    const cannon = this.wave % 3 === 0;
    const scale = 1 + Math.floor(this.time / 60) * 0.06;
    for (const team of TEAMS) {
      const melee = this.time > 360 ? [-2.2, -0.7, 0.7, 2.2] : [-1.6, 0, 1.6];
      melee.forEach((off, i) => this.schedule(i * 0.25, () => this.spawnMinion('melee', team, off, scale)));
      [-1, 1].forEach((off, i) => this.schedule(1.4 + i * 0.25, () => this.spawnMinion('caster', team, off, scale)));
      if (cannon) this.schedule(2.4, () => this.spawnMinion('cannon', team, 0, scale));
    }
  }

  spawnMinion(type, team, off, scale) {
    if (this.over) return null;
    const m = new Minion(this, type, team, off);
    m.base.maxHp *= scale;
    m.base.atk *= scale;
    m.computeStats();
    m.hp = m.stats.maxHp;
    return this.addUnit(m);
  }

  // ---------- 主循环 ----------
  step(dt) {
    this.time += dt;
    const t = this.time;
    for (const u of this.units) { u.px = u.x; u.pz = u.z; }

    if (t > FIRST_WAVE - 5 && !this.announced.has('5s')) {
      this.announced.add('5s');
      this.toAll(['banner', '距离小兵出击还有 5 秒', 'info']);
      this.voice('countdown');
    }
    if (t >= this.nextWave && !this.over) { this.spawnWave(); this.nextWave += WAVE_INTERVAL; }
    for (const c of this.camps) {
      if (t < c.nextAt || c.unit?.alive) continue;
      c.unit = this.addUnit(new Monster(this, c.def, c.x, c.z));
      c.nextAt = Infinity;
      if (c.def.id === 'tyrant') {
        this.toAll(['banner', '峡谷巨兽已出现在左上方野区', 'info']);
        this.voice('tyrant_spawn');
      }
    }

    if (this.timers.length) {
      const due = this.timers.filter((x) => x.t <= t);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.t > t);
        for (const d of due) d.fn();
      }
    }

    if (!this.over) for (const h of this.heroes) { h.gold += PASSIVE_GOLD * dt * (h.goldMul || 1); h.totalGold = (h.totalGold || 0) + PASSIVE_GOLD * dt; }

    for (const c of Object.values(this.controllers)) c.update(dt);
    for (const ai of this.ais) ai.update(dt);
    for (const u of this.units) if (u.alive) u.update(dt);
    for (const h of this.heroes) if (!h.alive) h.update(dt);

    this.updateSpring(dt);
    this.updateProjectiles(dt);
    this.separate();
    // 死亡的小兵和野怪直接移除（死亡动画由客户端播放）
    if (this.units.some((u) => !u.alive && (u.kind === 'minion' || u.kind === 'monster'))) {
      this.units = this.units.filter((u) => u.alive || (u.kind !== 'minion' && u.kind !== 'monster'));
    }
  }

  updateSpring(dt) {
    for (const h of this.heroes) {
      if (!h.alive) continue;
      const own = SPRING[h.team], foe = SPRING[1 - h.team];
      if (Math.hypot(h.x - own.x, h.z - own.z) < 7) {
        h.hp = Math.min(h.stats.maxHp, h.hp + h.stats.maxHp * 0.2 * dt);
      }
      if (Math.hypot(h.x - foe.x, h.z - foe.z) < 10) {
        const src = this.units.find((u) => u.kind === 'crystal' && u.team !== h.team) || h;
        h.hp -= 1500 * dt;
        if (h.hp <= 0) h.die(src);
      }
    }
  }

  separate() {
    const movers = this.units.filter((u) => u.alive && u.movable);
    const statics = this.units.filter((u) => u.alive && !u.movable);
    for (let i = 0; i < movers.length; i++) {
      const a = movers[i];
      if (a.dash) continue;
      for (let j = i + 1; j < movers.length; j++) {
        const b = movers[j];
        if (b.dash) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = (a.radius + b.radius) * (a.kind === 'hero' || b.kind === 'hero' ? 0.6 : 0.9);
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const nx = d2 > 0 ? dx / d : Math.random() - 0.5, nz = d2 > 0 ? dz / d : Math.random() - 0.5;
        const wa = b.mass / (a.mass + b.mass), wb = a.mass / (a.mass + b.mass);
        a.x -= nx * push * wa * 2; a.z -= nz * push * wa * 2;
        b.x += nx * push * wb * 2; b.z += nz * push * wb * 2;
      }
      for (const s of statics) {
        const dx = a.x - s.x, dz = a.z - s.z;
        const min = a.radius + s.radius;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 0.001) continue;
        const nx = dx / d, nz = dz / d;
        // 正面顶住障碍物时沿切线绕行，避免卡死
        const ix = a.x - (a.px ?? a.x), iz = a.z - (a.pz ?? a.z);
        const into = ix * nx + iz * nz;
        let ox = s.x + nx * min, oz = s.z + nz * min;
        if (into < 0) {
          let tx = ix - into * nx, tz = iz - into * nz;
          if (Math.hypot(tx, tz) < Math.abs(into) * 0.5) {
            let sx = -nz, sz = nx;
            if ((sx * LANE_NORMAL.x + sz * LANE_NORMAL.z) * laneSide(a) < 0) { sx = -sx; sz = -sz; }
            tx = sx * Math.abs(into);
            tz = sz * Math.abs(into);
          }
          ox += tx; oz += tz;
          const ndx = ox - s.x, ndz = oz - s.z, nd = Math.hypot(ndx, ndz) || 1;
          ox = s.x + (ndx / nd) * min; oz = s.z + (ndz / nd) * min;
        }
        a.x = ox; a.z = oz;
      }
    }
    for (const a of movers) {
      const p = clampToMap(a.x, a.z, a.radius * 0.6);
      a.x = p.x; a.z = p.z;
    }
  }
}

// 绕障方向：按单位所在兵线一侧决定，保证每帧一致
function laneSide(u) {
  return (u.x * LANE_NORMAL.x + u.z * LANE_NORMAL.z) >= 0 ? 1 : -1;
}

// ---------- 真人玩家控制器：把摇杆/按键状态转成英雄意图 ----------
export class PlayerController {
  constructor(sim, hero) {
    this.sim = sim;
    this.hero = hero;
    this.move = null;
    this.atk = false;
    this.tap = 0;
    this.seq = 0;
  }

  setInput({ move, atk, seq }) {
    if (move && Number.isFinite(move.x) && Number.isFinite(move.z)) {
      const l = Math.hypot(move.x, move.z);
      this.move = l > 0.2 ? { x: move.x / l, z: move.z / l } : null;
    } else this.move = null;
    this.atk = !!atk;
    if (Number.isFinite(seq)) this.seq = seq;
  }

  command(c) {
    const h = this.hero;
    const vec = (v) => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? { x: v[0], z: v[1] } : null);
    switch (c.t) {
      case 'tap': this.tap = 1.2; break;
      case 'cast': {
        const i = c.i | 0;
        const dir = vec(c.dir), point = vec(c.pt);
        if (i < 0 || i > 2 || !dir) return;
        const l = Math.hypot(dir.x, dir.z) || 1;
        h.castSkill(i, { dir: { x: dir.x / l, z: dir.z / l }, point: point || { x: h.x, z: h.z } });
        break;
      }
      case 'flash': {
        const dir = vec(c.dir);
        if (dir) { const l = Math.hypot(dir.x, dir.z) || 1; h.castFlash({ x: dir.x / l, z: dir.z / l }); }
        break;
      }
      case 'recall': h.startRecall(); break;
      case 'buy': if (typeof c.id === 'string') h.buy(c.id); break;
      default:
    }
  }

  update(dt) {
    const p = this.hero, g = this.sim;
    const it = p.intent;
    if (!p.alive) { it.attack = null; it.move = null; return; }
    it.move = this.move;
    if (this.tap > 0) this.tap -= dt;
    if (this.atk || this.tap > 0) {
      let t = it.attack;
      if (!t || !t.alive || p.edgeDist(t) > p.stats.range + 4 || !g.isTargetable(t, p.team)) t = g.autoTarget(p, Math.max(p.stats.range + 2.5, 6));
      const h = g.autoTarget(p, p.stats.range + 1, true, true); // 优先英雄
      if (h) t = h;
      it.attack = t;
      if (!t) this.tap = 0;
      if (it.attackDone && !this.atk) this.tap = 0;
    } else {
      it.attack = null;
    }
    it.attackDone = false;
  }
}
