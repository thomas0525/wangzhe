// 地形：可行走区域与草丛判定（纯逻辑，网页和服务器共用）
import { BASE, LANE_HALF, BASE_RADIUS, POCKETS, POCKET_RADIUS, JUNGLE, JUNGLE_RADIUS, BUSHES } from './config.js';

export const AREAS = [
  { x: BASE[0].x - 3, z: BASE[0].z + 3, r: BASE_RADIUS },
  { x: BASE[1].x + 3, z: BASE[1].z - 3, r: BASE_RADIUS },
  { x: POCKETS[0].x, z: POCKETS[0].z, r: POCKET_RADIUS },
  { x: POCKETS[1].x, z: POCKETS[1].z, r: POCKET_RADIUS },
  ...JUNGLE.map((j) => ({ x: j.x, z: j.z, r: JUNGLE_RADIUS })),
];

function segInfo(x, z) {
  const ax = BASE[0].x, az = BASE[0].z, bx = BASE[1].x, bz = BASE[1].z;
  const vx = bx - ax, vz = bz - az;
  let t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
  t = Math.max(0, Math.min(1, t));
  const px = ax + vx * t, pz = az + vz * t;
  return { px, pz, d: Math.hypot(x - px, z - pz) };
}

export function isWalkable(x, z, margin = 0) {
  if (segInfo(x, z).d <= LANE_HALF - margin) return true;
  for (const a of AREAS) if (Math.hypot(x - a.x, z - a.z) <= a.r - margin) return true;
  return false;
}

// 把点夹回可行走区域内（取最近的边界点）
export function clampToMap(x, z, margin = 0.4) {
  if (isWalkable(x, z, margin)) return { x, z };
  let best = null, bd = Infinity;
  const s = segInfo(x, z);
  if (s.d > 0) {
    const k = (LANE_HALF - margin) / s.d;
    const cx = s.px + (x - s.px) * k, cz = s.pz + (z - s.pz) * k;
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = { x: cx, z: cz }; }
  }
  for (const a of AREAS) {
    const dd = Math.hypot(x - a.x, z - a.z) || 1;
    const k = (a.r - margin) / dd;
    const cx = a.x + (x - a.x) * k, cz = a.z + (z - a.z) * k;
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = { x: cx, z: cz }; }
  }
  return best;
}

export function bushAt(x, z) {
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i];
    if (Math.hypot(x - b.x, z - b.z) < b.r) return i;
  }
  return -1;
}
