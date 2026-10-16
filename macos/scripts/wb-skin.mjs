#!/usr/bin/env node
// ============================================================================
// wb-skin.mjs — Dream Skin · 官方皮肤管线版
// ----------------------------------------------------------------------------
// 把「自制皮肤」（壁纸 + 调色板）编译成 WorkBuddy 官方格式的皮肤 CSS，
// 并装入官方皮肤缓存目录（~/.workbuddy/appearance-resources/<key>-<updatedAt>/），
// 由官方 SkinManager 直接渲染：
//   · 无 CDP 注入、无调试端口、无常驻进程
//   · 重启不丢、所有窗口一致、官方皮肤中心照常切换
//   · 一个官方皮肤位（载体）承载自定义外观；换回官方外观一条命令
//
// 原理（全部来自对 WorkBuddy 5.8.2 的逆向分析，2026-10-16）：
//   1. 官方皮肤 zip 第一次应用时会在 <资源根>/<resourceKey>-<updatedAt>/ 落地：
//        skin.v2.css（URL 改写为 local-file:// 的最终样式）+ 解包资产
//   2. 之后每次应用该皮肤，主进程先读该目录的 skin.v2.css，命中即直接返回
//        （DesktopAppearanceRepo.doGetLocalResource 缓存短路，不再下载）
//   3. 渲染进程 SkinManager 把 CSS 注入为 <style data-skin-sheet>，
//      并在 <html> 上写 data-skin=<resourceKey>
//   => 我们只要把模板生成的 skin.v2.css 写进该目录，官方管线就会渲染我们的皮肤。
//
// 零依赖：Node >= 18 + macOS 自带 sips（取色用；也可 --accent 跳过）。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const STUDIO_HOME = process.env.WB_SKIN_HOME ||
  path.join(HOME, 'Library/Application Support/WorkBuddyDreamSkinStudio/wb-skin');
const APPEARANCE_ROOT = process.env.WB_APPEARANCE_ROOT ||
  path.join(HOME, '.workbuddy/appearance-resources');
const SKINS_DIR = path.join(STUDIO_HOME, 'skins');
const TEMPLATES_DIR = path.join(STUDIO_HOME, 'templates');
const BACKUPS_DIR = path.join(STUDIO_HOME, 'backups');
const REGISTRY_FILE = path.join(STUDIO_HOME, 'registry.json');

const VERSION = '0.1.0';
const MARKER_FILE = 'wb-skin.patch.json';
const ART_URL_PLACEHOLDER = '__WB_ART_URL__';

// 官方皮肤 CSS 使用的选择器前奏（经 5.8.2 实测）
const TOKEN_PRELUDE = `:root,
body,
body.light,
.light,
.cb-light,
.light .cbChat,
.cb-light .cbChat,
.cbChat.light,
:root.light,
body[data-vscode-theme-name="IDE Light"]`;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const log = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s) return s;
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `dream-${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}
// 与主进程 toLocalFileUrl() 完全一致的编码规则
function toLocalFileUrl(absPath) {
  const parts = absPath.replace(/\\/g, '/').split('/').map((seg) => seg === '' ? '' : encodeURIComponent(seg));
  return 'local-file://local/' + parts.join('/').replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  const z = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${z(r)}${z(g)}${z(b)}`;
}
function mix(a, b, t) { // sRGB 线性插值
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
// 加权色距（近似感知）
function dist(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
}
// 求解 mix(ref, toward, t) ≈ target 的最小二乘 t（0..1）与残差
function solveMix(ref, toward, target) {
  const dr = toward.r - ref.r, dg = toward.g - ref.g, db = toward.b - ref.b;
  const denom = dr * dr + dg * dg + db * db;
  let t = denom === 0 ? 0 : ((target.r - ref.r) * dr + (target.g - ref.g) * dg + (target.b - ref.b) * db) / denom;
  t = Math.max(0, Math.min(1, t));
  const m = mix(ref, toward, t);
  return { t, err: dist(m, target), value: m };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// ---------------------------------------------------------------------------
// 取色：sips 缩图 → BMP 像素 → 聚类
// ---------------------------------------------------------------------------
function pixelsFromImage(imgPath, maxDim = 96) {
  const tmpBmp = path.join(os.tmpdir(), `wb-skin-${process.pid}.bmp`);
  try {
    execFileSync('sips', ['-Z', String(maxDim), '-s', 'format', 'bmp', imgPath, '--out', tmpBmp], { stdio: 'pipe' });
  } catch (e) {
    die(`sips 无法处理图片：${imgPath}\n${e.message}`);
  }
  const buf = fs.readFileSync(tmpBmp);
  fs.rmSync(tmpBmp, { force: true });
  if (buf.readUInt16LE(0) !== 0x4d42) die('sips 输出不是 BMP，取色失败');
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  let height = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24) die(`暂只支持 24 位 BMP（实际 ${bpp} 位）`);
  const topDown = height < 0;
  height = Math.abs(height);
  const stride = Math.ceil((width * 3) / 4) * 4;
  const px = [];
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    const rowStart = dataOffset + row * stride;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 3;
      px.push({ r: buf[i + 2], g: buf[i + 1], b: buf[i] }); // BGR
    }
  }
  return { width, height, px };
}

