// 商店规则（网页和服务器共用）：配件抵扣、能否购买、推荐出装
import { ITEM_BY_ID } from './config.js';

export function componentsOwned(items, id) {
  const it = ITEM_BY_ID[id];
  const pool = [...items];
  const used = [];
  for (const c of it.from || []) {
    const i = pool.indexOf(c);
    if (i >= 0) { used.push(c); pool.splice(i, 1); }
  }
  return used;
}

export function priceOf(items, id) {
  return ITEM_BY_ID[id].cost - componentsOwned(items, id).reduce((a, c) => a + ITEM_BY_ID[c].cost, 0);
}

export function canBuy(items, gold, id) {
  if (!ITEM_BY_ID[id]) return false;
  const used = componentsOwned(items, id);
  return items.length - used.length < 6 && gold >= priceOf(items, id);
}

// 推荐购买：下一件核心装备；买不起整件时先推荐配件
export function nextBuild(build, items, gold) {
  for (const id of build) {
    if (items.includes(id)) continue;
    const it = ITEM_BY_ID[id];
    if (gold >= priceOf(items, id) || !it.from) return id;
    const comp = it.from.find((c) => !items.includes(c));
    return comp || id;
  }
  return null;
}
