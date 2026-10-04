// 双人对战的网络连接：自动重连（凭房间号 + 凭证回到原座位）、延迟测量
import { SERVER_ORIGIN } from './config.js';

export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  // GitHub Pages 只能放静态文件，双人对战连接 Railway 服务器；其他情况（Railway、本地）连页面所在的服务器
  if (SERVER_ORIGIN && location.hostname.endsWith('github.io')) return SERVER_ORIGIN.replace(/^http/, 'ws') + '/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

const SESSION_KEY = 'xgdj.session';
export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && Date.now() - s.at < 5 * 60 * 1000 ? s : null;
  } catch { return null; }
}
function saveSession(s) { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, at: Date.now() })) : localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export class NetClient {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.rtt = 0;
    this.connected = false;
    this.session = null;
    this.queue = [];
    this.closed = false;
    this.retry = 0;
    this.connect();
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }, true), 2000);
  }

  connect() {
    const ws = new WebSocket(serverUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      if (this.session) ws.send(JSON.stringify({ t: 'rejoin', code: this.session.code, token: this.session.token }));
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      this.send({ t: 'ping', c: performance.now() }, true);
      this.onStatus?.('open');
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') {
        const r = performance.now() - m.c;
        this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
        return;
      }
      if (m.t === 'room') {
        this.session = { code: m.code, token: m.token, seat: m.seat };
        saveSession(this.session);
      }
      if (m.t === 'err' && m.gone) { this.session = null; saveSession(null); }
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.closed) return;
      this.onStatus?.('lost');
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closed) this.connect(); }, delay);
    };
  }

  send(m, volatile = false) {
    const s = JSON.stringify(m);
    if (this.connected && this.ws.readyState === 1) this.ws.send(s);
    else if (!volatile && m.t !== 'in') this.queue.push(s);
  }

  rejoin(session) {
    this.session = session;
    if (this.connected) this.ws.send(JSON.stringify({ t: 'rejoin', code: session.code, token: session.token }));
  }

  leave() {
    this.send({ t: 'leave' });
    this.session = null;
    saveSession(null);
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch { /* ignore */ }
  }
}
