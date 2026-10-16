# WorkBuddy Dream Skin

给 WorkBuddy 换一张自己的脸。所有动作都发生在应用外面，官方安装包一个字节不改。

工具现在有两条路。老路走本机调试端口，把样式注入到正在运行的应用里；新路安静得多，把「一张壁纸加一套配色」编译成官方格式的皮肤，交给 WorkBuddy 自己的皮肤引擎去渲染。

> 这不是 WorkBuddy 官方产品。它不改 .app、app.asar 或 Windows 安装目录，也不会动你的代码签名和 API 配置。

## 为什么会有这个项目

WorkBuddy 自带浅色和深色，官方的「外观」皮肤中心是后来才有的事，而且里面只有官方上架的那几套。想拿自己的图铺满整窗、让自己的配色浮在原生界面之上，一直没有入口。最直接的做法是改 app.asar，可那会动到代码签名，每次官方更新都要重来，环境也弄脏了。

项目一开始选了绕开安装包的路。它用 Chromium 自带的远程调试端口，把样式脚本注入正在运行的渲染进程。官方文件一个字节不动，想回去了，停掉注入、重启应用就行。代价是注入期间本机开着个调试端口，这个端口怎么看待，下面「注入版的原理与安全边界」里单独说。

后来官方上了皮肤中心，我们又顺着它的本机缓存机制开出第二条路，见下面「官方管线版」一节。

## 这个皮肤能做什么

- 换完还是原生界面。侧栏、对话区、输入框都能正常点、正常输入，跟拿一张整窗截图糊上去的假换肤是两回事。
- 一张 16×9 的壁纸连续铺满整窗。停在首页时氛围足一些，进任务干活时自动把干扰压下去。
- 换图之前先在本机用 Canvas 把图片主色算出来，改写界面的强调色，再给面板加一层半透明磨砂，原生界面就浮在壁纸上。
- 菜单栏和系统托盘里能保存、切换本地主题，也能随时导入一张自己的背景图。
- 随时能还原。停掉注入、重启 WorkBuddy，界面回到出厂状态。
- 应用、暂停、切换的时候窗口里会弹一层提示，成功还是失败一眼看到，不用干等。

## 注入版的原理与安全边界

注入版的机制不复杂，分四步。

第一步，用 `--remote-debugging-port` 重启 WorkBuddy。端口只绑在 `127.0.0.1`，也就是本机回环地址，外网连不进来。

第二步，Node 注入器去读 `/json/list`，拿到渲染进程列表，挑出 `renderer/index.html` 那个页面，通过 WebSocket 连上去，在渲染进程里执行 `Runtime.evaluate`。

第三步，注入的脚本解码背景图、写入 `<style>`、用 Canvas 分析主色、改写 `--vscode-*` 系列变量，再给面板加上磨砂，最后挂一个 MutationObserver 盯着 DOM。应用内部怎么重绘，皮肤都还在。

第四步，还原时停掉注入进程、在渲染器里跑一遍清理，下次重启不带调试端口，界面就回到出厂状态。

有句话得放在前面。CDP 在回环地址上不设认证，同一台机器上的任何程序都能连上它。所以皮肤生效期间，别同时跑来路不明的本机程序；不用了就 Restore，端口一关，这层隐患也就没了。

## 官方管线版（wb-skin）

官方最近在「外观」设置里上了一批皮肤（个性主题），点一下就能换。这些皮肤下载后存在本机，之后每次切回来，程序会先读本机缓存，读到就直接渲染，不再联网下载。wb-skin 走的就是这条现成的通道。

它把一张壁纸和从图里取出的配色，编译成一套官方格式的皮肤文件，装进某套官方皮肤的本机缓存目录里。用哪套官方皮肤来装由你挑，下文把选中的那套叫「载体」，建议挑一套平时不用的，前提是这台机器下载过它。对官方来说，那套皮肤还是原来的名字、原来的封面；在这台机器上，它已经换了张脸。

