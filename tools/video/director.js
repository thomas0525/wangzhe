// 宣传视频导演脚本：在 ?capture 模式下加载，由 capture.mjs 逐帧推进虚拟时间
// 每个镜头是一局摆拍好的对局：放置单位、按时间点释放技能、控制击杀时刻，并记录语音 / 音效时间点
import { lanePoint, JUNGLE, POCKETS, BUSHES, XP_TABLE, TOWER_T } from '../../js/config.js';

const P = new URLSearchParams(location.search);
const VERT = P.get('layout') === 'v';
const COVER = P.get('cover'); // xhs | bili：只拍一张封面
const $ = (s) => document.querySelector(s);
const L = (t, off = 0) => lanePoint(t, off);

let g = null;
let T = 0;
let t0 = null;
let cur = -1;
let fired = new Set();
const cues = [];
let narrText = {};
let narrDur = {};

// ---------- 工具 ----------
function cue(type, name, at = T) { cues.push({ type, name, t: +at.toFixed(3) }); }
const app = () => window.__app;

function place(u, p) { u.x = p.x; u.z = p.z; }

function setLevel(h, n) {
  h.level = n;
  h.xp = XP_TABLE[n - 1];
  h.computeStats();
  h.hp = h.stats.maxHp;
}

function setItems(h, items) {
  h.items = items.slice();
  h.computeStats();
  h.hp = h.stats.maxHp;
}

function hideHero(h) {
  h.alive = false;
  h.respawnAt = 1e9;
}

function press(sel) {
  const b = $(sel);
  if (!b) return;
  b.classList.add('down');
  setTimeout(() => b.classList.remove('down'), 220);
}

function aimFor(h, spec, p) {
  const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / d, z: dz / d };
  const r = Math.min(spec.range || 0, d);
  return { dir, point: { x: h.x + dir.x * r, z: h.z + dir.z * r } };
}

function cast(h, i, p) {
  h.skillCd[i] = 0;
  const spec = h.def.skills[i].aim;
  const ok = h.castSkill(i, p ? aimFor(h, spec, p) : { dir: { x: Math.sin(h.facing), z: Math.cos(h.facing) } });
  if (ok && h === g.player) press('#btn-s' + i);
  return ok;
}

function flash(h, p) {
  h.flashCd = 0;
  const a = aimFor(h, { range: 6 }, p);
  h.castFlash(a.dir);
  if (h === g.player) press('#btn-flash');
}

function nearestEnemyMinion(h, maxD = 99, lowHp = false) {
  let best = null, bs = Infinity;
  for (const u of g.units) {
    if (!u.alive || u.kind !== 'minion' || u.team === h.team) continue;
    const d = h.dist(u);
    if (d > maxD) continue;
    const s = lowHp ? u.hp + d * 30 : d;
    if (s < bs) { bs = s; best = u; }
  }
  return best;
}

function spawn(type, team, t, off) {
  g.spawnMinion(type, team, off, 1 + Math.floor(g.time / 60) * 0.06);
  const m = g.units[g.units.length - 1];
  place(m, L(t, off));
  return m;
}

// 一波兵：近战在前、法师在后
function wave(team, t, cannon = false) {
  const back = team === 0 ? -0.025 : 0.025;
  for (const off of [-2, 0, 2]) spawn('melee', team, t, off);
  for (const off of [-1.2, 1.2]) spawn('caster', team, t + back, off);
  if (cannon) spawn('cannon', team, t + back * 2, 0);
}

// 不让目标在指定时间之前死亡（保证击杀发生在解说空档里）
function holdAlive(u, frac) {
  if (!u.alive) return;
  u.addBuff({ id: 'vo_hold', dur: 0.15, dr: 0.75 });
  if (u.hp < u.stats.maxHp * frac) u.hp = u.stats.maxHp * frac;
}
function finish(src, u) {
  if (u.alive) g.damage(src, u, 1e6, 'true');
}