function extractPalette(px) {
  const buckets = new Map();
  for (const p of px) {
    const key = ((p.r >> 3) << 10) | ((p.g >> 3) << 5) | (p.b >> 3);
    let b = buckets.get(key);
    if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, b); }
    b.n++; b.r += p.r; b.g += p.g; b.b += p.b;
  }
  const total = px.length;
  const cands = [];
  for (const b of buckets.values()) {
    const c = { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n };
    const { s, l, h } = rgbToHsl(c);
    if (b.n < total * 0.004) continue;
    if (l < 0.12 || l > 0.97) continue;       // 过暗/过亮不进候选
    if (s < 0.12 && l < 0.2) continue;
    cands.push({ color: c, n: b.n, s, l, hue: h });
  }
  if (cands.length === 0) die('取色失败：图片候选颜色太少，请用 --accent 指定主色');
  const score = (c) => c.n * (0.18 + c.s * 2.2) * Math.max(0.12, 1 - Math.abs(c.l - 0.5) * 1.05);
  cands.sort((a, b) => score(b) - score(a));
  // 主色：取分值最高且亮度/饱和度可接受的
  let accent = cands.find((c) => c.s >= 0.22 && c.l >= 0.18 && c.l <= 0.8) || cands.find((c) => c.s >= 0.16) || cands[0];
  // 副色：色相距离 >= 40° 且饱和度足够的最高分候选
  let secondary = cands.find((c) => c.s >= 0.22 && c.l >= 0.22 && hueDist(c.hue, accent.hue) >= 40 && dist(c.color, accent.color) > 40);
  if (!secondary) {
    const h = (accent.hue + 150) % 360;
    secondary = { color: null, _derived: { h, s: Math.min(0.75, accent.s + 0.1), l: Math.max(0.35, Math.min(0.6, accent.l)) } };
  }
  return {
    accent: accent.color,
    secondary: secondary.color,
    accentHue: accent.hue,
    secondaryDerived: secondary._derived || null,
  };
}

// ---------------------------------------------------------------------------
// 调色板 → 官方皮肤令牌重映射
// ---------------------------------------------------------------------------
const BASE_ACCENT = '#3966ac';   // 模板基准主色（暖沙白系蓝）
const BASE_SECONDARY = '#e6c029'; // 模板基准金
const REMAP_THRESHOLD = 42;       // 色距阈值：低于则重映射，高于保留原值

function remapColorToken(hexRaw, ctx) {
  // 入参出参都带 # （如 #ffffff / #001f4fe6）
  const token = hexRaw.startsWith('#') ? hexRaw : '#' + hexRaw;
  let hex = token.slice(1);
  let alpha = '';
  if (hex.length === 8) { alpha = hex.slice(6); hex = hex.slice(0, 6); }
  else if (hex.length === 4) { alpha = hex[3] + hex[3]; hex = hex.slice(0, 3); }
  let rgb = hexToRgb(hex);
  if (!rgb) return token;
  const { s } = rgbToHsl(rgb);
  if (s < 0.03) return token; // 中性色保留
  // 对主色系与金色系分别求解，取误差更小者
  const accToWhite = solveMix(ctx.baseAccentRgb, { r: 255, g: 255, b: 255 }, rgb);
  const accToBlack = solveMix(ctx.baseAccentRgb, { r: 0, g: 0, b: 0 }, rgb);
  const accBest = accToWhite.err <= accToBlack.err ? { ...accToWhite, toward: 'white' } : { ...accToBlack, toward: 'black' };
  let best = { err: accBest.err, family: 'accent', toward: accBest.toward, t: accBest.t };
  const goldHue = rgbToHsl(ctx.baseSecondaryRgb).h;
  const { h } = rgbToHsl(rgb);
  if (s >= 0.15 && hueDist(h, goldHue) < 60) {
    const gToWhite = solveMix(ctx.baseSecondaryRgb, { r: 255, g: 255, b: 255 }, rgb);
    const gToBlack = solveMix(ctx.baseSecondaryRgb, { r: 0, g: 0, b: 0 }, rgb);
    const gBest = gToWhite.err <= gToBlack.err ? { ...gToWhite, toward: 'white' } : { ...gToBlack, toward: 'black' };
    if (gBest.err <= best.err) best = { err: gBest.err, family: 'secondary', toward: gBest.toward, t: gBest.t };
  }
  if (best.err > REMAP_THRESHOLD) return token; // 语义色（红绿警示等）保留
  const ref = best.family === 'accent' ? ctx.accentRgb : ctx.secondaryRgb;
  const toward = best.toward === 'white' ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const out = rgbToHex(mix(ref, toward, best.t));
  return out + alpha;
}

