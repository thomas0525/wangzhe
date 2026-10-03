# 峡谷对决 3D

浏览器里的 3D 1v1 MOBA 小游戏，玩法参考王者荣耀的单挑模式：单人对战电脑，推掉敌方水晶即获胜。手机和电脑都能玩。

**在线试玩：** https://thomas0525.github.io/wangzhe/

## 玩法

- 一条对角线兵线，每方有外塔、高地塔、水晶，必须按顺序摧毁
- 每 26 秒刷一波小兵，每第 3 波带炮车；6 分钟后兵线变强
- 补刀拿金币，升级解锁技能（2 级解锁二技能、4 级解锁大招），最高 15 级
- 商店随时可以买装备，配件可以合成大件；左侧会弹出推荐出装，一键购买
- 草丛可以隐身；左上野区 1:30 刷新“峡谷巨兽”，击败后获得 90 秒增益
- 三个原创英雄：影刃（战士）、星澜（法师）、鸣镝（射手）
- 三档电脑难度：简单 / 普通 / 困难
- 播报员语音（微软 Edge TTS 生成）：全军出击、第一滴血、双杀……、防御塔被摧毁、胜利 / 失败等，暂停菜单可以关闭

## 操作

| | 手机 | 电脑 |
|---|---|---|
| 移动 | 左侧虚拟摇杆 | WASD / 方向键 |
| 普攻 | 右下攻击键（长按连续攻击） | 空格 / J |
| 技能 | 点按自动释放；拖动手动瞄准；拖到“取消施法”取消 | Q / E / R（按住后朝鼠标方向瞄准，松开释放） |
| 闪现 / 回城 | 按钮 | F / B |
| 商店 | 左侧金币按钮 | P |

建议手机横屏游玩。

## 本地运行

没有构建步骤，纯静态文件（Three.js 已放在 `vendor/` 目录）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 语音播报

语音是用 [edge-tts](https://github.com/rany2/edge-tts) 离线生成的 mp3，放在 `audio/voice/`，音色为 `zh-CN-YunjianNeural`。修改台词或换音色后重新生成：

```bash
bash tools/gen-voice.sh                      # 需要 uv 和网络
VOICE=zh-CN-YunxiNeural bash tools/gen-voice.sh   # 换音色
```

调试参数：`?autoplay&speed=8` 让电脑同时控制双方，并以 8 倍速运行；`?start&hero=mage&enemy=blade&diff=hard` 跳过菜单直接开局。

## 代码结构

```
index.html / style.css   页面与 HUD 布局
js/main.js     菜单、英雄预览、开局与结算
js/game.js     主循环、伤害与击杀结算、刷兵、防御塔、摄像机
js/units.js    英雄 / 小兵 / 防御塔 / 水晶 / 野怪
js/heroes.js   英雄数据与技能实现
js/ai.js       电脑英雄 AI（补刀、换血、推塔、撤退回城、躲技能）
js/input.js    虚拟摇杆、技能拖拽瞄准、键鼠
js/ui.js       血条、飘字、小地图、商店
js/map.js      地图场景与可行走区域
js/models.js   低多边形模型（全部由几何体拼成）
js/fx.js       技能特效与施法指示器
js/audio.js    WebAudio 合成音效 + 播报语音队列
audio/voice/   Edge TTS 生成的播报语音
tools/gen-voice.sh  语音生成脚本
```

---

同人风格小游戏，角色、模型、音效都是原创，语音由 Edge TTS 合成，与腾讯《王者荣耀》没有任何关联。
