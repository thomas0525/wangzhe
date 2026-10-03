// 极简合成音效（WebAudio，无音频文件）
let ctx = null;
let master = null;
let muted = false;
const last = {};

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.3, freq = 800, delay = 0) {
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master);
  s.start(t0);
}

const SOUNDS = {
  hit: () => noise(0.08, 0.25, 2500),
  shoot: () => tone(900, 0.12, 'triangle', 0.12, 0.4),
  dash: () => noise(0.2, 0.25, 1200),
  spin: () => { for (let i = 0; i < 4; i++) noise(0.1, 0.15, 1800, i * 0.4); },
  boom: () => { noise(0.45, 0.5, 400); tone(90, 0.4, 'sine', 0.4, 0.5); },
  ice: () => { tone(1400, 0.25, 'sine', 0.15, 0.6); noise(0.2, 0.2, 4000); },
  level: () => { tone(523, 0.12, 'triangle', 0.2); tone(784, 0.2, 'triangle', 0.2, 0, 0.1); },
  buy: () => { tone(1200, 0.08, 'square', 0.08); tone(1600, 0.1, 'square', 0.08, 0, 0.07); },
  flash: () => tone(1800, 0.18, 'sine', 0.15, 0.3),
  recall: () => tone(400, 0.6, 'sine', 0.12, 2),
  tower: () => tone(220, 0.25, 'sawtooth', 0.12, 0.6),
  kill: () => { tone(660, 0.12, 'square', 0.15); tone(990, 0.25, 'square', 0.15, 0, 0.12); },
  death: () => tone(300, 0.6, 'sawtooth', 0.15, 0.3),
  destroy: () => { noise(0.8, 0.5, 300); tone(70, 0.8, 'sine', 0.5, 0.4); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.2, 0, i * 0.15)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.2, 0, i * 0.2)),
};

export function sfx(name) {
  if (!ctx || muted || !SOUNDS[name]) return;
  const now = performance.now();
  if (last[name] && now - last[name] < 50) return;
  last[name] = now;
  try { SOUNDS[name](); } catch { /* ignore */ }
}

// ---------- 播报语音（Edge TTS 预生成的 mp3，见 tools/gen-voice.sh） ----------
const VOICE_NAMES = [
  'welcome', 'countdown', 'wave', 'first_blood', 'double_kill', 'triple_kill', 'quadra_kill', 'penta_kill',
  'rampage', 'legendary', 'kill', 'killed', 'executed', 'ally_tower', 'enemy_tower', 'crystal_attack',
  'tyrant_spawn', 'tyrant_ally', 'tyrant_enemy', 'victory', 'defeat',
];
const voices = {};
let voiceOut = null;
let voiceOn = true;
let voiceQueue = [];
let voiceBusy = false;
let voiceSrc = null;
let voiceSeq = 0;

export function setVoiceOn(v) {
  voiceOn = v;
  if (!v) { voiceQueue = []; try { voiceSrc?.stop(); } catch { /* ignore */ } }
}
export function isVoiceOn() { return voiceOn; }

// 结尾静音裁掉，连续播报更紧凑
function trimEnd(buf) {
  const d = buf.getChannelData(0);
  let i = d.length - 1;
  while (i > 0 && Math.abs(d[i]) < 0.01) i--;
  return Math.min(buf.duration, i / buf.sampleRate + 0.12);
}

export function loadVoices(base = 'audio/voice/') {
  if (!ctx || voiceOut) return;
  voiceOut = ctx.createGain();
  voiceOut.gain.value = 1;
  voiceOut.connect(ctx.destination);
  for (const name of VOICE_NAMES) {
    voices[name] = fetch(base + name + '.mp3')
      .then((r) => r.arrayBuffer())
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => ({ buf, dur: trimEnd(buf) }))
      .catch(() => null);
  }
}

function playNextVoice() {
  if (voiceBusy || !voiceQueue.length) return;
  const item = voiceQueue.shift();
  if (performance.now() - item.at > 4000) return playNextVoice(); // 太旧的播报直接丢弃
  voiceBusy = true;
  const seq = ++voiceSeq;
  Promise.resolve(voices[item.name]).then((v) => {
    if (seq !== voiceSeq) return;
    if (!v || muted || !voiceOn) { voiceBusy = false; return playNextVoice(); }
    const s = ctx.createBufferSource();
    s.buffer = v.buf;
    s.connect(voiceOut);
    s.start();
    voiceSrc = s;
    setTimeout(() => { if (seq !== voiceSeq) return; voiceBusy = false; playNextVoice(); }, v.dur * 1000);
  });
}

// urgent：清空队列、打断当前播报（用于胜利/失败）
export function voice(name, urgent = false) {
  if (!ctx || muted || !voiceOn || !voices[name]) return;
  if (urgent) {
    voiceQueue = [];
    try { voiceSrc?.stop(); } catch { /* ignore */ }
    voiceSeq++;
    voiceBusy = false;
  }
  if (voiceQueue.length >= 2) voiceQueue.shift();
  voiceQueue.push({ name, at: performance.now() });
  playNextVoice();
}
