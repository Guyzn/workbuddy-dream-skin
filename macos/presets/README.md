# Presets

每个预设是一个文件夹 `preset-<id>/`，包含：

- `theme.json` —— 主题配置（见仓库 README 的「自定义旋钮」）
- `background.jpg` / `background.png` —— 纯背景图（可选；也可用 `theme.json` 里的 `art.css` 纯 CSS 艺术，无需图片）

## 内置预设

| 预设 | 风格 | 主色 |
|------|------|------|
| `preset-aurora-dusk` | 极光暮色 | `#3fd6a6` |
| `preset-midnight-bloom` | 午夜花开 | `#e05aa0` |
| `preset-ember-zen` | 余烬禅意 | `#f0a050` |

所有内置背景图由 `../scripts/gen_presets.py` 程序化生成，**不含任何第三方素材**。

## 贡献一个预设

1. 复制一个现有预设文件夹，改名为 `preset-<your-id>`（用小写与连字符）。
2. 替换 `background.jpg`（建议 2560×1440、16:9、≤16MB、无 UI/文字/水印）。
3. 编辑 `theme.json` 的 `name`、`colors.accent` 等。
4. 放入 `macos/presets/`（macOS）与 `windows/presets/`（Windows）。安装时会自动 seeding 到用户主题库。

> 你导入或贡献的素材，请自行确认肖像、商标与版权权利。
