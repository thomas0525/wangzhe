// HUD：血条、飘字、小地图、商店、公告
import * as THREE from 'three';
import { ITEMS, ITEM_BY_ID, TEAM_CSS, BASE, SPRING, LANE_HALF, POCKETS, POCKET_RADIUS, JUNGLE, JUNGLE_RADIUS, BUFF_INFO, XP_TABLE, MAX_LEVEL } from './config.js';
import * as shop from './shop.js';

const $ = (s) => document.querySelector(s);
const v3 = new THREE.Vector3();

export class UI {
  constructor(client, view) {
    this.c = client;
    this.view = view;
    this.abort = new AbortController();
    const sig = { signal: this.abort.signal };
    this.barLayer = $('#bars');
    this.floatLayer = $('#floats');
    this.bars = new Map();
    this.minimap = $('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.shopOpen = false;
    this.lastGold = -1;
    this.buildShop();
    $('#shop-btn').addEventListener('click', () => this.toggleShop(), sig);
    $('#shop-close').addEventListener('click', () => this.toggleShop(false), sig);
    $('#rec-buy').addEventListener('click', (e) => {
      e.stopPropagation();
      const p = this.me;
      const id = p && shop.nextBuild(p.def.build, p.items, p.gold);
      if (id) this.buy(id);
    }, sig);
  }

  get me() { return this.c.world.me; }

  buy(id) {
    const p = this.me;
    if (!p || !shop.canBuy(p.items, p.gold, id)) return;
    this.c.cmd({ t: 'buy', id }); // 结果随下一份快照更新
  }

  createBar(u) {
    const el = document.createElement('div');
    el.className = 'bar ' + u.kind;
    el.innerHTML = '<div class="lv"></div><div class="nm"></div><div class="hp"><i></i><b></b></div>';
    this.barLayer.appendChild(el);
    const rec = { el, fill: el.querySelector('.hp i'), lag: el.querySelector('.hp b'), lv: el.querySelector('.lv'), nm: el.querySelector('.nm'), lastPct: -1, lagPct: 1, setup: false };
    this.bars.set(u, rec);
  }

  removeBar(u) {
    const r = this.bars.get(u);
    if (r) { r.el.remove(); this.bars.delete(u); }
  }

  updateBars(dt) {
    const v = this.view, cam = v.camera, me = this.me;
    const w = v.width, h = v.height;
    for (const [u, r] of this.bars) {
      if (!r.setup) {
        r.setup = true;
        const mine = u.team === this.c.team;
        r.el.classList.add(u.team === 2 ? 'neutral' : mine ? 'ally' : 'enemy');
        if (u === me) r.el.classList.add('self');
        if (u.type) r.el.classList.add(u.type);
        if (u.kind === 'hero') r.nm.textContent = u.name;
      }
      const vis = u.alive && !u.hidden && u.mesh?.visible;
      if (!vis) { if (r.shown !== false) { r.el.style.display = 'none'; r.shown = false; } continue; }
      v3.set(u.x, u.y + u.barHeight, u.z).project(cam);
      if (v3.z > 1 || v3.x < -1.2 || v3.x > 1.2 || v3.y < -1.2 || v3.y > 1.2) {
        if (r.shown !== false) { r.el.style.display = 'none'; r.shown = false; }
        continue;
      }
      if (r.shown !== true) { r.el.style.display = ''; r.shown = true; }
      const sx = (v3.x * 0.5 + 0.5) * w, sy = (-v3.y * 0.5 + 0.5) * h;
      r.el.style.transform = `translate(${sx | 0}px,${sy | 0}px)`;
      const pct = Math.max(0, u.hp / u.stats.maxHp);
      if (Math.abs(pct - r.lastPct) > 0.001) {
        r.fill.style.width = (pct * 100).toFixed(1) + '%';
        r.lastPct = pct;
      }
      r.lagPct = Math.max(pct, r.lagPct - dt * 0.6);
      r.lag.style.width = (r.lagPct * 100).toFixed(1) + '%';
      if (u.kind === 'hero') {
        if (r.lvVal !== u.level) { r.lv.textContent = u.level; r.lvVal = u.level; }
      } else if ((u.kind === 'tower' || u.kind === 'crystal')) {
        const inv = !!u.inv;
        if (r.inv !== inv) { r.el.classList.toggle('inv', inv); r.inv = inv; }
      }
    }
  }

  floatText(u, text, cls) {
    const v = this.view;
    v3.set(u.x, u.y + u.barHeight + 0.3, u.z).project(v.camera);
    if (v3.z > 1) return;
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    const sx = (v3.x * 0.5 + 0.5) * v.width + (Math.random() - 0.5) * 30;
    const sy = (-v3.y * 0.5 + 0.5) * v.height;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    this.floatLayer.appendChild(el);
    if (this.floatLayer.childElementCount > 40) this.floatLayer.firstChild.remove();
    setTimeout(() => el.remove(), 900);
  }

  banner(text, cls = '') {
    const el = $('#banner');
    el.className = 'show ' + cls;
    el.textContent = text;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => (el.className = ''), 2200);
  }

