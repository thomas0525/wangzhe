// 入口：菜单、英雄预览、开局与结算
import * as THREE from 'three';
import { Game } from './game.js';
import { HERO_LIST, HEROES, pickEnemyHero } from './heroes.js';
import { DIFFICULTY } from './config.js';
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
  $('#menu').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  preview.stop();
  game?.destroy();
  game = new Game({
    ...settings,
    autoplay: params.has('autoplay'),
    speed: Number(params.get('speed')) || 1,
    quality: params.get('quality') || undefined,
    onEnd: showEnd,
  });
  window.__game = game;
}

function showEnd({ win, player, enemy, time }) {
  const t = $('#end-title');
  t.textContent = win ? '胜 利' : '失 败';
  t.className = win ? 'win' : 'lose';
  const mm = `${Math.floor(time / 60)}分${Math.floor(time % 60)}秒`;
  const row = (h, tag) => `<tr><td>${tag}</td><td>${h.name}</td><td>${h.level}</td><td>${h.kills}/${h.deaths}</td><td>${h.cs}</td><td>${Math.round(h.totalGold || 0)}</td><td>${Math.round(h.heroDamage || 0)}</td></tr>`;
  $('#end-stats').innerHTML =
    `<tr><th></th><th>英雄</th><th>等级</th><th>击杀/死亡</th><th>补刀</th><th>经济</th><th>对英雄伤害</th></tr>` +
    row(player, '你') + row(enemy, '电脑') +
    `<tr><td colspan="7" style="opacity:.6;border:0">对局时长 ${mm} · 难度 ${DIFFICULTY[lastSettings.difficulty].name}</td></tr>`;
  $('#end').classList.remove('hidden');
  window.__result = { win, time, kills: player.kills, deaths: player.deaths };
}

function backToMenu() {
  game?.destroy();
  game = null;
  $('#hud').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  preview.resume();
}

// ---------- 暂停 ----------
function setPaused(p) {
  if (!game || game.over) return;
  game.paused = p;
  $('#pause').classList.toggle('hidden', !p);
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
  const c = game.units.find((u) => u.kind === 'crystal' && u.team === 0);
  game.endGame(false, c);
});
$('#again-btn').addEventListener('click', () => start({ ...lastSettings, enemyId: pickEnemyHero(lastSettings.heroId) }));
$('#menu-btn').addEventListener('click', backToMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !params.has('autoplay')) setPaused(true); });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- 启动 ----------
buildMenu();
preview.init();
$('#loading').classList.add('done');

if (params.has('start') || params.has('autoplay')) {
  const hero = params.get('hero') || state.hero;
  start({ heroId: hero, enemyId: params.get('enemy') || pickEnemyHero(hero), difficulty: params.get('diff') || state.diff });
}
