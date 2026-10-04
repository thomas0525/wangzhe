// 入口：菜单、英雄预览、开局与结算
import * as THREE from 'three';
import { LocalGame, NetGame } from './client.js';
import { HERO_LIST, HEROES, pickEnemyHero } from './heroes.js';
import { DIFFICULTY, QUICK_CHAT } from './config.js';
import { NetClient, loadSession } from './net.js';
import { buildHero } from './models.js';
import { unlockAudio, setMuted, isMuted, loadVoices, setVoiceOn, isVoiceOn } from './audio.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const EMOJI = { blade: '🗡️', mage: '🔮', archer: '🏹' };

const state = {
  hero: localGet('hero') || 'blade',
  diff: localGet('diff') || 'normal',
};
let game = null;
let lastSettings = null;
let mode = 'solo'; // solo | duo
let net = null;
let lobby = null; // 最近一次房间状态

function localGet(k) { try { return localStorage.getItem('xgdj.' + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem('xgdj.' + k, v); } catch { /* ignore */ } }

// ---------- 菜单 ----------
function buildMenu() {
  const cards = $('#hero-cards');
  cards.innerHTML = '';
  for (const h of HERO_LIST) {
    const b = document.createElement('button');
    b.className = 'hero-card';
    b.dataset.id = h.id;
    b.innerHTML = `<div class="em">${EMOJI[h.id]}</div><div class="hn">${h.name}</div><div class="ht">${h.role} · ${h.title}</div>`;
    b.addEventListener('click', () => selectHero(h.id));
    cards.appendChild(b);
  }
  const diffs = $('#diffs');
  diffs.innerHTML = '';
  for (const [id, d] of Object.entries(DIFFICULTY)) {
    const b = document.createElement('button');
    b.className = 'diff';
    b.dataset.id = id;
    b.textContent = d.name;
    b.addEventListener('click', () => {
      state.diff = id;
      localSet('diff', id);
      refreshMenu();
    });
    diffs.appendChild(b);
  }
  $('#start-btn').addEventListener('click', () => start({ heroId: state.hero, enemyId: pickEnemyHero(state.hero), difficulty: state.diff }));
  refreshMenu();
}

function selectHero(id) {
  state.hero = id;
  localSet('hero', id);
  refreshMenu();
  preview.setHero(id);
}

function refreshMenu() {
  for (const c of document.querySelectorAll('.hero-card')) c.classList.toggle('sel', c.dataset.id === state.hero);
  for (const c of document.querySelectorAll('.diff')) c.classList.toggle('sel', c.dataset.id === state.diff);
  const h = HEROES[state.hero];
  $('#hero-detail').innerHTML =
    `<b>${h.name}</b>（${h.role}）${h.desc}<br>` +
    `被动：${h.passive}<br>` +
    h.skills.map((s) => `<span class="sk">${s.icon} <b>${s.name}</b> ${s.desc}<br></span>`).join('');
}

// ---------- 菜单里的 3D 英雄预览 ----------
const preview = {
  init() {
    const canvas = $('#preview');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 3.2, 8.5);
    this.camera.lookAt(0, 1.5, 0);
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x334466, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 2.5);
    d.position.set(3, 6, 5);
    this.scene.add(d);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0x2a3b5c, emissive: 0x16305a, roughness: 0.5 }));
    ped.position.y = -0.2;
    this.scene.add(ped);
    this.run = true;
    const loop = this.loopFn = (t) => {
      if (!this.run) return;
      requestAnimationFrame(loop);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.model) this.model.rotation.y = t / 1600;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
    this.setHero(state.hero);
  },
  setHero(id) {
    if (!this.scene) return;
    if (this.model) this.scene.remove(this.model);
    this.model = buildHero(HEROES[id], 0);
    this.model.scale.setScalar(1.25);
    this.scene.add(this.model);
  },
  stop() { this.run = false; },
  resume() {
    if (this.run) return;
    this.run = true;
    requestAnimationFrame(this.loopFn);
  },
};