// 摇杆可视化：让画面看起来是有人在操作
function joy(dir) {
  const base = $('#joy-base'), knob = $('#joy-knob');
  if (!base) return;
  if (dir) {
    base.classList.add('active');
    knob.style.transform = `translate(calc(-50% + ${dir.x * 40}px), calc(-50% + ${dir.z * 40}px))`;
  } else {
    base.classList.remove('active');
    knob.style.transform = 'translate(-50%,-50%)';
  }
}
function moveDirOf(h) {
  const it = h.intent;
  if (it.move) return it.move;
  const tgt = it.moveTo || (it.attack && !h.inRange(it.attack) ? it.attack : null);
  if (!tgt || !h.anim.moving) return null;
  const dx = tgt.x - h.x, dz = tgt.z - h.z, d = Math.hypot(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

function clearBanner() { $('#banner').className = ''; }

const CAM = {
  normal: VERT ? [0, 25, 15] : [0, 20, 13.5],
  close: VERT ? [0, 20, 12] : [0, 16.5, 11],
  wide: VERT ? [0, 36, 21] : [0, 27, 17],
};

function setupGame(hero, enemy, o = {}) {
  app().start({ heroId: hero, enemyId: enemy, difficulty: 'easy' });
  g = window.__game;
  g.opts.autoplay = true;
  g.sim.controllers = {}; // 关闭玩家控制器，英雄意图由导演直接设置
  if (!o.enemyAI) g.ais = [];
  const allowed = new Set(o.voices || []);
  g.voice = (n) => { if (allowed.has(n)) cue('voice', n); };
  const lastS = {};
  g.sfx = (n) => {
    if (lastS[n] !== undefined && T - lastS[n] < 0.07) return;
    lastS[n] = T;
    cue('sfx', n);
  };
  g.time = o.time ?? 120;
  g.sim.nextWave = Infinity;
  g.sim.announced.add('5s');
  for (const c of g.camps) c.nextAt = Infinity;
  clearBanner();
  setLevel(g.player, o.level || 1);
  setLevel(g.enemy, o.enemyLevel || o.level || 1);
  if (o.items) setItems(g.player, o.items);
  if (o.enemyItems) setItems(g.enemy, o.enemyItems);
  g.player.gold = o.gold ?? 300;
  g.camBase = [...(CAM[o.cam || 'normal'])];
  g.view.camOffset.set(...g.camBase);
  return g;
}

function protect(h, frac = 0.35) { if (h.alive && h.hp < h.stats.maxHp * frac) h.hp = h.stats.maxHp * frac; }

// ---------- 镜头 ----------
const SCENES = [
  {
    // 开场钩子：大场面
    dur: 5.5, narr: ['n01', 0.15], title: true,
    setup() {
      setupGame('mage', 'blade', { level: 10, enemyLevel: 10, time: 240, cam: 'close', items: ['boots', 'staff', 'heart'], enemyItems: ['boots', 'plate', 'heart'] });
      place(g.player, L(0.465, -1));
      place(g.enemy, L(0.55, 1.5));
      wave(0, 0.49, true);
      wave(1, 0.525, true);
    },
    actions: [
      [0.2, () => cast(g.player, 1, g.enemy)],
      [0.8, () => cast(g.player, 2, g.enemy)],
      [1.7, () => cast(g.enemy, 2, g.player)],
      [2.3, () => cast(g.enemy, 1)],
      [2.7, () => flash(g.player, { x: g.player.x - 4, z: g.player.z + 4 })],
      [3.1, () => cast(g.player, 0, g.enemy)],
      [3.7, () => cast(g.enemy, 0, g.player)],
      [4.2, () => cast(g.player, 1, g.enemy)],
      [4.7, () => { const m = nearestEnemyMinion(g.player, 14); cast(g.player, 2, m || g.enemy); }],
    ],
    frame(t) {
      const p = g.player, e = g.enemy;
      p.intent.attack = t > 1.2 ? e : nearestEnemyMinion(p, 10);
      e.intent.attack = t > 1.0 ? p : nearestEnemyMinion(e, 10);
      protect(p, 0.4); protect(e, 0.4);
    },
  },
  {
    // 英雄选择菜单
    dur: 3.7, narr: ['n02', 0.1], menu: true, capLow: true,
    setup() { app().backToMenu(); g = null; },
    actions: [
      [0.15, () => app().selectHero('blade')],
      [1.05, () => app().selectHero('mage')],
      [1.95, () => app().selectHero('archer')],
      [3.0, () => $('#start-btn').classList.add('vo-press')],
    ],
  },
  {
    // 中路对线
    dur: 6.4, narr: ['n03', 1.8], chip: '⚔️ 中路对线',
    setup() {
      setupGame('archer', 'mage', { level: 3, enemyLevel: 3, time: 30, voices: ['wave'] });
      $('#start-btn').classList.remove('vo-press');
      place(g.player, L(0.44, -1.5));
      place(g.enemy, L(0.585, 1));
      wave(0, 0.465);
      wave(1, 0.535);
    },
    actions: [
      [0.1, () => { g.ui.banner('全军出击！', 'info'); cue('voice', 'wave'); }],
      [2.0, () => cast(g.player, 1, g.enemy)],
      [3.1, () => {
        cast(g.enemy, 0, g.player);
        const a = aimFor(g.enemy, { range: 11 }, g.player);
        g.player.dodge = { x: -a.dir.z, z: a.dir.x };
      }],
      [3.25, () => g.ui.floatText(g.world.me, '走位躲开！', 'crit')],
      [3.7, () => { g.player.dodge = null; }],
      [4.4, () => cast(g.player, 0, g.enemy)],
    ],
    frame(t) {
      const p = g.player, e = g.enemy;
      if (p.dodge) { p.intent.move = p.dodge; p.intent.attack = null; }
      else {
        p.intent.move = null;
        p.intent.attack = t < 1.9 ? nearestEnemyMinion(p, 10, true) : (t > 4.3 ? e : nearestEnemyMinion(p, 10, true));
      }
      const m = nearestEnemyMinion(e, 9);
      e.intent.attack = m;
      if (!m) e.intent.moveTo = L(0.56, 1);
      protect(p, 0.5); protect(e, 0.3);
    },
  },
  {
    // 越塔被塔打
    dur: 3.6, narr: ['n04', 0.1], chip: '🏰 防御塔：没兵线别越塔',
    setup() {
      setupGame('blade', 'archer', { level: 4, enemyLevel: 4, time: 120 });
      place(g.player, L(0.525, 0.5));
      place(g.enemy, L(0.69, -1));
      g.player.hp = g.player.stats.maxHp * 0.75;
      g.player.intent.moveTo = L(0.62, 0);
    },
    actions: [
      [2.0, () => { g.player.intent.moveTo = L(0.48, 0); g.player.intent.attack = null; }],
    ],
    frame(t) {
      const p = g.player, e = g.enemy;
      if (t < 2.0) {
        if (p.dist(e) < p.stats.range + 3) p.intent.attack = e;
        if (!p.intent.moveTo && !p.intent.attack) p.intent.moveTo = L(0.62, 0);
      }
      e.intent.attack = e.inRange(p) ? p : null;
      protect(p, 0.2);
    },
  },
  {
    // 带兵推塔
    dur: 4.6, narr: ['n05', 0.1], chip: '💥 带兵推塔', voices: ['enemy_tower'],
    setup() {
      setupGame('blade', 'archer', { level: 5, time: 150, voices: ['enemy_tower'] });
      hideHero(g.enemy);
      const tower = g.units.find((u) => u.kind === 'tower' && u.team === 1 && u.tier === 'outer');
      tower.hp = 1700;
      this.tower = tower;
      wave(0, 0.585, true);
      place(g.player, L(0.575, 2));
    },
    frame(t) {
      const p = g.player;
      if (this.tower.alive) {
        p.intent.attack = this.tower;
        if (t < 2.55) holdAlive(this.tower, 0.03);
        else finish(p, this.tower);
      } else {
        p.intent.attack = null;
        p.intent.moveTo = L(0.7, 0);
      }
    },
  },
  {
    // 拿红拿蓝
    dur: 5.2, narr: ['n06', 0.1], chip: '🔥 拿红  💧 拿蓝', cam: 'close',
    setup() {
      setupGame('blade', 'mage', { level: 4, time: 60, cam: 'close' });
      hideHero(g.enemy);
      g.camps[1].nextAt = 0; // 蓝方红buff
      g.camps[2].nextAt = 0; // 蓝方蓝buff
      const r = JUNGLE[0];
      place(g.player, { x: r.x + 2.2, z: r.z + 2.2 });
      g.snapCamera();
    },
    actions: [
      [0.05, function () {
        this.red = g.camps[1].unit; this.blue = g.camps[2].unit;
        this.red.hp = 1300; this.blue.hp = 1100;
      }],
      [0.25, () => cast(g.player, 1)],
      [2.55, () => {
        const b = JUNGLE[1];
        flashCut();
        place(g.player, { x: b.x - 2.2, z: b.z - 2.2 });
        g.snapCamera();
      }],
      [2.75, () => cast(g.player, 1)],
      [4.6, () => { g.player.intent.moveTo = L(0.3, 3); }],
    ],
    frame(t) {
      const p = g.player;
      if (!this.red) return;
      if (t < 2.55) {
        p.intent.attack = this.red.alive ? this.red : null;
        if (t < 1.9) holdAlive(this.red, 0.05); else finish(p, this.red);
      } else if (t < 4.6) {
        p.intent.attack = this.blue.alive ? this.blue : null;
        if (t < 4.3) holdAlive(this.blue, 0.05); else finish(p, this.blue);
      }
      protect(p, 0.5);
    },
  },
  {
    // 大招连招拿一血
    dur: 4.8, narr: ['n07', 0.1], chip: '⚡ 四级大招 · 一套带走',
    setup() {
      setupGame('blade', 'mage', { level: 6, enemyLevel: 5, time: 200, voices: ['first_blood'] });
      g.player.addBuff({ id: 'redbuff', dur: 70 });
      place(g.player, L(0.45, -1));
      place(g.enemy, L(0.535, 1));
      g.enemy.hp = g.enemy.stats.maxHp * 0.55;
      g.enemy.intent.moveTo = L(0.49, 2);
      g.enemy.addBuff({ id: 'vo_dr', dur: 2.85, dr: 0.55 });
      wave(0, 0.47);
      wave(1, 0.53);
    },
    actions: [
      [0.3, () => cast(g.player, 0, g.enemy)],
      [0.9, () => cast(g.player, 2, g.enemy)],
      [1.5, () => cast(g.player, 1)],
      [1.6, () => { g.enemy.intent.moveTo = L(0.62, 0); }],
    ],
    frame(t) {
      const p = g.player, e = g.enemy;
      if (t > 0.5) p.intent.attack = e.alive ? e : null;
      if (t < 2.9) holdAlive(e, 0.12); else finish(p, e);
      if (e.alive && t < 1.6) e.intent.attack = e.inRange(p) ? p : null;
      protect(p, 0.5);
    },
  },
  {
    // 草丛伏击：闪现开大
    dur: 5.1, narr: ['n08', 0.1], chip: '🌿 草丛蹲人 · 闪现开大',
    setup() {
      setupGame('blade', 'archer', { level: 7, enemyLevel: 6, time: 260, voices: ['double_kill'] });
      g.sim.firstBlood = true;
      g.player.kills = 1; g.player.streak = 1; g.enemy.deaths = 1;
      const b = BUSHES[0];
      place(g.player, { x: b.x, z: b.z });
      g.player.facing = Math.PI * 0.75;
      place(g.enemy, L(0.535, 3));
      g.enemy.intent.moveTo = L(0.44, 3.5);
      g.enemy.hp = g.enemy.stats.maxHp * 0.75;
      g.enemy.addBuff({ id: 'vo_dr', dur: 3.35, dr: 0.55 });
      g.snapCamera();
    },
    actions: [
      [2.35, () => flash(g.player, g.enemy)],
      [2.55, () => cast(g.player, 2, g.enemy)],
      [3.05, () => cast(g.player, 1)],
      [3.1, () => { g.enemy.intent.moveTo = L(0.6, 1); }],
    ],
    frame(t) {
      const p = g.player, e = g.enemy;
      if (t > 2.6) p.intent.attack = e.alive ? e : null;
      if (t < 3.4) holdAlive(e, 0.12); else finish(p, e);
      protect(p, 0.5);
    },
  },
  {
    // 峡谷巨兽
    dur: 4.7, narr: ['n09', 0.1], chip: '🐉 峡谷巨兽', cam: 'close',
    setup() {
      setupGame('mage', 'blade', { level: 10, time: 300, cam: 'close', items: ['boots', 'staff', 'codex'], voices: ['tyrant_ally'] });
      hideHero(g.enemy);
      g.camps[0].nextAt = 0;
      const banner = g.ui.banner.bind(g.ui);
      g.ui.banner = (text, cls) => { if (!text.includes('已出现')) banner(text, cls); };
      const c = POCKETS[0];
      place(g.player, { x: c.x + 4.5, z: c.z + 4.5 });
      g.snapCamera();
    },
    actions: [
      [0.04, function () { clearBanner(); this.ty = g.camps[0].unit; this.ty.hp = this.ty.stats.maxHp * 0.5; }],
      [0.25, function () { return cast(g.player, 1, this.ty); }],
      [0.7, function () { return cast(g.player, 2, this.ty); }],
      [1.7, function () { return cast(g.player, 0, this.ty); }],
      [2.3, function () { return cast(g.player, 0, this.ty); }],
    ],
    frame(t) {
      const p = g.player;
      if (!this.ty) return;
      p.intent.attack = this.ty.alive ? this.ty : null;
      if (t < 2.75) holdAlive(this.ty, 0.06); else finish(p, this.ty);
      protect(p, 0.5);
    },
  },
  {
    // 回城、泉水回血、出装
    dur: 5.0, narr: ['n10', 0.1], chip: '🏠 回城 · 泉水回血 · 出装',
    setup() {
      setupGame('archer', 'mage', { level: 9, time: 320, gold: 2650, items: ['boots', 'fury', 'storm'] });
      hideHero(g.enemy);
      place(g.player, L(0.33, 0));
      g.player.hp = g.player.stats.maxHp * 0.18;
      g.snapCamera();
    },
    actions: [
      [0.15, () => { press('#btn-recall'); g.player.startRecall(); g.player.recall.dur = 2.2; }],
      [3.7, () => { press('#rec-buy'); g.player.buy(g.player.nextBuild()); g.ui.floatText(g.world.me, '购买 嗜血之刃 🩸', 'gold'); }],
      [4.2, () => { g.player.intent.moveTo = L(0.08, 0); }],
    ],
    frame(t, dt) {
      const p = g.player;
      // 泉水回血加速展示
      if (t > 2.45 && p.hp < p.stats.maxHp) {
        const add = p.stats.maxHp * 0.75 * dt;
        p.hp = Math.min(p.stats.maxHp, p.hp + add);
        this.healAcc = (this.healAcc || 0) + add;
        if (this.healAcc > 600) { g.ui.floatText(g.world.me, '+' + Math.round(this.healAcc), 'heal'); this.healAcc = 0; }
      }
    },
  },
  {
    // 推水晶胜利
    dur: 5.4, narr: ['n11', 0.1], chip: '💎 冲上高地 · 推掉水晶', voices: ['victory'],
    setup() {
      setupGame('blade', 'archer', { level: 13, time: 600, items: ['boots', 'vamp', 'plate', 'cleaver', 'heart', 'fury'], voices: ['victory'] });
      hideHero(g.enemy);
      g.player.kills = 5; g.enemy.deaths = 5;
      for (const u of g.units) {
        if (u.kind === 'tower' && u.team === 1) { u.alive = false; u.hp = 0; }
      }
      // 直接显示成废墟，不播放倒塌动画
      g.publish();
      for (const r of g.world.units) {
        if (r.kind === 'tower' && r.team === 1) { r.mesh.position.y = -0.5; r.mesh.scale.y = 0.3; }
      }
      g.view.corpses = g.view.corpses.filter((c) => c.r.kind !== 'tower');
      this.crystal = g.units.find((u) => u.kind === 'crystal' && u.team === 1);
      this.crystal.hp = 2600;
      wave(0, 0.905, true);
      place(g.player, L(0.9, 2.5));
      g.endDelay = 1.0; // 结算提前，避免和最后的解说重叠
      g.snapCamera();
    },
    frame(t) {
      const p = g.player;
      if (this.crystal.alive) {
        p.intent.attack = this.crystal;
        if (t < 2.4) holdAlive(this.crystal, 0.04); else finish(p, this.crystal);
      }
    },
  },
  {
    // 结尾卡片
    dur: 6.0, narr: ['n12', 0.1], outro: true, capLow: true,
    setup() {
      $('#end').classList.add('hidden');
      setupGame('mage', 'blade', { level: 8, enemyLevel: 8, time: 300, cam: 'wide' });
      wave(0, 0.48, true); wave(1, 0.52, true);
      place(g.player, L(0.44, -2));
      place(g.enemy, L(0.56, 2));
      $('#hud').classList.add('vo-hide');
      this.focus = { x: L(0.42).x, z: L(0.42).z };
      g.view.endFocus = this.focus;
      g.snapCamera();
    },
    frame(t) {
      const p = L(0.42 + t * 0.02);
      this.focus.x = p.x; this.focus.z = p.z;
      g.player.intent.attack = nearestEnemyMinion(g.player, 12);
      g.enemy.intent.attack = nearestEnemyMinion(g.enemy, 12);
    },
  },
];

let acc = 0;
for (const s of SCENES) { s.start = acc; acc += s.dur; }
const TOTAL = acc;

// ---------- 覆盖层（标题、字幕、标签、转场） ----------
const HIGHLIGHT = ['王者荣耀', 'AI', '红蓝buff', '大招', '闪现开大', '峡谷巨兽', '回城', '神装', '水晶', '防御塔', '越塔', '推塔', '走位', '预判', '扣1', '三个原创英雄', '泉水'];
function hl(text) {
  let s = text;
  for (const w of HIGHLIGHT) s = s.split(w).join(`<em>${w}</em>`);
  return s;
}

function injectOverlay() {
  const css = document.createElement('style');
  css.textContent = `
  #vo { position: fixed; inset: 0; z-index: 60; pointer-events: none; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
  #vo .cap { position: absolute; left: 50%; transform: translateX(-50%); width: ${VERT ? '92%' : '56%'}; ${VERT ? 'top: 61%;' : 'bottom: 15%;'}
    text-align: center; font-size: ${VERT ? 27 : 26}px; font-weight: 900; line-height: 1.35; color: #fff; letter-spacing: 1px;
    -webkit-text-stroke: 5px #000; paint-order: stroke fill; text-shadow: 0 3px 8px rgba(0,0,0,.6); opacity: 0; }
  #vo .cap.on { opacity: 1; }
  #vo .cap.low { ${VERT ? 'top: 80%;' : 'bottom: 6%;'} }
  ${VERT ? '' : '#vo .cap.cap-off { display: none; }'}
  #vo .cap em { font-style: normal; color: #ffd84a; }
  #vo .chip { position: absolute; ${VERT ? 'left: 50%; top: 29.5%; transform: translateX(-50%);' : 'right: 14px; top: 12px;'} white-space: nowrap;
    padding: ${VERT ? '9px 22px' : '7px 18px'}; border-radius: 40px; font-size: ${VERT ? 22 : 19}px; font-weight: 900; color: #fff;
    background: linear-gradient(90deg, #ff3d6e, #ff8a2b); box-shadow: 0 6px 20px rgba(255, 70, 90, .45); border: 3px solid #fff;
    animation: chipIn .45s cubic-bezier(.2,1.6,.4,1) both; }
  @keyframes chipIn { from { transform: ${VERT ? 'translateX(-50%)' : ''} scale(.3) rotate(-6deg); opacity: 0; } to { transform: ${VERT ? 'translateX(-50%)' : ''} scale(1); opacity: 1; } }
  #menu .help, #menu .note { visibility: hidden; }
  ${VERT ? '' : '#feed { top: 64px !important; }'}
  #vo .title { position: absolute; left: 0; right: 0; ${VERT ? 'top: 21%;' : 'top: 15%;'} text-align: center; }
  #vo .title .big { font-size: ${VERT ? 64 : 62}px; font-weight: 900; color: #ffe14a; letter-spacing: 6px;
    -webkit-text-stroke: 7px #b2160e; paint-order: stroke fill; text-shadow: 0 6px 0 #5a0a05, 0 10px 30px rgba(0,0,0,.6);
    animation: slam .5s cubic-bezier(.2,1.8,.4,1) both, wobble 1.2s .5s ease-in-out infinite; display: inline-block; }
  #vo .title .sub { margin-top: 10px; font-size: ${VERT ? 28 : 28}px; font-weight: 900; color: #fff; -webkit-text-stroke: 5px #000; paint-order: stroke fill;
    animation: popIn .45s .35s cubic-bezier(.2,1.6,.4,1) both; display: inline-block; }
  #vo .title .sub b { color: #7fe3ff; }
  @keyframes popIn { from { transform: scale(.3) rotate(-6deg); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes slam { from { transform: scale(3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes wobble { 50% { transform: scale(1.06) rotate(-2deg); } }
  #vo .flash { position: absolute; inset: 0; background: #fff; animation: flash .22s ease-out both; }
  @keyframes flash { from { opacity: .85; } to { opacity: 0; } }
  #vo .outro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${VERT ? 18 : 12}px;
    background: radial-gradient(ellipse at center, rgba(10,20,45,.55), rgba(5,10,25,.88)); animation: fadeIn .5s both; }
  #vo .outro .name { font-size: ${VERT ? 60 : 58}px; font-weight: 900; letter-spacing: 8px; background: linear-gradient(180deg, #fff3c4, #f0b43a);
    -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 4px 0 #6a3d00); animation: slam .5s .1s both; }
  #vo .outro .tag { font-size: ${VERT ? 26 : 24}px; font-weight: 800; color: #fff; animation: popIn .4s .4s both; }
  #vo .outro .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; max-width: 92%; }
  #vo .outro .pill { padding: 8px 16px; border-radius: 30px; background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.35);
    font-size: ${VERT ? 21 : 20}px; font-weight: 800; color: #fff; animation: popIn .4s both; }
  #vo .outro .cta { margin-top: 8px; padding: 12px 30px; border-radius: 40px; font-size: ${VERT ? 28 : 26}px; font-weight: 900; color: #3a2300;
    background: linear-gradient(180deg, #ffe08a, #e89a1f); box-shadow: 0 5px 0 #8a5300; animation: popIn .4s 1.1s both, pulse2 1s 1.6s infinite; }
  @keyframes pulse2 { 50% { transform: scale(1.07); } }
  @keyframes fadeIn { from { opacity: 0; } }
  #vo .cover { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    background: radial-gradient(ellipse at center, rgba(0,0,0,.05), rgba(0,0,0,.55)); }
  #vo .cover .badge { position: absolute; top: 5%; right: 5%; padding: 8px 16px; border-radius: 12px; font-size: 22px; font-weight: 900; color: #fff;
    background: linear-gradient(90deg, #7a3cff, #2f8cff); border: 3px solid #fff; transform: rotate(4deg); }
  #vo .cover .c1 { font-size: ${VERT ? 92 : 104}px; font-weight: 900; color: #ffe14a; letter-spacing: 6px; -webkit-text-stroke: 10px #b2160e; paint-order: stroke fill;
    text-shadow: 0 8px 0 #5a0a05, 0 14px 40px rgba(0,0,0,.6); transform: rotate(-4deg); }
  #vo .cover .c2 { margin-top: 18px; font-size: ${VERT ? 46 : 50}px; font-weight: 900; color: #fff; -webkit-text-stroke: 7px #000; paint-order: stroke fill; }
  #vo .cover .c2 b { color: #7fe3ff; }
  #vo .cover .c3 { margin-top: 6px; font-size: ${VERT ? 110 : 120}px; font-weight: 900; letter-spacing: 8px; background: linear-gradient(180deg, #fff6c8, #ffb02e 60%, #ff6a00);
    -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 0 #6a2d00) drop-shadow(0 0 24px rgba(255,160,40,.6)); }
  #vo .cover .c4 { margin-top: 18px; padding: 10px 26px; border-radius: 40px; font-size: ${VERT ? 30 : 32}px; font-weight: 900; color: #3a2300;
    background: linear-gradient(180deg, #ffe08a, #e89a1f); box-shadow: 0 6px 0 #8a5300; }
  ${VERT ? '' : '#menu .menu-inner { transform: scale(.8); transform-origin: left center; } #menu { padding-top: 0; padding-bottom: 0; }'}
  #start-btn.vo-press { transform: translateY(3px) scale(.97); filter: brightness(1.15); }
  #hud.vo-hide #controls, #hud.vo-hide #topbar, #hud.vo-hide #minimap, #hud.vo-hide #leftpanel, #hud.vo-hide #selfinfo, #hud.vo-hide #pause-btn { display: none; }
  #pause-btn { display: none; }
  `;
  document.head.appendChild(css);
  const vo = document.createElement('div');
  vo.id = 'vo';
  vo.innerHTML = '<div class="cap"></div>';
  document.body.appendChild(vo);
}

function flashCut() {
  const f = document.createElement('div');
  f.className = 'flash';
  $('#vo').appendChild(f);
  setTimeout(() => f.remove(), 260);
}

function showChip(text) {
  $('#vo .chip')?.remove();
  if (!text) return;
  const c = document.createElement('div');
  c.className = 'chip';
  c.textContent = text;
  $('#vo').appendChild(c);
}

function showTitle(on) {
  $('#vo .title')?.remove();
  if (!on) return;
  const d = document.createElement('div');
  d.className = 'title';
  d.innerHTML = '<div class="big">太炸裂了！</div><br><div class="sub">一句话 <b>AI</b> 生成「王者荣耀」</div>';
  $('#vo').appendChild(d);
}

function showOutro(on) {
  $('#vo .outro')?.remove();
  if (!on) return;
  const d = document.createElement('div');
  d.className = 'outro';
  d.innerHTML = `
    <div class="name">峡谷对决 3D</div>
    <div class="tag">一句话 · AI 生成的「王者荣耀」</div>
    <div class="row">
      <span class="pill" style="animation-delay:.6s">🧠 代码 AI 写</span>
      <span class="pill" style="animation-delay:.7s">🎨 建模 AI 搭</span>
      <span class="pill" style="animation-delay:.8s">🎙️ 配音 AI 配</span>
    </div>
    <div class="row"><span class="pill" style="animation-delay:.95s">📱 手机浏览器打开就能玩</span></div>
    <div class="cta">想玩的评论区扣 1 👇</div>`;
  $('#vo').appendChild(d);
}

function showCover() {
  const d = document.createElement('div');
  d.className = 'cover';
  d.innerHTML = `
    <div class="badge">全程 AI 制作</div>
    <div class="c1">太炸裂了！</div>
    <div class="c2">一句话 <b>AI</b> 生成</div>
    <div class="c3">王者荣耀</div>
    <div class="c4">3D 实时对战 · 手机能玩</div>`;
  $('#vo').appendChild(d);
  $('#hud').classList.add('vo-hide');
}

function updateCaption() {
  if (COVER) return;
  const cap = $('#vo .cap');
  let text = '';
  for (const c of cues) {
    if (c.type !== 'narr') continue;
    const end = c.t + (narrDur[c.name]?.end ?? 3) + 0.25;
    if (T >= c.t + 0.1 && T < end) text = narrText[c.name];
  }
  if (cap.dataset.t !== text) {
    cap.dataset.t = text;
    cap.innerHTML = hl(text);
    cap.classList.toggle('on', !!text);
  }
}

// ---------- 主控 ----------
function enterScene(i) {
  cur = i;
  fired = new Set();
  const s = SCENES[i];
  if (i > 0) { flashCut(); cue('cut', i); }
  s.setup();
  if (g && !s.menu) { g.publish(); g.snapCamera(); }
  $('#vo .cap').classList.toggle('low', !!s.capLow);
  $('#vo .cap').classList.toggle('cap-off', !!s.outro);
  if (s.narr) cue('narr', s.narr[0], s.start + s.narr[1]);
  showTitle(!!s.title && !COVER);
  if (COVER) showCover();
  showOutro(false);
  showChip(null);
  if (s.chip) setTimeout(() => showChip(s.chip), 150);
  if (s.outro) setTimeout(() => showOutro(true), 100);
  joy(null);
}

function frame(vnow) {
  if (t0 === null) return;
  const prevT = T;
  T = (vnow - t0) / 1000;
  const dt = T - prevT;
  let idx = SCENES.findIndex((s) => T >= s.start && T < s.start + s.dur);
  if (idx < 0) idx = SCENES.length - 1;
  if (idx !== cur) enterScene(idx);
  const s = SCENES[idx];
  const lt = T - s.start;
  for (let k = 0; k < (s.actions || []).length; k++) {
    const [at, fn] = s.actions[k];
    if (lt >= at && !fired.has(k)) { fired.add(k); fn.call(s); }
  }
  if (g && !g.destroyed) {
    s.frame?.call(s, lt, dt);
    g.input.updateButtons();
    if (!s.outro) joy(g.player.alive ? moveDirOf(g.player) : null);
    // 镜头开场轻微推近
    if (g.camBase) {
      const k = 1 + 0.12 * Math.max(0, 1 - lt / 0.6);
      g.view.camOffset.set(g.camBase[0], g.camBase[1] * k, g.camBase[2] * k);
    }
  }
  updateCaption();
}

async function init() {
  const txt = await (await fetch('tools/video/narration.txt')).text();
  for (const line of txt.split('\n')) {
    const [k, v] = line.split('|');
    if (k && v) narrText[k] = v.trim();
  }
  narrDur = await (await fetch('tools/video/narration/durations.json')).json();
  injectOverlay();
  window.__director = {
    ready: true,
    total: TOTAL,
    cues,
    begin(vnow) { t0 = vnow; },
    frame,
  };
}
init();

export { TOWER_T };
