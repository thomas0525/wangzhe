"""合成宣传视频音轨：背景音乐（程序生成）+ 游戏音效 + 播报员语音 + 解说，解说时自动压低背景音乐。

用法：uv run --with numpy python mix.py <cues.json> <ffmpeg> <out.wav> [解说目录]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
rng = np.random.default_rng(7)


def decode(ff, path):
    raw = subprocess.run([ff, '-v', 'quiet', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def add(buf, sig, t, gain=1.0):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * gain


def env(n, attack=0.002, decay=0.2):
    t = np.arange(n) / SR
    e = np.exp(-t / max(decay, 1e-4))
    a = int(attack * SR)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def osc(freq, dur, kind='sine', slide=1.0):
    n = int(dur * SR)
    f = freq * np.power(slide, np.linspace(0, 1, n)) if slide != 1 else np.full(n, freq)
    ph = np.cumsum(f) / SR
    if kind == 'sine':
        return np.sin(2 * np.pi * ph)
    if kind == 'square':
        return np.sign(np.sin(2 * np.pi * ph))
    if kind == 'saw':
        return 2 * (ph % 1) - 1
    if kind == 'tri':
        return 2 * np.abs(2 * (ph % 1) - 1) - 1
    raise ValueError(kind)


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR)).astype(np.float32)


# ---------- 游戏音效（与 js/audio.js 对应） ----------
def tone(freq, dur, kind='sine', vol=0.3, slide=1.0, delay=0.0):
    s = osc(freq, dur, kind, slide) * env(int(dur * SR), 0.003, dur / 4) * vol
    return np.concatenate([np.zeros(int(delay * SR)), s])


def nz(dur, vol=0.3, cutoff=800, delay=0.0):
    s = noise(dur) * np.linspace(1, 0, int(dur * SR))
    s = lowpass(s, cutoff) * vol * (1 + 2000 / max(cutoff, 200))
    return np.concatenate([np.zeros(int(delay * SR)), s])


def mixl(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n, dtype=np.float32)
    for p in parts:
        out[:len(p)] += p
    return out


SFX = {
    'hit': lambda: nz(0.08, 0.25, 2500),
    'shoot': lambda: tone(900, 0.12, 'tri', 0.12, 0.4),
    'dash': lambda: nz(0.2, 0.3, 1200),
    'spin': lambda: mixl(*[nz(0.1, 0.18, 1800, i * 0.4) for i in range(4)]),
    'boom': lambda: mixl(nz(0.5, 0.6, 400), tone(90, 0.45, 'sine', 0.6, 0.5)),
    'ice': lambda: mixl(tone(1400, 0.25, 'sine', 0.15, 0.6), nz(0.2, 0.2, 4000)),
    'level': lambda: mixl(tone(523, 0.12, 'tri', 0.2), tone(784, 0.2, 'tri', 0.2, 1, 0.1)),
    'buy': lambda: mixl(tone(1200, 0.08, 'square', 0.08), tone(1600, 0.1, 'square', 0.08, 1, 0.07)),
    'flash': lambda: tone(1800, 0.18, 'sine', 0.18, 0.3),
    'recall': lambda: tone(400, 0.6, 'sine', 0.14, 2),
    'tower': lambda: tone(220, 0.25, 'saw', 0.12, 0.6),
    'kill': lambda: mixl(tone(660, 0.12, 'square', 0.15), tone(990, 0.25, 'square', 0.15, 1, 0.12)),
    'death': lambda: tone(300, 0.6, 'saw', 0.15, 0.3),
    'destroy': lambda: mixl(nz(0.9, 0.7, 300), tone(70, 0.8, 'sine', 0.6, 0.4)),
    'win': lambda: mixl(*[tone(f, 0.3, 'tri', 0.2, 1, i * 0.15) for i, f in enumerate([523, 659, 784, 1046])]),
    'lose': lambda: mixl(*[tone(f, 0.4, 'tri', 0.2, 1, i * 0.2) for i, f in enumerate([392, 330, 262])]),
}


# ---------- 背景音乐：128 BPM 电子节拍，Am - F - C - G ----------
def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def bgm(total, menu_span):
    n = int(total * SR)
    L = np.zeros(n, dtype=np.float32)
    bpm = 128
    beat = 60 / bpm
    bar = beat * 4
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
    kick = osc(150, 0.35, 'sine', 50 / 150) * env(int(0.35 * SR), 0.001, 0.12)
    clap = lowpass(noise(0.18), 3000) * env(int(0.18 * SR), 0.001, 0.05) * 2.2
    hat = (noise(0.05) - lowpass(noise(0.05), 6000)) * env(int(0.05 * SR), 0.0005, 0.012)
    ohat = (noise(0.18) - lowpass(noise(0.18), 6000)) * env(int(0.18 * SR), 0.0005, 0.05)
    t = 0.0
    bi = 0
    while t < total:
        ch = chords[bi % 4]
        in_menu = menu_span[0] <= t < menu_span[1]
        outro = t > total - 6
        for b in range(4):
            tb = t + b * beat
            if not in_menu:
                add(L, kick, tb, 0.9)
            if b in (1, 3):
                add(L, clap, tb, 0.35)
            for e8 in range(2):
                add(L, hat, tb + e8 * beat / 2, 0.18 if not in_menu else 0.1)
            add(L, ohat, tb + beat / 2, 0.08)
            # 贝斯：八分音符根音
            for e8 in range(2):
                f = midi(ch[0] - 24)
                d = beat / 2 * 0.9
                s = lowpass(osc(f, d, 'saw'), 500 if in_menu else 900) * env(int(d * SR), 0.004, 0.12)
                add(L, s, tb + e8 * beat / 2, 0.35)
            # 和弦切音：反拍
            d = beat * 0.45
            stab = np.zeros(int(d * SR), dtype=np.float32)
            for note in ch:
                for det in (-0.08, 0.0, 0.08):
                    stab += osc(midi(note + 12) * 2 ** (det / 12), d, 'saw')
            stab = lowpass(stab / 9, 1800 if not in_menu else 1100) * env(len(stab), 0.003, 0.09)
            add(L, stab, tb + beat / 2, 0.32)
        # 琶音：十六分音符（菜单段和结尾段更安静）
        arp = [ch[0] + 24, ch[1] + 24, ch[2] + 24, ch[1] + 24]
        for k in range(16):
            tk = t + k * beat / 4
            d = beat / 4 * 0.8
            s = osc(midi(arp[k % 4]), d, 'square') * env(int(d * SR), 0.002, 0.05)
            add(L, lowpass(s, 2500), tk, 0.05 if (in_menu or outro) else 0.08)
        t += bar
        bi += 1
    # 开场冲击 + 结尾淡出
    hitn = int(1.2 * SR)
    impact = lowpass(noise(1.2), 1500) * env(hitn, 0.001, 0.35) * 1.5 + osc(55, 1.2, 'sine', 0.6) * env(hitn, 0.001, 0.4)
    add(L, impact, 0.0, 0.8)
    fade = int(1.5 * SR)
    L[-fade:] *= np.linspace(1, 0, fade)
    return L


def whoosh():
    d = 0.35
    s = noise(d)
    out = np.zeros_like(s)
    seg = int(0.01 * SR)
    for i in range(0, len(s), seg):
        cut = 300 + 6000 * (i / len(s))
        out[i:i + seg] = lowpass(s[i:i + seg], cut)
    return out * np.sin(np.linspace(0, np.pi, len(s))) * 2.5


def main():
    cues_path, ff, out = sys.argv[1], sys.argv[2], sys.argv[3]
    data = json.loads(Path(cues_path).read_text())
    total = data['total']
    cues = data['cues']
    narr_dir = Path(sys.argv[4]) if len(sys.argv) > 4 else HERE / 'narration'
    narr_d = json.loads((narr_dir / 'durations.json').read_text())
    menu = next(((c['t'], c['t'] + 3.7) for c in cues if c['type'] == 'cut' and c['name'] == 1), (5.5, 9.2))

    n = int(total * SR)
    voice = np.zeros(n, dtype=np.float32)
    sfx = np.zeros(n, dtype=np.float32)
    duck = np.zeros(n, dtype=np.float32)
    cache = {}

    def clip(kind, name):
        key = (kind, name)
        if key not in cache:
            p = (narr_dir / f'{name}.mp3') if kind == 'narr' else (ROOT / 'audio' / 'voice' / f'{name}.mp3')
            cache[key] = decode(ff, p)
        return cache[key]

    busy_until = 0.0
    for c in sorted(cues, key=lambda c: c['t']):
        t = c['t']
        if c['type'] == 'narr':
            s = clip('narr', c['name'])
            add(voice, s, t, 1.0)
            a, b = int(t * SR), int((t + narr_d[c['name']]['end'] + 0.15) * SR)
            duck[a:b] = 1
        elif c['type'] == 'voice':
            s = clip('voice', c['name'])
            t = max(t, busy_until)
            add(voice, s * 1.15, t, 0.95)
            a = int(t * SR)
            duck[a:a + len(s)] = np.maximum(duck[a:a + len(s)], 0.8)
            busy_until = t + len(s) / SR * 0.8
        elif c['type'] == 'sfx' and c['name'] in SFX:
            add(sfx, SFX[c['name']](), t, 1.0)
        elif c['type'] == 'cut':
            add(sfx, whoosh(), t - 0.12, 0.5)

    # 平滑的压低包络
    k = int(0.12 * SR)
    kern = np.ones(k) / k
    duck = np.convolve(duck, kern, mode='same')
    music = bgm(total, menu)
    music *= 1 - 0.62 * np.clip(duck, 0, 1)

    mix_l = music * 0.55 + sfx * 0.32 + voice * 1.0
    mix_r = mix_l.copy()
    st = np.stack([mix_l, mix_r], axis=1)
    peak = np.max(np.abs(st)) or 1
    st = st / peak * 0.89
    pcm = (st * 32767).astype(np.int16)
    import wave
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', out, f'{total:.1f}s', 'cues', len(cues))


if __name__ == '__main__':
    main()
