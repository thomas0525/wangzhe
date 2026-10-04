// 玩家输入：虚拟摇杆、技能按钮拖拽瞄准、键盘鼠标
// 不直接改英雄：持续状态（移动方向、是否按住普攻）通过 state 交给客户端，离散操作通过 client.cmd() 发出
import * as THREE from 'three';
import { FLASH, HEROES } from './heroes.js';

const $ = (s) => document.querySelector(s);
const MAX_DRAG = 80;

export class Input {
  constructor(client) {
    this.c = client;
    this.def = HEROES[client.heroId];
    this.flip = client.team === 1 ? -1 : 1; // 红方视角旋转 180°，屏幕方向要反过来
    this.state = { move: null, atk: false };
    this.joy = { active: false, pid: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.keys = new Set();
    this.attackHeld = false;
    this.aim = null;
    this.mouse = { active: false, x: 0, z: 0, sx: 0, sy: 0 };
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.listeners = [];
    this.setupDom();
  }

  on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this.listeners.push(() => el.removeEventListener(ev, fn, opts));
  }

  dispose() { this.listeners.forEach((f) => f()); }

  setupDom() {
    const hero = this.def;
    // 技能按钮图标
    hero.skills.forEach((s, i) => {
      const b = $('#btn-s' + i);
      b.querySelector('.ic').textContent = s.icon;
      b.querySelector('.nm').textContent = s.name;
    });
    $('#btn-flash .ic').textContent = FLASH.icon;

    // 摇杆
    const zone = $('#joy-zone'), base = $('#joy-base'), knob = $('#joy-knob');
    this.on(zone, 'pointerdown', (e) => {
      if (this.joy.active) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.joy = { active: true, pid: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      base.style.left = e.clientX - r.left + 'px';
      base.style.top = e.clientY - r.top + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%,-50%)';
    });
    this.on(zone, 'pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.pid) return;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy), R = 55;
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R;
      this.joy.y = dy / R;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.pid) return;
      this.joy = { active: false, pid: null, x: 0, y: 0 };
      base.classList.remove('active');
      base.style.left = '';
      base.style.top = '';
      knob.style.transform = 'translate(-50%,-50%)';
    };
    this.on(zone, 'pointerup', endJoy);
    this.on(zone, 'pointercancel', endJoy);

    // 普攻
    const atk = $('#btn-atk');
    this.on(atk, 'pointerdown', (e) => {
      e.preventDefault();
      atk.setPointerCapture(e.pointerId);
      this.attackHeld = true;
      this.c.cmd({ t: 'tap' });
      atk.classList.add('down');
    });
    const atkUp = () => { this.attackHeld = false; atk.classList.remove('down'); };
    this.on(atk, 'pointerup', atkUp);
    this.on(atk, 'pointercancel', atkUp);

    // 技能
    for (let i = 0; i < 3; i++) this.bindAimButton($('#btn-s' + i), i);
    this.bindAimButton($('#btn-flash'), 'flash');
    this.on($('#btn-recall'), 'pointerdown', (e) => {
      e.preventDefault();
      this.c.cmd({ t: 'recall' });
    });

