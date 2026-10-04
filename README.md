# 峡谷对决 3D

浏览器里的 3D 1v1 MOBA 小游戏，玩法参考王者荣耀的单挑模式：可以单人对战电脑，也可以和好友双人对战，推掉敌方水晶即获胜。手机和电脑都能玩。

**在线试玩：** https://thomas0525.github.io/wangzhe/ （单人 + 双人）· https://wangzhe-production.up.railway.app/ （服务器直连）

## 玩法

- 一条对角线兵线，每方有外塔、高地塔、水晶，必须按顺序摧毁
- 每 26 秒刷一波小兵，每第 3 波带炮车；6 分钟后兵线变强
- 补刀拿金币，升级解锁技能（2 级解锁二技能、4 级解锁大招），最高 15 级
- 商店随时可以买装备，配件可以合成大件；左侧会弹出推荐出装，一键购买
- 草丛可以隐身；双方野区各有红蓝 buff（红：普攻灼烧减速；蓝：冷却缩减 20%）；中间左上野区 1:30 刷新“峡谷巨兽”，击败后伤害提升
- 三个原创英雄：影刃（战士）、星澜（法师）、鸣镝（射手）
- 三档电脑难度：简单 / 普通 / 困难
- 播报员语音（微软 Edge TTS 生成）：全军出击、第一滴血、双杀……、防御塔被摧毁、胜利 / 失败等，暂停菜单可以关闭

## 双人对战

- 主菜单选「双人对战」→「新建房间」得到 4 位房间号，或输入房间号「加入房间」
- 「复制邀请」会生成带房间号的链接，好友点开直接进房
- 双方选英雄、点「准备」，3 秒倒计时后开局；建房的人是蓝方，加入的人是红方
- 红方的镜头、摇杆方向和小地图都会旋转 180°，双方都是“自己的基地在左下角”
- 对局中可以发快捷消息（右上角 💬），右上角显示网络延迟
- 断线 30 秒内重新打开页面会自动回到对局；超过 30 秒判负。结算后可以回到房间再来一局

### 架构

服务器权威：对局逻辑（`js/sim.js`）在服务器上以 30Hz 运行，客户端只发送操作、接收局面快照并渲染。自己的英雄做了移动预测，网络有延迟时操作也跟手。单人模式在浏览器里运行同一套逻辑，走同样的快照和渲染流程。

```
js/sim.js       对局规则与主循环（无 DOM / three.js，浏览器和服务器共用）
js/snapshot.js  按队伍生成局面快照（草丛里的敌人不会发给对方）
js/world.js     客户端：快照 → 单位副本（插值、动画）
js/view.js      客户端：3D 渲染、镜头（红方翻转）
js/client.js    LocalGame（单人）/ NetGame（双人，含移动预测）
js/net.js       WebSocket 连接、自动重连
server/         Node 服务器：静态文件 + /ws 房间与对局
```

### 部署（Railway）

```bash
npm install
npm start                      # 本地运行，打开 http://localhost:8080
railway up                     # 部署到已关联的 Railway 项目
```

`railway.json` 指定了新加坡区域、单副本（房间数据在内存里，不能多副本）、关闭休眠和健康检查 `/healthz`。GitHub Pages 版本通过 `js/config.js` 里的 `SERVER_ORIGIN` 连接 Railway 服务器。

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

语音是用 [edge-tts](https://github.com/rany2/edge-tts) 离线生成的 mp3，放在 `audio/voice/`，音色为卡通风女声 `zh-CN-XiaoyiNeural`（晓伊）。修改台词或换音色后重新生成：

```bash
bash tools/gen-voice.sh                      # 需要 uv 和网络
VOICE=zh-CN-XiaoxiaoNeural bash tools/gen-voice.sh   # 换音色（如更沉稳的晓晓）
```

调试参数：`?autoplay&speed=8` 让电脑同时控制双方，并以 8 倍速运行；`?start&hero=mage&enemy=blade&diff=hard` 跳过菜单直接开局。

## 宣传视频

`tools/video/` 用游戏本身摆拍并录制 60 秒宣传视频（竖版 1080×1920、横版 1920×1080）和封面：

- `director.js`：分镜脚本（中路对线、防御塔、推塔、红蓝 buff、大招、草丛伏击、峡谷巨兽、回城、推水晶）
- `capture.mjs`：接管页面时钟逐帧推进并截图，保证 30fps 匀速
- `mix.py`：程序生成背景音乐 + 游戏音效 + 播报 + 解说（Edge TTS `zh-CN-YunxiNeural`），解说时自动压低音乐
- `build.sh`：一键生成，输出到 `video-out/`

```bash
cd tools/video && npm i && bash gen-narration.sh   # 首次：安装依赖、生成解说
bash build.sh
```

## 代码结构

```
index.html / style.css   页面与 HUD 布局
js/main.js     菜单、英雄预览、双人房间、开局与结算
js/units.js    英雄 / 小兵 / 防御塔 / 水晶 / 野怪（纯逻辑）
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
