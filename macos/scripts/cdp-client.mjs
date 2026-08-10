// WorkBuddy Dream Skin — CDP client (Node >= 20, zero runtime deps).
//
// A small, hardened Chromium DevTools Protocol (CDP) client over a loopback
// WebSocket. It is shared verbatim by the macOS and Windows injectors and is
// the only place that speaks CDP: discovery, connection, command timeouts,
// typed errors, request queueing, and teardown all live here.
//
// Security contract (see also SECURITY.md):
//   * Only loopback ws://127.0.0.1 URLs with an explicit port are accepted.
//   * No credentials, hashes, or remote hosts are ever allowed.
//   * Every network operation has a bounded timeout.

// ---- Ports & timeouts -------------------------------------------------------

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5000;
const WS_OPEN = 1; // WebSocket.OPEN

/** @returns {number} the validated port. @throws {TypeError} on invalid input. */
export function validatePort(port) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new TypeError(`port must be an integer from ${MIN_PORT} through ${MAX_PORT}`);
  }
  return port;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// CDP loopback rule: ws://127.0.0.1 with an explicit port, no credentials/hash.
/** @returns {URL} the parsed URL. @throws {TypeError} if not loopback-safe. */
export function parseLoopbackWebSocketUrl(value) {
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

/** Fetch the CDP target list for a loopback port (bounded timeout). */
export async function listTargets(port) {
  validatePort(port);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(DEFAULT_DISCOVERY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`/json/list HTTP ${res.status}`);
  return res.json();
}

function wsUrlFromTarget(target) {
  if (typeof target.webSocketDebuggerUrl !== "string") return null;
  try { parseLoopbackWebSocketUrl(target.webSocketDebuggerUrl); return target.webSocketDebuggerUrl; } catch { return null; }
}

/**
 * Pick the WorkBuddy renderer target from a CDP target list.
 * Prefers the renderer entry document, then any file:// page, then the first page.
 * @returns {object|null}
 */
export function pickWorkbuddyTarget(targets) {
  const pages = targets.filter((t) => t.type === "page" && wsUrlFromTarget(t));
  const entry = pages.find((t) => (t.url || "").includes("renderer/index.html"));
  if (entry) return entry;
  const filePage = pages.find((t) => (t.url || "").startsWith("file://"));
  if (filePage) return filePage;
  return pages[0] || null;
}

// ---- Error taxonomy ----------------------------------------------------------

export class CdpError extends Error { constructor(message, options) { super(message, options); this.name = "CdpError"; } }

export class CdpProtocolError extends CdpError {
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

export class CdpEvaluationError extends CdpError {
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

// ---- Client ------------------------------------------------------------------

export class Cdp {
  /**
   * @param {string} url loopback ws:// URL (validated immediately)
   * @param {{connectTimeoutMs?: number, commandTimeoutMs?: number}} [options]
   */
  constructor(url, { connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    parseLoopbackWebSocketUrl(url); // reject non-loopback URLs up front
    this.url = url;
    this.connectTimeoutMs = connectTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.ws = null;
    this.id = 0;
    this.pending = new Map(); // id -> { method, resolve, reject, timer }
    this.queue = [];          // commands issued before the socket is open
    this.opened = false;
    this.closed = false;
    this.closeStarted = false;
    this.terminalError = null;
    this.openPromise = null;
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.connectTimer = null;
  }

  /** Open the WebSocket and enable Runtime/Page. Resolves once ready. */
  open() {
    if (this.closed) return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    if (this.opened) return Promise.resolve(this);
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    // Timeout ordering matters: terminate() first stamps terminalError so the
    // onclose handler below cannot overwrite the timeout message, then we close.
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
          this.flushQueue();
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

  /** Backwards-compatible alias: connect() === open() */
  connect() { return this.open(); }

  /**
   * Send a CDP command. If the socket is not open yet the command is queued
   * and flushed once the session is ready (each queued command keeps its own
   * timeout). Returns a promise for the command result.
   * @param {string} method CDP method name
   * @param {object} [params]
   * @param {string|null} [sessionId] optional session id (e.g. for OOPIF)
   * @param {{timeoutMs?: number}} [options]
   */
  send(method, params = {}, sessionId = null, { timeoutMs = this.commandTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(this.terminalError ?? new Error("CDP session is closed"));
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return this.enqueue(method, params, sessionId, timeoutMs);
    }
    return this.sendNow(method, params, sessionId, timeoutMs);
  }

  /** Queue a command issued before the socket is open. */
  enqueue(method, params, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const item = { method, params, sessionId, timeoutMs, resolve, reject, timer: null };
      this.queue.push(item);
      item.timer = setTimeout(() => {
        const idx = this.queue.indexOf(item);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error(`CDP ${method} queued but the session never opened within ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /** Flush the pre-open command queue once the session is ready. */
  flushQueue() {
    if (this.closed || !this.ws || this.ws.readyState !== WS_OPEN) return;
    const queued = this.queue;
    this.queue = [];
    for (const item of queued) {
      clearTimeout(item.timer);
      this.sendNow(item.method, item.params, item.sessionId, item.timeoutMs).then(item.resolve, item.reject);
    }
  }

  /** Send a command on an already-open socket. */
  sendNow(method, params, sessionId, timeoutMs) {
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

  /**
   * Evaluate a JS expression in the page, returning its value (by value).
   * @throws {CdpEvaluationError} on an exception thrown inside the page.
   */
  async evaluate(expression, sessionId = null, awaitPromise = true, returnByValue = true) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue }, sessionId);
    if (r?.exceptionDetails) throw new CdpEvaluationError(r.exceptionDetails);
    return r?.result?.value;
  }

  /** Fail the session: reject open + pending + queued, stamp the terminal error. */
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
    for (const item of this.queue) { clearTimeout(item.timer); item.reject(error); }
    this.queue = [];
  }

  clearConnectTimer() {
    if (this.connectTimer === null) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** Best-effort close of the underlying socket (idempotent). */
  closeSocket() {
    if (this.closeStarted) return;
    this.closeStarted = true;
    if (!this.ws || typeof this.ws.close !== "function") return;
    const CLOSING = 2, CLOSED = 3; // WebSocket.CLOSING / CLOSED
    if (this.ws.readyState === CLOSING || this.ws.readyState === CLOSED) return;
    try { this.ws.close(); } catch {}
  }

  close() { this.closeSocket(); }
}