    // 键盘
    this.on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      const idx = { q: 0, e: 1, r: 2, 1: 0, 2: 1, 3: 2 }[k];
      if (idx !== undefined) this.keyCast(idx);
      if (k === 'f') this.keyCast('flash');
      if (k === ' ' || k === 'j') { this.attackHeld = true; this.c.cmd({ t: 'tap' }); e.preventDefault(); }
      if (k === 'b') this.c.cmd({ t: 'recall' });
      if (k === 'p' || k === 'tab') { this.c.view.ui.toggleShop(); e.preventDefault(); }
      if (k === 'escape') this.c.view.ui.toggleShop(false);
    });
    this.on(window, 'keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' || k === 'j') this.attackHeld = false;
      const idx = { q: 0, e: 1, r: 2, 1: 0, 2: 1, 3: 2, f: 'flash' }[k];
      if (idx !== undefined && this.aim && this.aim.key && this.aim.idx === idx) {
        this.finishAim(false);
      }
    });
    this.on(window, 'blur', () => { this.keys.clear(); this.attackHeld = false; });

    // 鼠标位置（桌面端瞄准）
    const canvas = this.c.view.renderer.domElement;
    this.on(canvas, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.active = true;
      this.mouse.sx = e.clientX;
      this.mouse.sy = e.clientY;
    });
    this.on(canvas, 'pointerdown', (e) => {
      // 桌面端：点击地面也可以普攻附近目标
      if (e.pointerType === 'mouse' && e.button === 0) this.c.cmd({ t: 'tap' });
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  bindAimButton(btn, idx) {
    this.on(btn, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.aim) return;
      if (!this.canUse(idx)) { btn.classList.add('shake'); setTimeout(() => btn.classList.remove('shake'), 300); return; }
      btn.setPointerCapture(e.pointerId);
      const r = btn.getBoundingClientRect();
      this.aim = { idx, pid: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0, dragging: false, btn };
      btn.classList.add('down');
      if (this.spec(idx).type === 'self') this.showCancel(true);
    });
    this.on(btn, 'pointermove', (e) => {
      const a = this.aim;
      if (!a || a.pid !== e.pointerId) return;
      a.dx = e.clientX - a.cx;
      a.dy = e.clientY - a.cy;
      if (Math.hypot(a.dx, a.dy) > 14 && !a.dragging) { a.dragging = true; this.showCancel(true); }
      a.cancel = this.overCancel(e.clientX, e.clientY);
      $('#cancel-zone').classList.toggle('hot', !!a.cancel);
    });
    const up = (e) => {
      const a = this.aim;
      if (!a || a.pid !== e.pointerId) return;
      this.finishAim(e.type === 'pointercancel' || a.cancel);
    };
    this.on(btn, 'pointerup', up);
    this.on(btn, 'pointercancel', up);
  }

  showCancel(v) { $('#cancel-zone').classList.toggle('show', v); }
  overCancel(x, y) {
    const r = $('#cancel-zone').getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  spec(idx) {
    return idx === 'flash' ? FLASH.aim : this.def.skills[idx].aim;
  }

  canUse(idx) {
    const p = this.c.world.me;
    if (!p || !p.alive || !p.skillCd) return false;
    if (idx === 'flash') return p.flashCd <= 0;
    return p.level >= this.def.skills[idx].unlock && p.skillCd[idx] <= 0;
  }

  keyCast(idx) {
    if (this.aim || !this.canUse(idx)) return;
    if (this.mouse.active) {
      this.aim = { idx, key: true, dragging: true, mouse: true };
    } else {
      this.aim = { idx, key: true, dragging: false };
      this.finishAim(false);
    }
  }

  // 根据当前拖拽 / 鼠标计算瞄准
  computeAim() {
    const a = this.aim, p = this.c.world.me, spec = this.spec(a.idx);
    const range = spec.range || spec.radius || 3;
    if (a.mouse) {
      const m = this.mouseWorld();
      let dx = m.x - p.x, dz = m.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const dir = { x: dx / d, z: dz / d };
      const r = Math.min(range, d);
      return { dir, point: { x: p.x + dir.x * r, z: p.z + dir.z * r } };
    }
    if (a.dragging) {
      const d = Math.hypot(a.dx, a.dy) || 1;
      const dir = { x: (this.flip * a.dx) / d, z: (this.flip * a.dy) / d };
      const k = Math.min(1, d / MAX_DRAG);
      return { dir, point: { x: p.x + dir.x * range * k, z: p.z + dir.z * range * k } };
    }
    return this.autoAim(a.idx, range);
  }

  autoAim(idx, range) {
    const p = this.c.world.me;
    const t = this.c.world.autoTarget(p, range + 1.5, true);
    if (t) {
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
      const dir = { x: dx / d, z: dz / d };
      const r = Math.min(range, d);
      return { dir, point: { x: p.x + dir.x * r, z: p.z + dir.z * r }, target: t };
    }
    let dir;
    const mv = this.moveVec();
    if (mv) dir = mv;
    else dir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    return { dir, point: { x: p.x + dir.x * range * 0.6, z: p.z + dir.z * range * 0.6 } };
  }

  finishAim(cancel) {
    const a = this.aim;
    if (!a) return;
    this.aim = null;
    a.btn?.classList.remove('down');
    this.showCancel(false);
    $('#cancel-zone').classList.remove('hot');
    this.c.view.indicator.hide();
    if (cancel || !this.c.world.me) return;
    const aim = this.computeAimFor(a);
    const r2 = (v) => Math.round(v * 100) / 100;
    if (a.idx === 'flash') this.c.cmd({ t: 'flash', dir: [r2(aim.dir.x), r2(aim.dir.z)] });
    else this.c.cmd({ t: 'cast', i: a.idx, dir: [r2(aim.dir.x), r2(aim.dir.z)], pt: [r2(aim.point.x), r2(aim.point.z)] });
  }

  computeAimFor(a) {
    const prev = this.aim;
    this.aim = a;
    const r = this.computeAim();
    this.aim = prev;
    return r;
  }

  mouseWorld() {
    const v = this.c.view;
    const ndc = new THREE.Vector2((this.mouse.sx / v.width) * 2 - 1, -(this.mouse.sy / v.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, v.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.plane, hit)) return { x: hit.x, z: hit.z };
    const p = this.c.world.me;
    return { x: p.x, z: p.z };
  }

  moveVec() {
    let x = 0, z = 0;
    if (this.joy.active) { x = this.joy.x; z = this.joy.y; }
    if (this.keys.has('w') || this.keys.has('arrowup')) z -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) z += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    const d = Math.hypot(x, z);
    if (d < 0.2) return null;
    return { x: (this.flip * x) / d, z: (this.flip * z) / d };
  }

  update() {
    const p = this.c.world.me;
    this.state = { move: p && p.alive ? this.moveVec() : null, atk: this.attackHeld };
    if (!p) return;
    const ind = this.c.view.indicator;
    if (this.aim && this.aim.dragging) {
      ind.show(p, this.computeAim(), this.spec(this.aim.idx), this.aim.cancel);
    } else if (this.aim && this.spec(this.aim.idx).type === 'self') {
      ind.show(p, { dir: { x: 0, z: 1 } }, this.spec(this.aim.idx), this.aim.cancel);
    }
    this.updateButtons();
  }

  updateButtons() {
    const p = this.c.world.me;
    if (!p || !p.skillCd) return;
    for (let i = 0; i < 3; i++) {
      const sk = this.def.skills[i];
      this.paintBtn($('#btn-s' + i), p.level < sk.unlock, p.skillCd[i], sk.cd * (1 - Math.min(0.4, p.stats.cdr)));
    }
    this.paintBtn($('#btn-flash'), false, p.flashCd, FLASH.cd);
  }

  paintBtn(btn, locked, cd, max) {
    const st = btn._st || (btn._st = {});
    if (st.locked !== locked) { btn.classList.toggle('locked', locked); st.locked = locked; }
    const c = Math.max(0, cd);
    const txt = c > 0 ? (c < 1 ? c.toFixed(1) : Math.ceil(c)) : '';
    if (st.txt !== txt) {
      btn.querySelector('.cd').textContent = txt;
      btn.classList.toggle('cooling', c > 0);
      st.txt = txt;
    }
    const pct = c > 0 ? (c / max) * 100 : 0;
    btn.style.setProperty('--cd', pct.toFixed(1) + '%');
  }
}