  // 聊天气泡（快捷消息）
  bubble(u, text) {
    if (!u) return;
    const v = this.view;
    v3.set(u.x, u.y + u.barHeight + 1.2, u.z).project(v.camera);
    if (v3.z > 1) return;
    const el = document.createElement('div');
    el.className = 'bubble ' + (u.team === this.c.team ? 'ally' : 'enemy');
    el.textContent = text;
    el.style.left = (v3.x * 0.5 + 0.5) * v.width + 'px';
    el.style.top = (-v3.y * 0.5 + 0.5) * v.height + 'px';
    this.floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  killFeed(kName, kTeam, vName, vTeam) {
    const feed = $('#feed');
    const el = document.createElement('div');
    el.className = 'feed-item';
    const kc = TEAM_CSS[kTeam] || '#ccc';
    el.innerHTML = `<span style="color:${kc}">${kName}</span> ⚔ <span style="color:${TEAM_CSS[vTeam] || '#ccc'}">${vName}</span>`;
    feed.prepend(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ---------- 商店 ----------
  buildShop() {
    const grid = $('#shop-grid');
    grid.innerHTML = '';
    for (const it of ITEMS) {
      const b = document.createElement('button');
      b.className = 'item';
      b.dataset.id = it.id;
      b.innerHTML = `<span class="ic">${it.icon}</span><span class="in">${it.name}</span><span class="ds">${it.desc}</span><span class="pr">💰${it.cost}</span>`;
      b.addEventListener('click', () => this.buy(it.id));
      grid.appendChild(b);
    }
  }

  toggleShop(force) {
    this.shopOpen = force ?? !this.shopOpen;
    $('#shop').classList.toggle('open', this.shopOpen);
    this.refreshShop();
  }

  refreshShop() {
    const p = this.me;
    if (!p || !p.items) return;
    for (const b of document.querySelectorAll('#shop-grid .item')) {
      const it = ITEM_BY_ID[b.dataset.id];
      b.classList.toggle('owned', p.items.includes(it.id));
      b.classList.toggle('cant', !shop.canBuy(p.items, p.gold, it.id));
      b.querySelector('.pr').textContent = '💰' + shop.priceOf(p.items, it.id);
      b.classList.toggle('rec', p.def.build.includes(it.id));
    }
    const slots = $('#item-slots');
    let html = '';
    for (let i = 0; i < 6; i++) {
      const id = p.items[i];
      html += `<div class="slot">${id ? ITEM_BY_ID[id].icon : ''}</div>`;
    }
    slots.innerHTML = html;
    $('#shop-gold').textContent = Math.floor(p.gold);
  }

  // ---------- 每帧 HUD ----------
  updateHud(dt) {
    const w = this.c.world, p = this.me;
    if (!p || !p.items) return;
    this.updateBars(dt);
    const t = Math.floor(w.time);
    $('#timer').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    $('#score-blue').textContent = w.heroes.filter((h) => h.team === 0).reduce((a, h) => a + h.kills, 0);
    $('#score-red').textContent = w.heroes.filter((h) => h.team === 1).reduce((a, h) => a + h.kills, 0);
    const ping = $('#ping');
    if (this.c.rtt !== undefined) {
      const ms = Math.round(this.c.rtt);
      ping.textContent = this.c.connected === false ? '⚠ 重连中' : `📶 ${ms}ms`;
      ping.className = this.c.connected === false || ms > 250 ? 'bad' : ms > 120 ? 'mid' : 'good';
    } else ping.className = 'hidden';
    $('#kda').textContent = `${p.kills}/${p.deaths} · 补刀 ${p.cs}`;
    const gold = Math.floor(p.gold);
    if (gold !== this.lastGold) {
      $('#gold').textContent = gold;
      this.lastGold = gold;
      if (this.shopOpen) this.refreshShop();
    }
    // 推荐装备
    const rec = shop.nextBuild(p.def.build, p.items, p.gold);
    const recEl = $('#rec');
    if (rec && shop.canBuy(p.items, p.gold, rec) && p.alive) {
      recEl.classList.add('show');
      if (recEl.dataset.id !== rec) {
        recEl.dataset.id = rec;
        $('#rec-icon').textContent = ITEM_BY_ID[rec].icon;
        $('#rec-name').textContent = ITEM_BY_ID[rec].name;
      }
      const price = shop.priceOf(p.items, rec);
      if (recEl.dataset.price !== String(price)) {
        recEl.dataset.price = price;
        $('#rec-price').textContent = '💰' + price;
      }
    } else recEl.classList.remove('show');
    // buff 图标
    let bh = '';
    for (const b of p.buffs) {
      const info = BUFF_INFO[b.id];
      if (info) bh += `<span class="buff ${b.id}">${info.icon}<i>${Math.max(0, Math.ceil(b.until - w.time))}</i></span>`;
    }
    if (bh !== this.lastBuffHtml) { $('#buffs').innerHTML = bh; this.lastBuffHtml = bh; }
    // 经验条
    const lv = p.level;
    const xpPct = lv >= MAX_LEVEL ? 1 : (p.xp - XP_TABLE[lv - 1]) / (XP_TABLE[lv] - XP_TABLE[lv - 1]);
    $('#xp i').style.width = (xpPct * 100).toFixed(1) + '%';
    $('#lvl').textContent = 'Lv.' + lv;
    // 死亡遮罩
    const dead = $('#dead');
    if (!p.alive) {
      dead.classList.add('show');
      $('#respawn').textContent = Math.max(0, Math.ceil(p.respawnAt - w.time));
    } else dead.classList.remove('show');
    // 回城进度
    const rc = $('#recall-bar');
    if (p.recall) {
      rc.classList.add('show');
      rc.querySelector('i').style.width = (p.recall.t / p.recall.dur * 100) + '%';
    } else rc.classList.remove('show');
    this.drawMinimap();
  }

  drawMinimap() {
    const w = this.c.world, me = this.me, c = this.mctx;
    const W = this.minimap.width;
    const S = W / 130;
    const f = this.view.flip ? -1 : 1; // 红方视角旋转 180°
    const tx = (x) => (f * x + 65) * S, tz = (z) => (f * z + 65) * S;
    c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(20,40,20,0.85)';
    c.fillRect(0, 0, W, W);
    c.lineCap = 'round';
    c.strokeStyle = '#b8a57e';
    c.lineWidth = LANE_HALF * 2 * S;
    c.beginPath();
    c.moveTo(tx(BASE[0].x), tz(BASE[0].z));
    c.lineTo(tx(BASE[1].x), tz(BASE[1].z));
    c.stroke();
    c.fillStyle = '#5f7d3e';
    for (const p of POCKETS) { c.beginPath(); c.arc(tx(p.x), tz(p.z), POCKET_RADIUS * S, 0, 7); c.fill(); }
    for (const p of JUNGLE) { c.beginPath(); c.arc(tx(p.x), tz(p.z), JUNGLE_RADIUS * S, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(63,167,214,0.8)';
    c.lineWidth = 6 * S;
    c.beginPath(); c.moveTo(tx(-25), tz(-25)); c.lineTo(tx(25), tz(25)); c.stroke();
    for (let t = 0; t < 2; t++) {
      c.fillStyle = TEAM_CSS[t];
      c.globalAlpha = 0.35;
      c.beginPath(); c.arc(tx(SPRING[t].x), tz(SPRING[t].z), 4 * S, 0, 7); c.fill();
      c.globalAlpha = 1;
    }
    for (const u of w.units) {
      if (!u.alive || u.kind === 'hero') continue;
      const col = u.team === 2 ? '#c58cff' : TEAM_CSS[u.team];
      if (u.kind === 'tower' || u.kind === 'crystal') {
        c.fillStyle = col;
        c.strokeStyle = '#fff';
        c.lineWidth = 1;
        const s = u.kind === 'crystal' ? 7 : 5;
        c.fillRect(tx(u.x) - s / 2, tz(u.z) - s / 2, s, s);
        c.strokeRect(tx(u.x) - s / 2, tz(u.z) - s / 2, s, s);
      } else if (u.kind === 'minion') {
        c.fillStyle = col;
        c.fillRect(tx(u.x) - 1.5, tz(u.z) - 1.5, 3, 3);
      } else if (u.kind === 'monster') {
        c.fillStyle = u.def.id === 'red' ? '#ff6a3a' : u.def.id === 'blue' ? '#5ab4ff' : col;
        c.beginPath(); c.arc(tx(u.x), tz(u.z), 4, 0, 7); c.fill();
      }
    }
    for (const h of w.heroes) {
      if (!h.alive || h.hidden) continue;
      c.fillStyle = TEAM_CSS[h.team];
      c.strokeStyle = h === me ? '#ffe066' : '#fff';
      c.lineWidth = 2;
      c.beginPath(); c.arc(tx(h.x), tz(h.z), 5, 0, 7); c.fill(); c.stroke();
    }
  }

  dispose() {
    this.abort.abort();
    this.toggleShop(false);
    for (const [, r] of this.bars) r.el.remove();
    this.bars.clear();
    this.floatLayer.innerHTML = '';
    $('#feed').innerHTML = '';
  }
}
