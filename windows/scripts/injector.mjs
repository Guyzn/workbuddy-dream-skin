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

// ---- CDP helpers (hardened: port/URL validation, timeouts, error taxonomy) ----

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5000;

function validatePort(port) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new TypeError(`port must be an integer from ${MIN_PORT} through ${MAX_PORT}`);
  }
  return port;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// CDP loopback rule: ws://127.0.0.1 with an explicit port, no credentials/hash.
function parseLoopbackWebSocketUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError("webSocketDebuggerUrl must be a non-empty URL string");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`webSocketDebuggerUrl is invalid: ${errorMessage(error)}`, { cause: error });
  }
  if (
    parsed.protocol !== "ws:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.port
  ) {
    throw new TypeError("webSocketDebuggerUrl must use ws://127.0.0.1 with an explicit port");
  }
  validatePort(Number(parsed.port));
  return parsed;
}

async function listTargets(port) {
  validatePort(port);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(DEFAULT_DISCOVERY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`/json/list HTTP ${res.status}`);
  return res.json();
}

function wsUrlFromTarget(target) {
  if (typeof target.webSocketDebuggerUrl !== "string") return null;
  try { parseLoopbackWebSocketUrl(target.webSocketDebuggerUrl); return target.webSocketDebuggerUrl; } catch { return null; }
}

async function pickWorkbuddyTarget(targets) {
  const pages = targets.filter((t) => t.type === "page" && wsUrlFromTarget(t));
  // Prefer the renderer entry document.
  const entry = pages.find((t) => (t.url || "").includes("renderer/index.html"));
  if (entry) return entry;
  const filePage = pages.find((t) => (t.url || "").startsWith("file://"));
  if (filePage) return filePage;
  return pages[0] || null;
}

class CdpError extends Error { constructor(message, options) { super(message, options); this.name = "CdpError"; } }
class CdpProtocolError extends CdpError {
  constructor(method, payload) {
    const code = payload && Object.hasOwn(payload, "code") ? payload.code : undefined;
    const message = typeof payload?.message === "string" ? payload.message : "unknown CDP error";
    const codeText = code === undefined ? "" : ` (${code})`;
    super(`CDP ${method} failed${codeText}: ${message}`);
    this.name = "CdpProtocolError";
    if (code !== undefined) this.code = code;
    if (payload && Object.hasOwn(payload, "data")) this.data = payload.data;
  }
}
class CdpEvaluationError extends CdpError {
  constructor(exceptionDetails) {
    const description = exceptionDetails?.exception?.description;
    const text = exceptionDetails?.text;
    const detail = typeof description === "string" && description.length > 0
      ? description
      : typeof text === "string" && text.length > 0 ? text : "unknown JavaScript exception";
    super(`Runtime.evaluate failed: ${detail}`);
    this.name = "CdpEvaluationError";
    this.exceptionDetails = exceptionDetails;
  }
}

class Cdp {
  constructor(url, { connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    parseLoopbackWebSocketUrl(url); // reject non-loopback URLs up front
    this.url = url;
    this.connectTimeoutMs = connectTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.queue = [];
    this.ready = null;
    this.opened = false;
    this.closed = false;
    this.closeStarted = false;
    this.terminalError = null;
    this.openPromise = null;
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.connectTimer = null;
  }

  open() {
    if (this.closed) return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    if (this.opened) return Promise.resolve(this);
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    this.connectTimer = setTimeout(() => {
      this.terminate(new Error(`CDP WebSocket connect timed out after ${this.connectTimeoutMs}ms`));
      this.closeSocket();
    }, this.connectTimeoutMs);

    try {
      this.ws = new WebSocket(this.url);
    } catch (error) {
      this.terminate(new Error(`failed to open CDP WebSocket: ${errorMessage(error)}`, { cause: error }));
      return this.openPromise;
    }

    this.ws.onopen = () => {
      if (this.closed || this.opened) return;
      this.clearConnectTimer();
      Promise.all([this.send("Runtime.enable"), this.send("Page.enable")])
        .then(() => {
          if (this.closed) return;
          this.opened = true;
          const resolve = this.resolveOpen;
          this.resolveOpen = null;
          this.rejectOpen = null;
          resolve?.(this);
        })
        .catch((error) => { this.terminate(error); this.closeSocket(); });
    };
    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (error) { this.terminate(new Error(`received malformed CDP JSON: ${errorMessage(error)}`)); this.closeSocket(); return; }
      if (!Number.isInteger(msg?.id)) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new CdpProtocolError(pending.method, msg.error));
      else pending.resolve(msg.result);
    };
    this.ws.onerror = (event) => {
      const source = event?.error;
      this.terminate(new Error(`CDP WebSocket error: ${source instanceof Error ? source.message : "unknown socket error"}`, { cause: source instanceof Error ? source : undefined }));
      this.closeSocket();
    };
    this.ws.onclose = (event) => {
      this.closeStarted = true;
      const code = Number.isInteger(event?.code) ? event.code : "unknown";
      const reason = typeof event?.reason === "string" && event.reason.length > 0 ? `, reason: ${event.reason}` : "";
      this.terminate(new Error(`CDP WebSocket closed (code: ${code}${reason})`));
    };
    return this.openPromise;
  }

  // Backwards-compatible alias: connect() === open()
  connect() { return this.open(); }

  send(method, params = {}, sessionId = null, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    const OPEN = typeof WebSocket !== "undefined" ? WebSocket.OPEN ?? 1 : 1;
    if (!this.ws || this.ws.readyState !== OPEN) return Promise.reject(new Error("CDP session is not open"));
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`failed to send CDP ${method}: ${errorMessage(error)}`, { cause: error }));
      }
    });
  }

  async evaluate(expression, sessionId = null, awaitPromise = true, returnByValue = true) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue, contextId: undefined }, sessionId);
    if (r?.exceptionDetails) throw new CdpEvaluationError(r.exceptionDetails);
    return r?.result?.value;
  }

  terminate(error) {
    if (this.terminalError) return;
    this.clearConnectTimer();
    this.terminalError = error;
    this.closed = true;
    const rejectOpen = this.rejectOpen;
    this.resolveOpen = null;
    this.rejectOpen = null;
    rejectOpen?.(error);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }

  clearConnectTimer() {
    if (this.connectTimer === null) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  closeSocket() {
    if (this.closeStarted) return;
    this.closeStarted = true;
    if (!this.ws || typeof this.ws.close !== "function") return;
    const CLOSING = typeof WebSocket !== "undefined" ? WebSocket.CLOSING ?? 2 : 2;
    const CLOSED = typeof WebSocket !== "undefined" ? WebSocket.CLOSED ?? 3 : 3;
    if (this.ws.readyState === CLOSING || this.ws.readyState === CLOSED) return;
    try { this.ws.close(); } catch {}
  }

  close() { this.closeSocket(); }
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
