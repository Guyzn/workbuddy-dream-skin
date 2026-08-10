# WorkBuddy Dream Skin

给 WorkBuddy 桌面端换一张会呼吸的脸。这是一个外部主题工具，走本机 CDP 注入，不碰官方安装包。

一张图，一种心情。写代码，也得有氛围感。

> 这不是 WorkBuddy 官方产品。它不会修改 .app、app.asar 或 Windows 安装目录，也不会动你的代码签名和 API 配置。

## 为什么会有这个项目

WorkBuddy 桌面端本身能换浅色深色，但想要一张整窗铺满的壁纸、想要自己的配色浮在原生界面之上，官方并不提供入口。最直接的办法是改 app.asar，可那会动到代码签名，每次官方更新都要重来，也把你自己的环境弄脏。

这个项目选了另一条路。它用 Chromium 自带的远程调试端口，把样式脚本注入到正在运行的渲染进程里。官方文件一个字节都不动，想回去的时候停掉注入、重启应用就行。代价是注入期间本地会开一个调试端口，下面「安全边界」一节会讲清楚怎么看待这件事。

## 这个皮肤能做什么

- 侧栏、对话区、输入框都是原生控件，不是把整窗截图贴上去假装换肤。
- 一张 16×9 壁纸连续铺满整窗。首页突出氛围，进了具体任务自动把干扰压下去。
- 注入前在本地用 Canvas 分析图片主色，改写为界面的强调色，再给面板加一层半透明磨砂，让原生 UI 浮在背景之上。
- 菜单栏、系统托盘里能保存和切换本地主题，也能一键导入你自己的纯背景图。
- 一键还原官方外观。停掉注入、重启 WorkBuddy，调试端口一关，界面就回到出厂状态。
- 应用、暂停、切换时窗口里会弹覆盖层告诉你成功还是失败，不用盲等。

## 工作原理与安全边界

整个机制分四步。

第一步，用 `--remote-debugging-port` 重启 WorkBuddy。端口只绑在 `127.0.0.1`，也就是本机回环地址，外网连不进来。

第二步，Node 注入器去读 `/json/list`，拿到渲染进程列表，挑出 `renderer/index.html` 那个页面，通过 WebSocket 连上去，在渲染进程里执行 `Runtime.evaluate`。

第三步，注入的脚本解码背景图、写入 `<style>`、用 Canvas 分析主色、改写 `--vscode-*` 系列变量并给面板加上磨砂，最后挂一个 MutationObserver 盯着 DOM，WorkBuddy 内部重绘时皮肤不会丢。

第四步，还原时只停注入进程、在渲染器里跑清理，重启时不带调试端口就恢复出厂 UI。

关于那个调试端口，有一句话要放在前面。CDP 在回环地址上是无认证的，同台机器上任何程序都能连。所以皮肤生效期间，别同时跑来路不明的本机程序。用完记得 Restore，端口一关就安全了。

## 用 AI 一键安装（推荐）

不想自己敲命令的话，把本仓库的 GitHub 地址发给任意 AI 助手（WorkBuddy、CodeBuddy、Claude、Cursor 都行），再加一句

> 用这个开源项目帮我更换 WorkBuddy 的主题

AI 会克隆仓库、读根目录的 [`SKILL.md`](SKILL.md)，自动完成平台检测、安装、启动皮肤、验证状态。你只需要在弹窗里把 WorkBuddy 当前任务存一下。之后的日常切换在菜单栏、系统托盘或命令行里做。

> 想指定主题直接说就行，比如「用午夜花开」或者「帮我换成极光暮色」。

## macOS 快速开始

```bash
cd macos
# 1) 安装到 ~/Library/Application Support/WorkBuddyDreamSkinStudio，并生成桌面启动器
./scripts/install-dream-skin-macos.sh --no-launch

# 2) 启动皮肤（会重启一次 WorkBuddy 以开启调试端口）
./scripts/start-dream-skin-macos.sh --prompt-restart

# 3) 或者桌面双击：
#    WorkBuddy Dream Skin.command             应用 / 恢复
#    WorkBuddy Dream Skin - Customize.command 导入自己的背景图
#    WorkBuddy Dream Skin - Verify.command    校验
#    WorkBuddy Dream Skin - Restore.command   还原（重启 WorkBuddy）
```

想要菜单栏入口，先装 [SwiftBar](https://swiftbar.app)，再跑下面这条命令

```bash
./scripts/install-menubar-macos.sh
# 右上角出现 🎨 Skin，可应用 / 暂停 / 切换预设 / 导入 / 诊断
```

切换预设用这条命令

```bash
# 已安装预设在 state/themes 下
scripts/switch-theme-macos.sh --id preset-aurora-dusk
```

导入你自己的纯背景图（建议 2560×1440，不超过 16MB，图上不要有 UI、文字或水印）

```bash
scripts/customize-theme-macos.sh --image "/path/to/bg.jpg" --name "My Skin" --accent "#3fd6a6"
```

## Windows 快速开始

```powershell
cd windows\scripts
powershell -ExecutionPolicy Bypass -File .\install-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\start-dream-skin.ps1
# 启动系统托盘（右键图标操作）：
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

三套预设的背景图都由 `macos/scripts/gen_presets.py` 程序化生成，不含任何第三方素材。

## 自定义旋钮（theme.json）

```jsonc
{
  "appearance": "auto",          // auto | light | dark（auto 跟随 WorkBuddy 或系统）
  "art": {
    "file": "background.jpg",    // 或者 "css": "linear-gradient(...)" 纯 CSS 艺术，无需图片
    "focusX": 0.72, "focusY": 0.45,  // 背景焦点（0–1）
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

WorkBuddy 的 DOM 选择子是启发式匹配的，依据 `#root`、`.monaco-workbench`、`[class*="sidebar"]` 这类线索。某次注入后某块区域太透或不够透，跑下面的脚本看实时渲染器的状态

```bash
scripts/doctor-macos.sh
```

皮肤启用时它会 dump 出 `rootClass`、`themeName`、`colorScheme`、`hasMonaco` 这些字段，拿去精修选择器用。

## 开发者检查

```bash
npm install          # 没有运行时依赖（只声明了 engines），install 这一步可做可不做
npm run check        # 语法 + 双平台镜像一致性 + 主题 schema + payload 冒烟测试
npm run check:schema # 校验 macos/presets/ 下所有 theme.json 符合 schema
```

`schemas/theme.schema.json` 定义了 `theme.json` 的字段契约。注入器在应用主题时会先校验，主题不合法会直接报错，不会静默生效。`injector.mjs` 现在只做编排，CDP 传输层抽到了 `cdp-client.mjs`，主题校验抽到了 `theme-schema.mjs`。

## 致谢

这个项目不是凭空长出来的。做的时候对照过 [workbuddy-skin-studio](https://github.com/cdredfox/workbuddy-skin-studio)，一个思路相近的同类作品，作者是 cdredfox。它给了我们不少启发，直接借鉴过来的东西包括

- 🎨 注入式主题菜单的思路（即时切换、自定义图片导入、本地保存）
- CDP 客户端的校验与超时工程化（回环地址白名单、连接超时、错误分类）
- Windows 下用注册表探测 WorkBuddy 安装位置的套路
- theme.json 加 schema 校验、路径防逃逸的做法

我们保留了自家那套机制（MutationObserver 保活、Canvas 取色生成自适应调色板、分级遮罩与磨砂、状态机守护），在上面长出了更完整的皮肤体验。开源就是这样，互相看着对方的路，各自往前走。

## 许可

MIT，见 `LICENSE`。商标与素材权利见 `NOTICE.md`。