```bash
cd macos/scripts
# 1) 看本机有哪些已下载的官方皮肤可作载体
node wb-skin.mjs list

# 2) 用一张图铸造自定义皮肤（调色板可从图里自动提取，也可 --accent 指定）
node wb-skin.mjs build --name "我的皮肤" --image ~/Pictures/wall.jpg
#    或者直接用内置预设
node wb-skin.mjs build --name "极光暮色" --slug aurora-dusk --from-preset ../presets/preset-aurora-dusk

# 3) 装到载体（选一个你不常用的官方皮肤位）
node wb-skin.mjs install aurora-dusk --carrier theme-tkboqn
#    之后在 WorkBuddy「设置 → 外观」点一下该皮肤卡片，就能看到自定义外观

# 4) 随时恢复官方原样 / 官方更新后重新注入
node wb-skin.mjs restore --carrier theme-tkboqn
node wb-skin.mjs resync
```

底图的要求不复杂。横构图最合身，长边 2560 起步（2560×1440 或 2560×1600 都行），更大也没问题。照片给 JPG，插画这类要保干净边缘的给 PNG，体积最好不超过 16MB；HEIC、WebP、TIFF 这些不用自己转，构建时会自动转成 JPG。图上别带界面元素、文字或水印，主体也别铺得太满，界面上还要叠按钮和文字。画面默认居中铺满，想挪落点就加 `--focus-x` 和 `--focus-y`（0 到 1）。

机制上的细节，是照着 WorkBuddy 5.8.2 的实现摸出来的。官方皮肤第一次应用时会解包到 `~/.workbuddy/appearance-resources/<皮肤id>-<版本>/skin.v2.css`，之后每次切换都优先读这份本地文件。wb-skin 往这个文件里写两样东西。一样是官方六百多条设计令牌（`--cb-*`、`--wb-*`、`--vscode-*` 这些）按你的配色整套重映射；另一样是 Dream Skin 的老本行，整窗壁纸、磨砂面板、透明化。想回官方原样，`restore` 逐字节还原；官方哪天更新了这套皮肤，缓存目录会换新，跑一条 `resync` 重新装上。

> wb-skin 只写本机的皮肤缓存文件，不碰 .app、app.asar 和签名；载体皮肤的选择会照常同步到你的账号，其他设备上还是官方外观，只有这台机器渲染自定义版。另外，这条路建立在官方现在的缓存逻辑上，将来官方改了实现它可能失效，失效了就回退到注入版。

## 用 AI 一键安装

不想自己敲命令的话，把本仓库的 GitHub 地址发给任意 AI 助手（WorkBuddy、CodeBuddy、Claude、Cursor 都行），再加一句

> 用这个开源项目帮我更换 WorkBuddy 的主题

AI 会克隆仓库、读根目录的 [`SKILL.md`](SKILL.md)，把平台检测、安装、启动、验证一路做完。需要你配合的只有一件事，弹出重启提示时，先把 WorkBuddy 里没保存的工作存一下。之后的日常切换在菜单栏、系统托盘或命令行里做。

> 想指定主题直接说就行，比如「用午夜花开」或者「帮我换成极光暮色」。

## macOS 快速开始

```bash
cd macos
# 1) 安装到 ~/Library/Application Support/WorkBuddyDreamSkinStudio，并生成桌面启动器
./scripts/install-dream-skin-macos.sh --no-launch

# 2) 启动皮肤（会重启一次 WorkBuddy 以开启调试端口）
./scripts/start-dream-skin-macos.sh --prompt-restart

# 3) 或者直接双击桌面上的这几个启动器
#    WorkBuddy Dream Skin.command             应用 / 恢复
#    WorkBuddy Dream Skin - Customize.command 导入自己的背景图
#    WorkBuddy Dream Skin - Verify.command    校验
#    WorkBuddy Dream Skin - Restore.command   还原（重启 WorkBuddy）
```

