// 双人联机宣传视频导演脚本：外层页面运行同一局 Sim，每帧把蓝方 / 红方视角的快照分别喂给两台“手机”里的游戏页面
import { Sim } from '../../js/sim.js';
import { snapshotFor } from '../../js/snapshot.js';
import { lanePoint, XP_TABLE, FIRST_WAVE, BUSHES } from '../../js/config.js';

const P = new URLSearchParams(location.search);
const COVER = P.get('cover');
const $ = (s) => document.querySelector(s);
const L = (t, off = 0) => lanePoint(t, off);
const CODE = '6688';
const HEROES = ['blade', 'mage'];
const FRAMES = [$('#fa'), $('#fb')];
const win = (i) => FRAMES[i].contentWindow;
const doc = (i) => FRAMES[i].contentDocument;
const duo = (i) => win(i).__app.duo;

let T = 0, t0 = null, cur = -1, fired = new Set();
let sim = null;
let feeding = [false, false];
let offSince = -1;
let allowVoices = new Set();
const cues = [];
const lastSfx = {};
let narrText = {}, narrDur = {};
const nets = [null, null];

const cue = (type, name, at = T) => cues.push({ type, name, t: +at.toFixed(3) });

// ---------- 布局：竖版两台手机上下排；横版左边文字、右边两台手机 ----------
function layout() {
  const W = innerWidth, H = innerHeight, vert = H > W;
  // 横版按高度放下两台手机（含标签与间距）
  const pw = vert ? Math.min(W - 40, 500) : Math.min(W * 0.55, ((H - 28 - 64 - 14) / 2 - 10) * 844 / 390 + 10);
  const s = (pw - 10) / 844, ph = 390 * s + 10;
  for (const f of FRAMES) f.style.transform = `scale(${s})`;
  for (const el of document.querySelectorAll('.screen')) { el.style.width = pw + 'px'; el.style.height = ph + 'px'; }
  const pa = $('#pa'), pb = $('#pb'), title = $('#title'), cap = $('#cap'), chip = $('#chip'), vs = $('#vs'), brand = $('#brand');
  if (vert) {
    const x = (W - pw) / 2;
    const top = H * 0.2;
    pa.style.left = pb.style.left = x + 'px';
    pa.style.top = top + 'px';
    pb.style.top = top + ph + 32 + 54 + 'px';
    title.style.left = '0'; title.style.right = '0'; title.style.top = H * 0.035 + 'px';
    vs.style.left = W / 2 - 18 + 'px'; vs.style.top = top + ph + 32 + 10 + 'px';
    chip.style.left = '0'; chip.style.right = '0'; chip.style.top = H * 0.095 + 'px';
    const hd = $('#header'); hd.style.left = '0'; hd.style.right = '0'; hd.style.top = H * 0.03 + 'px';
    cap.style.left = '4%'; cap.style.right = '4%'; cap.style.top = top + 2 * (ph + 32) + 54 + 18 + 'px';
    brand.style.left = '0'; brand.style.right = '0'; brand.style.textAlign = 'center'; brand.style.bottom = '18px';
  } else {
    const x = W - pw - 26;
    pa.style.left = pb.style.left = x + 'px';
    pa.style.top = '14px';
    pb.style.top = 14 + ph + 32 + 10 + 'px';
    vs.style.left = x - 46 + 'px'; vs.style.top = 14 + ph + 6 + 'px';
    const colW = x - 50;
    title.style.left = '24px'; title.style.width = colW + 'px'; title.style.top = H * 0.12 + 'px';
    title.querySelector('.big').style.fontSize = '40px';
    chip.style.left = '24px'; chip.style.width = colW + 'px'; chip.style.top = H * 0.36 + 'px';
    const hd = $('#header'); hd.style.left = '24px'; hd.style.width = colW + 'px'; hd.style.top = H * 0.1 + 'px';
    cap.style.left = '24px'; cap.style.width = colW + 'px'; cap.style.top = H * 0.48 + 'px';
    brand.style.left = '24px'; brand.style.bottom = '16px';
  }
}

