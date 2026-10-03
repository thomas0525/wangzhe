// 电脑英雄 AI：补刀、换血、推塔、撤退回城、躲技能
import { SPRING, lanePoint, laneT, POCKETS } from './config.js';

export class AI {
  constructor(game, hero, diff) {
    this.game = game;
    this.hero = hero;
    this.D = diff;
    this.thinkT = 0;
    this.foeVel = { x: 0, z: 0 };
    this.foePrev = null;
    this.dodgeUntil = 0;
    this.dodgeDir = null;
    this.seenShots = new WeakSet();
    this.offset = (Math.random() - 0.5) * 4;
    this.skillDelay = 0;
  }

  get fwd() { return this.hero.team === 0 ? 1 : -1; }

  update(dt) {
    const h = this.hero, g = this.game;
    const foe = g.heroes.find((x) => x.team !== h.team);
    this.foe = foe;
    // 估计敌人速度用于预判
    if (foe.alive) {
      if (this.foePrev && dt > 0) {
        const vx = (foe.x - this.foePrev.x) / dt, vz = (foe.z - this.foePrev.z) / dt;
        if (Math.hypot(vx, vz) < 20) {
          this.foeVel.x += (vx - this.foeVel.x) * Math.min(1, dt * 8);
          this.foeVel.z += (vz - this.foeVel.z) * Math.min(1, dt * 8);
        }
      }
      this.foePrev = { x: foe.x, z: foe.z };
    }
    if (!h.alive) { this.foePrev = null; return; }

    // 买装备
    const next = h.nextBuild();
    if (next && h.canBuy(next)) h.buy(next);

    // 躲避技能
    if (g.time < this.dodgeUntil) {
      h.intent.move = this.dodgeDir;
      h.intent.attack = null;
      h.intent.moveTo = null;
      return;
    }
    this.checkDodge();

    this.skillDelay -= dt;
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.D.think * (0.7 + Math.random() * 0.6);
    this.decide();
  }

  checkDodge() {
    const h = this.hero, g = this.game;
    for (const p of g.projectiles) {
      if (p.kind !== 'skill' || p.owner.team === h.team || this.seenShots.has(p)) continue;
      const rx = h.x - p.x, rz = h.z - p.z;
      const along = rx * p.dir.x + rz * p.dir.z;
      if (along < 0 || along > 9) continue;
      const perp = rx * -p.dir.z + rz * p.dir.x;
      if (Math.abs(perp) > p.radius + h.radius + 0.6) continue;
      this.seenShots.add(p);
      if (Math.random() < this.D.dodge) {
        const s = perp >= 0 ? 1 : -1;
        this.dodgeDir = { x: -p.dir.z * s, z: p.dir.x * s };
        this.dodgeUntil = g.time + 0.35;
      }
    }
  }

  set(move, attack, moveTo) {
    const it = this.hero.intent;
    it.move = move || null;
    it.attack = attack || null;
    it.moveTo = moveTo || null;
  }

  dirTo(x, z) {
    const h = this.hero;
    const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }

  // 预判瞄准
  predict(t, lead) {
    const D = this.D;
    let x = t.x, z = t.z;
    if (t === this.foe) {
      x += this.foeVel.x * lead * D.predict;
      z += this.foeVel.z * lead * D.predict;
    }
    const err = D.aimError * 3;
    x += (Math.random() - 0.5) * err;
    z += (Math.random() - 0.5) * err;
    return { x, z };
  }

  aimAt(t, spec, lead = 0.35) {
    const h = this.hero;
    const p = this.predict(t, lead);
    const dir = this.dirTo(p.x, p.z);
    const d = Math.min(spec.range || 0, Math.hypot(p.x - h.x, p.z - h.z));
    return { dir, point: { x: h.x + dir.x * d, z: h.z + dir.z * d } };
  }

  enemyTowerNear() {
    const h = this.hero, g = this.game;
    let best = null;
    for (const u of g.units) {
      if (!u.alive || u.team !== 1 - h.team || (u.kind !== 'tower' && u.kind !== 'crystal')) continue;
      if (!best || h.dist(u) < h.dist(best)) best = u;
    }
    return best;
  }