function remapCssValue(value, ctx) {
  return value
    .replace(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/g,
      (m) => remapColorToken(m, ctx))
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g,
      (m, r, g, b, a) => {
        const mapped = remapColorToken(rgbToHex({ r: +r, g: +g, b: +b }), ctx);
        const rgb = hexToRgb(mapped.slice(0, 7));
        return a !== undefined ? `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})` : `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
      });
}

// 解析官方皮肤 CSS 的全部设计令牌（--x: value; 行）
function parseBaseTokens(css) {
  const tokens = new Map();
  const re = /^\s*(--[a-zA-Z][\w-]*)\s*:\s*(.+?)\s*;?\s*$/;
  for (const line of css.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].replace(/\s*!important\s*$/, ''));
  }
  return tokens;
}

function buildTokenSheet(baseCss, palette) {
  const tokens = parseBaseTokens(baseCss);
  if (tokens.size < 100) die(`基础模板令牌太少（${tokens.size} 条），请确认 --base 文件是官方皮肤 skin.css`);
  const ctx = {
    accentRgb: palette.accentRgb,
    secondaryRgb: palette.secondaryRgb,
    baseAccentRgb: hexToRgb(BASE_ACCENT),
    baseSecondaryRgb: hexToRgb(BASE_SECONDARY),
  };
  const lines = [];
  let dropped = 0;
  for (const [name, value] of tokens) {
    // 丢弃指向模板原资产/自定义图的令牌——图片由 Dream Skin 艺术层自管
    if (/url\(/i.test(value) || /--wb-custom-img|welcome-bg-image/.test(value)) { dropped++; continue; }
    lines.push(`  ${name}: ${remapCssValue(value, ctx)} !important;`);
  }
  return { css: lines.join('\n'), count: tokens.size - dropped, dropped };
}

// ---------------------------------------------------------------------------
// 艺术层（移植自 Dream Skin renderer-inject 的 CSS 层，适配官方管线）
// ---------------------------------------------------------------------------
function artLayer(palette, focus) {
  const accentHex = rgbToHex(palette.accentRgb);
  const pageHex = rgbToHex(mix(palette.accentRgb, { r: 255, g: 255, b: 255 }, 0.95));
  const textHex = rgbToHex(mix(palette.accentRgb, { r: 0, g: 0, b: 0 }, 0.72));
  const accentRgbStr = `${Math.round(palette.accentRgb.r)} ${Math.round(palette.accentRgb.g)} ${Math.round(palette.accentRgb.b)}`;
  const pos = `${Math.round(focus.x * 100)}% ${Math.round(focus.y * 100)}%`;
  return `/* ─────────────── Dream Skin art layer ───────────────
 * 整窗壁纸 + 阅读蒙层 + 面板磨砂 + 透明化（官方管线版）
 * 作用域挂在 html[data-skin] 上：皮肤被官方切走时整体自动失效。 */

:root[data-skin] {
  --dream-blur: 22px;
  --dream-scrim: 0.34;
  --dream-home-scrim: 0.20;
  --dream-art-position: ${pos};
  --dream-skin-art: url("${ART_URL_PLACEHOLDER}");
  --ds-panel: rgb(255 255 255 / 0.84);
  --ds-bg: ${pageHex};
  --ds-green: ${accentHex};
  --ds-green-rgb: ${accentRgbStr};
  --ds-text: ${textHex};
}

html[data-skin],
html[data-skin] body { background: ${pageHex} !important; }
html[data-skin] #root { background: transparent !important; }

body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -2;
  background-image: var(--dream-skin-art);
  background-repeat: no-repeat;
  background-size: cover;
  background-position: var(--dream-art-position);
  pointer-events: none;
}
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background: linear-gradient(180deg,
    rgba(0,0,0,0.08) 0%,
    rgba(0,0,0,0.0) 24%,
    rgba(0,0,0,0.0) 62%,
    rgba(0,0,0,0.16) 100%);
  opacity: var(--dream-scrim);
  pointer-events: none;
  transition: opacity 220ms ease;
}

