// 地图场景搭建（可行走区域见 terrain.js）
import * as THREE from 'three';
import { BASE, SPRING, LANE_HALF, POCKETS, POCKET_RADIUS, JUNGLE, JUNGLE_RADIUS, BUSHES, TEAM_COLOR, LANE_DIR, LANE_NORMAL, lanePoint } from './config.js';
import { mat } from './models.js';
import { AREAS, isWalkable } from './terrain.js';

export { isWalkable, clampToMap, bushAt } from './terrain.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4f8a3a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const v = 60 + Math.random() * 60;
    g.fillStyle = `rgba(${v * 0.6},${v * 1.4},${v * 0.5},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b8a57e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(90,75,50,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y < 128; y += 32) {
    for (let x = (y / 32) % 2 ? 16 : 0; x < 128; x += 32) {
      const v = Math.random() * 18;
      g.fillStyle = `rgb(${158 + v},${140 + v},${104 + v})`;
      g.fillRect(x + 1, y + 1, 30, 30);
      g.strokeRect(x + 1, y + 1, 30, 30);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMap(scene, quality) {
  const group = new THREE.Group();
  scene.add(group);

  // 草地
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 兵线石板路
  const laneLen = Math.hypot(BASE[1].x - BASE[0].x, BASE[1].z - BASE[0].z);
  const st = stoneTexture();
  st.repeat.set(LANE_HALF * 2 / 4, laneLen / 4);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HALF * 2, laneLen), new THREE.MeshStandardMaterial({ map: st, roughness: 0.95 }));
  lane.rotation.x = -Math.PI / 2;
  lane.rotation.z = Math.atan2(LANE_DIR.x, -LANE_DIR.z) * -1;
  lane.position.y = 0.02;
  lane.receiveShadow = true;
  group.add(lane);
  // 路边石沿（在基地、野区入口处断开）
  const STEPS = 280;
  for (const s of [-1, 1]) {
    let startK = -1;
    for (let k = 0; k <= STEPS; k++) {
      const p = lanePoint(k / STEPS, s * (LANE_HALF + 0.25));
      const open = k === STEPS || AREAS.some((a) => Math.hypot(p.x - a.x, p.z - a.z) < a.r + 0.2);
      if (!open && startK < 0) startK = k;
      if (open && startK >= 0) {
        const t0 = startK / STEPS, t1 = (k - 1) / STEPS;
        const len = (t1 - t0) * laneLen;
        if (len > 0.5) {
          const mid = lanePoint((t0 + t1) / 2, s * (LANE_HALF + 0.25));
          const curb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, len), mat(0x8c8270));
          curb.rotation.y = lane.rotation.z;
          curb.position.set(mid.x, 0.17, mid.z);
          curb.receiveShadow = true;
          group.add(curb);
        }
        startK = -1;
      }
    }
  }

  // 基地平台、泉水
  for (let t = 0; t < 2; t++) {
    const a = AREAS[t];
    const bt = stoneTexture();
    bt.repeat.set(7, 7);
    const plat = new THREE.Mesh(new THREE.CircleGeometry(a.r + 0.5, 40), new THREE.MeshStandardMaterial({ map: bt, color: t === 0 ? 0xc9d8ff : 0xffd6d0, roughness: 0.9 }));
    plat.rotation.x = -Math.PI / 2;
    plat.position.set(a.x, 0.03, a.z);
    plat.receiveShadow = true;
    group.add(plat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(a.r + 0.5, 0.3, 6, 48), mat(0x8c8270));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(a.x, 0.1, a.z);
    group.add(rim);
    const sp = SPRING[t];
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32), new THREE.MeshStandardMaterial({ color: TEAM_COLOR[t], emissive: TEAM_COLOR[t], emissiveIntensity: 0.6, transparent: true, opacity: 0.55 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(sp.x, 0.06, sp.z);
    group.add(pool);
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 2.4, 8), mat(0xe9e2d0));
    fountain.position.set(sp.x, 1.2, sp.z);
    fountain.castShadow = true;
    group.add(fountain);
    const fl = new THREE.PointLight(TEAM_COLOR[t], 25, 12, 1.5);
    fl.position.set(sp.x, 3, sp.z);
    group.add(fl);
  }

  // 河道（与兵线垂直，穿过中心）
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9, 70), new THREE.MeshStandardMaterial({ color: 0x3fa7d6, transparent: true, opacity: 0.7, roughness: 0.15, metalness: 0.2, emissive: 0x0d4466, emissiveIntensity: 0.3 }));
  water.rotation.x = -Math.PI / 2;
  water.rotation.z = Math.atan2(LANE_NORMAL.x, -LANE_NORMAL.z) * -1;
  water.position.y = 0.05;
  group.add(water);
  group.userData.water = water;

  // 野区小平台
  for (const p of [...POCKETS.map((q) => ({ ...q, r: POCKET_RADIUS })), ...JUNGLE.map((q) => ({ ...q, r: JUNGLE_RADIUS }))]) {
    const plat = new THREE.Mesh(new THREE.CircleGeometry(p.r + 0.3, 32), new THREE.MeshStandardMaterial({ color: 0x5f7d3e, roughness: 1 }));
    plat.rotation.x = -Math.PI / 2;
    plat.position.set(p.x, 0.035, p.z);
    plat.receiveShadow = true;
    group.add(plat);
    if (p.kind) {
      // 野怪营地的符文圈
      const col = p.kind === 'red' ? 0xff5a2a : 0x4aa8ff;
      const rune = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false }));
      rune.rotation.x = -Math.PI / 2;
      rune.position.set(p.x, 0.06, p.z);
      group.add(rune);
    }
  }

  // 草丛
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.9, flatShading: true, transparent: true, opacity: 1 });
  const bladeGeo = new THREE.ConeGeometry(0.28, 1.5, 4);
  const bushMeshes = [];
  for (const b of BUSHES) {
    const n = Math.floor(b.r * b.r * 7);
    const im = new THREE.InstancedMesh(bladeGeo, bushMat, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * b.r;
      const s = 0.7 + Math.random() * 0.6;
      m4.compose(
        new THREE.Vector3(b.x + Math.cos(a) * r, 0.6 * s, b.z + Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4)),
        new THREE.Vector3(s, s, s)
      );
      im.setMatrixAt(i, m4);
      im.setColorAt(i, new THREE.Color().setHSL(0.3 + Math.random() * 0.05, 0.55, 0.25 + Math.random() * 0.12));
    }
    group.add(im);
    bushMeshes.push(im);
  }

  // 森林：在不可行走区域放树和石头
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6);
  const leafGeo = new THREE.ConeGeometry(1.5, 3.4, 7);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const spots = [];
  const count = quality === 'low' ? 380 : 650;
  let guard = 0;
  while (spots.length < count && guard++ < 20000) {
    const x = (Math.random() - 0.5) * 150, z = (Math.random() - 0.5) * 150;
    if (isWalkable(x, z, -2.2)) continue;
    // 河道上不种树
    const along = x * LANE_DIR.x + z * LANE_DIR.z;
    if (Math.abs(along) < 5) continue;
    spots.push({ x, z, s: 0.8 + Math.random() * 0.7, rock: Math.random() < 0.12 });
  }
  const trees = spots.filter((s) => !s.rock), rocks = spots.filter((s) => s.rock);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4a2a), trees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), trees.length);
  const rockIm = new THREE.InstancedMesh(rockGeo, mat(0x8a8a86), rocks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  trees.forEach((t, i) => {
    q.setFromEuler(new THREE.Euler(0, Math.random() * 6, 0));
    m4.compose(v.set(t.x, 0.8 * t.s, t.z), q, sc.set(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m4);
    m4.compose(v.set(t.x, (1.6 + 1.5) * t.s, t.z), q, sc.set(t.s, t.s, t.s));
    leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, new THREE.Color().setHSL(0.27 + Math.random() * 0.08, 0.5, 0.22 + Math.random() * 0.12));
  });
  rocks.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
    m4.compose(v.set(r.x, 0.4 * r.s, r.z), q, sc.set(r.s * 1.3, r.s * 0.8, r.s * 1.1));
    rockIm.setMatrixAt(i, m4);
  });
  for (const im of [trunks, leaves, rockIm]) {
    im.castShadow = quality !== 'low';
    im.receiveShadow = true;
    group.add(im);
  }

  // 河道两侧石桥柱装饰
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 6), mat(0xa39b8a));
      p.position.set(LANE_DIR.x * k * 5 + LANE_NORMAL.x * s * (LANE_HALF + 0.4), 0.8, LANE_DIR.z * k * 5 + LANE_NORMAL.z * s * (LANE_HALF + 0.4));
      p.castShadow = true;
      group.add(p);
    }
  }

  return { group, bushMat, bushMeshes };
}
