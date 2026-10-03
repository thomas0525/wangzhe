#!/usr/bin/env bash
# 用微软 Edge TTS 生成游戏播报语音（需要联网，依赖 uv）
# 用法：bash tools/gen-voice.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=audio/voice
mkdir -p "$OUT"
VOICE="${VOICE:-zh-CN-XiaoxiaoNeural}"
RATE="${RATE:-+8%}"
PITCH="${PITCH:-+0Hz}"

# 文件名|播报文本
LINES='
welcome|欢迎来到峡谷对决！
countdown|距离小兵出击，还有五秒！
wave|全军出击！
first_blood|第一滴血！
double_kill|双杀！
triple_kill|大杀特杀！
quadra_kill|主宰比赛！
penta_kill|无人能挡！
rampage|横扫千军！
legendary|天下无双！
kill|击败敌方英雄！
killed|你被击败了。
executed|你被处决了。
ally_tower|我方防御塔已被摧毁！
enemy_tower|摧毁敌方防御塔！
crystal_attack|我方水晶正在遭受攻击！
tyrant_spawn|峡谷巨兽已出现！
tyrant_ally|我方击败了峡谷巨兽！
tyrant_enemy|敌方击败了峡谷巨兽！
victory|胜利！
defeat|失败！
'

echo "$LINES" | while IFS='|' read -r name text; do
  [ -z "$name" ] && continue
  echo "生成 $name: $text"
  uvx edge-tts --voice "$VOICE" --rate="$RATE" --pitch="$PITCH" --text "$text" --write-media "$OUT/$name.mp3" >/dev/null 2>&1
done
ls -la "$OUT"