/* 面板磨砂：把承载内容的半透明化，让壁纸透出来 */
:root[data-skin] [class*="sidebar"]:not([class*="sidebar-"]),
:root[data-skin] [class*="Sidebar"],
:root[data-skin] [class*="panel"]:not([class*="panel-"]):not([class*="Panel-"]),
:root[data-skin] [class*="Panel"],
:root[data-skin] [class*="editor"]:not([class*="editor-"]),
:root[data-skin] [class*="Editor"],
:root[data-skin] [class*="chat"]:not([class*="chat-"]),
:root[data-skin] [class*="Chat"],
:root[data-skin] [class*="conversation"]:not([class*="conversation-"]),
:root[data-skin] [class*="Conversation"],
:root[data-skin] [class*="composer"]:not([class*="composer-"]),
:root[data-skin] [class*="Composer"],
:root[data-skin] [class*="content"]:not([class*="content-"]),
:root[data-skin] [class*="Content"],
:root[data-skin] [class*="workspace"]:not([class*="workspace-"]),
:root[data-skin] [class*="Workspace"] {
  background-color: transparent !important;
  backdrop-filter: blur(var(--dream-blur)) saturate(1.08);
  -webkit-backdrop-filter: blur(var(--dream-blur)) saturate(1.08);
}

/* 精确锚点（WorkBuddy DOM data-view-id），比类名启发式更稳 */
:root[data-skin] [data-view-id] { background: transparent !important; }
:root[data-skin] [data-view-id="sidebar"] {
  background: color-mix(in srgb, var(--ds-panel) 88%, transparent) !important;
  border-right: 1px solid color-mix(in srgb, var(--ds-green) 40%, transparent) !important;
  backdrop-filter: blur(var(--dream-blur)) saturate(1.12);
  -webkit-backdrop-filter: blur(var(--dream-blur)) saturate(1.12);
}
:root[data-skin] [data-view-id="main-content"] {
  background: linear-gradient(180deg,
    transparent 0 42%,
    color-mix(in srgb, var(--ds-bg) 70%, transparent) 100%) !important;
}
:root[data-skin] [data-view-id="detail-panel"],
:root[data-skin] [data-view-id="chat-panel"] {
  background: color-mix(in srgb, var(--ds-panel) 88%, transparent) !important;
  backdrop-filter: blur(calc(var(--dream-blur) * 0.85)) saturate(1.08);
  -webkit-backdrop-filter: blur(calc(var(--dream-blur) * 0.85)) saturate(1.08);
}
`;
}

// ---------------------------------------------------------------------------
// 皮肤组装
// ---------------------------------------------------------------------------
function assembleSkinCSS({ meta, baseCss, palette }) {
  const { css: tokenCss, count } = buildTokenSheet(baseCss, palette);
  const accentHex = rgbToHex(palette.accentRgb);
  const secondaryHex = rgbToHex(palette.secondaryRgb);
  const header = `/* ============================================================================
 * WB Dream Skin (custom) — ${meta.name}
 * built by wb-skin.mjs v${VERSION} · ${meta.builtAt}
 * 调色板: accent ${accentHex} / secondary ${secondaryHex} · 底图: ${meta.imageFile}
 * 令牌: 基于官方皮肤模板重映射（${count} 条）· 风格层: Dream Skin art layer
 *
 * ⚠ 本文件由工具生成并安装到官方皮肤缓存目录，用于本地渲染。
 *   恢复官方外观请运行: node wb-skin.mjs restore --carrier <主题key>
 * ============================================================================ */