// ---------- 开局 ----------
function start(settings) {
  unlockAudio();
  loadVoices();
  lastSettings = settings;
  if (matchMedia('(pointer: coarse)').matches && !params.has('nofs')) {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const p = req?.call(el);
      p?.then?.(() => screen.orientation?.lock?.('landscape')?.catch(() => {})).catch(() => {});
    } catch { /* iOS 等不支持全屏 */ }
  }
  enterGame(() => new LocalGame({
    ...settings,
    autoplay: params.has('autoplay'),
    speed: Number(params.get('speed')) || 1,
    quality: params.get('quality') || undefined,
    onEnd: showEnd,
  }));
}

function enterGame(make) {
  $('#menu').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#room').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  preview.stop();
  game?.destroy();
  game = make();
  window.__game = game;
  const duo = game instanceof NetGame;
  $('#chat-btn').classList.toggle('hidden', !duo);
  $('#chat-panel').classList.remove('open');
  $('#pause-btn').textContent = duo ? '☰' : '⏸';
}

function showEnd({ win, player, enemy, time, reason }) {
  const t = $('#end-title');
  t.textContent = win ? '胜 利' : '失 败';
  t.className = win ? 'win' : 'lose';
  const mm = `${Math.floor(time / 60)}分${Math.floor(time % 60)}秒`;
  const row = (h, tag) => (h ? `<tr><td>${tag}</td><td>${h.name}</td><td>${h.level}</td><td>${h.kills}/${h.deaths}</td><td>${h.cs}</td><td>${Math.round(h.totalGold || 0)}</td><td>${Math.round(h.heroDamage || 0)}</td></tr>` : '');
  const duo = game instanceof NetGame;
  const why = { surrender: win ? '对手投降' : '你投降了', disconnect: '对手断线超时', leave: '对手离开了房间' }[reason] || '';
  $('#end-stats').innerHTML =
    `<tr><th></th><th>英雄</th><th>等级</th><th>击杀/死亡</th><th>补刀</th><th>经济</th><th>对英雄伤害</th></tr>` +
    row(player, '你') + row(enemy, duo ? '对手' : '电脑') +
    `<tr><td colspan="7" style="opacity:.6;border:0">对局时长 ${mm} · ${duo ? `双人对战 · 房间 ${net?.session?.code || ''}` : `难度 ${DIFFICULTY[lastSettings.difficulty].name}`}${why ? ' · ' + why : ''}</td></tr>`;
  $('#again-btn').textContent = duo ? '回到房间' : '再来一局';
  $('#end').classList.remove('hidden');
  window.__result = { win, time, kills: player.kills, deaths: player.deaths };
}

function backToMenu() {
  game?.destroy();
  game = null;
  if (net) { net.leave(); net.close(); net = null; }
  $('#room').classList.add('hidden');
  $('#net-status').classList.remove('show');
  $('#hud').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  preview.resume();
}

// ---------- 暂停 ----------
function setPaused(p) {
  if (!game || game.over) return;
  if (!(game instanceof NetGame)) game.paused = p; // 双人对战不能暂停，只打开菜单
  $('#pause').classList.toggle('hidden', !p);
  $('#resume-btn').textContent = game instanceof NetGame ? '返回对局' : '继续游戏';
}
$('#pause-btn').addEventListener('click', () => setPaused(true));
$('#resume-btn').addEventListener('click', () => setPaused(false));
$('#mute-btn').addEventListener('click', () => {
  setMuted(!isMuted());
  $('#mute-btn').textContent = '音效：' + (isMuted() ? '关' : '开');
});
$('#voice-btn').addEventListener('click', () => {
  setVoiceOn(!isVoiceOn());
  localSet('voice', isVoiceOn() ? '1' : '0');
  $('#voice-btn').textContent = '语音播报：' + (isVoiceOn() ? '开' : '关');
});
if (localGet('voice') === '0') { setVoiceOn(false); $('#voice-btn').textContent = '语音播报：关'; }
$('#surrender-btn').addEventListener('click', () => {
  if (!game) return;
  setPaused(false);
  if (game instanceof NetGame) net?.send({ t: 'surrender' });
  else game.surrender();
});
$('#again-btn').addEventListener('click', () => {
  if (game instanceof NetGame) { backToRoom(); return; }
  start({ ...lastSettings, enemyId: pickEnemyHero(lastSettings.heroId) });
});
$('#menu-btn').addEventListener('click', backToMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !(game instanceof NetGame) && !params.has('autoplay')) setPaused(true); });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- 双人对战 ----------
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('#mode-tabs button')) b.classList.toggle('sel', b.dataset.mode === m);
  $('#solo-panel').classList.toggle('hidden', m !== 'solo');
  $('#duo-panel').classList.toggle('hidden', m !== 'duo');
}
for (const b of document.querySelectorAll('#mode-tabs button')) b.addEventListener('click', () => setMode(b.dataset.mode));