  allyMinions() { return this.game.units.filter((u) => u.alive && u.kind === 'minion' && u.team === this.hero.team); }
  enemyMinions(r) {
    const h = this.hero;
    return this.game.units.filter((u) => u.alive && u.kind === 'minion' && u.team !== h.team && h.dist(u) < r);
  }

  homePoint(back = 0.06) {
    const h = this.hero;
    const t = laneT(h.x, h.z) - this.fwd * back;
    return lanePoint(Math.max(0, Math.min(1, t)), this.offset);
  }

  decide() {
    const h = this.hero, g = this.game, D = this.D, foe = this.foe;
    const hpPct = h.hp / h.stats.maxHp;
    const foeVis = foe.alive && g.isVisibleTo(foe, h.team);
    const foeDist = foeVis ? h.dist(foe) : 99;
    const foeHp = foe.alive ? foe.hp / foe.stats.maxHp : 0;
    const sp = SPRING[h.team];
    const atSpring = Math.hypot(h.x - sp.x, h.z - sp.z) < 6;

    // 回城中
    if (h.recall) {
      if (foeVis && foeDist < 9) h.cancelRecall();
      else { this.set(); return; }
    }

    // 在泉水回血
    if (atSpring && hpPct < 0.95) { this.set(); return; }

    const tower = this.enemyTowerNear();
    const inEnemyTower = tower && h.edgeDist(tower) < tower.stats.range + 0.5;
    const foeUnderHisTower = foeVis && tower && foe.edgeDist(tower) < tower.stats.range - 0.5;

    // 击杀判断
    const killable = foeVis && foeHp < 0.28 + D.aggression * 0.12 && hpPct > 0.3;

    // 撤退
    const lowLine = foeVis && foeDist < 10 ? 0.35 : 0.22;
    if (hpPct < lowLine && !killable) {
      this.retreat(foeVis, foeDist);
      return;
    }

    // 敌方英雄阵亡：趁机推塔
    const foeDeadLong = !foe.alive && foe.respawnAt - g.time > 6;
    if (tower && g.isVulnerable(tower) && foeDeadLong && hpPct > 0.45) {
      const tankers = this.allyMinions().filter((u) => u.edgeDist(tower) < tower.stats.range);
      if (tankers.length >= 1 || tower.hp < 2200 || hpPct > 0.8) {
        this.set(null, tower);
        return;
      }
    }

    // 防御塔安全
    if (inEnemyTower && !(killable && foeDist < 5 && D.aggression > 0.5 && hpPct > 0.45)) {
      const tankers = g.units.filter((u) => u.alive && u.kind === 'minion' && u.team === h.team && u.edgeDist(tower) < tower.stats.range);
      if (tower.target === h || tankers.length < 2) {
        const away = this.dirTo(tower.x, tower.z);
        this.set({ x: -away.x, z: -away.z });
        if (foeVis && foeDist < h.stats.range + 0.5 && h.attackCd <= 0 && tower.target !== h) h.intent.attack = foe;
        return;
      }
    }

    // 敌方英雄正在拆我方建筑 → 回防
    const ft = foe.intent?.attack;
    const defending = foeVis && ft && (ft.kind === 'tower' || ft.kind === 'crystal') && ft.team === h.team && foeDist < 24;

    // 对拼评估
    if (foeVis && (foeDist < 13 || defending)) {
      let score = (hpPct - foeHp) * 1.6 + (h.level - foe.level) * 0.15 + (D.aggression - 0.5);
      if (defending) score += 0.8;
      const allyTower = g.units.find((u) => u.alive && (u.kind === 'tower' || u.kind === 'crystal') && u.team === h.team && foe.edgeDist(u) < u.stats.range);
      if (allyTower) score += 0.6;
      if (foeUnderHisTower) score -= 1.2;
      const ultReady = h.canCast(2);
      if (ultReady) score += 0.25;
      if (killable) score += 0.8;
      const enemyMinionsNear = this.enemyMinions(5).length;
      score -= enemyMinionsNear * 0.08;

      this.useSkillsOn(foe, score > 0);
      if (score > 0.05) {
        // 进攻
        if (!h.def.melee && foe.def.melee && foeDist < 3 && hpPct < foeHp + 0.2) {
          const away = this.dirTo(foe.x, foe.z);
          this.set({ x: -away.x, z: -away.z }, foe);
        } else this.set(null, foe);
        if (D.useFlash && killable && foeHp < 0.12 && foeDist > h.stats.range + 0.5 && foeDist < h.stats.range + 5.5 && h.flashCd <= 0) {
          h.castFlash(this.dirTo(foe.x, foe.z));
        }
        return;
      }
      if (foeDist < (foe.stats.range + 2)) {
        // 劣势：后撤并保持距离
        const away = this.dirTo(foe.x, foe.z);
        this.set({ x: -away.x * 0.8 - this.fwd * 0.4 * 0.7, z: -away.z * 0.8 + this.fwd * 0.4 * 0.7 });
        const mv = h.intent.move;
        const l = Math.hypot(mv.x, mv.z);
        mv.x /= l; mv.z /= l;
        return;
      }
    }

    // 打巨兽：敌人死亡或很远，且自身状态好
    const tyrant = g.units.find((u) => u.kind === 'monster' && u.alive);
    if (tyrant && h.level >= 4 && hpPct > 0.7 && (!foe.alive || (!foeVis && foe.respawnAt - g.time > 6)) && this.enemyMinions(12).length === 0) {
      this.set(null, tyrant);
      if (h.dist(tyrant) < 6) this.useSkillsOn(tyrant, true, true);
      return;
    }
    if (h.intent.attack?.kind === 'monster' && tyrant && (foeVis && foeDist < 12 || hpPct < 0.45)) {
      this.set(null, null, this.homePoint(0.05));
      return;
    }

    // 补刀 / 清兵
    const mins = this.enemyMinions(13);
    if (mins.length) {
      let target = null;
      const lethal = h.stats.atk * 1.05 * (602 / 642);
      // 最后一击优先
      for (const m of mins) {
        if (m.hp <= lethal + 30 && h.edgeDist(m) < h.stats.range + 3) {
          if (!target || m.hp < target.hp) target = m;
        }
      }
      if (!target) {
        // 有己方兵时，攻击残血兵；否则也攻击最近
        let best = null, bs = Infinity;
        for (const m of mins) {
          const s = h.dist(m) + (m.hp / m.stats.maxHp) * 4;
          if (s < bs) { bs = s; best = m; }
        }
        target = best;
      }
      // 不要因为补刀走进敌方塔下
      if (target && tower && target.edgeDist(tower) < tower.stats.range && (tower.target === h || this.allyMinions().filter((u) => u.edgeDist(tower) < tower.stats.range).length < 2)) {
        target = null;
      }
      if (target) {
        this.set(null, target);
        if (mins.length >= 3 && Math.random() < 0.25 && this.skillDelay <= 0) this.farmSkills(mins);
        return;
      }
    }

    // 推塔
    if (tower && g.isVulnerable(tower)) {
      const tankers = this.allyMinions().filter((u) => u.edgeDist(tower) < tower.stats.range);
      if (tankers.length >= 1 && tower.target !== h && (!foeVis || foeDist > 7)) {
        this.set(null, tower);
        return;
      }
      if ((!foe.alive || foe.respawnAt - g.time > 8) && tower.kind === 'crystal' && hpPct > 0.6) {
        this.set(null, tower);
        return;
      }
    }

    // 站位：在己方兵线后方
    const allies = this.allyMinions();
    let frontT;
    if (allies.length) {
      frontT = this.fwd > 0 ? Math.max(...allies.map((u) => laneT(u.x, u.z))) : Math.min(...allies.map((u) => laneT(u.x, u.z)));
      frontT -= this.fwd * 0.04;
    } else {
      const myTowers = g.units.filter((u) => u.alive && u.kind === 'tower' && u.team === h.team);
      frontT = myTowers.length ? (this.fwd > 0 ? Math.max(...myTowers.map((u) => laneT(u.x, u.z))) : Math.min(...myTowers.map((u) => laneT(u.x, u.z)))) : (h.team === 0 ? 0.08 : 0.92);
      frontT += this.fwd * 0.02;
      // 状态不好且无兵线 → 回城补给
      if (hpPct < 0.55 && (!foeVis || foeDist > 14)) {
        h.startRecall();
        this.set();
        return;
      }
    }
    const p = lanePoint(frontT, this.offset);
    if (Math.hypot(p.x - h.x, p.z - h.z) > 1.2) this.set(null, null, p);
    else this.set();
  }