`;
  const tokenBlock = `\n/* ─────────────── 官方设计令牌（重映射） ─────────────── */\n${TOKEN_PRELUDE} {\n${tokenCss}\n}\n`;
  return header + tokenBlock + '\n' + artLayer(palette, meta.focus);
}

// ---------------------------------------------------------------------------
// 缓存目录扫描 / 备份 / 打补丁
// ---------------------------------------------------------------------------
function scanAppearanceDirs() {
  if (!fs.existsSync(APPEARANCE_ROOT)) return [];
  const out = [];
  for (const d of fs.readdirSync(APPEARANCE_ROOT)) {
    const abs = path.join(APPEARANCE_ROOT, d);
    if (!fs.statSync(abs).isDirectory()) continue;
    const m = d.match(/^(.*)-(\d{10,})$/) || d.match(/^(.*)-(\d+)$/);
    const key = m ? m[1] : d;
    const updatedAt = m ? m[2] : '';
    // 猜测皮肤展示名：取目录内层文件夹（跳过我们自己的 assets）
    let name = '';
    try {
      const inner = fs.readdirSync(abs).filter((x) => x !== 'assets' && fs.statSync(path.join(abs, x)).isDirectory());
      name = inner[0] || '';
    } catch {}
    const cssV2 = path.join(abs, 'skin.v2.css');
    const hasV2 = fs.existsSync(cssV2);
    const marker = readJSON(path.join(abs, MARKER_FILE), null);
    out.push({ dirName: d, key, updatedAt, abs, name, hasV2, patched: !!marker, marker });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.updatedAt.localeCompare(b.updatedAt));
}

function loadRegistry() {
  return readJSON(REGISTRY_FILE, { version: 1, carriers: {} });
}
function saveRegistry(reg) { writeJSON(REGISTRY_FILE, reg); }

function backupOfficial(dirInfo, reg) {
  const backupDir = path.join(BACKUPS_DIR, dirInfo.dirName);
  const backupFile = path.join(backupDir, 'skin.v2.css');
  if (fs.existsSync(backupFile)) return backupFile; // 已有备份，勿覆盖
  ensureDir(backupDir);
  const cssV2 = path.join(dirInfo.abs, 'skin.v2.css');
  if (fs.existsSync(cssV2)) {
    fs.copyFileSync(cssV2, backupFile);
    return backupFile;
  }
  return null; // 本来就没有 v2 版
}

function patchOneDir(dirInfo, skin, reg) {
  const carrierKey = dirInfo.key;
  reg.carriers[carrierKey] = reg.carriers[carrierKey] || { skin: skin.slug, dirs: {} };
  const entry = reg.carriers[carrierKey];
  entry.skin = skin.slug;
  const dirEntry = entry.dirs[dirInfo.dirName] = entry.dirs[dirInfo.dirName] || {};
  if (dirEntry.backup === undefined) {
    const hadOfficial = fs.existsSync(path.join(dirInfo.abs, 'skin.v2.css'));
    const backup = backupOfficial(dirInfo, reg);
    dirEntry.hadOfficialV2 = hadOfficial;
    dirEntry.backup = backup ? path.relative(STUDIO_HOME, backup) : null;
  }
  dirEntry.patchedAt = new Date().toISOString();
  // 复制资产到目标目录（LRU 淘汰时随目录一起走，天然不残留）
  const assetDirName = `dream-skin-${skin.slug}`;
  const destAssetDir = path.join(dirInfo.abs, 'assets', assetDirName);
  ensureDir(destAssetDir);
  const artFileName = skin.meta.imageFile;
  fs.copyFileSync(path.join(skin.dir, 'assets', artFileName), path.join(destAssetDir, artFileName));
  const artUrl = toLocalFileUrl(path.join(destAssetDir, artFileName));
  const css = skin.cssTemplate.split(ART_URL_PLACEHOLDER).join(artUrl);
  fs.writeFileSync(path.join(dirInfo.abs, 'skin.v2.css'), css, 'utf8');
  dirEntry.cssHash = sha256(css);
  writeJSON(path.join(dirInfo.abs, MARKER_FILE), {
    tool: `wb-skin.mjs v${VERSION}`,
    skin: skin.slug,
    skinName: skin.meta.name,
    installedAt: dirEntry.patchedAt,
    artwork: path.join('assets', assetDirName, artFileName),
  });
  return dirEntry;
}

function unpatchOneDir(dirInfo, reg) {
  const carrierKey = dirInfo.key;
  const entry = reg.carriers[carrierKey];
  const dirEntry = entry?.dirs?.[dirInfo.dirName];
  const cssV2 = path.join(dirInfo.abs, 'skin.v2.css');
  if (dirEntry && dirEntry.hadOfficialV2 && dirEntry.backup) {
    fs.copyFileSync(path.join(STUDIO_HOME, dirEntry.backup), cssV2);
  } else {
    fs.rmSync(cssV2, { force: true }); // 本来就没有，删除我们的
  }
  // 清理我们的资产与标记
  const marker = readJSON(path.join(dirInfo.abs, MARKER_FILE), null);
  if (marker?.skin) {
    fs.rmSync(path.join(dirInfo.abs, 'assets', `dream-skin-${marker.skin}`), { recursive: true, force: true });
  }
  try { fs.rmdirSync(path.join(dirInfo.abs, 'assets')); } catch { /* 非空或不存在则保留 */ }
  fs.rmSync(path.join(dirInfo.abs, MARKER_FILE), { force: true });
  if (entry) delete entry.dirs[dirInfo.dirName];
}

function loadSkin(slug) {
  const dir = path.join(SKINS_DIR, slug);
  const meta = readJSON(path.join(dir, 'meta.json'), null);
  if (!meta) die(`皮肤不存在：${slug}（目录 ${dir}）`);
  const cssTemplate = fs.readFileSync(path.join(dir, 'skin.css'), 'utf8');
  return { slug, dir, meta, cssTemplate };
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------
function cmdList() {
  const dirs = scanAppearanceDirs();
  if (dirs.length === 0) {
    log('未发现任何官方皮肤缓存。先在 WorkBuddy 的「设置 → 外观」里应用一次任意皮肤。');
    return;
  }
  log('');
  log('本机官方皮肤缓存（可作为自定义皮肤的「载体」）：');
  log('');
  const byKey = new Map();
  for (const d of dirs) {
    if (!byKey.has(d.key)) byKey.set(d.key, []);
    byKey.get(d.key).push(d);
  }
  for (const [key, list] of byKey) {
    const patched = list.some((d) => d.patched);
    const tag = patched ? ' [已装 Dream Skin 补丁]' : '';
    log(`  ● ${key}${tag}`);
    for (const d of list) {
      log(`      └─ ${d.dirName}${d.name ? `  (${d.name})` : ''}`);
    }
  }
  log('');
  log('用法: node wb-skin.mjs install <皮肤slug> --carrier <上面的主题key>');
  log('');
}

function cmdBuild(argv) {
  const opts = parseOpts(argv);
  const name = opts.name;
  if (!name) die('build 需要 --name "皮肤名称"');
  const slug = opts.slug || slugify(name);
  // 底图来源：--image 或 --from-preset
  let imagePath = opts.image;
  let focus = { x: parseFloat(opts['focus-x'] ?? '0.5'), y: parseFloat(opts['focus-y'] ?? '0.5') };
  let presetColors = null;
  if (!imagePath && opts['from-preset']) {
    const pd = opts['from-preset'];
    const pj = readJSON(path.join(pd, 'theme.json'), null);
    if (!pj) die(`预设目录缺少 theme.json：${pd}`);
    imagePath = path.join(pd, pj.art?.file || 'background.jpg');
    if (pj.art?.focusX !== undefined) focus.x = pj.art.focusX;
    if (pj.art?.focusY !== undefined) focus.y = pj.art.focusY;
    presetColors = pj.colors || null;
  }
  if (!imagePath || !fs.existsSync(imagePath)) die(`底图不存在：${imagePath || '(未指定，用 --image 或 --from-preset)'}`);
  // 基础模板
  const basePath = opts.base || path.join(TEMPLATES_DIR, 'base-skin.css');
  if (!fs.existsSync(basePath)) die(`缺少基础模板：${basePath}\n提示：--base /path/to/某官方皮肤skin.css，或先放入 ${TEMPLATES_DIR}/base-skin.css`);
  const baseCss = fs.readFileSync(basePath, 'utf8');

  // 确定调色板
  let accentHex = (opts.accent && opts.accent !== 'auto') ? opts.accent : (presetColors?.accent || null);
  let secondaryHex = (opts.secondary && opts.secondary !== 'auto') ? opts.secondary : (presetColors?.secondary || null);
  if (!accentHex || !secondaryHex) {
    log('· 正在从底图取色（sips 缩样）…');
    const { px } = pixelsFromImage(imagePath);
    const pal = extractPalette(px);
    accentHex = accentHex || rgbToHex(pal.accent);
    if (!secondaryHex) secondaryHex = pal.secondary ? rgbToHex(pal.secondary) : rgbToHex(mix(hexToRgb(accentHex), { r: 0, g: 0, b: 0 }, 0.2));
  }
  const accentRgb = hexToRgb(accentHex);
  const secondaryRgb = hexToRgb(secondaryHex);
  if (!accentRgb || !secondaryRgb) die('颜色格式错误（用 #RRGGBB）');

  const builtAt = new Date().toISOString();
  const srcExt = path.extname(imagePath).toLowerCase();
  const keepExt = ['.jpg', '.jpeg', '.png'].includes(srcExt);
  const imageFile = `bg-${slug}${keepExt ? srcExt : '.jpg'}`;
  const meta = { name, slug, builtAt, imageFile, focus, accent: accentHex, secondary: secondaryHex, base: basePath };
  const css = assembleSkinCSS({ meta, baseCss, palette: { accentRgb, secondaryRgb } });

  const skinDir = path.join(SKINS_DIR, slug);
  ensureDir(path.join(skinDir, 'assets'));
  const destImage = path.join(skinDir, 'assets', imageFile);
  if (keepExt) {
    fs.copyFileSync(imagePath, destImage);
  } else {
    // 不常用格式（HEIC / WebP / TIFF / BMP 等）统一转成 JPG，保证渲染进程能直接显示
    log(`· 底图是 ${srcExt} 格式，正在转成 JPG…`);
    try {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', imagePath, '--out', destImage], { stdio: 'pipe' });
    } catch (e) {
      die(`底图格式转换失败：${imagePath}\n${e.message}`);
    }
  }
  fs.writeFileSync(path.join(skinDir, 'skin.css'), css, 'utf8');
  writeJSON(path.join(skinDir, 'meta.json'), meta);

  log('');
  log(`✓ 皮肤已生成：${name}`);
  log(`  slug      : ${slug}`);
  log(`  调色板    : accent ${accentHex} · secondary ${secondaryHex}`);
  log(`  底图      : ${imageFile}（${(fs.statSync(destImage).size / 1024).toFixed(0)} KB）`);
  log(`  输出      : ${skinDir}`);
  log('');
  log('底图建议: 横构图, 长边 2560 起步, JPG 优先, PNG 也可, 体积 16MB 以内');
  log(`下一步: node wb-skin.mjs install ${slug} --carrier <载体主题key>（先跑 list 看候选）`);
  log('');
}

function cmdInstall(argv) {
  const [slug] = argv;
  const opts = parseOpts(argv.slice(1));
  if (!slug) die('install 需要皮肤 slug');
  if (!opts.carrier) die('install 需要 --carrier <主题key>（先跑 list）');
  const skin = loadSkin(slug);
  const dirs = scanAppearanceDirs();
  const targets = dirs.filter((d) => d.key === opts.carrier);
  if (targets.length === 0) {
    die(`载体 ${opts.carrier} 无缓存目录。请先在 WorkBuddy「设置 → 外观」里应用一次该皮肤（完成一次官方缓存），再运行本命令。`);
  }
  const reg = loadRegistry();
  if (opts['dry-run']) {
    log('· dry-run：将执行以下操作');
    for (const d of targets) log(`    - 备份并覆盖 ${d.dirName}/skin.v2.css（当前${d.hasV2 ? '有官方版本' : '无 v2 文件'}）`);
    return;
  }
  for (const d of targets) {
    patchOneDir(d, skin, reg);
    log(`  ✓ 已注入 ${d.dirName}`);
  }
  saveRegistry(reg);
  log('');
  log(`✓ 皮肤「${skin.meta.name}」已装入载体 ${opts.carrier}（${targets.length} 个目录）`);
  log('');
  log('生效方法（二选一）：');
  log(`  · 打开 WorkBuddy 设置 → 外观，点一下「${opts.carrier}」对应的皮肤卡片；或`);
  log('  · 重启 WorkBuddy（下次启动即生效）。');
  log(`恢复官方外观: node wb-skin.mjs restore --carrier ${opts.carrier}`);
  log('');
}

function cmdRestore(argv) {
  const opts = parseOpts(argv);
  const reg = loadRegistry();
  const keys = opts.all ? Object.keys(reg.carriers) : (opts.carrier ? [opts.carrier] : []);
  if (keys.length === 0) die('restore 需要 --carrier <key> 或 --all');
  const dirs = scanAppearanceDirs();
  let n = 0;
  for (const key of keys) {
    const entry = reg.carriers[key];
    if (!entry) { log(`  - ${key}: 未登记，跳过`); continue; }
    for (const d of dirs.filter((x) => x.key === key)) {
      unpatchOneDir(d, reg);
      n++;
      log(`  ✓ 已恢复 ${d.dirName}`);
    }
    delete reg.carriers[key];
  }
  saveRegistry(reg);
  log(`\n✓ 恢复完成（${n} 个目录）。${n ? '重启 WorkBuddy 或重选一次该皮肤后回到官方外观。' : ''}`);
}

function cmdResync(argv) {
  const opts = parseOpts(argv);
  const reg = loadRegistry();
  const keys = opts.carrier ? [opts.carrier] : Object.keys(reg.carriers);
  if (keys.length === 0) { log('没有已登记的自定义皮肤载体。'); return; }
  const dirs = scanAppearanceDirs();
  let n = 0;
  for (const key of keys) {
    const entry = reg.carriers[key];
    if (!entry) continue;
    const skin = loadSkin(entry.skin);
    for (const d of dirs.filter((x) => x.key === key)) {
      const dirEntry = entry.dirs[d.dirName];
      const needs = !d.patched || !dirEntry || (dirEntry.cssHash && dirEntry.cssHash !== sha256IfPatched(d, skin));
      if (needs) {
        patchOneDir(d, skin, reg);
        n++;
        log(`  ✓ 重新注入 ${d.dirName}（官方更新或缓存被清）`);
      }
    }
  }
  saveRegistry(reg);
  log(`\n✓ resync 完成，处理 ${n} 个目录。${n ? '' : '（全部健康，无需处理）'}`);
}
function sha256IfPatched(dirInfo, skin) {
  // 只有内容为我们生成时才参与比对
  const cssV2 = path.join(dirInfo.abs, 'skin.v2.css');
  if (!fs.existsSync(cssV2)) return '';
  return sha256(fs.readFileSync(cssV2, 'utf8'));
}

function cmdStatus() {
  const reg = loadRegistry();
  const keys = Object.keys(reg.carriers);
  log('');
  if (keys.length === 0) {
    log('（暂无已安装的自定义皮肤）');
  } else {
    log('已安装的自定义皮肤（载体 → 皮肤）：');
    for (const key of keys) {
      const e = reg.carriers[key];
      log(`  ● ${key} → ${e.skin}（${Object.keys(e.dirs).length} 个目录）`);
      for (const [dn, de] of Object.entries(e.dirs)) {
        const alive = fs.existsSync(path.join(APPEARANCE_ROOT, dn, 'skin.v2.css'));
        log(`      └─ ${dn}  备份:${de.backup ? '有' : '无'}  ${alive ? '' : ' ← 目录已被系统清理（跑 resync 恢复）'}`);
      }
    }
  }
  const skins = fs.existsSync(SKINS_DIR) ? fs.readdirSync(SKINS_DIR) : [];
  log(`\n本地皮肤库（${skins.length} 个）：${skins.join(', ') || '空'}`);
  log(`Studio 目录：${STUDIO_HOME}`);
  log('');
}

// ---------------------------------------------------------------------------
function parseOpts(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { opts[key] = true; }
      else { opts[key] = next; i++; }
    }
  }
  return opts;
}

const HELP = `
wb-skin.mjs — Dream Skin · 官方皮肤管线版 v${VERSION}

