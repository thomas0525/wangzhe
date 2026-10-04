// 局面快照：把某一方能看到的局面压缩成可序列化的数据（服务器和单人模式共用）
export const KIND = { hero: 0, minion: 1, tower: 2, crystal: 3, monster: 4 };
export const KIND_NAME = ['hero', 'minion', 'tower', 'crystal', 'monster'];
const PUBLIC_BUFFS = new Set(['redbuff', 'bluebuff', 'tyrant']);

const r2 = (v) => Math.round(v * 100) / 100;

function flags(u) {
  return (u.anim.moving ? 1 : 0) | (u.stunned ? 2 : 0) | (u.dash ? 8 : 0) | (u.recall ? 16 : 0);
}

// events：sim.drainEvents() 的结果；只挑出发给该队（或所有人）的事件
export function snapshotFor(sim, team, events = [], extra = {}) {
  const u = [];
  for (const x of sim.units) {
    if (x.kind === 'hero') continue;
    const k = KIND[x.kind];
    const model = x.kind === 'minion' ? x.type : x.kind === 'monster' ? x.def.id : x.tier || '';
    const e = [x.id, k, x.team, r2(x.x), r2(x.z), r2(x.y), r2(x.facing), Math.ceil(x.hp), Math.round(x.stats.maxHp), flags(x), x.atkSeq, model];
    if (k === KIND.tower || k === KIND.crystal) e.push(x.alive ? 1 : 0, sim.isVulnerable(x) ? 0 : 1, x.alive && x.target ? x.target.id : 0);
    else if (!x.alive) continue;
    u.push(e);
  }
  const h = sim.heroes.map((x) => {
    const visible = x.alive && sim.isVisibleTo(x, team);
    const o = {
      id: x.id, tm: x.team, d: x.def.id, al: x.alive ? 1 : 0, hid: x.alive && !visible ? 1 : 0, lv: x.level,
      k: x.kills, de: x.deaths, cs: x.cs, tg: Math.round(x.totalGold || 0), hd: Math.round(x.heroDamage || 0),
    };
    if (visible) {
      Object.assign(o, {
        x: r2(x.x), z: r2(x.z), y: r2(x.y), f: r2(x.facing), hp: Math.ceil(x.hp), mhp: Math.round(x.stats.maxHp),
        fl: flags(x), as: x.atkSeq, sp: r2(Math.max(0, x.anim.spin)), bf: x.buffs.filter((b) => PUBLIC_BUFFS.has(b.id)).map((b) => b.id),
        rc: x.recall ? r2(x.recall.t / x.recall.dur) : -1, ib: x.team === team ? x.inBush : -1, spd: r2(x.stats.speed),
      });
    }
    return o;
  });
  const p = sim.projectiles.map((q) => [q.id, r2(q.x), r2(q.y), r2(q.z), q.color, q.size, q.arrow ? 1 : 0, q.kind === 'skill' ? 1 : 0, r2(q.yaw || 0)]);
  const mine = sim.heroes[team];
  const me = mine && {
    id: mine.id, gold: Math.floor(mine.gold), xp: Math.round(mine.xp), items: mine.items,
    cd: mine.skillCd.map((c) => Math.max(0, r2(c))), fcd: Math.max(0, r2(mine.flashCd)), cdr: r2(mine.stats.cdr), rng: mine.stats.range,
    rsp: r2(mine.respawnAt), bu: mine.buffs.filter((b) => PUBLIC_BUFFS.has(b.id)).map((b) => [b.id, r2(b.until)]),
    rd: mine.recall ? mine.recall.dur : 0, ack: sim.controllers[team]?.seq ?? 0,
  };
  const ev = [];
  for (const e of events) if (e.to === -1 || e.to === team) ev.push(e.ev);
  return { time: r2(sim.time), u, h, p, me, ev, over: sim.over ? sim.winner : -1, ...extra };
}
