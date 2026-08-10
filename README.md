# WorkBuddy Dream Skin

给 **WorkBuddy** 桌面端换一张会呼吸的脸 —— 外部主题工具，本机 CDP 注入，不改官方安装包。

一张图，一种心情。写代码，也要有氛围感。

> 非 WorkBuddy 官方产品。不修改 `.app` / `app.asar` / Windows 安装目录，也不改动你的代码签名与 API 配置。

---

## 用 AI 一键安装（推荐）

不想自己敲命令？把本仓库的 GitHub 地址发给任意 AI 助手（WorkBuddy / CodeBuddy / Claude / Cursor 等），再加上一句：

> 用这个开源项目帮我更换 WorkBuddy 的主题

AI 会克隆仓库、读取根目录的 [`SKILL.md`](SKILL.md)，自动完成**平台检测 → 安装 → 启动皮肤 → 验证状态**，你只需在弹窗里保存好 WorkBuddy 当前任务即可。换肤后的日常切换在菜单栏 / 系统托盘 / 命令行里完成。

> 想指定主题也可直接说，例如「用午夜花开主题」或「帮我换成极光暮色」。

---

## 它能做什么

- **真·可交互**：侧栏、对话区、输入框都是原生控件，不是整窗假截图贴上去。
- **真背景层**：一张 16:9 纯壁纸连续铺满整窗，首页突出氛围，任务页自动降低干扰。
- **自适应配色**：注入前在本地 Canvas 分析图片主色，改写为 `--vscode-*` 强调色，并给面板加半透明磨砂，让原生 UI 浮在背景之上。
- **可换图 / 可存主题**：菜单栏 / 系统托盘可保存、切换本地主题；也能一键导入你自己的纯背景图。
- **可恢复**：一键还原官方外观（停止注入并重启 WorkBuddy，无 debug 端口即回到原 UI）。
- **操作进度 UI**：应用 / 暂停 / 切换时，窗口内弹出 loading / 成功 / 失败覆盖层。
- **相对安全**：本机回环 CDP 注入，不改官方二进制与签名。

---

## 工作原理（安全边界）

1. 用 `--remote-debugging-port` 重启 WorkBuddy（仅本机 `127.0.0.1`）。
2. Node 注入器连 `/json/list` → WebSocket → 在 `file://…/renderer/index.html` 渲染进程里 `Runtime.evaluate` 注入脚本。
3. 注入脚本：解码背景图 → 注入 `<style>` → Canvas 分析主色 → 改写 `--vscode-*` 变量 + 面板半透明磨砂 → MutationObserver 保活。
4. 还原时只停止注入进程并在渲染器里执行清理；重启不带 debug 端口即恢复出厂 UI。

> CDP 在回环地址上是无认证的。应用皮肤期间请勿运行来路不明的本机程序。用完建议 Restore。

---

## 快速开始（macOS）

```bash
cd macos
# 1) 安装到 ~/Library/Application Support/WorkBuddyDreamSkinStudio，并生成桌面启动器
./scripts/install-dream-skin-macos.sh --no-launch

# 2) 启动皮肤（会重启 WorkBuddy 一次以开启 debug 端口）
./scripts/start-dream-skin-macos.sh --prompt-restart

# 3) 或从桌面双击：
#    “WorkBuddy Dream Skin.command”           应用 / 恢复
#    “WorkBuddy Dream Skin - Customize.command” 导入自己的背景图
#    “WorkBuddy Dream Skin - Verify.command”   校验
#    “WorkBuddy Dream Skin - Restore.command”  还原（重启 WorkBuddy）
```

菜单栏（需 [SwiftBar](https://swiftbar.app)）：

```bash
./scripts/install-menubar-macos.sh
# 右上角出现 🎨 Skin，可应用 / 暂停 / 切换预设 / 导入 / 诊断
```

切换预设：

```bash
~/.workbuddy 的状态在 ~/Library/Application\ Support/WorkBuddyDreamSkinStudio
# 已安装预设：
~/.workbuddy/.../state/themes 下 preset-aurora-dusk / preset-midnight-bloom / preset-ember-zen
scripts/switch-theme-macos.sh --id preset-aurora-dusk
```

导入自己的纯背景图（建议 2560×1440，≤16MB，无 UI / 文字 / 水印）：

```bash
scripts/customize-theme-macos.sh --image "/path/to/bg.jpg" --name "My Skin" --accent "#3fd6a6"
```

---

## 快速开始（Windows）

```powershell
cd windows\scripts
powershell -ExecutionPolicy Bypass -File .\install-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\start-dream-skin.ps1
# 启动系统托盘（右键图标操作）：
powershell -ExecutionPolicy Bypass -File .\tray-dream-skin.ps1
```

桌面会生成「WorkBuddy Dream Skin」快捷方式。

> 若找不到 WorkBuddy.exe 或 CDP 端口始终不就绪，先跑排查脚本：
> `powershell -ExecutionPolicy Bypass -File .\find-workbuddy.ps1`（探测应用 / Node / 端口三要素并给出指引）。

---

## 内置预设

| 预设 | 风格 | 主色 |
|------|------|------|
| `preset-aurora-dusk` | 极光暮色（蓝紫 + 青绿辉光） | `#3fd6a6` |
| `preset-midnight-bloom` | 午夜花开（深蓝 + 玫瑰品红） | `#e05aa0` |
| `preset-ember-zen` | 余烬禅意（暖暗 + 琥珀橙） | `#f0a050` |

所有预设背景图均由脚本 `macos/scripts/gen_presets.py` 程序化生成，不含任何第三方素材。

## 自定义旋钮（theme.json）

```jsonc
{
  "appearance": "auto",          // auto | light | dark（auto 跟随 WorkBuddy/系统）
  "art": {
    "file": "background.jpg",    // 或 "css": "linear-gradient(...)" 纯 CSS 艺术（无需图片）
    "focusX": 0.72, "focusY": 0.45,  // 背景焦点（0–1）
    "safeArea": "left",          // left | right | center | none
    "taskMode": "auto"           // auto | ambient | banner | off
  },
  "colors": { "accent": "#3fd6a6", "secondary": "#6aa0ff", "highlight": "#48c9c0" },
  "explicitColorKeys": ["accent","secondary","highlight"], // 显式指定则覆盖图片分析
  "surfaceAlpha": 0.82,          // 面板不透明度（越小越透）
  "blur": 22,                    // 面板磨砂强度(px)
  "scrim": 0.42, "homeScrim": 0.30 // 任务页 / 首页 遮罩强度
}
```

## 诊断与微调

WorkBuddy 的 DOM 选择子是启发式匹配的（基于 `#root` / `.monaco-workbench` / `[class*="sidebar"]` 等）。若某次注入后某些区域不够透或太透，运行：

```bash
scripts/doctor-macos.sh
```

在皮肤已启用时，它会 dump 实时渲染器的 `rootClass`、`themeName`、`colorScheme`、`hasMonaco` 等，用于后续精修选择器。

---

## 许可

MIT —— 见 `LICENSE`。商标与素材权利见 `NOTICE.md`。