// ---------- 工具 ----------
function setLevel(h, n) { h.level = n; h.xp = XP_TABLE[n - 1]; h.computeStats(); h.hp = h.stats.maxHp; }
function place(u, p) { u.x = p.x; u.z = p.z; }
function aimFor(h, range, p) {
  const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / d, z: dz / d };
  const r = Math.min(range, d);
  return { dir, point: { x: h.x + dir.x * r, z: h.z + dir.z * r } };
}
function press(i, sel) {
  const b = doc(i)?.querySelector(sel);
  if (!b) return;
  b.classList.add('vo-press', 'down');
  win(i).setTimeout(() => b.classList.remove('vo-press', 'down'), 240);
}
function cast(h, idx, p) {
  h.skillCd[idx] = 0;
  const ok = h.castSkill(idx, p ? aimFor(h, h.def.skills[idx].aim.range || 3, p) : { dir: { x: Math.sin(h.facing), z: Math.cos(h.facing) } });
  if (ok) press(h.team, '#btn-s' + idx);
}
function flash(h, p) { h.flashCd = 0; h.castFlash(aimFor(h, 6, p).dir); press(h.team, '#btn-flash'); }
function holdAlive(u, frac) {
  if (!u.alive) return;
  u.addBuff({ id: 'vo_hold', dur: 0.15, dr: 0.75 });
  if (u.hp < u.stats.maxHp * frac) u.hp = u.stats.maxHp * frac;
}
// 收尾击杀：先压到 1 血再补一下，避免把巨额伤害算进结算统计
function finish(src, u) { if (u.alive) { u.hp = 1; sim.damage(src, u, 60, 'true'); } }
function protect(h, frac) { if (h.alive && h.hp < h.stats.maxHp * frac) h.hp = h.stats.maxHp * frac; }
function nearestFoeMinion(h, maxD = 12) {
  let best = null, bd = maxD;
  for (const u of sim.units) if (u.alive && u.kind === 'minion' && u.team !== h.team && h.dist(u) < bd) { bd = h.dist(u); best = u; }
  return best;
}
function wave(team, t) {
  const back = team === 0 ? -0.025 : 0.025;
  const spawn = (type, tt, off) => { const m = sim.spawnMinion(type, team, off, 1); place(m, L(tt, off)); };
  for (const off of [-2, 0, 2]) spawn('melee', t, off);
  for (const off of [-1.2, 1.2]) spawn('caster', t + back, off);
}
// 摇杆可视化（屏幕方向：红方要翻转）
function joy(i, h) {
  const d = doc(i);
  if (!d) return;
  const base = d.querySelector('#joy-base'), knob = d.querySelector('#joy-knob');
  if (!base) return;
  const it = h?.intent;
  const tgt = it && (it.moveTo || (it.attack && !h.inRange(it.attack) ? it.attack : null));
  let dir = it?.move || null;
  if (!dir && tgt && h.anim.moving) { const dx = tgt.x - h.x, dz = tgt.z - h.z, l = Math.hypot(dx, dz) || 1; dir = { x: dx / l, z: dz / l }; }
  if (dir && h.alive) {
    const f = i === 1 ? -1 : 1;
    base.classList.add('active');
    knob.style.transform = `translate(calc(-50% + ${f * dir.x * 40}px), calc(-50% + ${f * dir.z * 40}px))`;
  } else { base.classList.remove('active'); knob.style.transform = 'translate(-50%,-50%)'; }
}

function fakeNet(i) {
  nets[i] = { session: { seat: i, code: CODE, token: 'x' }, rtt: i ? 46 : 38, connected: true, send() {}, leave() {}, close() {}, rejoin() {} };
  duo(i).setNet(nets[i]);
}
const seat = (hero, ready = false, online = true) => ({ hero, ready, online });
const lobbyMsg = (seats, phase = 'lobby', cd = 0) => ({ t: 'lobby', code: CODE, phase, cd, seats });

