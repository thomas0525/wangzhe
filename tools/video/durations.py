"""测量 mp3 中有声部分的起止时间，输出 JSON。用法：uv run --with numpy python durations.py <ffmpeg> <目录>"""
import subprocess, sys, json, numpy as np, glob, os
ff = sys.argv[1]; d = sys.argv[2]
out = {}
for f in sorted(glob.glob(d + '/*.mp3')):
    raw = subprocess.run([ff, '-v', 'quiet', '-i', f, '-f', 's16le', '-ac', '1', '-ar', '24000', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    nz = np.nonzero(np.abs(a) > 0.01)[0]
    out[os.path.basename(f)[:-4]] = {'start': round(nz[0] / 24000, 3), 'end': round(nz[-1] / 24000, 3), 'total': round(len(a) / 24000, 3)}
print(json.dumps(out, ensure_ascii=False, indent=0))
