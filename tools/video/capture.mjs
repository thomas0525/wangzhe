// 逐帧录制宣传视频画面（虚拟时钟，保证 30fps 匀速，不受渲染速度影响）
// 用法：node capture.mjs --layout=v|h --out=DIR [--fps=30] [--every=1] [--url=http://localhost:8765/]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const layout = args.layout || 'v';
const fps = Number(args.fps || 30);
const every = Number(args.every || 1);
const out = args.out || `frames-${layout}`;
const base = args.url || 'http://localhost:8765/';
const cover = args.cover; // xhs | bili
const [w, h] = cover === 'xhs' ? [540, 720] : layout === 'v' ? [540, 960] : [960, 540];
fs.mkdirSync(out, { recursive: true });

// 在页面脚本运行前接管时间：performance.now / Date.now / setTimeout / rAF / CSS 动画
function shim() {
  let vnow = 0;
  const base = Date.now();
  const timers = new Map();
  let tid = 1;
  let rafs = [];
  let rid = 1;
  performance.now = () => vnow;
  Date.now = () => base + vnow;
  window.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.set(id, { t: vnow + (Number(ms) || 0), fn: () => (typeof fn === 'function' ? fn(...a) : null) }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (fn, ms = 0) => {
    const id = tid++;
    const tick = () => { timers.set(id, { t: vnow + ms, fn: tick }); fn(); };
    timers.set(id, { t: vnow + ms, fn: tick });
    return id;
  };
  window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (cb) => { const id = rid++; rafs.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r.id !== id); };
  const animStart = new WeakMap();
  window.__vt = {
    now: () => vnow,
    advance(ms) {
      const target = vnow + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of timers) if (t.t <= target && (!best || t.t < best[1].t)) best = [id, t];
        if (!best) break;
        timers.delete(best[0]);
        vnow = Math.max(vnow, best[1].t);
        try { best[1].fn(); } catch (e) { console.error(e); }
      }
      vnow = target;
      window.__director?.frame(vnow);
      const cbs = rafs;
      rafs = [];
      for (const r of cbs) { try { r.cb(vnow); } catch (e) { console.error(e); } }
      for (const a of document.getAnimations()) {
        if (!animStart.has(a)) { animStart.set(a, vnow); a.pause(); }
        a.currentTime = vnow - animStart.get(a);
      }
    },
  };
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.addInitScript(shim);
const lay = cover === 'xhs' ? 'v' : layout;
// --page=tools/video/duo.html 录制双人联机视频；默认录制游戏页面本身
await page.goto(args.page ? `${base}${args.page}?layout=${lay}${cover ? '&cover=' + cover : ''}${args.cut ? '&cut=' + args.cut : ''}` : `${base}?capture&layout=${lay}${cover ? '&cover=' + cover : ''}`);
// 等待就绪（期间推进虚拟时钟，页面里的 setTimeout 才会执行）
while (!(await page.evaluate(() => { window.__vt.advance(16); return !!window.__director?.ready; }))) await new Promise((r) => setTimeout(r, 50));
// 预热：让菜单和资源先跑几帧
for (let i = 0; i < 5; i++) await page.evaluate(() => window.__vt.advance(33));
const total = await page.evaluate(() => { window.__director.begin(window.__vt.now()); return window.__director.total; });
const N = cover ? 48 : Math.round(total * fps);
const cdp = await page.context().newCDPSession(page);
// 必须带 clip.scale，否则 CDP 只按 CSS 像素输出，丢掉 2 倍清晰度
const shot = (quality) => cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: w, height: h, scale: 2 } });
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await page.evaluate((ms) => window.__vt.advance(ms), 1000 / fps);
  if (!cover && f % every === 0) {
    const { data } = await shot(92);
    fs.writeFileSync(path.join(out, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
  }
  if (f % 150 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (cover) {
  const { data } = await shot(95);
  fs.writeFileSync(path.join(out, `cover-${cover}.jpg`), Buffer.from(data, 'base64'));
  console.log('cover saved');
  await browser.close();
  process.exit(0);
}
const cues = await page.evaluate(() => window.__director.cues);
fs.writeFileSync(path.join(out, 'cues.json'), JSON.stringify({ fps, total, cues }, null, 1));
console.log('done', N, 'frames, cues:', cues.length);
await browser.close();