// 新开一局（两台手机都进入联机对局）
function startMatch(o = {}) {
  sim = new Sim({ heroes: HEROES, humans: [0, 1] });
  sim.controllers = {}; // 英雄意图由导演直接设置
  sim.time = o.time ?? 60;
  sim.nextWave = o.waves ? FIRST_WAVE : Infinity;
  if (!o.waves) sim.announced.add('5s');
  for (const c of sim.camps) c.nextAt = Infinity;
  if (o.level) for (const h of sim.heroes) setLevel(h, o.level);
  if (!o.waves) sim.drainEvents(); // 中途开场的镜头不显示“欢迎”横幅
  for (let i = 0; i < 2; i++) {
    if (!nets[i]) fakeNet(i);
    duo(i).onNetMessage({ t: 'start', team: i, heroes: HEROES });
    duo(i).game.endDelay = 1.0;
  }
  feeding = [true, true];
  offSince = -1;
}

// 每帧：推进模拟并分别喂快照
function feed(dt) {
  if (!sim) return;
  sim.step(dt);
  const events = sim.drainEvents();
  for (const { to, ev } of events) {
    if (to !== -1 && to !== 0) continue;
    if (ev[0] === 'voice' && allowVoices.has(ev[1])) cue('voice', ev[1]);
    if (ev[0] === 'sfx') {
      const ids = ev[2] || [];
      if (ids.length && !ids.some((id) => sim.heroes.some((h) => h.id === id))) continue;
      if (lastSfx[ev[1]] !== undefined && T - lastSfx[ev[1]] < 0.07) continue;
      lastSfx[ev[1]] = T;
      cue('sfx', ev[1]);
    }
  }
  for (let i = 0; i < 2; i++) {
    if (!feeding[i]) continue;
    const extra = i === 0 && offSince >= 0 ? { opp: Math.max(0, Math.ceil(30 - (T - offSince))) } : {};
    duo(i).onNetMessage({ t: 'snap', ...snapshotFor(sim, i, events, extra) });
  }
}

const A = () => sim.heroes[0], B = () => sim.heroes[1];

