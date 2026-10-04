// 低多边形模型构建（全部由几何体拼装，无外部素材）
import * as THREE from 'three';
import { TEAM_COLOR } from './config.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, flatShading: true, ...opts }));
  }
  return matCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.IcosahedronGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 8),
  capsule: new THREE.CapsuleGeometry(0.45, 0.8, 4, 10),
  oct: new THREE.OctahedronGeometry(1, 0),
};

function scaled(m, sx, sy, sz) {
  m.scale.set(sx, sy, sz);
  return m;
}

// 英雄模型：身体、头、披风、武器、队伍光环
export function buildHero(def, team) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const tc = TEAM_COLOR[team];
  const main = mat(def.color);
  const dark = mat(0x2a2f3a);
  const teamMat = mat(tc, { emissive: tc, emissiveIntensity: 0.25 });
  const skin = mat(0xf2d0b0);

  const torso = mesh(G.capsule, main, 0, 1.25, 0);
  scaled(torso, 1, 1, 0.8);
  body.add(torso);
  const belt = mesh(G.cyl, teamMat, 0, 0.95, 0);
  scaled(belt, 0.5, 0.15, 0.42);
  body.add(belt);
  const head = mesh(G.sphere, skin, 0, 2.15, 0);
  head.scale.setScalar(0.38);
  body.add(head);
  const hair = mesh(G.sphere, def.weapon === 'staff' ? mat(0x6a3fb5) : def.weapon === 'bow' ? mat(0x3d6b2e) : mat(0x1d2a44), 0, 2.28, -0.05);
  scaled(hair, 0.42, 0.3, 0.42);
  body.add(hair);
  // 肩甲
  for (const s of [-1, 1]) {
    const pad = mesh(G.sphere, teamMat, s * 0.52, 1.7, 0);
    scaled(pad, 0.26, 0.2, 0.3);
    body.add(pad);
    const leg = mesh(G.capsule, dark, s * 0.2, 0.42, 0);
    scaled(leg, 0.38, 0.45, 0.38);
    leg.name = s < 0 ? 'legL' : 'legR';
    body.add(leg);
  }
  // 披风
  const cape = mesh(new THREE.PlaneGeometry(0.9, 1.3, 1, 3), mat(tc, { side: THREE.DoubleSide, emissive: tc, emissiveIntensity: 0.15 }), 0, 1.25, -0.42);
  cape.rotation.x = 0.15;
  cape.name = 'cape';
  body.add(cape);

  // 武器
  const arm = new THREE.Group();
  arm.position.set(0.58, 1.45, 0.05);
  arm.name = 'arm';
  body.add(arm);
  if (def.weapon === 'sword') {
    const blade = mesh(G.box, mat(0xdff6ff, { metalness: 0.8, roughness: 0.2, emissive: 0x6fd8ff, emissiveIntensity: 0.4 }), 0, 0, 0.9);
    scaled(blade, 0.12, 0.05, 1.5);
    arm.add(blade);
    const guard = mesh(G.box, mat(0xffd34d, { metalness: 0.7 }), 0, 0, 0.15);
    scaled(guard, 0.45, 0.08, 0.08);
    arm.add(guard);
  } else if (def.weapon === 'staff') {
    const stick = mesh(G.cyl, mat(0x7a4b2a), 0, 0.3, 0.2);
    scaled(stick, 0.06, 2.0, 0.06);
    arm.add(stick);
    const orb = mesh(G.oct, mat(0xe3c4ff, { emissive: 0xb07bff, emissiveIntensity: 1.2 }), 0, 1.35, 0.2);
    orb.scale.setScalar(0.24);
    orb.name = 'orb';
    arm.add(orb);
  } else {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.05, 6, 16, Math.PI), mat(0x8a5a2b));
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    bow.position.set(0, 0, 0.35);
    bow.castShadow = true;
    arm.add(bow);
    const quiver = mesh(G.cyl, mat(0x6b4a2a), -0.6, 1.5, -0.35);
    scaled(quiver, 0.14, 0.7, 0.14);
    quiver.rotation.z = 0.4;
    body.add(quiver);
  }

  // 脚下光环
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.05, 32),
    new THREE.MeshBasicMaterial({ color: tc, transparent: true, opacity: 0.8, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.name = 'ring';
  root.add(ring);
  root.userData.body = body;
  return root;
}

export function buildMinion(type, team) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const tc = TEAM_COLOR[team];
  const teamMat = mat(tc, { emissive: tc, emissiveIntensity: 0.2 });
  const armor = mat(team === 0 ? 0xbfd6ff : 0xffc9c9);
  if (type === 'cannon') {
    const base = mesh(G.box, armor, 0, 0.6, 0);
    scaled(base, 1.3, 0.7, 1.6);
    body.add(base);
    for (const s of [-1, 1]) for (const f of [-1, 1]) {
      const w = mesh(G.cyl, mat(0x3a3a3a), s * 0.7, 0.35, f * 0.55);
      scaled(w, 0.35, 0.18, 0.35);
      w.rotation.z = Math.PI / 2;
      body.add(w);
    }
    const barrel = mesh(G.cyl, teamMat, 0, 1.15, 0.5);
    scaled(barrel, 0.22, 1.4, 0.22);
    barrel.rotation.x = Math.PI / 2.4;
    body.add(barrel);
  } else {
    const torso = mesh(G.box, armor, 0, 0.75, 0);
    scaled(torso, 0.6, 0.65, 0.4);
    body.add(torso);
    const head = mesh(G.sphere, teamMat, 0, 1.3, 0);
    head.scale.setScalar(0.28);
    body.add(head);
    for (const s of [-1, 1]) {
      const leg = mesh(G.box, mat(0x333844), s * 0.16, 0.25, 0);
      scaled(leg, 0.18, 0.5, 0.2);
      leg.name = s < 0 ? 'legL' : 'legR';
      body.add(leg);
    }
    const arm = new THREE.Group();
    arm.position.set(0.4, 0.85, 0);
    arm.name = 'arm';
    body.add(arm);
    if (type === 'melee') {
      const sw = mesh(G.box, mat(0xdddddd, { metalness: 0.6 }), 0, 0, 0.45);
      scaled(sw, 0.08, 0.08, 0.8);
      arm.add(sw);
      const shield = mesh(G.cyl, teamMat, -0.8, 0, 0.2);
      scaled(shield, 0.35, 0.08, 0.35);
      shield.rotation.z = Math.PI / 2;
      arm.add(shield);
    } else {
      const st = mesh(G.cyl, mat(0x6b4a2a), 0, 0.3, 0.1);
      scaled(st, 0.04, 1.0, 0.04);
      arm.add(st);
      const orb = mesh(G.sphere, mat(tc, { emissive: tc, emissiveIntensity: 1 }), 0, 0.85, 0.1, false);
      orb.scale.setScalar(0.13);
      arm.add(orb);
    }
  }
  root.userData.body = body;
  return root;
}