把自定义壁纸/调色板编译为官方格式皮肤 CSS，装入官方缓存目录，
由 WorkBuddy 官方 SkinManager 渲染（零注入、零端口、重启不丢）。

用法:
  node wb-skin.mjs list                              列出可作载体的官方皮肤缓存
  node wb-skin.mjs build --name 名称 --from-preset <预设目录>
                        [--image 底图] [--accent auto|#hex] [--secondary #hex]
                        [--base <官方皮肤skin.css>] [--slug xx]
  node wb-skin.mjs install <slug> --carrier <主题key> [--dry-run]
  node wb-skin.mjs restore --carrier <key> | --all    恢复官方原样
  node wb-skin.mjs resync [--carrier <key>]           官方更新后重新注入
  node wb-skin.mjs status                             查看安装状态

目录:
  Studio : ${STUDIO_HOME}
  缓存   : ${APPEARANCE_ROOT}

底图建议:
  横构图, 长边 2560 起步（2560×1440 / 2560×1600 最合身）, JPG 优先, PNG 也可,
  体积 16MB 以内; HEIC / WebP / TIFF 等格式会在构建时自动转为 JPG。
`;

const [, , cmd, ...rest] = process.argv;
try {
  switch (cmd) {
    case 'list': cmdList(); break;
    case 'build': cmdBuild(rest); break;
    case 'install': cmdInstall(rest); break;
    case 'restore': cmdRestore(rest); break;
    case 'resync': cmdResync(rest); break;
    case 'status': cmdStatus(); break;
    default: console.log(HELP); break;
  }
} catch (e) {
  console.error(`\n✗ 执行失败: ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n') || ''}`);
  process.exit(1);
}