function ensureNet() {
  unlockAudio();
  loadVoices();
  if (!net) net = new NetClient(onNetMessage, onNetStatus);
  return net;
}

function onNetStatus(st) {
  const ns = $('#net-status');
  if (st === 'lost' && net?.session) { ns.textContent = '连接断开，正在重连…'; ns.classList.add('show'); $('#room-msg').textContent = '连接断开，正在重连…'; }
  if (st === 'open') { ns.classList.remove('show'); if (lobby) renderLobby(lobby); }
}

function onNetMessage(m) {
  switch (m.t) {
    case 'room':
      $('#duo-msg').textContent = '';
      $('#room-code').textContent = m.code;
      if (!(game instanceof NetGame) || game.over) showRoom();
      break;
    case 'lobby':
      lobby = m;
      renderLobby(m);
      break;
    case 'start': {
      const heroId = m.heroes[m.team];
      if (game instanceof NetGame && !game.over && game.team === m.team) break; // 重连后继续当前对局
      enterGame(() => new NetGame(net, m.team, heroId, { quality: params.get('quality') || undefined, onEnd: showEnd }));
      break;
    }
    case 'snap':
      if (game instanceof NetGame) {
        game.onSnap(m);
        const ns = $('#net-status');
        if (m.opp !== undefined && !game.over) { ns.textContent = `对手断线了，${m.opp} 秒内未回来将判你获胜`; ns.classList.add('show'); }
        else if (net.connected) ns.classList.remove('show');
      }
      break;
    case 'chat':
      if (game instanceof NetGame) {
        const text = QUICK_CHAT[m.id];
        const hero = game.world.heroes.find((h) => h.team === m.team);
        game.view.ui.bubble(hero, text);
        game.view.ui.killFeed(m.team === game.team ? '你' : '对手', m.team, text, -1);
      }
      break;
    case 'err':
      if ($('#room').classList.contains('hidden')) $('#duo-msg').textContent = m.msg;
      else $('#room-msg').textContent = m.msg;
      if (m.gone) { $('#room').classList.add('hidden'); $('#menu').classList.remove('hidden'); }
      break;
    default:
  }
}

function showRoom() {
  $('#menu').classList.add('hidden');
  $('#room').classList.remove('hidden');
}

function backToRoom() {
  game?.destroy();
  game = null;
  $('#hud').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#net-status').classList.remove('show');
  showRoom();
  if (lobby) renderLobby(lobby);
}

function renderLobby(m) {
  const mySeat = net?.session?.seat ?? -1;
  $('#room-code').textContent = m.code;
  for (let i = 0; i < 2; i++) {
    const s = m.seats[i];
    const el = $('#seat' + i);
    el.classList.toggle('empty', !s);
    if (!s) { el.innerHTML = `<div class="who">${i === 0 ? '蓝方' : '红方'}</div><div class="st">等待加入…</div>`; continue; }
    const h = HEROES[s.hero];
    const st = !s.online ? '⚠ 断线中' : s.ready ? '✓ 已准备' : '选择英雄中';
    el.innerHTML = `<div class="who">${i === mySeat ? '你' : '对手'} · ${i === 0 ? '蓝方' : '红方'}</div><div>${EMOJI[s.hero]} ${h.name}</div><div class="st ${s.ready ? 'ok' : ''}">${st}</div>`;
  }
  const me = m.seats[mySeat];
  for (const b of document.querySelectorAll('#room-heroes button')) b.classList.toggle('sel', me && b.dataset.id === me.hero);
  const ready = $('#ready-btn');
  ready.classList.toggle('on', !!me?.ready);
  ready.textContent = me?.ready ? '取消准备' : '准备';
  ready.disabled = m.phase === 'playing';
  const other = m.seats[1 - mySeat];
  let msg = '';
  if (m.phase === 'countdown') msg = `${m.cd} 秒后开始…`;
  else if (m.phase === 'playing') msg = '对局进行中…';
  else if (!other) msg = '把房间号发给好友，等 TA 加入';
  else if (!other.online) msg = '对手断线了，等待重连…';
  else if (me?.ready && !other.ready) msg = '等待对手准备…';
  else if (!me?.ready && other.ready) msg = '对手已准备，点「准备」开始';
  else if (!me?.ready) msg = '选好英雄，双方都点「准备」就开始';
  $('#room-msg').textContent = msg;
  $('#leave-room').disabled = m.phase === 'playing';
}

