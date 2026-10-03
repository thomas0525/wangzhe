// 视觉特效
import * as THREE from 'three';

const GEO = {
  cube: new THREE.BoxGeometry(0.18, 0.18, 0.18),
  ring: new THREE.RingGeometry(0.92, 1, 48),
  disc: new THREE.CircleGeometry(1, 40),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  arc: new THREE.RingGeometry(0.55, 1, 24, 1, -Math.PI * 0.45, Math.PI * 0.9),
  star: new THREE.OctahedronGeometry(0.15, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
  plane: new THREE.PlaneGeometry(1, 1),
};

function basic(color, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra });
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  add(obj, dur, update, onEnd) {
    this.scene.add(obj);
    const e = { obj, t: 0, dur, update, onEnd, dead: false, remove: () => { e.dead = true; } };
    this.list.push(e);
    return e;
  }

  update(dt) {
    for (const e of this.list) {
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.update?.(k, dt, e);
      if (k >= 1) e.dead = true;
      if (e.dead) {
        this.scene.remove(e.obj);
        e.obj.traverse((o) => { if (o.material && !o.material.userData?.shared) o.material.dispose(); });
        e.onEnd?.();
      }
    }
    this.list = this.list.filter((e) => !e.dead);
  }

  burst(x, y, z, color, n = 12) {
    const g = new THREE.Group();
    const m = basic(color, 1);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(GEO.cube, m);
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, up = Math.random() * 6 + 2, sp = Math.random() * 5 + 2;
      p.userData.v = new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp);
      g.add(p);
      parts.push(p);
    }
    this.add(g, 0.55, (k, dt) => {
      for (const p of parts) {
        p.userData.v.y -= 18 * dt;
        p.position.addScaledVector(p.userData.v, dt);
        p.rotation.x += dt * 8;
        p.scale.setScalar(1 - k);
      }
      m.opacity = 1 - k;
    });
  }

  ring(x, z, r, color, dur, o = {}) {
    const g = new THREE.Group();
    const edge = new THREE.Mesh(GEO.ring, basic(color, 0.9));
    edge.rotation.x = -Math.PI / 2;
    g.add(edge);
    let fill = null;
    if (o.fill) {
      fill = new THREE.Mesh(GEO.disc, basic(color, o.opacity ?? 0.25));
      fill.rotation.x = -Math.PI / 2;
      g.add(fill);
    }
    g.position.set(x, 0.12, z);
    g.scale.setScalar(r);
    return this.add(g, dur, (k) => {
      if (o.follow) g.position.set(o.follow.x, 0.12, o.follow.z);
      if (o.grow && fill) fill.scale.setScalar(Math.max(0.01, k));
      edge.material.opacity = 0.9 * (1 - k * 0.5);
    });
  }

  shockwave(x, z, r, color) {
    const m = new THREE.Mesh(GEO.ring, basic(color, 1));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.15, z);
    this.add(m, 0.4, (k) => {
      m.scale.setScalar(r * (0.3 + k * 0.9));
      m.material.opacity = 1 - k;
    });
  }

  slashArc(unit, r, color, opacity = 0.8) {
    const m = new THREE.Mesh(GEO.arc, basic(color, opacity));
    m.rotation.x = -Math.PI / 2;
    const f = unit.facing;
    m.rotation.z = f - Math.PI / 2;
    m.position.set(unit.x, 1, unit.z);
    m.scale.setScalar(r * 0.7);
    this.add(m, 0.2, (k) => {
      m.material.opacity = opacity * (1 - k);
      m.scale.setScalar(r * (0.7 + k * 0.3));
      m.position.set(unit.x, 1 + unit.y, unit.z);
    });
  }

  trail(unit, color, dur) {
    const g = new THREE.Group();
    const m = basic(color, 0.5);
    const ghosts = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(GEO.sphere, m);
      s.scale.set(0.5, 1, 0.5);
      s.visible = false;
      g.add(s);
      ghosts.push(s);
    }
    let i = 0;
    this.add(g, dur + 0.25, (k, dt, e) => {
      if (e.t < dur) {
        const s = ghosts[i++ % ghosts.length];
        s.visible = true;
        s.position.set(unit.x, 1.1 + unit.y, unit.z);
      }
      m.opacity = 0.5 * (1 - k);
    });
  }

  frost(x, z, r) {
    this.shockwave(x, z, r, 0x8be9ff);
    const g = new THREE.Group();
    const m = basic(0xbff6ff, 0.9);
    const spikes = [];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.9;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.4, 5), m);
      c.position.set(x + Math.cos(a) * d, 0, z + Math.sin(a) * d);
      c.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
      g.add(c);
      spikes.push(c);
    }
    this.add(g, 0.9, (k) => {
      const h = k < 0.2 ? k / 0.2 : 1;
      for (const c of spikes) c.position.y = -0.7 + h * 0.9;
      m.opacity = 0.9 * (1 - Math.max(0, k - 0.5) * 2);
    }, () => g.children.forEach((c) => c.geometry.dispose()));
  }

  meteor(x, z, delay) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(GEO.sphere, basic(0xffb347, 1));
    core.scale.setScalar(0.8);
    g.add(core);
    const glow = new THREE.Mesh(GEO.sphere, basic(0xff5522, 0.5));
    glow.scale.setScalar(1.5);
    g.add(glow);
    this.add(g, delay, (k) => {
      g.position.set(x - 8 * (1 - k), 0.5 + 18 * (1 - k), z + 6 * (1 - k));
    });
  }

  arrow(x, z, dx, dz, len, color) {
    const m = new THREE.Mesh(GEO.cube, basic(color, 1));
    m.scale.set(0.6, 0.6, 5);
    m.rotation.y = Math.atan2(dx, dz);
    this.add(m, 0.3, (k) => {
      m.position.set(x + dx * len * k, 1.2, z + dz * len * k);
      m.material.opacity = 1 - k * 0.5;
    });
  }

  stars(unit) {
    const g = new THREE.Group();
    const m = basic(0xffee66, 1);
    for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(GEO.star, m));
    this.add(g, 1, (k, dt, e) => {
      if (!unit.alive || !unit.stunned) { e.dead = true; return; }
      g.children.forEach((s, i) => {
        const a = e.t * 6 + (i * Math.PI * 2) / 3;
        s.position.set(unit.x + Math.cos(a) * 0.6, unit.barHeight + 0.1, unit.z + Math.sin(a) * 0.6);
      });
    });
  }

  levelUp(unit) {
    const m = new THREE.Mesh(GEO.cyl, basic(0xffe066, 0.6));
    this.add(m, 0.8, (k) => {
      m.position.set(unit.x, 1.5 + k * 1.5, unit.z);
      m.scale.set(1.2, 3 * (1 - k) + 0.1, 1.2);
      m.material.opacity = 0.6 * (1 - k);
    });
    this.burst(unit.x, 1.5, unit.z, 0xffe066, 14);
  }

  recallBeam(unit) {
    const g = new THREE.Group();
    const col = new THREE.Mesh(GEO.cyl, basic(0x7fd0ff, 0.35));
    col.scale.set(1, 6, 1);
    col.position.y = 3;
    g.add(col);
    const ring = new THREE.Mesh(GEO.ring, basic(0x7fd0ff, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    return this.add(g, 4.2, (k, dt, e) => {
      g.position.set(unit.x, 0, unit.z);
      col.material.opacity = 0.2 + 0.25 * Math.sin(e.t * 10) ** 2;
      ring.scale.setScalar(1.6 - k);
      if (!unit.alive) e.dead = true;
    });
  }

  explosion(x, z, color) {
    for (let i = 0; i < 3; i++) this.burst(x + (Math.random() - 0.5) * 2, 2 + i * 1.5, z + (Math.random() - 0.5) * 2, color, 24);
    this.shockwave(x, z, 8, color);
    const s = new THREE.Mesh(GEO.sphere, basic(0xffffff, 0.9));
    s.position.set(x, 3, z);
    this.add(s, 0.6, (k) => {
      s.scale.setScalar(1 + k * 6);
      s.material.opacity = 0.9 * (1 - k);
    });
  }

  // 防御塔锁定线
  beam(from, to, color) {
    const m = new THREE.Mesh(GEO.plane, basic(color, 0.5));
    m.rotation.x = -Math.PI / 2;
    return this.add(m, 1e9, (k, dt, e) => {
      if (!to.alive || !from.alive || from.target !== to) { e.dead = true; return; }
      const dx = to.x - from.x, dz = to.z - from.z;
      const d = Math.hypot(dx, dz);
      m.position.set((from.x + to.x) / 2, 0.2, (from.z + to.z) / 2);
      m.scale.set(0.25, d, 1);
      m.rotation.z = Math.atan2(dx, -dz) * -1;
      m.material.opacity = 0.35 + 0.25 * Math.sin(e.t * 12);
    });
  }
}

// 技能指示器（施法预览）
export class Indicator {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.rangeRing = new THREE.Mesh(GEO.ring, basic(0xffffff, 0.35, { blending: THREE.NormalBlending }));
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeFill = new THREE.Mesh(GEO.disc, basic(0x88ccff, 0.08, { blending: THREE.NormalBlending }));
    this.rangeFill.rotation.x = -Math.PI / 2;
    this.area = new THREE.Mesh(GEO.disc, basic(0x7fd0ff, 0.42, { blending: THREE.NormalBlending }));
    this.area.rotation.x = -Math.PI / 2;
    this.line = new THREE.Mesh(GEO.plane, basic(0x7fd0ff, 0.5, { blending: THREE.NormalBlending }));
    this.line.rotation.x = -Math.PI / 2;
    this.cone = new THREE.Mesh(new THREE.CircleGeometry(1, 24, 0, 1), basic(0x7fd0ff, 0.4, { blending: THREE.NormalBlending }));
    this.cone.rotation.x = -Math.PI / 2;
    this.group.add(this.rangeRing, this.rangeFill, this.area, this.line, this.cone);
  }

  show(hero, aim, spec, cancel) {
    const g = this.group;
    g.visible = true;
    const col = cancel ? 0xff4444 : 0x7fd0ff;
    for (const m of [this.area, this.line, this.cone]) m.material.color.setHex(col);
    const range = spec.range || spec.radius || 3;
    this.rangeRing.position.set(hero.x, 0.14, hero.z);
    this.rangeRing.scale.setScalar(range);
    this.rangeFill.position.set(hero.x, 0.13, hero.z);
    this.rangeFill.scale.setScalar(range);
    this.area.visible = this.line.visible = this.cone.visible = false;
    if (spec.type === 'point') {
      this.area.visible = true;
      this.area.position.set(aim.point.x, 0.16, aim.point.z);
      this.area.scale.setScalar(spec.radius);
    } else if (spec.type === 'self') {
      this.area.visible = true;
      this.area.position.set(hero.x, 0.16, hero.z);
      this.area.scale.setScalar(spec.radius);
    } else if (spec.type === 'dir') {
      this.line.visible = true;
      const L = spec.range;
      this.line.position.set(hero.x + aim.dir.x * L / 2, 0.16, hero.z + aim.dir.z * L / 2);
      this.line.scale.set(spec.width || 1, L, 1);
      this.line.rotation.z = -Math.atan2(aim.dir.x, -aim.dir.z);
    } else if (spec.type === 'cone') {
      this.cone.visible = true;
      this.cone.geometry.dispose();
      const a = Math.atan2(-aim.dir.z, aim.dir.x);
      this.cone.geometry = new THREE.CircleGeometry(1, 24, a - spec.angle / 2, spec.angle);
      this.cone.position.set(hero.x, 0.16, hero.z);
      this.cone.scale.setScalar(spec.range);
    }
  }

  hide() { this.group.visible = false; }
}
