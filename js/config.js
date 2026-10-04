// 全局常量、地图布局、物品与难度配置
export const BLUE = 0;
export const RED = 1;
export const TEAM_NAME = ['蓝方', '红方'];
export const TEAM_COLOR = [0x3f8cff, 0xff4a4a];
export const TEAM_CSS = ['#4da3ff', '#ff5a5a'];

// 地图：一条从左下（蓝方）通往右上（红方）的对角线兵线
export const BASE = [{ x: -50, z: 50 }, { x: 50, z: -50 }];
export const SPRING = [{ x: -58, z: 58 }, { x: 58, z: -58 }];
export const LANE_HALF = 8.5;
export const BASE_RADIUS = 14;
export const POCKET_RADIUS = 7.5;
const S = Math.SQRT1_2;
export const LANE_DIR = { x: S, z: -S }; // 蓝 -> 红
export const LANE_NORMAL = { x: S, z: S }; // 屏幕右下方向
export const POCKETS = [
  { x: -LANE_NORMAL.x * 15, z: -LANE_NORMAL.z * 15 }, // 左上野区（暴君）
  { x: LANE_NORMAL.x * 15, z: LANE_NORMAL.z * 15 },   // 右下草丛区
];

export function lanePoint(t, offset = 0) {
  return {
    x: BASE[0].x + (BASE[1].x - BASE[0].x) * t + LANE_NORMAL.x * offset,
    z: BASE[0].z + (BASE[1].z - BASE[0].z) * t + LANE_NORMAL.z * offset,
  };
}

// 投影到兵线上的进度 t (0 = 蓝方水晶, 1 = 红方水晶)
export function laneT(x, z) {
  const dx = x - BASE[0].x, dz = z - BASE[0].z;
  const L = Math.hypot(BASE[1].x - BASE[0].x, BASE[1].z - BASE[0].z);
  return (dx * LANE_DIR.x + dz * LANE_DIR.z) / L;
}

// 野区：每方一红一蓝（关于地图中心点对称）
export const JUNGLE_RADIUS = 6;
export const JUNGLE = [
  { ...lanePoint(0.27, -13), kind: 'red', side: 0 },
  { ...lanePoint(0.27, 13), kind: 'blue', side: 0 },
  { ...lanePoint(0.73, 13), kind: 'red', side: 1 },
  { ...lanePoint(0.73, -13), kind: 'blue', side: 1 },
];

export const MONSTERS = {
  tyrant: { id: 'tyrant', name: '峡谷巨兽', hp: 6500, hpGrow: 450, atk: 230, atkGrow: 18, armor: 140, range: 3.2, as: 0.7, radius: 1.6, barHeight: 4.2, gold: 260, xp: 380, buff: { id: 'tyrant', dur: 90 }, first: 90, respawn: 120, fxColor: 0xb27bff },
  red: { id: 'red', name: '炽焰魔像', hp: 2600, hpGrow: 220, atk: 105, atkGrow: 10, armor: 90, range: 2.8, as: 0.8, radius: 1.3, barHeight: 3.6, gold: 110, xp: 160, buff: { id: 'redbuff', dur: 70 }, first: 20, respawn: 90, fxColor: 0xff6a2a },
  blue: { id: 'blue', name: '寒霜魔像', hp: 2400, hpGrow: 200, atk: 95, atkGrow: 9, armor: 80, range: 2.8, as: 0.8, radius: 1.3, barHeight: 3.6, gold: 110, xp: 160, buff: { id: 'bluebuff', dur: 70 }, first: 20, respawn: 90, fxColor: 0x5ab4ff },
};

export const BUFF_INFO = {
  redbuff: { icon: '🔥', name: '红buff', desc: '普攻灼烧减速' },
  bluebuff: { icon: '💧', name: '蓝buff', desc: '冷却缩减 20%' },
  tyrant: { icon: '👑', name: '巨兽之力', desc: '伤害提升 15%' },
};

export const TOWER_T = [
  [0.18, 0.37], // 蓝方 高地塔, 外塔
  [0.82, 0.63], // 红方 高地塔, 外塔
];

export const BUSHES = [
  { ...lanePoint(0.42, 6.2), r: 2.6 },
  { ...lanePoint(0.42, -6.2), r: 2.6 },
  { ...lanePoint(0.58, 6.2), r: 2.6 },
  { ...lanePoint(0.58, -6.2), r: 2.6 },
  { x: POCKETS[1].x + 1.5, z: POCKETS[1].z + 1.5, r: 3.4 },
  { x: POCKETS[0].x - 3.2, z: POCKETS[0].z - 3.2, r: 2.4 },
];