export function buildTower(team) {
  const root = new THREE.Group();
  const tc = TEAM_COLOR[team];
  const stone = mat(0xb9b2a5);
  const darkStone = mat(0x7d776d);
  const base = mesh(G.cyl, darkStone, 0, 0.5, 0);
  scaled(base, 1.9, 1, 1.9);
  root.add(base);
  const body = mesh(new THREE.CylinderGeometry(0.9, 1.4, 4.2, 8), stone, 0, 3.1, 0);
  root.add(body);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = mesh(G.box, mat(tc, { emissive: tc, emissiveIntensity: 0.3 }), Math.cos(a) * 1.05, 2.8, Math.sin(a) * 1.05);
    scaled(fin, 0.25, 3.0, 0.25);
    root.add(fin);
  }
  const top = mesh(new THREE.CylinderGeometry(1.4, 1.0, 0.6, 8), darkStone, 0, 5.4, 0);
  root.add(top);
  const gem = mesh(G.oct, mat(tc, { emissive: tc, emissiveIntensity: 1.4 }), 0, 6.6, 0);
  gem.scale.set(0.6, 0.9, 0.6);
  gem.name = 'gem';
  root.add(gem);
  root.userData.gemY = 6.6;
  return root;
}

export function buildCrystal(team) {
  const root = new THREE.Group();
  const tc = TEAM_COLOR[team];
  const ped = mesh(new THREE.CylinderGeometry(2.6, 3.2, 1.2, 8), mat(0x9e968a), 0, 0.6, 0);
  root.add(ped);
  const ped2 = mesh(new THREE.CylinderGeometry(1.8, 2.3, 0.8, 8), mat(0x7d776d), 0, 1.6, 0);
  root.add(ped2);
  const gem = mesh(G.oct, mat(tc, { emissive: tc, emissiveIntensity: 1.1, transparent: true, opacity: 0.92, roughness: 0.1, metalness: 0.3 }), 0, 4.2, 0);
  gem.scale.set(1.5, 2.3, 1.5);
  gem.name = 'gem';
  root.add(gem);
  for (let i = 0; i < 3; i++) {
    const shard = mesh(G.oct, mat(tc, { emissive: tc, emissiveIntensity: 1.5 }), 0, 4, 0, false);
    shard.scale.set(0.3, 0.55, 0.3);
    shard.name = 'shard' + i;
    root.add(shard);
  }
  const light = new THREE.PointLight(tc, 30, 16, 1.6);
  light.position.y = 4;
  root.add(light);
  return root;
}