  retreat(foeVis, foeDist) {
    const h = this.hero, g = this.game, D = this.D, foe = this.foe;
    const sp = SPRING[h.team];
    const danger = g.units.some((u) => u.alive && u.team !== h.team && u.team !== 2 && (u.kind === 'hero' || u.kind === 'minion') && h.dist(u) < 9 && g.isVisibleTo(u, h.team));
    if (!danger && !h.recall) {
      h.startRecall();
      this.set();
      return;
    }
    const dir = this.dirTo(sp.x, sp.z);
    this.set(null, null, { x: sp.x, z: sp.z });
    if (foeVis && foeDist < 7) {
      // 位移技能逃跑
      if (h.def.id === 'blade' && h.canCast(0)) h.castSkill(0, { dir, point: { x: h.x + dir.x * 7, z: h.z + dir.z * 7 } });
      else if (h.def.id === 'archer' && h.canCast(0)) h.castSkill(0, { dir, point: { x: h.x + dir.x * 4, z: h.z + dir.z * 4 } });
      else if (h.def.id === 'mage' && h.canCast(1) && foeDist < 8) h.castSkill(1, this.aimAt(foe, h.def.skills[1].aim, 0.6));
      if (D.useFlash && h.hp / h.stats.maxHp < 0.15 && foeDist < 4 && h.flashCd <= 0) h.castFlash(dir);
    }
  }