export const MINION_TYPES = {
  melee: { name: '近战兵', hp: 560, atk: 42, armor: 40, range: 1.6, atkSpeed: 0.9, speed: 4.4, radius: 0.55, gold: 38, xp: 60, siege: 2 },
  caster: { name: '法师兵', hp: 380, atk: 58, armor: 10, range: 6, atkSpeed: 0.75, speed: 4.4, radius: 0.5, gold: 34, xp: 50, siege: 2 },
  cannon: { name: '炮车', hp: 1100, atk: 96, armor: 80, range: 7, atkSpeed: 0.55, speed: 4.2, radius: 0.85, gold: 75, xp: 110, siege: 3.2 },
};

export const ITEMS = [
  { id: 'boots', name: '疾行之靴', icon: '👢', cost: 450, stats: { speed: 0.8, armor: 40 }, desc: '+0.8 移速 +40 护甲' },
  { id: 'sword', name: '精钢长剑', icon: '🗡️', cost: 650, stats: { atk: 40 }, desc: '+40 物攻' },
  { id: 'dagger', name: '疾风匕首', icon: '🔪', cost: 650, stats: { as: 0.2 }, desc: '+20% 攻速' },
  { id: 'tome', name: '秘法典籍', icon: '📘', cost: 700, stats: { ap: 90 }, desc: '+90 法强' },
  { id: 'gem', name: '生命宝石', icon: '❤️', cost: 600, stats: { hp: 550 }, desc: '+550 生命' },
  { id: 'mail', name: '守护布甲', icon: '🛡️', cost: 600, stats: { armor: 130 }, desc: '+130 护甲' },
  { id: 'vamp', name: '嗜血之刃', icon: '🩸', cost: 1600, from: ['sword'], stats: { atk: 75, lifesteal: 0.15 }, desc: '+75 物攻 15% 吸血' },
  { id: 'fury', name: '狂暴战刃', icon: '⚔️', cost: 2000, from: ['sword'], stats: { atk: 120, crit: 0.2 }, desc: '+120 物攻 +20% 暴击' },
  { id: 'storm', name: '雷霆匕首', icon: '⚡', cost: 1800, from: ['dagger'], stats: { as: 0.35, crit: 0.15, speed: 0.4 }, desc: '+35% 攻速 +15% 暴击' },
  { id: 'cleaver', name: '破城巨刃', icon: '🪓', cost: 2400, from: ['sword'], stats: { atk: 170, pen: 0.3 }, desc: '+170 物攻 30% 穿透' },
  { id: 'staff', name: '星辰法杖', icon: '🔮', cost: 2000, from: ['tome'], stats: { ap: 220, cdr: 0.1 }, desc: '+220 法强 10% 冷却缩减' },
  { id: 'codex', name: '圣光法典', icon: '📖', cost: 2400, from: ['tome'], stats: { ap: 300, pen: 0.3 }, desc: '+300 法强 30% 法穿' },
  { id: 'plate', name: '磐石重铠', icon: '🪨', cost: 2000, from: ['mail'], stats: { hp: 1100, armor: 220 }, desc: '+1100 生命 +220 护甲' },
  { id: 'heart', name: '不朽之心', icon: '💖', cost: 2200, from: ['gem'], stats: { hp: 1900, regen: 40 }, desc: '+1900 生命 每秒回复 40' },
];
export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const DIFFICULTY = {
  easy: { name: '简单', dmg: 0.7, think: 0.5, aggression: 0.3, aimError: 0.5, predict: 0, dodge: 0.0, useFlash: false, goldMul: 0.8 },
  normal: { name: '普通', dmg: 0.9, think: 0.3, aggression: 0.5, aimError: 0.3, predict: 0.4, dodge: 0.25, useFlash: true, goldMul: 0.95 },
  hard: { name: '困难', dmg: 1.12, think: 0.12, aggression: 0.85, aimError: 0.05, predict: 1, dodge: 0.65, useFlash: true, goldMul: 1.2 },
};

export const XP_TABLE = (() => {
  const t = [0];
  for (let l = 1; l < 15; l++) t.push(t[l - 1] + 160 + l * 90);
  return t; // t[l-1] = 升到 l 级所需累计经验
})();

export const MAX_LEVEL = 15;
export const WAVE_INTERVAL = 26;
export const FIRST_WAVE = 12;
export const PASSIVE_GOLD = 5;

// 双人对战
export const QUICK_CHAT = ['干得漂亮！', '进攻！', '撤退！', '稳住，我们能赢', '大意了…', '😂😂😂', '👍', '🤝 GG'];
// 部署在 GitHub Pages 时，双人对战连接的服务器地址（页面由服务器本身提供时用同源地址）
export const SERVER_ORIGIN = 'https://wangzhe-production.up.railway.app';
