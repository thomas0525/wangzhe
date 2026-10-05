#!/usr/bin/env bash
# 一键生成宣传视频（竖版小红书 + 横版 B 站）和封面
# 依赖：node、uv、网络（首次需 npm i 和生成解说）。
# 用法：bash tools/video/build.sh            # 第一条：AI 生成王者
#       VIDEO=duo bash tools/video/build.sh  # 第二条：双人联机
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
OUT="$ROOT/video-out"
mkdir -p "$OUT"
[ -d node_modules ] || npm i --silent
if [ "${VIDEO:-}" = duo ]; then
  PAGE="--page=tools/video/duo.html"; NARR="duo/narration"; PREFIX="峡谷对决-双人联机"; TAG="duo-"
else
  PAGE=""; NARR="narration"; PREFIX="峡谷对决-宣传"; TAG=""
fi
[ -f "$NARR/durations.json" ] || { echo "缺少 $NARR/durations.json，先生成解说"; exit 1; }
FF="$(node -e "console.log(require('ffmpeg-static'))")"
PORT=8799
python3 -m http.server $PORT --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
URL="http://localhost:$PORT/"

for L in ${LAYOUTS:-v h}; do  # LAYOUTS=h 只生成横版
  FR="frames-$TAG$L"
  mkdir -p "$FR"
  node capture.mjs $PAGE --layout=$L --out="$FR" --url="$URL"
  uv run --with numpy python mix.py "$FR/cues.json" "$FF" "$FR/mix.wav" "$NARR"
  NAME=$([ $L = v ] && echo "小红书-竖版-1080x1920" || echo "B站-横版-1920x1080")
  "$FF" -v error -y -framerate 30 -i "$FR/f%05d.jpg" -i "$FR/mix.wav" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -r 30 \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 44100 \
    -movflags +faststart -shortest "$OUT/$PREFIX-$NAME.mp4"
  echo "✓ $OUT/$PREFIX-$NAME.mp4"
done

if [ -z "${SKIP_COVERS:-}" ]; then
node capture.mjs $PAGE --cover=xhs --out="$OUT" --url="$URL"
node capture.mjs $PAGE --cover=bili --layout=h --out="$OUT" --url="$URL"
mv "$OUT/cover-xhs.jpg" "$OUT/${TAG:+双人联机-}小红书封面-1080x1440.jpg"
mv "$OUT/cover-bili.jpg" "$OUT/${TAG:+双人联机-}B站封面-1920x1080.jpg"
fi
ls -la "$OUT"
