#!/usr/bin/env bash
# 用 Edge TTS 生成宣传视频解说（男声），输出到 tools/video/narration/
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p narration
VOICE="${VOICE:-zh-CN-YunxiNeural}"
while IFS='|' read -r name text; do
  [ -z "$name" ] && continue
  uvx edge-tts --voice "$VOICE" --rate=+12% --text "$text" --write-media "narration/$name.mp3" >/dev/null 2>&1
  echo "$name ok"
done < narration.txt
