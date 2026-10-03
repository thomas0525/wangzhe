// 英雄定义与技能实现（原创角色）
import { RED } from './config.js';

const sd = (hero, base, perLv, atkR = 0, apR = 0) =>
  base + perLv * (hero.level - 1) + atkR * hero.stats.atk + apR * hero.stats.ap;

export const HEROES = {
  blade: {
    id: 'blade',
    name: '影刃',
    title: '疾风剑客',
    role: '战士',
    desc: '近战突进，擅长切入与连招爆发',
    color: 0x8fd3ff,
    weapon: 'sword',
    hp: 3800, hpGrow: 290, atk: 180, atkGrow: 15, armor: 140, armorGrow: 12,
    range: 2.6, atkSpeed: 1.0, speed: 7.6, regen: 14,
    melee: true,
    build: ['boots', 'vamp', 'plate', 'cleaver', 'heart', 'fury'],
    passive: '每第三次普攻造成 150% 伤害并回复生命',
    skills: [
      {
        name: '疾风突刺', icon: '💨', cd: 5, unlock: 1,
        aim: { type: 'dir', range: 7.5, width: 1.6 },
        desc: '向指定方向突进，对路径上的敌人造成物理伤害',
        cast(game, hero, aim) {
          const tx = hero.x + aim.dir.x * 7.5, tz = hero.z + aim.dir.z * 7.5;
          const hit = new Set();
          game.fx.trail(hero, 0x9fe8ff, 0.25);
          hero.dashTo(tx, tz, 0.22, {
            each(h) {
              for (const e of game.enemiesInCircle(h.team, h.x, h.z, 1.8)) {
                if (hit.has(e)) continue;
                hit.add(e);
                game.damage(h, e, sd(h, 110, 18, 0.9), 'phys', { skill: true });
                game.fx.burst(e.x, 1.2, e.z, 0x9fe8ff, 10);
              }
            },
          });
          game.sfx('dash');
        },
      },
      {
        name: '旋刃风暴', icon: '🌀', cd: 9, unlock: 2,
        aim: { type: 'self', radius: 3.6 },
        desc: '旋转利刃 2 秒，持续伤害周围敌人，期间加速且减伤',
        cast(game, hero) {
          hero.addBuff({ id: 'spin', dur: 2, speedMul: 1.25, dr: 0.2 });
          hero.anim.spin = 2;
          const fxRing = game.fx.ring(hero.x, hero.z, 3.6, 0x9fe8ff, 2, { follow: hero, opacity: 0.35 });
          for (let i = 0; i < 5; i++) {
            game.schedule(0.4 * i + 0.05, () => {
              if (!hero.alive) return;
              for (const e of game.enemiesInCircle(hero.team, hero.x, hero.z, 3.6)) {
                game.damage(hero, e, sd(hero, 45, 9, 0.32), 'phys', { skill: true });
              }
              game.fx.slashArc(hero, 3.4, 0xbff2ff);
            });
          }
          void fxRing;
          game.sfx('spin');
        },
      },
      {
        name: '破天斩', icon: '⚡', cd: 26, unlock: 4,
        aim: { type: 'point', range: 8.5, radius: 3.6 },
        desc: '跃向目标区域斩落，造成大量伤害并眩晕 1 秒',
        cast(game, hero, aim) {
          const p = game.clamp(aim.point.x, aim.point.z);
          game.fx.ring(p.x, p.z, 3.6, 0xffe066, 0.5, { fill: true, opacity: 0.25 });
          hero.dashTo(p.x, p.z, 0.45, {
            arc: 4,
            end(h) {
              for (const e of game.enemiesInCircle(h.team, h.x, h.z, 3.6)) {
                game.damage(h, e, sd(h, 300, 45, 1.25), 'phys', { skill: true });
                e.addBuff({ id: 'stun', dur: 1, stun: true });
              }
              game.fx.shockwave(h.x, h.z, 4.2, 0xffe066);
              game.fx.burst(h.x, 0.5, h.z, 0xffe066, 26);
              game.shake(0.5);
              game.sfx('boom');
            },
          });
          game.sfx('dash');
        },
      },
    ],
    onBasicHit(game, hero, target) {
      hero.counter = (hero.counter || 0) + 1;
      if (hero.counter % 3 === 0) {
        game.damage(hero, target, hero.stats.atk * 0.5, 'phys');
        hero.heal(40 + hero.level * 12);
        game.fx.burst(target.x, 1.2, target.z, 0x9fe8ff, 12);
      }
    },
  },

  mage: {
    id: 'mage',
    name: '星澜',
    title: '星辰法师',
    role: '法师',
    desc: '远程法术爆发，控制与范围伤害',
    color: 0xc79bff,
    weapon: 'staff',
    hp: 3000, hpGrow: 210, atk: 160, atkGrow: 10, armor: 90, armorGrow: 8, ap: 40, apGrow: 14,
    range: 7.2, atkSpeed: 0.8, speed: 7.0, regen: 12,
    melee: false,
    build: ['boots', 'staff', 'heart', 'codex', 'plate', 'gem'],
    passive: '技能命中后，下次普攻附带额外法术伤害',
    skills: [
      {
        name: '星辰弹', icon: '✨', cd: 4.5, unlock: 1,
        aim: { type: 'dir', range: 11, width: 1.4 },
        desc: '发射星辰弹，命中第一个敌人爆炸造成法术伤害',
        cast(game, hero, aim) {
          game.addSkillShot({
            owner: hero, x: hero.x, z: hero.z, dir: aim.dir, speed: 24, range: 11, radius: 0.8,
            color: 0xd9a6ff, size: 0.45,
            onHit(e, p) {
              for (const t of game.enemiesInCircle(hero.team, p.x, p.z, 1.8)) {
                game.damage(hero, t, sd(hero, 180, 28, 0, 0.75), 'magic', { skill: true });
              }
              hero.empowered = true;
              game.fx.burst(p.x, 1, p.z, 0xd9a6ff, 18);
              game.fx.shockwave(p.x, p.z, 1.8, 0xd9a6ff);
              return true;
            },
          });
          game.sfx('shoot');
        },
      },
      {
        name: '寒霜禁锢', icon: '❄️', cd: 9, unlock: 2,
        aim: { type: 'point', range: 8.5, radius: 3 },
        desc: '0.6 秒后在目标区域爆发寒霜，造成伤害并减速 50%',
        cast(game, hero, aim) {
          const p = game.clamp(aim.point.x, aim.point.z);
          game.fx.ring(p.x, p.z, 3, 0x8be9ff, 0.6, { fill: true, opacity: 0.25, grow: true });
          game.schedule(0.6, () => {
            for (const e of game.enemiesInCircle(hero.team, p.x, p.z, 3)) {
              game.damage(hero, e, sd(hero, 160, 24, 0, 0.6), 'magic', { skill: true });
              e.addBuff({ id: 'slow', dur: 2, speedMul: 0.5 });
              hero.empowered = true;
            }
            game.fx.frost(p.x, p.z, 3);
            game.sfx('ice');
          });
        },
      },
      {
        name: '流星坠落', icon: '☄️', cd: 30, unlock: 4,
        aim: { type: 'point', range: 9.5, radius: 4 },
        desc: '召唤三颗流星连续轰击目标区域',
        cast(game, hero, aim) {
          const p = game.clamp(aim.point.x, aim.point.z);
          game.fx.ring(p.x, p.z, 4, 0xff9a3d, 1.5, { fill: true, opacity: 0.18 });
          for (let i = 0; i < 3; i++) {
            const ox = (Math.random() - 0.5) * 1.6, oz = (Math.random() - 0.5) * 1.6;
            game.fx.meteor(p.x + ox, p.z + oz, 0.35 + i * 0.4);
            game.schedule(0.35 + i * 0.4, () => {
              for (const e of game.enemiesInCircle(hero.team, p.x + ox, p.z + oz, 4)) {
                game.damage(hero, e, sd(hero, 170, 30, 0, 0.55), 'magic', { skill: true });
              }
              game.fx.shockwave(p.x + ox, p.z + oz, 4, 0xff9a3d);
              game.fx.burst(p.x + ox, 0.5, p.z + oz, 0xff7a2d, 20);
              game.shake(0.25);
              game.sfx('boom');
            });
          }
        },
      },
    ],
    onBasicHit(game, hero, target) {
      if (hero.empowered) {
        hero.empowered = false;
        game.damage(hero, target, 60 + hero.level * 15 + hero.stats.ap * 0.4, 'magic');
        game.fx.burst(target.x, 1.2, target.z, 0xd9a6ff, 10);
      }
    },
  },

  archer: {
    id: 'archer',
    name: '鸣镝',
    title: '逐风射手',
    role: '射手',
    desc: '远程持续输出，灵活位移与范围箭雨',
    color: 0x9cff9c,
    weapon: 'bow',
    hp: 2950, hpGrow: 205, atk: 165, atkGrow: 13, armor: 90, armorGrow: 7,
    range: 7.5, atkSpeed: 1.0, speed: 7.2, regen: 12,
    melee: false,
    build: ['boots', 'fury', 'storm', 'vamp', 'cleaver', 'plate'],
    passive: '普攻命中叠加攻速，最多 5 层',
    skills: [
      {
        name: '翻滚射击', icon: '🏹', cd: 6, unlock: 1,
        aim: { type: 'dir', range: 4.5, width: 1.2 },
        desc: '向指定方向翻滚，下次普攻造成额外伤害',
        cast(game, hero, aim) {
          hero.dashTo(hero.x + aim.dir.x * 4.5, hero.z + aim.dir.z * 4.5, 0.2, {});
          hero.empowered = true;
          hero.attackCd = Math.min(hero.attackCd, 0.05);
          game.fx.trail(hero, 0x9cff9c, 0.2);
          game.sfx('dash');
        },
      },
      {
        name: '穿云箭', icon: '🎯', cd: 8, unlock: 2,
        aim: { type: 'dir', range: 13, width: 1.2 },
        desc: '射出贯穿箭矢，伤害路径上所有敌人并减速',
        cast(game, hero, aim) {
          game.addSkillShot({
            owner: hero, x: hero.x, z: hero.z, dir: aim.dir, speed: 30, range: 13, radius: 0.9,
            color: 0xb8ffb8, size: 0.3, arrow: true, pierce: true,
            onHit(e) {
              game.damage(hero, e, sd(hero, 150, 22, 0.85), 'phys', { skill: true });
              e.addBuff({ id: 'slow', dur: 1.5, speedMul: 0.65 });
              game.fx.burst(e.x, 1.2, e.z, 0xb8ffb8, 10);
            },
          });
          game.sfx('shoot');
        },
      },
      {
        name: '万箭齐发', icon: '🌧️', cd: 26, unlock: 4,
        aim: { type: 'cone', range: 9.5, angle: 1.0 },
        desc: '向扇形区域连续射出 5 轮箭雨',
        cast(game, hero, aim) {
          const dir = { ...aim.dir };
          for (let w = 0; w < 5; w++) {
            game.schedule(w * 0.2, () => {
              if (!hero.alive) return;
              for (let k = -2; k <= 2; k++) {
                const a = Math.atan2(dir.z, dir.x) + k * 0.22 + (Math.random() - 0.5) * 0.1;
                game.fx.arrow(hero.x, hero.z, Math.cos(a), Math.sin(a), 9.5, 0xd8ffb0);
              }
              for (const e of game.enemiesInCircle(hero.team, hero.x, hero.z, 9.5)) {
                const dx = e.x - hero.x, dz = e.z - hero.z;
                const d = Math.hypot(dx, dz) || 1;
                if ((dx * dir.x + dz * dir.z) / d > Math.cos(0.55)) {
                  game.damage(hero, e, sd(hero, 70, 12, 0.38), 'phys', { skill: true });
                }
              }
              game.sfx('shoot');
            });
          }
        },
      },
    ],
    onBasicHit(game, hero, target) {
      hero.addBuff({ id: 'hunt', dur: 3, asBonus: 0.05, stacks: 5 });
      if (hero.empowered) {
        hero.empowered = false;
        game.damage(hero, target, 100 + hero.level * 16 + hero.stats.atk * 0.5, 'phys');
        game.fx.burst(target.x, 1.2, target.z, 0x9cff9c, 12);
      }
    },
  },
};

export const HERO_LIST = Object.values(HEROES);

export const FLASH = { name: '闪现', icon: '✦', cd: 60, aim: { type: 'dir', range: 6, width: 1 } };
export const RECALL = { name: '回城', icon: '🏠', cd: 0 };

export function pickEnemyHero(playerId) {
  const opts = HERO_LIST.filter((h) => h.id !== playerId);
  return opts[Math.floor(Math.random() * opts.length)].id;
}
export { RED };