// ---------- 分镜 ----------
const SCENES = [
  {
    // 开场：同一局的两台手机，双方正在交手
    dur: 4.3, narr: ['d01', 0.15], title: true,
    setup() {
      startMatch({ level: 8, time: 240 });
      place(A(), L(0.475, -1)); place(B(), L(0.535, 1));
      wave(0, 0.49); wave(1, 0.52);
    },
    actions: [
      [0.3, () => cast(B(), 1, A())],
      [0.9, () => cast(A(), 0, B())],
      [1.4, () => cast(B(), 2, A())],
      [2.1, () => cast(A(), 2, B())],
      [2.8, () => cast(A(), 1)],
      [3.3, () => cast(B(), 0, A())],
    ],
    frame() { A().intent.attack = B(); B().intent.attack = A(); protect(A(), 0.4); protect(B(), 0.4); },
  },
  {
    // 建房 / 输入房间号加入
    dur: 4.7, narr: ['d02', 0.1], chip: '🏠 新建房间 · 4 位房间号', menu: true,
    setup() {
      sim = null;
      for (let i = 0; i < 2; i++) {
        duo(i).toMenu();
        duo(i).setMode('duo');
        win(i).__app.selectHero(HEROES[i]);
        fakeNet(i);
        doc(i).querySelector('#room-input').value = '';
      }
    },
    actions: [
      [0.5, () => press(0, '#create-room')],
      [0.8, () => { duo(0).onNetMessage({ t: 'room', code: CODE, seat: 0, token: 'x' }); duo(0).onNetMessage(lobbyMsg([seat('blade'), null])); }],
      ...[...CODE].map((ch, k) => [1.4 + k * 0.28, () => { const el = doc(1).querySelector('#room-input'); el.value += ch; }]),
      [2.7, () => press(1, '#join-room')],
      [3.0, () => {
        duo(1).onNetMessage({ t: 'room', code: CODE, seat: 1, token: 'x' });
        const m = lobbyMsg([seat('blade'), seat('mage')]);
        duo(0).onNetMessage(m); duo(1).onNetMessage(m);
      }],
    ],
  },
  {
    // 准备、倒计时
    dur: 4.0, narr: ['d03', 0.1], chip: '✅ 选英雄 · 准备 · 开打', menu: true,
    actions: [
      [0.3, () => press(1, '#room-heroes button[data-id="mage"]')],
      [0.6, () => { press(0, '#ready-btn'); const m = lobbyMsg([seat('blade', true), seat('mage')]); duo(0).onNetMessage(m); duo(1).onNetMessage(m); }],
      [1.2, () => { press(1, '#ready-btn'); const m = lobbyMsg([seat('blade', true), seat('mage', true)], 'countdown', 3); duo(0).onNetMessage(m); duo(1).onNetMessage(m); }],
      [2.2, () => { const m = lobbyMsg([seat('blade', true), seat('mage', true)], 'countdown', 2); duo(0).onNetMessage(m); duo(1).onNetMessage(m); }],
      [3.2, () => { const m = lobbyMsg([seat('blade', true), seat('mage', true)], 'countdown', 1); duo(0).onNetMessage(m); duo(1).onNetMessage(m); }],
    ],
  },
  {
    // 开局：同一局两个视角（红方翻转）
    dur: 8.0, narr: ['d04', 1.1], chip: '🔄 同一局 · 两个视角', voices: ['wave'],
    setup() {
      startMatch({ time: FIRST_WAVE - 0.2, waves: true });
    },
    frame(t) {
      if (t > 0.4) { A().intent.moveTo = L(0.36, -1); B().intent.moveTo = L(0.64, 1); }
    },
  },
  {
    // 对线：放技能、躲技能
    dur: 4.2, narr: ['d05', 0.1], chip: '⚔️ 实时对线',
    setup() {
      for (const h of sim.heroes) { setLevel(h, 4); h.intent = { move: null, attack: null }; }
      sim.time = 120;
      sim.nextWave = Infinity;
      sim.units = sim.units.filter((u) => u.kind !== 'minion');
      place(A(), L(0.465, -1.5)); place(B(), L(0.55, 1.5));
      wave(0, 0.48); wave(1, 0.52);
    },
    actions: [
      [0.4, () => { cast(B(), 0, A()); const a = aimFor(B(), 11, A()); A().dodge = { x: -a.dir.z, z: a.dir.x }; }],
      [0.95, () => { A().dodge = null; }],
      [1.6, () => cast(A(), 0, B())],
      [2.4, () => cast(B(), 1, A())],
      [3.0, () => cast(A(), 1)],
    ],
    frame() {
      const a = A(), b = B();
      if (a.dodge) { a.intent.move = a.dodge; a.intent.attack = null; } else { a.intent.move = null; a.intent.attack = b; }
      b.intent.attack = a;
      protect(a, 0.45); protect(b, 0.45);
    },
  },
  {
    // 快捷消息
    dur: 3.0, narr: ['d06', 0.1], chip: '💬 快捷消息',
    actions: [
      [0.3, () => { press(1, '#chat-btn'); doc(1).querySelector('#chat-panel').classList.add('open'); }],
      [0.7, () => { doc(1).querySelector('#chat-panel').classList.remove('open'); for (let i = 0; i < 2; i++) duo(i).onNetMessage({ t: 'chat', team: 1, id: 5 }); }],
      [1.6, () => { press(0, '#chat-btn'); doc(0).querySelector('#chat-panel').classList.add('open'); }],
      [2.0, () => { doc(0).querySelector('#chat-panel').classList.remove('open'); for (let i = 0; i < 2; i++) duo(i).onNetMessage({ t: 'chat', team: 0, id: 6 }); }],
    ],
    frame() {
      A().intent.attack = nearestFoeMinion(A()); B().intent.attack = nearestFoeMinion(B());
      protect(A(), 0.5); protect(B(), 0.5);
    },
  },
  {
    // 一套连招拿一血，对面黑屏
    dur: 4.5, narr: ['d07', 0.1], chip: '⚡ 一血！对面黑屏', voices: ['first_blood'],
    setup() {
      setLevel(A(), 6); setLevel(B(), 5);
      A().addBuff({ id: 'redbuff', dur: 70 });
      place(A(), L(0.48, -1)); place(B(), L(0.535, 1));
      B().hp = B().stats.maxHp * 0.5;
      B().respawnAt = 0;
    },
    actions: [
      [0.3, () => cast(A(), 0, B())],
      [0.9, () => cast(A(), 2, B())],
      [1.5, () => cast(A(), 1)],
      [1.6, () => { B().intent.moveTo = L(0.62, 0); }],
    ],
    frame(t) {
      const a = A(), b = B();
      if (t > 0.5) a.intent.attack = b.alive ? b : null;
      if (t < 1.6 && b.alive) b.intent.attack = a;
      if (t < 3.0) holdAlive(b, 0.12); else finish(a, b);
      protect(a, 0.5);
    },
  },
  {
    // 断线重连
    dur: 3.9, narr: ['d08', 0.1], chip: '📶 断线自动重连',
    setup() {
      const b = B();
      if (!b.alive) b.respawnAt = sim.time; // 复活后再演示断线
      A().intent = { move: null, attack: null };
    },
    actions: [
      [0.4, () => { feeding[1] = false; offSince = T; nets[1].connected = false; duo(1).onNetStatus('lost'); }],
      [2.7, () => { nets[1].connected = true; duo(1).onNetStatus('open'); feeding[1] = true; offSince = -1; }],
    ],
    frame() {
      A().intent.attack = nearestFoeMinion(A(), 14);
      if (B().alive) B().intent.moveTo = L(0.7, 0);
    },
  },
  {
    // 推水晶：一边胜利一边失败
    dur: 6.1, narr: ['d09', 0.1], chip: '💎 推掉水晶', voices: [],
    setup() {
      setLevel(A(), 12); setLevel(B(), 11);
      A().items = ['boots', 'vamp', 'plate', 'cleaver']; A().computeStats(); A().hp = A().stats.maxHp;
      for (const u of sim.units) if (u.kind === 'tower' && u.team === 1) { u.alive = false; u.hp = 0; }
      sim.units = sim.units.filter((u) => u.kind !== 'minion');
      this.crystal = sim.units.find((u) => u.kind === 'crystal' && u.team === 1);
      this.crystal.hp = 2600;
      wave(0, 0.9);
      place(A(), L(0.9, 2.5));
      place(B(), L(0.93, -2));
      B().alive = false; B().hp = 0; B().respawnAt = sim.time + 25; B().deaths++;
      this.rubble = false;
    },
    frame(t) {
      if (!this.rubble) {
        // 已被摧毁的防御塔直接显示为废墟
        this.rubble = true;
        for (let i = 0; i < 2; i++) {
          const g = duo(i).game;
          for (const r of g.world.units) if (r.kind === 'tower' && r.team === 1 && r.mesh) { r.alive = false; r.mesh.position.y = -0.5; r.mesh.scale.y = 0.3; }
          g.view.corpses = g.view.corpses.filter((c) => c.r.kind !== 'tower' || c.r.team !== 1);
          for (const r of g.world.units) if (r.kind === 'tower' && r.team === 1) g.view.ui.removeBar(r);
        }
      }
      const a = A();
      if (this.crystal.alive) {
        a.intent.attack = this.crystal;
        if (t < 3.2) holdAlive(this.crystal, 0.04); else { finish(a, this.crystal); cue('voice', 'victory', T + 1.0); }
      }
    },
  },
  {
    // 结尾卡片
    dur: 6.0, narr: ['d10', 0.1], outro: true,
    frame() {},
  },
];