export function buildGolem(kind) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const glow = kind === 'red' ? 0xff4a1a : 0x2a9bff;
  const stone = mat(kind === 'red' ? 0x6e4a3e : 0x46576e);
  const core = mat(glow, { emissive: glow, emissiveIntensity: 1.6 });
  const torso = mesh(G.box, stone, 0, 1.7, 0);
  scaled(torso, 1.7, 1.5, 1.2);
  torso.rotation.y = 0.1;
  body.add(torso);
  const heart = mesh(G.oct, core, 0, 1.8, 0.62, false);
  heart.scale.setScalar(0.35);
  body.add(heart);
  const head = mesh(G.box, stone, 0, 2.75, 0.15);
  scaled(head, 0.8, 0.6, 0.7);
  body.add(head);
  for (const s of [-1, 1]) {
    const eye = mesh(G.sphere, core, s * 0.2, 2.8, 0.52, false);
    eye.scale.setScalar(0.09);
    body.add(eye);
    const shoulder = mesh(G.sphere, stone, s * 1.05, 2.25, 0);
    shoulder.scale.setScalar(0.5);
    body.add(shoulder);
    const arm = mesh(G.box, stone, s * 1.15, 1.35, 0.1);
    scaled(arm, 0.5, 1.3, 0.55);
    body.add(arm);
    const fist = mesh(G.box, core, s * 1.15, 0.6, 0.15);
    fist.scale.setScalar(0.5);
    body.add(fist);
    const leg = mesh(G.box, stone, s * 0.45, 0.45, 0);
    scaled(leg, 0.55, 0.9, 0.6);
    leg.name = s < 0 ? 'legL' : 'legR';
    body.add(leg);
  }
  for (let i = 0; i < 4; i++) {
    const crystal = mesh(G.oct, core, (i - 1.5) * 0.4, 2.6 + (i % 2) * 0.2, -0.55, false);
    crystal.scale.set(0.15, 0.4, 0.15);
    body.add(crystal);
  }
  const light = new THREE.PointLight(glow, 8, 7, 1.8);
  light.position.set(0, 2, 1.2);
  root.add(light);
  root.userData.body = body;
  return root;
}

export function buildTyrant() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = mat(0x6b3d8f);
  const belly = mat(0xd6a86b);
  const b = mesh(G.sphere, skin, 0, 1.6, 0);
  scaled(b, 1.5, 1.3, 1.7);
  body.add(b);
  const bl = mesh(G.sphere, belly, 0, 1.3, 0.6);
  scaled(bl, 1.0, 0.9, 1.0);
  body.add(bl);
  const head = mesh(G.sphere, skin, 0, 2.6, 1.3);
  scaled(head, 0.9, 0.75, 0.9);
  body.add(head);
  for (const s of [-1, 1]) {
    const horn = mesh(G.cone, mat(0xffe8b0), s * 0.5, 3.4, 1.2);
    scaled(horn, 0.18, 0.7, 0.18);
    horn.rotation.z = -s * 0.4;
    body.add(horn);
    const eye = mesh(G.sphere, mat(0xffee55, { emissive: 0xffaa00, emissiveIntensity: 2 }), s * 0.35, 2.75, 2.05, false);
    eye.scale.setScalar(0.12);
    body.add(eye);
    const leg = mesh(G.cyl, skin, s * 0.8, 0.4, 0);
    scaled(leg, 0.4, 0.8, 0.4);
    leg.name = s < 0 ? 'legL' : 'legR';
    body.add(leg);
  }
  root.userData.body = body;
  return root;
}