  useSkillsOn(t, engage, isMonster = false) {
    const h = this.hero;
    if (this.skillDelay > 0) return;
    const d = h.dist(t);
    const S = h.def.skills;
    const cast = (i, aim) => {
      if (h.castSkill(i, aim)) this.skillDelay = 0.25 + this.D.think;
    };
    const tHp = t.hp / t.stats.maxHp;
    if (h.def.id === 'blade') {
      if (h.canCast(2) && d < 8.5 && (engage || tHp < 0.4)) return cast(2, this.aimAt(t, S[2].aim, 0.45));
      if (h.canCast(0) && engage && d > 2.5 && d < 7.5) return cast(0, this.aimAt(t, S[0].aim, 0.2));
      if (h.canCast(1) && d < 3.4) return cast(1, {});
    } else if (h.def.id === 'mage') {
      if (h.canCast(1) && d < 8.5) return cast(1, this.aimAt(t, S[1].aim, 0.6));
      if (h.canCast(0) && d < 10.5) return cast(0, this.aimAt(t, S[0].aim, d / 24));
      if (h.canCast(2) && d < 9.5 && (engage || tHp < 0.45) && !isMonster) return cast(2, this.aimAt(t, S[2].aim, 0.5));
      if (h.canCast(2) && isMonster && d < 9) return cast(2, this.aimAt(t, S[2].aim, 0));
    } else if (h.def.id === 'archer') {
      if (h.canCast(1) && d < 12) return cast(1, this.aimAt(t, S[1].aim, d / 30));
      if (h.canCast(2) && d < 9 && (engage || tHp < 0.4)) return cast(2, this.aimAt(t, S[2].aim, 0));
      if (h.canCast(0) && engage && d < h.stats.range + 3 && d > 2) {
        // 侧向翻滚
        const to = this.dirTo(t.x, t.z), s = Math.random() < 0.5 ? 1 : -1;
        return cast(0, { dir: { x: -to.z * s, z: to.x * s } });
      }
    }
  }

  farmSkills(mins) {
    const h = this.hero;
    const c = mins.reduce((a, m) => ({ x: a.x + m.x / mins.length, z: a.z + m.z / mins.length }), { x: 0, z: 0 });
    const fake = { x: c.x, z: c.z, hp: 1, stats: { maxHp: 1 } };
    const d = Math.hypot(c.x - h.x, c.z - h.z);
    const S = h.def.skills;
    if (h.def.id === 'mage' && h.canCast(1) && d < 8.5) h.castSkill(1, this.aimAt(fake, S[1].aim, 0));
    else if (h.def.id === 'archer' && h.canCast(1) && d < 11) h.castSkill(1, this.aimAt(fake, S[1].aim, 0));
    else if (h.def.id === 'blade' && h.canCast(1) && d < 3) h.castSkill(1, {});
    this.skillDelay = 1;
  }
}

export { POCKETS };
