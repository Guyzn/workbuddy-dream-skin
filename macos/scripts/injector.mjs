// WorkBuddy Dream Skin — CDP injector (Node, zero runtime deps; uses global WebSocket/fetch on Node 22+)
// CDP transport lives in cdp-client.mjs; this file only builds payloads and
// drives the CLI (apply / verify / restore / inspect / watch / check-payload).
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, listTargets, pickWorkbuddyTarget } from "./cdp-client.mjs";
import { validateThemeJson } from "./theme-schema.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const assetsDir = path.resolve(here, "..", "assets");
const root = path.resolve(here, "..", "..");

export const SKIN_VERSION = (await readMaybe(path.join(assetsDir, "..", "VERSION")))?.trim() || "1.0.0";
const MAX_ART_BYTES = 16 * 1024 * 1024;
const OP_HOST_ID = "workbuddy-dream-skin-operation";

async function readMaybe(p) { try { return await fs.readFile(p, "utf8"); } catch { return null; } }

// ---- Payload building ----

// Resolve a theme directory's art into a data URL / css spec with escape guard.
async function resolveArtSpec(themeDir, theme) {
  const artFile = theme.art?.file || theme.background;
  if (artFile) {
    const abs = path.isAbsolute(artFile) ? artFile : path.join(themeDir, artFile);
    // Path-escape guard: the art file must resolve inside the theme directory.
    // A theme.json pointing anywhere else (absolute path or ../) is rejected.
    const themeRoot = await fs.realpath(themeDir);
    const artReal = await fs.realpath(abs);
    const rel = path.relative(themeRoot, artReal);
    if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Art file escapes the theme directory: ${artFile}`);
    }
    const buf = await fs.readFile(artReal);
    if (buf.length > MAX_ART_BYTES) throw new Error("Art exceeds 16MB limit");
    const ext = path.extname(artReal).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  if (typeof theme.art?.css === "string" && theme.art.css) return theme.art.css;
  if (typeof theme.art?.gradient === "string") return theme.art.gradient;
  return "none";
}

// Collect all theme entries visible to the in-app menu: sibling theme dirs
// (installed state) or the bundled presets root (source checkout).
async function collectMenuThemes(themeDir) {
  const candidates = [];
  const siblingRoot = path.dirname(themeDir);
  const bundledRoot = path.join(root, "presets");
  const roots = [siblingRoot, bundledRoot];
  const seen = new Set();
  for (const candidateRoot of roots) {
    let entries;
    try { entries = await fs.readdir(candidateRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;
      const dir = path.join(candidateRoot, entry.name);
      let theme;
      try { theme = JSON.parse(await fs.readFile(path.join(dir, "theme.json"), "utf8")); } catch { continue; }
      if (!theme?.id) continue;
      let artSpec = "none";
      try { artSpec = await resolveArtSpec(dir, theme); } catch { continue; } // bad art never blocks the menu
      seen.add(entry.name);
      candidates.push({ id: theme.id, name: theme.name || theme.id, theme, artSpec });
    }
  }
  return candidates;
}

async function buildPayload(themeDir) {
  const cssPath = path.join(assetsDir, "dream-skin.css");
  const injectPath = path.join(assetsDir, "renderer-inject.js");
  const css = await fs.readFile(cssPath, "utf8");
  let injectSrc = await fs.readFile(injectPath, "utf8");

  const themePath = path.join(themeDir, "theme.json");
  let theme = {};
  try { theme = JSON.parse(await fs.readFile(themePath, "utf8")); } catch { throw new Error(`Cannot read theme.json at ${themePath}`); }
  validateThemeJson(theme); // schema validation (loose: warns on unknown fields)

  // Resolve art spec.
  const artSpec = await resolveArtSpec(themeDir, theme);
  const menuThemes = await collectMenuThemes(themeDir);

  const cssJson = JSON.stringify(css);
  const artJson = JSON.stringify(artSpec);
  const themeJson = JSON.stringify(theme);
  const menuJson = JSON.stringify(menuThemes);

  injectSrc = injectSrc
    .replace("__DREAM_SKIN_CSS_JSON__", cssJson)
    .replace("__DREAM_SKIN_ART_JSON__", artJson)
    .replace("__DREAM_SKIN_THEME_JSON__", themeJson)
    .replace("__DREAM_SKIN_MENU_JSON__", menuJson)
    .replace("__DREAM_SKIN_VERSION_JSON__", JSON.stringify(SKIN_VERSION))
    .replace("__DREAM_SKIN_STYLE_REVISION_JSON__", JSON.stringify(createHash("sha256").update(css).digest("hex").slice(0, 16)))
    .replace("__DREAM_SKIN_PAYLOAD_REVISION_JSON__", JSON.stringify(createHash("sha256").update(css + artSpec + themeJson).digest("hex").slice(0, 16)));

  return injectSrc;
}

// In-renderer operation overlay controller (injected after the skin payload).
const OP_UI_SRC = `(() => {
  const TAG = ${JSON.stringify(OP_HOST_ID)};
  window.__WB_DREAM_SKIN_OP__ = function(state, label) {
    let el = document.querySelector(TAG);
    if (!el) {
      el = document.createElement(TAG);
      el.innerHTML = '<div class="status"><div class="spinner"></div><div class="mark"></div><div class="label"></div></div>';
      document.body.appendChild(el);
    }
    const mark = el.querySelector('.mark'), spin = el.querySelector('.spinner'), lab = el.querySelector('.label');
    spin.style.display = state === 'loading' ? 'block' : 'none';
    mark.style.display = state === 'loading' ? 'none' : 'block';
    mark.textContent = state === 'success' ? '✓' : state === 'error' ? '✕' : '';
    mark.style.color = state === 'success' ? 'var(--ds-green,#5ad1a0)' : '#ff6b6b';
    lab.textContent = label || '';
    el.setAttribute('data-visible', 'true');
    if (state !== 'loading') setTimeout(() => el.setAttribute('data-visible', 'false'), 1400);
  };
  return true;
})();`;

async function injectInto(cdp, expression) {
  return cdp.evaluate(expression);
}

// ---- CLI ----
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--port") opt.port = Number(args[++i]);
  else if (a === "--theme-dir") opt.themeDir = args[++i];
  else if (a === "--watch") opt.watch = true;
  else if (a === "--once") opt.once = true;
  else if (a === "--verify") opt.verify = true;
  else if (a === "--check-payload") opt.checkPayload = true;
  else if (a === "--restore") opt.restore = true;
  else if (a === "--inspect") opt.inspect = true;
  else if (a === "--timeout-ms") opt.timeout = Number(args[++i]);
  else if (a.startsWith("--")) opt[a.slice(2).replace(/-/g, "_")] = args[++i] ?? true;
}
const PORT = opt.port || 9341;
const THEME_DIR = opt.themeDir || path.join(root, "presets", "preset-aurora-dusk");

if (opt.checkPayload) {
  try { const p = await buildPayload(THEME_DIR); console.log(`payload ok: ${p.length} bytes`); process.exit(0); }
  catch (e) { console.error(e.message); process.exit(1); }
}

async function main() {
  const targets = await listTargets(PORT);
  const target = await pickWorkbuddyTarget(targets);
  if (!target) throw new Error("No WorkBuddy renderer target found on port " + PORT);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");

  if (opt.inspect) {
    const probe = await cdp.evaluate(`(()=>{
      const root = document.documentElement;
      const body = document.body;
      return {
        hasRoot: !!document.getElementById('root'),
        rootClass: root.className || '',
        bodyClass: body?.className || '',
        themeName: body?.getAttribute('data-vscode-theme-name') || root.getAttribute('data-vscode-theme-name') || '',
        colorScheme: getComputedStyle(root).colorScheme || '',
        hasMonaco: !!document.querySelector('.monaco-workbench'),
        skinActive: !!window.__WORKBUDDY_DREAM_SKIN_STATE__,
        title: document.title
      };
    })()`);
    console.log(JSON.stringify(probe, null, 2));
    cdp.close();
    return;
  }

  if (opt.restore) {
    await injectInto(cdp, "(()=>{ try { return window.__WORKBUDDY_DREAM_SKIN_STATE__ ? window.__WORKBUDDY_DREAM_SKIN_STATE__.cleanup() : true; } catch(e){ return 'no-state'; } })()");
    console.log("restore: skin cleanup requested");
    cdp.close();
    return;
  }

  const payload = await buildPayload(THEME_DIR);
  // Show loading overlay, then apply, then success.
  await injectInto(cdp, "window.__WB_DREAM_SKIN_OP__ ? 0 : 0;");
  await injectInto(cdp, OP_UI_SRC);
  await injectInto(cdp, "window.__WB_DREAM_SKIN_OP__('loading','正在应用皮肤…')");
  const result = await injectInto(cdp, payload);
  await injectInto(cdp, "window.__WB_DREAM_SKIN_OP__('success','皮肤已应用')");

  if (opt.verify || opt.once) {
    const ok = await verify(cdp);
    if (!ok) { await injectInto(cdp, "window.__WB_DREAM_SKIN_OP__('error','校验失败')"); throw new Error("verify failed"); }
    console.log("verify: ok");
  }
  if (opt.watch) {
    console.log("watch: keeping skin alive (Ctrl-C to stop)");
    // The renderer self-keeps-alive via interval; here we just hold the connection.
    setInterval(() => {}, 1 << 30);
  }
  if (!opt.watch) cdp.close();
  return result;
}

async function verify(cdp) {
  try {
    const r = await cdp.evaluate(`(()=>{
      const root = document.documentElement;
      const style = document.getElementById('workbuddy-dream-skin-style');
      const hasArt = getComputedStyle(root).getPropertyValue('--dream-skin-art');
      return { style: !!style, shell: root.getAttribute('data-dream-shell'), art: !!hasArt.trim() };
    })()`);
    return !!(r && r.style && r.art);
  } catch { return false; }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