function buildRoomHeroes() {
  const box = $('#room-heroes');
  box.innerHTML = '';
  for (const h of HERO_LIST) {
    const b = document.createElement('button');
    b.dataset.id = h.id;
    b.innerHTML = `<span class="em">${EMOJI[h.id]}</span>${h.name}`;
    b.addEventListener('click', () => { net?.send({ t: 'pick', hero: h.id }); selectHero(h.id); });
    box.appendChild(b);
  }
}

$('#create-room').addEventListener('click', () => ensureNet().send({ t: 'create', hero: state.hero }));
function joinRoom() {
  const code = $('#room-input').value.trim();
  if (!/^\d{4}$/.test(code)) { $('#duo-msg').textContent = '请输入 4 位数字房间号'; return; }
  ensureNet().send({ t: 'join', code, hero: state.hero });
}
$('#join-room').addEventListener('click', joinRoom);
$('#room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('#room-input').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
$('#ready-btn').addEventListener('click', () => {
  unlockAudio();
  const me = lobby?.seats[net?.session?.seat];
  net?.send({ t: 'ready', v: !me?.ready });
});
$('#leave-room').addEventListener('click', () => {
  if (net) { net.leave(); net.close(); net = null; }
  lobby = null;
  $('#room').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  preview.resume();
});
$('#copy-invite').addEventListener('click', async () => {
  const code = net?.session?.code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  const text = `来「峡谷对决 3D」和我 1v1！房间号 ${code}，打开链接直接加入：${url}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: '峡谷对决 3D', text, url });
    else { await navigator.clipboard.writeText(text); $('#room-msg').textContent = '已复制，发给好友吧'; }
  } catch { $('#room-msg').textContent = `房间号 ${code}`; }
});

// 快捷消息
const chatPanel = $('#chat-panel');
QUICK_CHAT.forEach((text, id) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', () => { net?.send({ t: 'chat', id }); chatPanel.classList.remove('open'); });
  chatPanel.appendChild(b);
});
$('#chat-btn').addEventListener('click', () => chatPanel.classList.toggle('open'));

// ---------- 启动 ----------
buildMenu();
buildRoomHeroes();
preview.init();
$('#loading').classList.add('done');

// 邀请链接 ?room=1234：直接进入双人模式并加入
const inviteCode = params.get('room');
if (/^\d{4}$/.test(inviteCode || '')) {
  setMode('duo');
  $('#room-input').value = inviteCode;
  $('#duo-msg').textContent = `好友邀请你加入房间 ${inviteCode}，正在加入…`;
  ensureNet().send({ t: 'join', code: inviteCode, hero: state.hero });
} else {
  const ses = loadSession();
  if (ses) {
    setMode('duo');
    $('#duo-msg').textContent = `正在回到房间 ${ses.code}…`;
    ensureNet().rejoin(ses);
  }
}

// 宣传视频录制（tools/video）
window.__app = { start, backToMenu, selectHero };
if (params.has('capture')) import('../tools/video/director.js');

if (params.has('start') || params.has('autoplay')) {
  const hero = params.get('hero') || state.hero;
  start({ heroId: hero, enemyId: params.get('enemy') || pickEnemyHero(hero), difficulty: params.get('diff') || state.diff });
}