let acc = 0;
for (const s of SCENES) { s.start = acc; acc += s.dur; }
const TOTAL = acc;

// ---------- 字幕 ----------
const HL = ['AI', '联机', '新建房间', '四位房间号', '准备', '两个视角', '自动翻转', '左下角', '实时', '快捷消息', '一血', '黑屏', '自动重连', '水晶', '胜利', '失败', '服务器', '扣1'];
function hl(t) { let s = t; for (const w of HL) s = s.split(w).join(`<em>${w}</em>`); return s; }
function updateCaption() {
  let text = '';
  for (const c of cues) {
    if (c.type !== 'narr') continue;
    if (T >= c.t + 0.1 && T < c.t + (narrDur[c.name]?.end ?? 3) + 0.25) text = narrText[c.name];
  }
  const cap = $('#cap');
  if (cap.dataset.t !== text) { cap.dataset.t = text; cap.innerHTML = hl(text); }
}

function enterScene(i) {
  cur = i;
  fired = new Set();
  const s = SCENES[i];
  if (i > 0) { const f = $('#flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); cue('cut', i); }
  allowVoices = new Set(s.voices || []);
  s.setup?.call(s);
  if (s.narr) cue('narr', s.narr[0], s.start + s.narr[1]);
  $('#title').style.display = s.title && !COVER ? '' : 'none';
  $('#header').style.display = s.title || s.outro || COVER ? 'none' : '';
  const chip = $('#chip');
  chip.classList.remove('on');
  chip.querySelector('span').textContent = s.chip || '';
  if (s.chip) { void chip.offsetWidth; chip.classList.add('on'); }
  $('#outro').classList.toggle('on', !!s.outro);
}

function frame(vnow) {
  if (t0 === null) return;
  const prevT = T;
  T = (vnow - t0) / 1000;
  const dt = Math.max(0, T - prevT) || 1 / 30;
  let idx = SCENES.findIndex((s) => T >= s.start && T < s.start + s.dur);
  if (idx < 0) idx = SCENES.length - 1;
  if (idx !== cur) enterScene(idx);
  const s = SCENES[idx];
  const lt = T - s.start;
  (s.actions || []).forEach(([at, fn], k) => { if (lt >= at && !fired.has(k)) { fired.add(k); fn.call(s); } });
  if (sim && !s.menu) {
    s.frame?.call(s, lt);
    feed(dt);
    for (let i = 0; i < 2; i++) { joy(i, sim.heroes[i]); duo(i).game?.input.updateButtons(); }
  }
  // 两台手机推进同样的时间
  for (let i = 0; i < 2; i++) win(i).__vt?.advance(dt * 1000);
  updateCaption();
}

async function init() {
  layout();
  addEventListener('resize', layout);
  const txt = await (await fetch('duo/narration.txt')).text();
  for (const line of txt.split('\n')) { const [k, v] = line.split('|'); if (k && v) narrText[k] = v.trim(); }
  narrDur = await (await fetch('duo/narration/durations.json')).json();
  // 等两台手机加载完成
  await new Promise((res) => {
    const check = () => (FRAMES.every((f) => f.contentWindow?.__app?.duo) ? res() : setTimeout(check, 50));
    check();
  });
  if (COVER) {
    $('#cover').classList.add('on');
    for (const el of ['#cap', '#brand', '#vs', '#header']) $(el).style.display = 'none';
    for (const el of document.querySelectorAll('.phone .label')) el.style.visibility = 'hidden';
    if (innerWidth > innerHeight) {
      // 横版封面：文字放在左侧空白区，避开右边两台手机
      const cv = $('#cover');
      cv.style.right = innerWidth - parseFloat($('#pa').style.left) + 'px';
      cv.style.background = 'none';
      cv.querySelector('.c1').style.fontSize = '50px';
      cv.querySelector('.c2').style.fontSize = '74px';
      cv.querySelector('.c3').style.fontSize = '22px';
      const badge = cv.querySelector('.badge');
      badge.style.right = 'auto'; badge.style.left = '6%';
    }
  }
  window.__director = { ready: true, total: TOTAL, cues, begin(v) { t0 = v; }, frame };
}
init();

export { BUSHES };
