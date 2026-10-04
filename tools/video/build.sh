#!/usr/bin/env bash
# 一键生成宣传视频（竖版小红书 + 横版 B 站）和封面
# 依赖：node、uv、网络（首次需 npm i 和生成解说）。用法：bash tools/video/build.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
OUT="$ROOT/video-out"
mkdir -p "$OUT"
[ -d node_modules ] || npm i --silent
[ -f narration/durations.json ] || { echo "先运行 bash gen-narration.sh 并生成 durations.json"; exit 1; }
FF="$(node -e "console.log(require('ffmpeg-static'))")"
PORT=8799
python3 -m http.server $PORT --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
URL="http://localhost:$PORT/"

for L in v h; do
  FR="frames-$L"
  mkdir -p "$FR"
  node capture.mjs --layout=$L --out="$FR" --url="$URL"
  uv run --with numpy python mix.py "$FR/cues.json" "$FF" "$FR/mix.wav"
  NAME=$([ $L = v ] && echo "小红书-竖版-1080x1920" || echo "B站-横版-1920x1080")
  "$FF" -v error -y -framerate 30 -i "$FR/f%05d.jpg" -i "$FR/mix.wav" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -r 30 \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 44100 \
    -movflags +faststart -shortest "$OUT/峡谷对决-宣传-$NAME.mp4"
  echo "✓ $OUT/峡谷对决-宣传-$NAME.mp4"
done

node capture.mjs --cover=xhs --out="$OUT" --url="$URL"
node capture.mjs --cover=bili --layout=h --out="$OUT" --url="$URL"
mv "$OUT/cover-xhs.jpg" "$OUT/小红书封面-1080x1440.jpg"
mv "$OUT/cover-bili.jpg" "$OUT/B站封面-1920x1080.jpg"
ls -la "$OUT"