想要菜单栏入口，先装 [SwiftBar](https://swiftbar.app)，再跑这条命令

```bash
./scripts/install-menubar-macos.sh
# 右上角出现皮肤图标，可应用 / 暂停 / 切换预设 / 导入 / 诊断
```

切换预设用这条命令

```bash
# 已安装预设在 state/themes 下
scripts/switch-theme-macos.sh --id preset-aurora-dusk
```

导入你自己的背景图（横构图，长边 2560 起步，JPG 优先，不超过 16MB，图上别带界面元素、文字或水印）

```bash
scripts/customize-theme-macos.sh --image "/path/to/bg.jpg" --name "My Skin" --accent "#3fd6a6"
```

## Windows 快速开始

```powershell
cd windows\scripts
powershell -ExecutionPolicy Bypass -File .\install-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\start-dream-skin.ps1
# 启动系统托盘（右键图标操作）
powershell -ExecutionPolicy Bypass -File .\tray-dream-skin.ps1
```

桌面会生成「WorkBuddy Dream Skin」快捷方式。

> 如果找不到 WorkBuddy.exe，或者 CDP 端口一直不就绪，先跑排查脚本
> `powershell -ExecutionPolicy Bypass -File .\find-workbuddy.ps1`
> 它会探测应用、Node、端口三要素，并给出对应的处理建议。

## 内置预设

| 预设 | 风格 | 主色 |
|------|------|------|
| `preset-aurora-dusk` | 极光暮色（蓝紫 + 青绿辉光） | `#3fd6a6` |
| `preset-midnight-bloom` | 午夜花开（深蓝 + 玫瑰品红） | `#e05aa0` |
| `preset-ember-zen` | 余烬禅意（暖暗 + 琥珀橙） | `#f0a050` |

三套预设的背景图都由 `macos/scripts/gen_presets.py` 程序化生成，没有用任何第三方素材。

## 自定义旋钮（theme.json）

```jsonc
{
  "appearance": "auto",          // auto | light | dark（auto 跟随 WorkBuddy 或系统）
  "art": {
    "file": "background.jpg",    // 或者 "css": "linear-gradient(...)" 纯 CSS 艺术，无需图片
    "focusX": 0.72, "focusY": 0.45,  // 背景焦点（0 到 1）
    "safeArea": "left",          // left | right | center | none
    "taskMode": "auto"           // auto | ambient | banner | off
  },
  "colors": { "accent": "#3fd6a6", "secondary": "#6aa0ff", "highlight": "#48c9c0" },
  "explicitColorKeys": ["accent","secondary","highlight"], // 显式指定则覆盖图片分析
  "surfaceAlpha": 0.82,          // 面板不透明度（越小越透）
  "blur": 22,                    // 面板磨砂强度（px）
  "scrim": 0.42, "homeScrim": 0.30 // 任务页 / 首页 遮罩强度
}
```

## 诊断与微调

WorkBuddy 的界面没有固定的类名清单可依，选择器只能启发式匹配，`#root`、`.monaco-workbench`、`[class*="sidebar"]` 这类都算线索。某块区域太透或者不够透的时候，跑一下诊断脚本看渲染器当前的状态，再回来调

```bash
scripts/doctor-macos.sh
```

皮肤启用时它会 dump 出 `rootClass`、`themeName`、`colorScheme`、`hasMonaco` 这几个字段，调选择器就靠它们。

## 开发者检查

```bash
npm install          # 没有运行时依赖（只声明了 engines），这一步可做可不做
npm run check        # 语法 + 双平台镜像一致性 + 主题 schema + payload 冒烟测试
npm run check:schema # 校验 macos/presets/ 下所有 theme.json 符合 schema
```

`schemas/theme.schema.json` 是 `theme.json` 的字段契约，注入器应用主题前会先校验，不合法直接报错，不会悄悄生效。注入器本身现在只做编排，CDP 的连接和超时在 `cdp-client.mjs`，主题校验在 `theme-schema.mjs`。

## 致谢

这个项目不是凭空长出来的，做的时候对照过 [workbuddy-skin-studio](https://github.com/cdredfox/workbuddy-skin-studio)，一个思路相近的同类作品，作者是 cdredfox。直接借鉴过来的有

- 注入式主题菜单的思路，即时切换、自定义图片导入、本地保存
- CDP 客户端的校验与超时处理，回环地址白名单、连接超时、错误分类
- Windows 下用注册表探测 WorkBuddy 安装位置的做法
- theme.json 加 schema 校验、路径防逃逸的做法

我们自己的那套机制也在，MutationObserver 保活、Canvas 取色生成调色板、分级遮罩与磨砂、状态机守护。

## 许可

MIT，见 `LICENSE`。商标与素材权利见 `NOTICE.md`。
