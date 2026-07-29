// WorkBuddy Dream Skin — CDP injector (Node, zero runtime deps; uses global WebSocket/fetch on Node 22+)
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const assetsDir = path.resolve(here, "..", "assets");
const root = path.resolve(here, "..", "..");

export const SKIN_VERSION = (await readMaybe(path.join(assetsDir, "..", "VERSION")))?.trim() || "1.0.0";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_ART_BYTES = 16 * 1024 * 1024;
const OP_HOST_ID = "workbuddy-dream-skin-operation";

async function readMaybe(p) { try { return await fs.readFile(p, "utf8"); } catch { return null; } }

// ---- CDP helpers ----
async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`/json/list HTTP ${res.status}`);
  return res.json();
}

function wsUrlFromTarget(target) {
  if (typeof target.webSocketDebuggerUrl === "string") return target.webSocketDebuggerUrl;
  return null;
}

async function pickWorkbuddyTarget(targets) {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  // Prefer the renderer entry document.
  const entry = pages.find((t) => (t.url || "").includes("renderer/index.html"));
  if (entry) return entry;
  const filePage = pages.find((t) => (t.url || "").startsWith("file://"));
  if (filePage) return filePage;
  return pages[0] || null;
}

class Cdp {
  constructor(url) { this.url = url; this.ws = null; this.id = 0; this.pending = new Map(); this.queue = []; this.ready = null; }
  connect() {
    this.ws = new WebSocket(this.url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (e) => reject(e.error || new Error("ws error")));
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
    return this.ready;
  }
  send(method, params = {}, sessionId = null) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  async evaluate(expression, sessionId = null, awaitPromise = true, returnByValue = true) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue, contextId: undefined }, sessionId);
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval exception");
    return r?.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

// ---- Payload building ----
async function buildPayload(themeDir) {
  const cssPath = path.join(assetsDir, "dream-skin.css");
  const injectPath = path.join(assetsDir, "renderer-inject.js");
  const css = await fs.readFile(cssPath, "utf8");
  let injectSrc = await fs.readFile(injectPath, "utf8");

  const themePath = path.join(themeDir, "theme.json");
  let theme = {};
  try { theme = JSON.parse(await fs.readFile(themePath, "utf8")); } catch { throw new Error(`Cannot read theme.json at ${themePath}`); }

  // Resolve art spec.
  let artSpec = "none";
  const artFile = theme.art?.file || theme.background;
  if (artFile) {
    const abs = path.isAbsolute(artFile) ? artFile : path.join(themeDir, artFile);
    const buf = await fs.readFile(abs);
    if (buf.length > MAX_ART_BYTES) throw new Error("Art exceeds 16MB limit");
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/png";
    artSpec = `data:${mime};base64,${buf.toString("base64")}`;
  } else if (typeof theme.art?.css === "string" && theme.art.css) {
    artSpec = theme.art.css;
  } else if (typeof theme.art?.gradient === "string") {
    artSpec = theme.art.gradient;
  }

  const cssJson = JSON.stringify(css);
  const artJson = JSON.stringify(artSpec);
  const themeJson = JSON.stringify(theme);

  injectSrc = injectSrc
    .replace("__DREAM_SKIN_CSS_JSON__", cssJson)
    .replace("__DREAM_SKIN_ART_JSON__", artJson)
    .replace("__DREAM_SKIN_THEME_JSON__", themeJson)
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
