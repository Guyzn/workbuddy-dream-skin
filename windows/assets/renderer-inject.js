((cssText, artSpec, themeConfig, menuData) => {
  const STATE_KEY = "__WORKBUDDY_DREAM_SKIN_STATE__";
  const DISABLED_KEY = "__WORKBUDDY_DREAM_SKIN_DISABLED__";
  const STYLE_ID = "workbuddy-dream-skin-style";
  const CHROME_ID = "workbuddy-dream-skin-chrome";
  const OP_UI_TAG = "workbuddy-dream-skin-operation";
  const MENU_ROOT_ID = "workbuddy-dream-skin-menu";
  const MENU_STORAGE_KEY = "workbuddyDreamSkinCustom";
  const SHELL_ATTR = "data-dream-shell";
  const ART_ATTRS = [
    "data-dream-art-wide", "data-dream-art-safe", "data-dream-task-mode",
    "data-dream-art-safe-area", "data-dream-art-task-mode", "data-dream-art-aspect",
    "data-dream-art-ready",
  ];
  const VERSION = __DREAM_SKIN_VERSION_JSON__;
  const STYLE_REVISION = __DREAM_SKIN_STYLE_REVISION_JSON__;
  const PAYLOAD_REVISION = __DREAM_SKIN_PAYLOAD_REVISION_JSON__;
  let THEME = themeConfig && typeof themeConfig === "object" ? themeConfig : {};
  let ART = THEME.art && typeof THEME.art === "object" ? THEME.art : {};
  const ART_METADATA = THEME.artMetadata && typeof THEME.artMetadata === "object" ? THEME.artMetadata : null;
  // Menu data: [{ id, name, theme, artSpec }] from the Node side.
  let MENU_ENTRIES = Array.isArray(menuData) ? menuData.filter((e) => e && e.id && typeof e.theme === "object") : [];
  const ANALYSIS_CACHE_KEY = "__WORKBUDDY_DREAM_SKIN_ANALYSIS_CACHE__";
  const THEME_VARIABLES = [
    "--ds-bg", "--ds-panel", "--ds-panel-2", "--ds-green", "--ds-lime",
    "--ds-cyan", "--ds-purple", "--ds-text", "--ds-muted", "--ds-line",
    "--ds-bg-rgb", "--ds-panel-rgb", "--ds-panel-2-rgb", "--ds-green-rgb",
    "--ds-lime-rgb", "--ds-cyan-rgb", "--ds-purple-rgb",
    "--ds-text-rgb", "--ds-muted-rgb", "--ds-line-rgb",
    "--dream-skin-art", "--dream-art-focus-x", "--dream-art-focus-y",
    "--dream-art-position", "--dream-skin-focus-x", "--dream-skin-focus-y",
    "--dream-skin-art-position", "--dream-skin-name", "--dream-skin-tagline",
  ];
  const installToken = {};
  const existingCache = window[ANALYSIS_CACHE_KEY];
  const analysisCache = existingCache && typeof existingCache.get === "function" && typeof existingCache.set === "function" ? existingCache : new Map();
  window[ANALYSIS_CACHE_KEY] = analysisCache;
  let artAnalysis = typeof THEME.artKey === "string" ? analysisCache.get(THEME.artKey) ?? null : null;
  let analysisTimer = null;
  let samplingNativeShell = false;
  let rootObserver = null;
  const now = () => typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
  const metrics = { ensureCalls: 0, rootPasses: 0, routePasses: 0, styleWrites: 0, attributeWrites: 0, analysisRuns: 0, analysisCacheHits: artAnalysis ? 1 : 0, firstEnsureMs: null, analysisMs: null };
  window[DISABLED_KEY] = false;

  const previous = window[STATE_KEY];

  // Resolve art: image data URL -> blob URL; CSS gradient/url -> used directly (no canvas analysis).
  let artUrl = null;
  let artCss = null;
  let isImage = false;
  const resolveArt = (spec) => {
    if (artUrl) { try { URL.revokeObjectURL(artUrl); } catch {} }
    artUrl = null; artCss = null; isImage = false;
    if (typeof spec !== "string") return;
    const trimmed = spec.trim();
    if (/^data:image\//.test(trimmed)) {
      isImage = true;
      try {
        const comma = trimmed.indexOf(",");
        const mime = /^data:([^;,]+)/.exec(trimmed)?.[1] || "image/png";
        const binary = atob(trimmed.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        artUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch { artUrl = null; }
    } else if (/^(linear-gradient|radial-gradient|conic-gradient|url\(|repeating-)/.test(trimmed)) {
      artCss = trimmed;
    } else if (trimmed.length) {
      artCss = `linear-gradient(135deg, ${trimmed.split(/[\s,]+/).join(", ")})`;
    }
  };
  resolveArt(artSpec);

  if (previous?.observer) previous.observer.disconnect();
  if (previous?.rootObserver) previous.rootObserver.disconnect();
  if (previous?.resizeObserver) previous.resizeObserver.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.scheduler?.frame != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(previous.scheduler.frame);
  if (previous?.analysisTimer) clearTimeout(previous.analysisTimer);
  if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
  if (previous?.mediaHandler && previous?.mediaQuery) { try { previous.mediaQuery.removeEventListener("change", previous.mediaHandler); } catch {} }

  const cssString = (value) => JSON.stringify(String(value ?? ""));
  const setStyleProperty = (root, name, value) => {
    if (!value) return;
    if (root.style.getPropertyValue(name) !== value) { root.style.setProperty(name, value); metrics.styleWrites += 1; }
  };
  const setAttribute = (root, name, value) => {
    const normalized = String(value);
    if (root.getAttribute(name) !== normalized) { root.setAttribute(name, normalized); metrics.attributeWrites += 1; }
  };
  const setTextContent = (node, value) => { if (node && node.textContent !== value) { node.textContent = value; } };
  const parseRgb = (value) => {
    if (!value || value === "transparent") return null;
    const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) { const n = Number.parseInt(hex[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 }; }
    const m = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const rgbString = (value) => { const rgb = parseRgb(value); return rgb ? `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}` : null; };
  const rgbToHex = ({ r, g, b }) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
  const rgbToHsl = ({ r, g, b }) => {
    const v = [r, g, b].map((c) => c / 255);
    const max = Math.max(...v), min = Math.min(...v), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === v[0]) h = (v[1] - v[2]) / d + (v[1] < v[2] ? 6 : 0);
    else if (max === v[1]) h = (v[2] - v[0]) / d + 2;
    else h = (v[0] - v[1]) / d + 4;
    return { h: h * 60, s, l };
  };
  const hslToRgb = ({ h, s, l }) => {
    const hue = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const n = Math.round(l * 255); return { r: n, g: n, b: n }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const ch = (o) => { let t = hue + o; if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
    return { r: ch(1/3) * 255, g: ch(0) * 255, b: ch(-1/3) * 255 };
  };
  const luminance = ({ r, g, b }) => { const lin = [r, g, b].map((c) => { const x = c/255; return x <= 0.03928 ? x/12.92 : ((x+0.055)/1.055)**2.4; }); return 0.2126*lin[0] + 0.7152*lin[1] + 0.0722*lin[2]; };

  // WorkBuddy shell detection: data-vscode-theme-name, VS Code color-scheme, classes, media.
  const detectShellMode = () => {
    const root = document.documentElement, body = document.body;
    const cls = `${root.className || ""} ${body?.className || ""}`.toLowerCase();
    if (/\b(dark|theme-dark|vscode-dark)\b/.test(cls)) return "dark";
    if (/\b(light|theme-light|vscode-light)\b/.test(cls)) return "light";
    const themeName = (body?.getAttribute("data-vscode-theme-name") || root.getAttribute("data-vscode-theme-name") || "").toLowerCase();
    if (themeName.includes("dark")) return "dark";
    if (themeName.includes("light")) return "light";
    const dataTheme = (root.getAttribute("data-theme") || root.getAttribute("data-appearance") || root.getAttribute("data-color-mode") || body?.getAttribute("data-theme") || "").toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";
    try {
      const had = root.classList.contains("workbuddy-dream-skin");
      const saved = root.getAttribute(SHELL_ATTR);
      samplingNativeShell = true;
      if (had) root.classList.remove("workbuddy-dream-skin");
      if (saved !== null) root.removeAttribute(SHELL_ATTR);
      let cs = "";
      try { cs = getComputedStyle(root).colorScheme || ""; } finally {
        if (had) root.classList.add("workbuddy-dream-skin");
        if (saved !== null) root.setAttribute(SHELL_ATTR, saved);
        rootObserver?.takeRecords?.();
        samplingNativeShell = false;
      }
      if (cs.includes("dark") && !cs.includes("light")) return "dark";
      if (cs.includes("light") && !cs.includes("dark")) return "light";
    } catch { samplingNativeShell = false; }
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch {}
    return "light";
  };

  const makeAdaptivePalette = (sample, shell) => {
    const source = sample || { r: 108, g: 126, b: 136 };
    const hsl = rgbToHsl(source);
    const hue = hsl.s < 0.12 ? 214 : hsl.h;
    const sat = clamp(hsl.s, 0.38, 0.72);
    const accent = hslToRgb({ h: hue, s: sat, l: shell === "light" ? 0.42 : 0.66 });
    const accentAlt = hslToRgb({ h: hue + 12, s: sat * 0.82, l: shell === "light" ? 0.52 : 0.73 });
    const secondary = hslToRgb({ h: hue - 24, s: sat * 0.64, l: shell === "light" ? 0.56 : 0.62 });
    const highlight = hslToRgb({ h: hue + 24, s: sat * 0.76, l: shell === "light" ? 0.36 : 0.58 });
    const neutral = (l, c = 0.08) => rgbToHex(hslToRgb({ h: hue, s: c, l }));
    return shell === "light" ? {
      background: neutral(0.965, 0.07), panel: neutral(0.987, 0.035), panelAlt: neutral(0.945, 0.09),
      accent: rgbToHex(accent), accentAlt: rgbToHex(accentAlt), secondary: rgbToHex(secondary), highlight: rgbToHex(highlight),
      text: neutral(0.13, 0.10), muted: neutral(0.42, 0.08),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .24)`,
    } : {
      background: neutral(0.055, 0.045), panel: neutral(0.085, 0.04), panelAlt: neutral(0.125, 0.05),
      accent: rgbToHex(accent), accentAlt: rgbToHex(accentAlt), secondary: rgbToHex(secondary), highlight: rgbToHex(highlight),
      text: neutral(0.93, 0.025), muted: neutral(0.69, 0.03),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .28)`,
    };
  };

  const resolvedShell = () => {
    if (THEME.appearance === "light" || THEME.appearance === "dark") return THEME.appearance;
    return detectShellMode();
  };

  // Map the dream-skin palette onto VS Code / WorkBuddy surface + accent variables.
  const recordedVscodeKeys = new Set();
  const applyTheme = (root, shell) => {
    const colors = THEME.colors || {};
    const explicit = new Set(Array.isArray(THEME.explicitColorKeys) ? THEME.explicitColorKeys : []);
    const adaptive = makeAdaptivePalette(artAnalysis?.accentRgb, shell);
    const legacyLight = !THEME.appearance && shell === "light";
    const structural = new Set(["background", "panel", "panelAlt", "text", "muted"]);
    const pick = (name) => {
      const allow = explicit.has(name) && !(legacyLight && structural.has(name));
      return allow && typeof colors[name] === "string" ? colors[name] : adaptive[name];
    };
    const accent = pick("accent");
    const accentAlt = explicit.has("accentAlt") ? pick("accentAlt") : (explicit.has("accent") ? accent : adaptive.accentAlt);
    const surfaceAlpha = typeof THEME.surfaceAlpha === "number" ? THEME.surfaceAlpha : (shell === "light" ? 0.80 : 0.84);
    const toRgba = (hexOrRgb, alpha) => {
      const rgb = parseRgb(hexOrRgb);
      if (!rgb) return hexOrRgb;
      return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`;
    };
    const surface = (name) => toRgba(pick(name), surfaceAlpha);
    // VS Code variable overrides (read by WorkBuddy's --vscode-* theming).
    const vscode = {
      "--vscode-editor-background": surface("background"),
      "--vscode-sideBar-background": surface("panel"),
      "--vscode-sideBarsectionHeader-background": surface("panel"),
      "--vscode-panel-background": surface("background"),
      "--vscode-panelSection-background": surface("panel"),
      "--vscode-panelTitle-activeBackground": surface("panel"),
      "--vscode-editorWidget-background": surface("panelAlt"),
      "--vscode-editorWidget-border": adaptive.line,
      "--vscode-dropdown-background": surface("panelAlt"),
      "--vscode-input-background": surface("panelAlt"),
      "--vscode-list-activeSelectionBackground": toRgba(accent, 0.28),
      "--vscode-list-hoverBackground": toRgba(accent, 0.14),
      "--vscode-list-inactiveSelectionBackground": toRgba(accent, 0.18),
      "--vscode-tab-activeBackground": surface("panel"),
      "--vscode-tab-inactiveBackground": surface("background"),
      "--vscode-titleBar-activeBackground": surface("background"),
      "--vscode-titleBar-inactiveBackground": surface("background"),
      "--vscode-activityBar-background": surface("background"),
      "--vscode-activityBar-inactiveForeground": adaptive.muted,
      "--vscode-statusBar-background": surface("background"),
      "--vscode-statusBar-foreground": adaptive.text,
      "--vscode-chat-background": surface("background"),
      "--vscode-chat-requestBackground": surface("panelAlt"),
      "--vscode-chat-slashCommandBackground": toRgba(accent, 0.16),
      "--vscode-focus-border": accent,
      "--vscode-focusBorder": accent,
      "--vscode-button-background": accent,
      "--vscode-button-hoverBackground": accentAlt,
      "--vscode-button-secondaryBackground": surface("panelAlt"),
      "--vscode-textLink-foreground": accentAlt,
      "--vscode-textLink-activeForeground": accentAlt,
      "--vscode-progressBar-background": accent,
      "--vscode-toolbar-hoverBackground": toRgba(accent, 0.16),
      "--vscode-toolbar-activeBackground": toRgba(accent, 0.22),
      "--vscode-badge-background": accent,
      "--vscode-badge-foreground": shell === "light" ? "#ffffff" : "#0c0d10",
      "--vscode-inputOption-activeBackground": toRgba(accent, 0.22),
      "--vscode-inputOption-activeBorder": accent,
      "--vscode-scrollbarSlider-background": toRgba(accent, 0.22),
      "--vscode-scrollbarSlider-hoverBackground": toRgba(accent, 0.38),
      "--vscode-scrollbarSlider-activeBackground": toRgba(accent, 0.5),
      "--vscode-widget-shadow": "rgba(0,0,0,0.36)",
      "--vscode-commandCenter-activeBackground": surface("panelAlt"),
    };
    for (const [name, value] of Object.entries(vscode)) { recordedVscodeKeys.add(name); setStyleProperty(root, name, value); }
    // WorkBuddy-specific --cb-* increments (the stable --vscode-* layer above stays
    // as the general base; these cover WorkBuddy's own design variables: titlebar,
    // dark buttons, scrollbars, borders/markdown rules, team cards, etc.).
    const cb = {
      // surfaces
      "--cb-bg-primary": pick("background"),
      "--cb-bg-secondary": toRgba(pick("background"), 0.94),
      "--cb-panel-bg-primary": toRgba(pick("panel"), 0.88),
      "--cb-team-member-card-background": toRgba(pick("panel"), 0.88),
      // text
      "--cb-text-primary": pick("text"),
      "--cb-text-secondary": toRgba(pick("text"), 0.70),
      "--cb-text-disabled": toRgba(pick("text"), 0.42),
      "--cb-text-link": accentAlt,
      "--cb-text-error-active": accent,
      // VS Code theme-color wrappers
      "--cb-vscode-editor-background": pick("background"),
      "--cb-vscode-sideBar-background": toRgba(pick("panel"), 0.90),
      "--cb-vscode-foreground": pick("text"),
      "--cb-vscode-editor-foreground": pick("text"),
      "--cb-vscode-descriptionForeground": toRgba(pick("text"), 0.70),
      "--cb-vscode-titleBar-activeBackground": surface("background"),
      "--cb-vscode-titleBar-activeForeground": pick("text"),
      "--cb-vscode-titleBar-inactiveBackground": toRgba(pick("background"), 0.8),
      "--cb-vscode-titleBar-inactiveForeground": toRgba(pick("text"), 0.7),
      "--cb-titlebar-control-hover-background": toRgba(accent, 0.16),
      "--cb-vscode-input-background": toRgba(pick("panelAlt"), 0.88),
      "--cb-vscode-dropdown-background": toRgba(pick("panelAlt"), 0.94),
      "--cb-vscode-list-hoverBackground": toRgba(accent, 0.16),
      "--cb-vscode-toolbar-hoverBackground": toRgba(accent, 0.16),
      "--cb-vscode-scrollbarSlider-background": toRgba(accent, 0.30),
      "--cb-vscode-scrollbarSlider-hoverBackground": toRgba(accent, 0.50),
      "--cb-vscode-textLink-foreground": accentAlt,
      "--cb-vscode-widget-border": toRgba(accent, 0.45),
      "--cb-vscode-panel-border": toRgba(accent, 0.30),
      // buttons
      "--cb-button-dark-background": accent,
      "--cb-button-dark-foreground": shell === "light" ? "#ffffff" : "#0c0d10",
      "--cb-button-dark-hover-background": accentAlt,
      "--cb-vscode-button-background": accent,
      "--cb-vscode-button-foreground": shell === "light" ? "#ffffff" : "#0c0d10",
      "--cb-vscode-button-hoverBackground": accentAlt,
      // strokes
      "--cb-stroke-secondary": toRgba(accent, 0.45),
      "--cb-markdown-hr-border-color": toRgba(accent, 0.30),
    };
    for (const [name, value] of Object.entries(cb)) { recordedVscodeKeys.add(name); setStyleProperty(root, name, value); }
    // Internal dream-skin vars.
    const dsVars = {
      "--ds-bg": pick("background"), "--ds-panel": pick("panel"), "--ds-panel-2": pick("panelAlt"),
      "--ds-green": accent, "--ds-lime": accentAlt, "--ds-cyan": pick("secondary"), "--ds-purple": pick("highlight"),
      "--ds-text": pick("text"), "--ds-muted": pick("muted"), "--ds-line": adaptive.line,
    };
    for (const [name, value] of Object.entries(dsVars)) setStyleProperty(root, name, value);
    for (const [name, value] of Object.entries(dsVars)) { const rgb = rgbString(value); if (rgb) setStyleProperty(root, name + "-rgb", rgb); }
    setStyleProperty(root, "--dream-skin-name", cssString(THEME.name || "WorkBuddy Dream Skin"));
    setStyleProperty(root, "--dream-skin-tagline", cssString(THEME.tagline || "Make something wonderful."));
    setStyleProperty(root, "--dream-surface-alpha", String(surfaceAlpha));
    if (typeof THEME.blur === "number") setStyleProperty(root, "--dream-blur", `${THEME.blur}px`);
    if (typeof THEME.scrim === "number") setStyleProperty(root, "--dream-scrim", String(THEME.scrim));
    if (typeof THEME.homeScrim === "number") setStyleProperty(root, "--dream-home-scrim", String(THEME.homeScrim));
  };

  const applyArtMetadata = (root) => {
    const profile = artAnalysis || ART_METADATA;
    const inferredSafe = profile?.safeArea || "center";
    const safeArea = ART.safeArea && ART.safeArea !== "auto" ? ART.safeArea : inferredSafe;
    const canonicalSafe = ["left", "right", "center", "none"].includes(safeArea) ? safeArea : "center";
    const focusX = typeof ART.focusX === "number" ? ART.focusX : profile?.focusX ?? (safeArea === "left" ? 0.72 : safeArea === "right" ? 0.28 : 0.5);
    const focusY = typeof ART.focusY === "number" ? ART.focusY : profile?.focusY ?? 0.5;
    const taskMode = ART.taskMode && ART.taskMode !== "auto" ? ART.taskMode : profile?.taskMode || "ambient";
    const wide = profile?.wide || false;
    const aspect = profile?.aspect || "unknown";
    const fx = `${(clamp(focusX, 0, 1) * 100).toFixed(2)}%`;
    const fy = `${(clamp(focusY, 0, 1) * 100).toFixed(2)}%`;
    setAttribute(root, "data-dream-art-wide", wide ? "true" : "false");
    setAttribute(root, "data-dream-art-safe", canonicalSafe);
    setAttribute(root, "data-dream-task-mode", taskMode);
    setAttribute(root, "data-dream-art-safe-area", safeArea);
    setAttribute(root, "data-dream-art-task-mode", taskMode);
    setAttribute(root, "data-dream-art-aspect", aspect);
    setAttribute(root, "data-dream-art-ready", artAnalysis ? "true" : "false");
    setStyleProperty(root, "--dream-art-focus-x", fx);
    setStyleProperty(root, "--dream-art-focus-y", fy);
    setStyleProperty(root, "--dream-art-position", `${fx} ${fy}`);
    setStyleProperty(root, "--dream-skin-focus-x", fx);
    setStyleProperty(root, "--dream-skin-focus-y", fy);
    setStyleProperty(root, "--dream-skin-art-position", `${fx} ${fy}`);
  };

  const analyzeArt = () => new Promise((resolve) => {
    metrics.analysisRuns += 1;
    if (!isImage || !artUrl || typeof window.Image !== "function" || !document?.createElement) return resolve(null);
    const image = new window.Image();
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; if (analysisTimer) clearTimeout(analysisTimer); analysisTimer = null; resolve(v); };
    analysisTimer = setTimeout(() => finish(null), 6000);
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        const ratio = image.naturalWidth / image.naturalHeight;
        if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("bad dims");
        const maxDim = 96;
        const w = Math.max(16, Math.round(ratio >= 1 ? maxDim : maxDim * ratio));
        const h = Math.max(16, Math.round(ratio >= 1 ? maxDim / ratio : maxDim));
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(image, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
        let lightTotal = 0, count = 0;
        const samples = new Array(w * h);
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
          const o = (y * w + x) * 4; if (data[o + 3] < 32) continue;
          const rgb = { r: data[o], g: data[o + 1], b: data[o + 2] };
          const light = (0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b) / 255;
          const hsl = rgbToHsl(rgb); samples[y*w + x] = { light, s: hsl.s };
          lightTotal += light; count += 1;
          if (hsl.s >= 0.16 && hsl.l >= 0.16 && hsl.l <= 0.86) {
            const bin = bins[Math.min(23, Math.floor(hsl.h / 15))];
            const weight = hsl.s * (1 - Math.abs(hsl.l - 0.52) * 0.85);
            bin.weight += weight; bin.r += rgb.r * weight; bin.g += rgb.g * weight; bin.b += rgb.b * weight;
          }
        }
        if (!count) throw new Error("empty");
        const brightness = lightTotal / count;
        const info = (s, e) => { let t = 0, sq = 0, p = 0; for (let y = 0; y < h; y += 1) for (let x = s; x < e; x += 1) { const sm = samples[y*w + x]; if (!sm) continue; t += sm.light; sq += sm.light*sm.light; p += 1; } const m = p ? t/p : 0; return Math.sqrt(Math.max(0, sq/p - m*m)); };
        const zw = Math.max(1, Math.floor(w * 0.38));
        const leftI = info(0, zw), rightI = info(w - zw, w);
        let safeArea = "center";
        if (leftI < rightI * 0.86) safeArea = "left"; else if (rightI < leftI * 0.86) safeArea = "right";
        const accentBin = bins.reduce((b, c) => c.weight > b.weight ? c : b, bins[0]);
        const accentRgb = accentBin.weight > 0 ? { r: accentBin.r/accentBin.weight, g: accentBin.g/accentBin.weight, b: accentBin.b/accentBin.weight } : null;
        const aspect = ratio >= 2.25 ? "ultrawide" : ratio >= 1.45 ? "wide" : ratio >= 1.08 ? "landscape" : ratio >= 0.9 ? "square" : "portrait";
        finish({ width: image.naturalWidth, height: image.naturalHeight, ratio, wide: ratio >= 1.75, aspect, brightness, shell: brightness >= 0.58 ? "light" : "dark", safeArea, focusX: 0.5, focusY: 0.5, taskMode: ratio >= 2.25 ? "banner" : "ambient", accentRgb });
      } catch { finish(null); }
    };
    image.src = artUrl;
  });

  let chromeParts = null;
  let observedShellMain = null;
  let resizeObserver = null;

  const ensureStyle = (root) => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID; style.textContent = cssText; style.dataset.dreamSkinVersion = VERSION;
      (document.head || root).appendChild(style);
    } else if (style.dataset.dreamSkinStyleRevision !== STYLE_REVISION) {
      style.textContent = cssText;
    }
    style.dataset.dreamSkinVersion = VERSION;
    style.dataset.dreamSkinStyleRevision = STYLE_REVISION;
    return style;
  };

  const applyRootState = (root) => {
    ensureStyle(root);
    const shell = resolvedShell();
    setAttribute(root, SHELL_ATTR, shell);
    setStyleProperty(root, "--dream-skin-art", artCss ? artCss : (artUrl ? `url("${artUrl}")` : "none"));
    applyTheme(root, shell);
    applyArtMetadata(root);
    root.classList.add("workbuddy-dream-skin");
    document.body?.classList.add("workbuddy-dream-skin");
    return shell;
  };

  const detectHome = () => {
    const root = document.getElementById("root");
    if (!root) return null;
    const homeSelector = THEME.homeSelector || "[class*='welcome'], [class*='Welcome'], [class*='home'], [class*='Home'], [class*='onboarding'], [class*='empty']";
    const composerSelector = "textarea, [contenteditable='true'], [class*='composer'], [class*='Composer'], [class*='chat-input'], [class*='ChatInput'], [data-testid*='composer'], [data-testid*='input']";
    try {
      const homeMark = root.querySelector(homeSelector);
      const composer = root.querySelector(composerSelector);
      if (homeMark && !composer) return homeMark.closest("[role='main']") || homeMark;
      if (composer) return null; // conversation/task view
      return homeMark || null;
    } catch { return null; }
  };

  const syncRouteState = (shell, { layout = false } = {}) => {
    metrics.routePasses += 1;
    const root = document.documentElement;
    if (!root) return;
    shell ||= root.getAttribute(SHELL_ATTR) || resolvedShell();
    const home = detectHome();
    for (const c of document.querySelectorAll(".dream-skin-home")) if (c !== home) c.classList.remove("dream-skin-home");
    if (home) home.classList.add("dream-skin-home");
    root.classList.toggle("dream-skin-home", Boolean(home));

    let chrome = document.getElementById(CHROME_ID);
    let created = false;
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div"); chrome.id = CHROME_ID; chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `<div class="dream-skin-brand"><span class="dream-skin-portal-mark">◉</span><span><b></b><small></small></span></div><div class="dream-skin-status"><i></i><span></span></div><div class="dream-skin-quote"></div>`;
      document.body.appendChild(chrome); created = true; chromeParts = null;
    }
    if (!chromeParts || chromeParts.chrome !== chrome) {
      chromeParts = { chrome, name: chrome.querySelector(".dream-skin-brand b"), subtitle: chrome.querySelector(".dream-skin-brand small"), status: chrome.querySelector(".dream-skin-status span"), quote: chrome.querySelector(".dream-skin-quote") };
    }
    setTextContent(chromeParts.name, THEME.name || "WorkBuddy Dream Skin");
    setTextContent(chromeParts.subtitle, THEME.brandSubtitle || "WORKBUDDY DREAM SKIN");
    setTextContent(chromeParts.status, THEME.statusText || "DREAM SKIN ONLINE");
    setTextContent(chromeParts.quote, THEME.quote || "MAKE SOMETHING WONDERFUL");
  };

  const ensure = ({ root: rootPass = true, route = true } = {}) => {
    if (window[DISABLED_KEY]) return;
    const root = document.documentElement; if (!root) return;
    metrics.ensureCalls += 1;
    const shell = rootPass ? applyRootState(root) : null;
    if (route) syncRouteState(shell);
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window[DISABLED_KEY] = true;
    const root = document.documentElement;
    root?.classList.remove("workbuddy-dream-skin");
    document.body?.classList.remove("workbuddy-dream-skin", "dream-skin-home");
    root?.removeAttribute(SHELL_ATTR);
    for (const name of ART_ATTRS) root?.removeAttribute(name);
    for (const name of THEME_VARIABLES) root?.style.removeProperty(name);
    // Restore VS Code variables by removing our overrides (revert to app defaults).
    for (const name of recordedVscodeKeys) root?.style.removeProperty(name);
    document.querySelectorAll(".dream-skin-home").forEach((n) => n.classList.remove("dream-skin-home"));
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    document.querySelector(OP_UI_TAG)?.remove();
    state?.observer?.disconnect(); state?.rootObserver?.disconnect(); state?.resizeObserver?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.scheduler?.frame != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.scheduler.frame);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (state?.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    if (state?.mediaHandler && state?.mediaQuery) { try { state.mediaQuery.removeEventListener("change", state.mediaHandler); } catch {} }
    if (artUrl) URL.revokeObjectURL(artUrl);
    document.getElementById(MENU_ROOT_ID)?.remove();
    delete window[STATE_KEY];
    return true;
  };

  // ---- In-app 🎨 theme menu (ported concept: instant switching + custom upload) ----
  let menuRows = new Map(); // id -> { row, dot, nameEl }
  let customEntry = null;   // { id, name, theme, artSpec } persisted in localStorage

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  // Simplified palette extractor for uploaded images (24-bin hue weighting, like the
  // built-in analyzeArt but self-contained and sync so the menu can paint instantly).
  const extractPalette = (image) => {
    const maxDim = 96;
    const ratio = image.naturalWidth / image.naturalHeight;
    const w = Math.max(16, Math.round(ratio >= 1 ? maxDim : maxDim * ratio));
    const h = Math.max(16, Math.round(ratio >= 1 ? maxDim / ratio : maxDim));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const bins = new Array(24).fill(0).map(() => ({ weight: 0, r: 0, g: 0, b: 0 }));
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue;
      const d = max - min || 1;
      let h2 = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h2) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const weight = sat * sat;
      bins[bucket].weight += weight; bins[bucket].r += r * weight; bins[bucket].g += g * weight; bins[bucket].b += b * weight;
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = bins.filter((b) => b.weight > 0).sort((a, b2) => b2.weight - a.weight);
    const accent = ranked[0] ? [ranked[0].r / ranked[0].weight, ranked[0].g / ranked[0].weight, ranked[0].b / ranked[0].weight] : [36, 201, 215];
    const light = avgLum > 128;
    const surface = light ? mix(accent, [252, 252, 255], 0.92) : mix(accent, [12, 12, 18], 0.86);
    const text = light ? mix(accent, [16, 24, 40], 0.82) : mix(accent, [244, 246, 252], 0.85);
    return {
      accent: hex(...accent),
      surface: hex(...surface),
      text: hex(...text),
      accentRgb: { r: accent[0], g: accent[1], b: accent[2] },
    };
  };

  // Switch the live skin to another menu entry (bundled preset or custom upload).
  const setTheme = (entry) => {
    if (!entry || typeof entry.theme !== "object" || window[DISABLED_KEY]) return false;
    THEME = entry.theme || {};
    ART = THEME.art && typeof THEME.art === "object" ? THEME.art : {};
    resolveArt(entry.artSpec);
    artAnalysis = null;
    if (typeof THEME.artKey === "string") {
      const cached = analysisCache.get(THEME.artKey) ?? null;
      if (cached) artAnalysis = cached;
    }
    const state = window[STATE_KEY];
    if (state) { state.artUrl = artUrl; state.themeId = THEME.id || "custom"; state.analysis = artAnalysis; }
    ensure({ root: true, route: true });
    paintMenu(entry.id);
    if (isImage && !artAnalysis) {
      analyzeArt().then((analysis) => {
        const st = window[STATE_KEY];
        if (!analysis || st?.installToken !== installToken || window[DISABLED_KEY]) return;
        artAnalysis = analysis; st.analysis = analysis;
        if (typeof THEME.artKey === "string") { analysisCache.set(THEME.artKey, analysis); while (analysisCache.size > 8) analysisCache.delete(analysisCache.keys().next().value); }
        ensure({ root: true, route: false });
      }).catch(() => {});
    }
    return true;
  };

  const paintMenu = (activeId) => {
    for (const [id, r] of menuRows) {
      r.row.style.background = id === activeId ? "rgba(36,201,215,.16)" : "transparent";
      r.row.style.fontWeight = id === activeId ? "700" : "500";
    }
  };

  const clearThemeToNative = () => { cleanup(); };

  const loadCustom = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(MENU_STORAGE_KEY) ?? "null");
      return saved && saved.id && saved.theme && saved.artSpec ? saved : null;
    } catch { return null; }
  };
  const saveCustom = (entry) => {
    try { localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(entry)); }
    catch (error) { console.warn("WorkBuddy Dream Skin：自定义主题过大，本次生效但重启后不保留", error); }
  };
  const deleteCustom = () => {
    try { localStorage.removeItem(MENU_STORAGE_KEY); } catch {}
    if (window[STATE_KEY] && window[STATE_KEY].themeId === "custom-upload") clearTheme();
    menuRows.get("custom-upload")?.row?.remove();
    menuRows.delete("custom-upload");
    customEntry = null;
  };
  const ensureCustomRow = (entry) => {
    if (menuRows.has("custom-upload")) {
      const r = menuRows.get("custom-upload");
      r.nameEl.textContent = entry.name;
      r.dot.style.background = entry.theme.colors?.accent || "#24c9d7";
      return;
    }
    const rowEl = makeMenuRow(entry.name, entry.theme.colors?.accent || "#24c9d7", () => { setTheme(entry); togglePanel(false); }, true);
    menuRows.set("custom-upload", rowEl);
    customEntry = entry;
  };

  const importFromDataUrl = (dataUrl, name) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 1600 / img.width);
        const full = document.createElement("canvas");
        full.width = Math.round(img.width * scale); full.height = Math.round(img.height * scale);
        full.getContext("2d").drawImage(img, 0, 0, full.width, full.height);
        const webp = full.toDataURL("image/webp", 0.82);
        const palette = extractPalette(img);
        const entry = {
          id: "custom-upload",
          name: name || "我的图片",
          artSpec: webp,
          theme: {
            id: "custom-upload", name: name || "我的图片",
            appearance: "auto",
            art: { file: null, focusX: 0.5, focusY: 0.5, safeArea: "center", taskMode: "auto" },
            colors: { accent: palette.accent, surface: palette.surface, text: palette.text },
            explicitColorKeys: ["accent", "surface", "text"],
          },
        };
        saveCustom(entry);
        ensureCustomRow(entry);
        setTheme(entry);
        togglePanel(false);
        resolve(palette);
      } catch (error) { reject(error); }
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });

  let panelOpen = false;
  const togglePanel = (force) => {
    const panel = document.getElementById(MENU_ROOT_ID)?.querySelector?.(".dream-skin-menu-panel");
    if (!panel) return;
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    panel.style.display = panelOpen ? "block" : "none";
  };

  const makeMenuRow = (label, dotColor, onPick, withDelete) => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;";
    const dot = document.createElement("span");
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex:none;background:${dotColor};`;
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    item.append(dot, text);
    item.addEventListener("mouseenter", () => { if (item.style.fontWeight !== "700") item.style.background = "rgba(0,0,0,.05)"; });
    item.addEventListener("mouseleave", () => paintMenu(window[STATE_KEY]?.themeId ?? null));
    item.addEventListener("click", () => onPick(item));
    if (withDelete) {
      const del = document.createElement("span");
      del.textContent = "\u00d7";
      del.title = "删除自定义主题";
      del.style.cssText = "flex:none;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;color:rgba(0,0,0,.45);font-size:14px;";
      del.addEventListener("mouseenter", () => { del.style.background = "rgba(220,60,60,.15)"; del.style.color = "#c03030"; });
      del.addEventListener("mouseleave", () => { del.style.background = "transparent"; del.style.color = "rgba(0,0,0,.45)"; });
      del.addEventListener("click", (event) => { event.stopPropagation(); deleteCustom(); });
      item.appendChild(del);
    }
    return { row: item, dot, nameEl: text };
  };

  const mountMenu = () => {
    document.getElementById(MENU_ROOT_ID)?.remove();
    if (window[DISABLED_KEY]) return;
    const root = document.createElement("div");
    root.id = MENU_ROOT_ID;
    root.style.cssText = "position:fixed;top:48px;right:16px;z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "\u{1F3A8}";
    button.title = "WorkBuddy Dream Skin";
    button.style.cssText = "display:block;margin-left:auto;width:38px;height:38px;border-radius:50%;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);backdrop-filter:blur(10px);box-shadow:0 3px 12px rgba(0,0,0,.24);cursor:pointer;font-size:19px;padding:0;";
    const panel = document.createElement("div");
    panel.className = "dream-skin-menu-panel";
    panel.style.cssText = "display:none;margin-top:8px;min-width:200px;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;";

    menuRows = new Map();
    for (const entry of MENU_ENTRIES) {
      const accent = entry.theme?.colors?.accent || "#24c9d7";
      const r = makeMenuRow(entry.name || entry.id, accent, () => { setTheme(entry); togglePanel(false); });
      panel.appendChild(r.row);
      menuRows.set(entry.id, r);
    }

    const savedCustom = loadCustom();
    if (savedCustom) ensureCustomRow(savedCustom);

    // Upload row
    const uploadRow = makeMenuRow("\uff0b \u81ea\u5b9a\u4e49\u56fe\u7247", "rgba(36,201,215,.9)", () => picker.click());
    uploadRow.row.style.borderTop = "1px solid rgba(0,0,0,.08)";
    panel.appendChild(uploadRow.row);

    // Native row
    const nativeRow = makeMenuRow("\u539f\u751f\u754c\u9762", "rgba(0,0,0,.24)", () => { clearThemeToNative(); togglePanel(false); });
    panel.appendChild(nativeRow.row);

    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg,image/webp";
    picker.style.display = "none";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importFromDataUrl(reader.result, file.name.replace(/\.[a-z0-9]+$/i, ""));
      reader.readAsDataURL(file);
      picker.value = "";
    });

    button.addEventListener("click", () => togglePanel());
    root.append(button, panel, picker);
    document.body.appendChild(root);
    paintMenu(window[STATE_KEY]?.themeId ?? null);
  };

  const clearTheme = () => {
    // Full teardown handled by cleanup(); here we only clear CSS vars without
    // killing the keep-alive so the user can still reopen the menu later.
    const root = document.documentElement;
    root?.classList.remove("workbuddy-dream-skin");
    document.body?.classList.remove("workbuddy-dream-skin", "dream-skin-home");
    root?.removeAttribute(SHELL_ATTR);
    for (const name of ART_ATTRS) root?.removeAttribute(name);
    for (const name of THEME_VARIABLES) root?.style.removeProperty(name);
    const state = window[STATE_KEY];
    if (state) for (const name of recordedVscodeKeys) root?.style.removeProperty(name);
    document.querySelectorAll(".dream-skin-home").forEach((n) => n.classList.remove("dream-skin-home"));
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    if (state) state.themeId = null;
    paintMenu(null);
  };

  const scheduler = { timeout: null, frame: null, root: false, route: false };
  const flush = () => {
    if (scheduler.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(scheduler.frame);
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.frame = null; scheduler.timeout = null;
    const pending = { root: scheduler.root, route: scheduler.route };
    scheduler.root = false; scheduler.route = false;
    ensure(pending);
  };
  const scheduleEnsure = ({ root = false, route = true } = {}) => {
    scheduler.root ||= root; scheduler.route ||= route;
    if (scheduler.timeout || scheduler.frame !== null) return;
    if (typeof requestAnimationFrame === "function") { scheduler.frame = requestAnimationFrame(flush); scheduler.timeout = setTimeout(flush, 96); }
    else scheduler.timeout = setTimeout(flush, 64);
  };
  const observer = new MutationObserver(() => scheduleEnsure({ route: true }));
  rootObserver = new MutationObserver(() => { if (samplingNativeShell) return; scheduleEnsure({ root: true, route: true }); });
  const resizeHandler = () => scheduleEnsure({ route: true });
  if (typeof ResizeObserver === "function") resizeObserver = new ResizeObserver(() => scheduleEnsure({ route: true }));
  let mediaQuery = null, mediaHandler = null;
  try { mediaQuery = window.matchMedia("(prefers-color-scheme: dark)"); mediaHandler = () => scheduleEnsure({ root: true, route: true }); } catch {}

  window[STATE_KEY] = {
    ensure, cleanup, setTheme, clearTheme, deleteCustom, mountMenu, importFromDataUrl, menuEntries: MENU_ENTRIES,
    observer, rootObserver, resizeObserver, timer: null, scheduler, resizeHandler, mediaQuery, mediaHandler,
    artUrl, installToken, analysis: artAnalysis, artMetadata: ART_METADATA, metrics, version: VERSION, themeId: THEME.id || "custom", revision: PAYLOAD_REVISION, detectShellMode,
    vscodeKeys: recordedVscodeKeys,
  };
  ensure({ root: true, route: true });
  mountMenu();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode", "data-vscode-theme-name", "style"] });
  if (document.body) rootObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-name", "style"] });
  const timer = setInterval(() => ensure(), 4000);
  window[STATE_KEY].timer = timer;
  window.addEventListener("resize", resizeHandler, { passive: true });
  if (mediaHandler && mediaQuery) mediaQuery.addEventListener("change", mediaHandler);
  const analysisPromise = isImage && !artAnalysis ? analyzeArt() : Promise.resolve(null);
  window[STATE_KEY].analysisTimer = analysisTimer;
  analysisPromise.then((analysis) => {
    const state = window[STATE_KEY];
    if (!analysis || state?.installToken !== installToken || window[DISABLED_KEY]) return;
    artAnalysis = analysis; state.analysis = analysis;
    if (typeof THEME.artKey === "string") { analysisCache.set(THEME.artKey, analysis); while (analysisCache.size > 8) analysisCache.delete(analysisCache.keys().next().value); }
    ensure({ root: true, route: false });
  }).catch(() => {});
  return { installed: true, version: VERSION, themeId: THEME.id || "custom", revision: PAYLOAD_REVISION, shell: resolvedShell(), analysis: artAnalysis, artKind: isImage ? "image" : (artCss ? "css" : "none") };
})(__DREAM_SKIN_CSS_JSON__, __DREAM_SKIN_ART_JSON__, __DREAM_SKIN_THEME_JSON__, __DREAM_SKIN_MENU_JSON__)
