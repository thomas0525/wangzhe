// 游戏主循环与规则
import * as THREE from 'three';
import {
  BLUE, RED, SPRING, TOWER_T, LANE_NORMAL, POCKETS, JUNGLE, MONSTERS, BUFF_INFO, WAVE_INTERVAL, FIRST_WAVE, PASSIVE_GOLD, DIFFICULTY, TEAM_COLOR,
} from './config.js';
import { buildMap, clampToMap, bushAt } from './map.js';
import { Hero, Minion, Tower, Monster } from './units.js';
import { HEROES } from './heroes.js';
import { FX, Indicator } from './fx.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { AI } from './ai.js';
import { sfx, voice } from './audio.js';

const STREAK_TEXT = { 2: '双杀！', 3: '大杀特杀！', 4: '主宰比赛！', 5: '无人能挡！', 6: '横扫千军！' };
const STREAK_VOICE = { 2: 'double_kill', 3: 'triple_kill', 4: 'quadra_kill', 5: 'penta_kill', 6: 'rampage' };

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.time = 0;
    this.speed = opts.speed || 1;
    this.over = false;
    this.paused = false;
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.quality = opts.quality || (this.mobile ? 'low' : 'high');
    this.units = [];
    this.heroes = [];
    this.projectiles = [];
    this.timers = [];
    this.corpses = [];
    this.shakeAmp = 0;
    this.firstBlood = false;
    this.wave = 0;
    this.nextWave = FIRST_WAVE;
    this.camps = [
      { def: MONSTERS.tyrant, x: POCKETS[0].x, z: POCKETS[0].z, nextAt: MONSTERS.tyrant.first, unit: null },
      ...JUNGLE.map((j) => ({ def: MONSTERS[j.kind], x: j.x, z: j.z, side: j.side, nextAt: MONSTERS[j.kind].first, unit: null })),
    ];
    this.announced = new Set();

    this.initRenderer();
    this.fx = new FX(this.scene);
    this.indicator = new Indicator(this.scene);
    this.ui = new UI(this);
    this.sfx = (n) => sfx(n);
    this.voice = (n, urgent) => voice(n, urgent);
    this.crystalWarnAt = -99;

    // 防御塔与水晶
    for (const team of [BLUE, RED]) {
      const [innerT, outerT] = TOWER_T[team];
      this.addUnit(new Tower(this, team, outerT, 'outer'));
      this.addUnit(new Tower(this, team, innerT, 'inner'));
      this.addUnit(new Tower(this, team, team === BLUE ? 0 : 1, 'crystal'));
    }
    // 英雄
    this.player = new Hero(this, HEROES[opts.heroId], BLUE, true);
    this.enemy = new Hero(this, HEROES[opts.enemyId], RED, false);
    this.addUnit(this.player);
    this.addUnit(this.enemy);
    this.heroes = [this.player, this.enemy];
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.diff = diff;
    this.enemy.dmgMul = diff.dmg;
    this.enemy.goldMul = diff.goldMul;
    this.player.goldMul = 1;
    this.ais = [new AI(this, this.enemy, diff)];
    if (opts.autoplay) this.ais.push(new AI(this, this.player, DIFFICULTY.normal));

    this.input = new Input(this);
    this.ui.refreshShop();

    // 敌方防御塔攻击范围提示圈
    this.towerRings = [];
    for (const u of this.units) {
      if ((u.kind === 'tower' || u.kind === 'crystal') && u.team === RED) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(u.stats.range + u.radius - 0.15, u.stats.range + u.radius, 64),
          new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.5, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(u.x, 0.11, u.z);
        ring.visible = false;
        this.scene.add(ring);
        this.towerRings.push({ u, ring });
      }
    }

    this.camTarget = new THREE.Vector3(this.player.x, 0, this.player.z);
    this.snapCamera();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.last = performance.now();
    this.ui.banner('欢迎来到峡谷对决', 'info');
    this.schedule(0.6, () => this.voice('welcome'));
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  initRenderer() {
    const host = document.getElementById('game');
    const renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fc4e8);
    scene.fog = new THREE.Fog(0x8fc4e8, 45, 95);
    this.scene = scene;

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4a6b35, 1.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-18, 34, 14);
    sun.castShadow = true;
    const sm = this.quality === 'low' ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 200);
    this.map = buildMap(scene, this.quality);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const portrait = h > w;
    this.camOffset = portrait ? new THREE.Vector3(0, 42, 24) : new THREE.Vector3(0, 27, 17);
    const mmSize = portrait || h < 500 ? 110 : 140;
    if (this.mm !== mmSize) {
      this.mm = mmSize;
      const mmEl = document.getElementById('minimap');
      mmEl.width = mmEl.height = mmSize;
    }
  }

  addUnit(u) { this.units.push(u); return u; }

  schedule(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }

  shake(a) { this.shakeAmp = Math.max(this.shakeAmp, a); }

  clamp(x, z) { return clampToMap(x, z); }

  snapCamera() {
    const p = this.player;
    this.camTarget.set(p.x, 0, p.z);
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget);
  }

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
      if (src === this.player && o.basic) this.ui.floatText(target, '无敌', 'immune');
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
    if (target.kind === 'crystal' && target.team === this.player.team && this.time - this.crystalWarnAt > 20 && target.hp > 0) {
      this.crystalWarnAt = this.time;
      this.ui.banner('我方水晶正在遭受攻击！', 'bad');
      this.voice('crystal_attack');
    }
    target.lastDamagedAt = this.time;
    target.lastAttacker = src;
    target.anim.hurt = 0.15;
    if (target.kind === 'hero') {
      target.cancelRecall();
      if (src.kind === 'hero') { target.lastHeroDamager = src; target.lastHeroDamageAt = this.time; src.heroDamage = (src.heroDamage || 0) + a; }
    }
    if (src.kind === 'hero' && target.kind === 'hero') src.lastHeroAttackAt = this.time;
    if (src.kind === 'hero') src.revealUntil = Math.max(src.revealUntil, this.time + 0.8);
    if (src.stats?.lifesteal && o.basic) src.heal(a * src.stats.lifesteal);

    if (src === this.player) {
      this.ui.floatText(target, Math.round(a), o.crit ? 'crit' : type === 'magic' ? 'magic' : 'dmg');
    } else if (target === this.player) {
      this.ui.floatText(target, '-' + Math.round(a), 'hurt');
      if (a > 150) this.shake(0.12);
    }
    if (target.hp <= 0) target.die(src);
    return a;
  }

  awardGold(hero, n, text = true) {
    n *= hero.goldMul || 1;
    hero.gold += n;
    hero.totalGold = (hero.totalGold || 0) + n;
    if (hero === this.player && text && n >= 10) this.ui.floatText(hero, '+' + Math.round(n) + '💰', 'gold');
  }

  onDeath(u, killer) {
    const enemyHero = this.heroes.find((h) => h.team !== u.team && h.team !== 2);
    if (u.kind === 'minion') {
      for (const h of this.heroes) {
        if (h.team === u.team || !h.alive) continue;
        if (h.dist(u) < 15) h.addXp(u.def.xp);
        if (killer === h) { this.awardGold(h, u.def.gold); h.cs++; }
        else if (h.dist(u) < 15) this.awardGold(h, u.def.gold * 0.3, false);
      }
      this.ui.removeBar(u);
      this.corpses.push({ u, t: 0, dur: 0.7 });
    } else if (u.kind === 'monster') {
      const h = killer?.kind === 'hero' ? killer : null;
      const def = u.def;
      if (h) {
        this.awardGold(h, def.gold);
        h.addXp(def.xp);
        h.addBuff({ ...def.buff });
        const mine = h.team === this.player.team;
        if (def.id === 'tyrant') {
          this.ui.banner(mine ? '我方击败了峡谷巨兽！' : '敌方击败了峡谷巨兽！', mine ? 'good' : 'bad');
          this.voice(mine ? 'tyrant_ally' : 'tyrant_enemy');
        } else {
          const info = BUFF_INFO[def.buff.id];
          this.ui.banner(mine ? `获得${info.name}：${info.desc}` : `敌方拿下了${info.name}`, mine ? 'good' : 'bad');
        }
        this.ui.killFeed(h, u);
      }
      this.ui.removeBar(u);
      this.corpses.push({ u, t: 0, dur: 1.2 });
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
        this.voice(line || (u === this.player ? 'killed' : 'kill'));
        const mine = credit.team === this.player.team;
        this.ui.banner(text ? `${credit.name} ${text}` : `${credit.name} 击败了 ${u.name}`, mine ? 'good' : 'bad');
        this.sfx(mine ? 'kill' : 'death');
      } else {
        this.ui.banner(`${u.name} 被击败了`, u.team === this.player.team ? 'bad' : 'good');
        this.voice(u === this.player ? 'executed' : 'kill');
        if (enemyHero) enemyHero.addXp(100);
      }
      this.ui.killFeed(credit || killer, u);
      this.corpses.push({ u, t: 0, dur: 1.4, hero: true });
    } else if (u.kind === 'tower') {
      this.fx.explosion(u.x, u.z, TEAM_COLOR[u.team]);
      this.shake(0.6);
      this.sfx('destroy');
      this.ui.removeBar(u);
      if (enemyHero) { this.awardGold(enemyHero, 220); enemyHero.addXp(200); }
      this.ui.banner(u.team === this.player.team ? '我方防御塔被摧毁！' : '摧毁了敌方防御塔！', u.team === this.player.team ? 'bad' : 'good');
      this.voice(u.team === this.player.team ? 'ally_tower' : 'enemy_tower');
      this.corpses.push({ u, t: 0, dur: 1.2, keep: true });
    } else if (u.kind === 'crystal') {
      this.fx.explosion(u.x, u.z, TEAM_COLOR[u.team]);
      this.fx.explosion(u.x, u.z, 0xffffff);
      this.shake(1);
      this.sfx('destroy');
      this.ui.removeBar(u);
      this.corpses.push({ u, t: 0, dur: 1.5, keep: true });
      this.endGame(u.team !== this.player.team, u);
    }
  }

  endGame(win, crystal) {
    if (this.over) return;
    this.over = true;
    this.endFocus = crystal;
    this.speed = Math.min(this.speed, 0.35);
    this.input.finishAim(true);
    setTimeout(() => {
      this.sfx(win ? 'win' : 'lose');
      this.voice(win ? 'victory' : 'defeat', true);
      this.opts.onEnd?.({ win, player: this.player, enemy: this.enemy, time: this.time });
    }, 2200);
  }

  // ---------- 投射物 ----------
  addHoming(owner, target, style, onHit) {
    const geo = style.arrow ? new THREE.BoxGeometry(0.08, 0.08, 0.9) : new THREE.SphereGeometry(style.size || 0.25, 8, 6);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: style.color || 0xffffff }));
    const y = style.fromY ?? 1.4;
    m.position.set(owner.x, y, owner.z);
    this.scene.add(m);
    this.projectiles.push({ kind: 'homing', owner, target, mesh: m, speed: style.speed || 24, onHit, x: owner.x, y, z: owner.z });
  }

  addSkillShot(o) {
    const geo = o.arrow ? new THREE.BoxGeometry(0.25, 0.25, 1.8) : new THREE.IcosahedronGeometry(o.size || 0.4, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: o.color }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry((o.size || 0.4) * 2.2, 10, 8), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.add(glow);
    mesh.rotation.y = Math.atan2(o.dir.x, o.dir.z);
    mesh.position.set(o.x, 1.2, o.z);
    this.scene.add(mesh);
    const p = { kind: 'skill', ...o, mesh, traveled: 0, hit: new Set() };
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
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.lookAt(t.x, ty, t.z);
      } else {
        const step = p.speed * dt;
        p.x += p.dir.x * step;
        p.z += p.dir.z * step;
        p.traveled += step;
        p.mesh.position.set(p.x, 1.2, p.z);
        p.mesh.rotation.x += dt * 6 * (p.arrow ? 0 : 1);
        for (const e of this.enemiesInCircle(p.owner.team, p.x, p.z, p.radius)) {
          if (p.hit.has(e)) continue;
          p.hit.add(e);
          const stop = p.onHit(e, p);
          if (stop || !p.pierce) { p.done = true; break; }
        }
        if (p.traveled >= p.range) p.done = true;
      }
    }
    if (this.projectiles.some((p) => p.done)) {
      for (const p of this.projectiles) {
        if (p.done) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          p.mesh.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.done);
    }
  }

  // ---------- 刷兵 ----------
  spawnWave() {
    this.wave++;
    if (this.wave === 1) { this.ui.banner('全军出击！', 'info'); this.voice('wave'); }
    const cannon = this.wave % 3 === 0;
    const scale = 1 + Math.floor(this.time / 60) * 0.06;
    for (const team of [BLUE, RED]) {
      const melee = this.time > 360 ? [-2.2, -0.7, 0.7, 2.2] : [-1.6, 0, 1.6];
      melee.forEach((off, i) => this.schedule(i * 0.25, () => this.spawnMinion('melee', team, off, scale)));
      [-1, 1].forEach((off, i) => this.schedule(1.4 + i * 0.25, () => this.spawnMinion('caster', team, off, scale)));
      if (cannon) this.schedule(2.4, () => this.spawnMinion('cannon', team, 0, scale));
    }
  }

  spawnMinion(type, team, off, scale) {
    if (this.over) return;
    const m = new Minion(this, type, team, off);
    m.base.maxHp *= scale;
    m.base.atk *= scale;
    m.computeStats();
    m.hp = m.stats.maxHp;
    this.addUnit(m);
  }

  // ---------- 主循环 ----------
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) { this.render(0); return; }
    dt *= this.speed;
    const steps = Math.max(1, Math.ceil(dt / 0.034));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) this.step(sdt);
    this.render(dt / this.speed);
  }

  step(dt) {
    this.time += dt;
    const t = this.time;
    for (const u of this.units) { u.px = u.x; u.pz = u.z; }

    // 公告
    if (t > FIRST_WAVE - 5 && !this.announced.has('5s')) { this.announced.add('5s'); this.ui.banner('距离小兵出击还有 5 秒', 'info'); this.voice('countdown'); }
    if (t >= this.nextWave && !this.over) { this.spawnWave(); this.nextWave += WAVE_INTERVAL; }
    for (const c of this.camps) {
      if (t < c.nextAt || c.unit?.alive) continue;
      c.unit = this.addUnit(new Monster(this, c.def, c.x, c.z));
      c.nextAt = Infinity;
      if (c.def.id === 'tyrant') {
        this.ui.banner('峡谷巨兽已出现在左上方野区', 'info');
        this.voice('tyrant_spawn');
      }
    }

    // 定时器
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.t <= t);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.t > t);
        for (const d of due) d.fn();
      }
    }

    // 金币
    for (const h of this.heroes) if (!this.over) { h.gold += PASSIVE_GOLD * dt * (h.goldMul || 1); h.totalGold = (h.totalGold || 0) + PASSIVE_GOLD * dt; }

    if (!this.over || this.speed > 0) {
      if (!this.opts.autoplay) this.input.update(dt);
      for (const ai of this.ais) ai.update(dt);
    }
    for (const u of this.units) if (u.alive) u.update(dt);
    for (const h of this.heroes) if (!h.alive) h.update(dt);

    this.updateSpring(dt);
    this.updateProjectiles(dt);
    this.separate();
    this.updateCorpses(dt);
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
            // 选择远离兵线中轴、朝单位当前所在一侧的切线方向
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

  updateCorpses(dt) {
    for (const c of this.corpses) {
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const m = c.u.mesh;
      if (c.hero) {
        if (c.u.alive) { c.done = true; continue; }
        m.rotation.x = -Math.min(1, k * 2) * Math.PI / 2 * 0.9;
        m.position.y = -k * 0.3;
        if (k >= 1) { m.visible = false; c.done = true; }
      } else if (c.keep) {
        m.position.y = -k * (c.u.kind === 'crystal' ? 3 : 4.5);
        m.rotation.z = k * 0.15;
        if (k >= 1) {
          c.done = true;
          m.scale.y = 0.3;
          m.position.y = -0.5;
        }
      } else {
        m.position.y = -k * 1.2;
        m.rotation.z = k * 1.2;
        if (k >= 1) {
          c.done = true;
          this.scene.remove(m);
          const i = this.units.indexOf(c.u);
          if (i >= 0) this.units.splice(i, 1);
        }
      }
    }
    if (this.corpses.length) this.corpses = this.corpses.filter((c) => !c.done);
  }

  render(dt) {
    const p = this.player;
    // 可见性
    for (const h of this.heroes) {
      if (!h.alive) continue;
      const vis = this.isVisibleTo(h, p.team);
      h.mesh.visible = vis;
      const ring = h.mesh.getObjectByName('ring');
      if (ring) ring.material.opacity = h.inBush >= 0 ? 0.35 : 0.8;
      this.updateAuras(h);
    }
    this.map.bushMat.opacity = p.alive && p.inBush >= 0 ? 0.55 : 1;
    for (const u of this.units) if (u.alive) u.syncMesh(dt * this.speed);

    // 防御塔警示
    for (const { u, ring } of this.towerRings) {
      ring.visible = u.alive && p.alive && p.edgeDist(u) < u.stats.range + 5;
      if (ring.visible) ring.material.opacity = u.target === p ? 0.85 : 0.4;
      if (u.alive && u.target === p && (!u.beam || u.beam.dead)) u.beam = this.fx.beam(u, p, 0xff3030);
    }

    this.fx.update(dt * this.speed);
    const water = this.map.group.userData.water;
    if (water) water.material.emissiveIntensity = 0.3 + Math.sin(this.time * 2) * 0.1;

    // 摄像机
    const focus = this.endFocus || p;
    const lerp = 1 - Math.exp(-dt * (this.endFocus ? 2 : 10));
    this.camTarget.x += (focus.x - this.camTarget.x) * lerp;
    this.camTarget.z += (focus.z - this.camTarget.z) * lerp;
    const cam = this.camera;
    cam.position.copy(this.camTarget).add(this.camOffset);
    if (this.shakeAmp > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmp;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.5);
    }
    cam.lookAt(this.camTarget);
    this.sun.position.set(this.camTarget.x - 18, 34, this.camTarget.z + 14);
    this.sun.target.position.copy(this.camTarget);

    this.renderer.render(this.scene, cam);
    this.ui.updateHud(dt);
    document.body.classList.toggle('dead-gray', !p.alive && !this.over);
  }

  // 红蓝 buff / 巨兽之力 脚下光环
  updateAuras(h) {
    if (!h.auras) {
      h.auras = {};
      const defs = { redbuff: [0xff5a1a, 1.3], bluebuff: [0x3aa8ff, 1.55], tyrant: [0xc07bff, 1.8] };
      for (const [id, [col, r]] of Object.entries(defs)) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(r - 0.12, r, 40, 1, 0, Math.PI * 1.6),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.08;
        h.mesh.add(m);
        h.auras[id] = m;
      }
    }
    let i = 0;
    for (const [id, m] of Object.entries(h.auras)) {
      m.visible = h.hasBuff(id);
      m.rotation.z = this.time * (2 + i++) * (i % 2 ? 1 : -1);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    document.body.classList.remove('dead-gray');
  }
}

// 绕障方向：按单位所在兵线一侧决定，保证每帧一致
function laneSide(u) {
  return (u.x * LANE_NORMAL.x + u.z * LANE_NORMAL.z) >= 0 ? 1 : -1;
}

export { bushAt };
