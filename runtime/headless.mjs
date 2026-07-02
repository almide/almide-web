// almide-web headless host — Node.js reference implementation of the import
// surface, for executable binding vectors without a browser.
//
// Usage: node runtime/headless.js <app.wasm>
//
// Semantics (deterministic by construction):
//   - Virtual DOM: elements are handle-table entries {tag, attrs, style,
//     text, children}. The final tree of every root element is serialized to
//     stdout after the event queue drains.
//   - console.*: captured and printed as `console.<level>: <text>` lines.
//   - timers/fetch: every async op appends to one FIFO; after main returns
//     the queue drains in insertion order. set_interval fires exactly twice
//     (then auto-stops) so interval semantics are observable but bounded.
//     clear_timer removes a pending entry. fetch is stubbed:
//       GET  test://ok   -> status 200, body "ok-body"
//       POST any URL     -> status 201, body "<ct>|<request body>"
//       anything else    -> status 404, body ""
//
// The string-intern protocol (begin_str/push_byte/commit_str) and the
// callback re-entry convention (host calls exported on_timer /
// on_fetch_response with BigInt args) are exactly the browser runtime's
// (runtime/web.js) — this file doubles as its executable specification.

import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";

const wasmPath = process.argv[2];
if (!wasmPath) {
  console.error("usage: node runtime/headless.js <app.wasm>");
  process.exit(2);
}

const B = (n) => BigInt(n);
const N = (b) => Number(b);

// ── String table (the web.js protocol) ──
const strings = [];
let strBuf = [];
const pushString = (s) => { strings.push(s); return strings.length - 1; };

// ── Virtual DOM ──
const elements = []; // handle -> element record
const roots = new Set(); // handles never append_child'd into another
const newElement = (tag) => {
  const el = { tag, attrs: [], style: [], text: "", children: [] };
  elements.push(el);
  const h = elements.length - 1;
  roots.add(h);
  return h;
};
const serialize = (h) => {
  const el = elements[h];
  const attrs = el.attrs.map(([k, v]) => ` ${k}="${v}"`).join("");
  const style = el.style.length
    ? ` style="${el.style.map(([k, v]) => `${k}:${v}`).join(";")}"`
    : "";
  const kids = el.children.map(serialize).join("");
  return `<${el.tag}${attrs}${style}>${el.text}${kids}</${el.tag}>`;
};

// ── Captured output ──
const lines = [];
const say = (s) => lines.push(s);

// ── Deferred event queue (timers + fetch callbacks) ──
const queue = [];
let exportsRef = null;

// ── Imports ──
const dom = {
  begin_str() { strBuf = []; },
  push_byte(b) { strBuf.push(N(b)); },
  commit_str() {
    strings.push(new TextDecoder().decode(new Uint8Array(strBuf)));
    return B(strings.length - 1);
  },
  create_element(tagId) { return B(newElement(strings[N(tagId)])); },
  set_text(elId, textId) { elements[N(elId)].text = strings[N(textId)]; },
  set_attr(elId, nameId, valId) {
    elements[N(elId)].attrs.push([strings[N(nameId)], strings[N(valId)]]);
  },
  set_style(elId, propId, valId) {
    elements[N(elId)].style.push([strings[N(propId)], strings[N(valId)]]);
  },
  append_child(parentId, childId) {
    elements[N(parentId)].children.push(N(childId));
    roots.delete(N(childId));
  },
  get_offset_width(elId) {
    // Deterministic stand-in: 10px per character of text.
    return elements[N(elId)].text.length * 10.0;
  },
  clear_children(elId) {
    for (const c of elements[N(elId)].children) roots.add(c);
    elements[N(elId)].children = [];
  },
  log(strId) { say(`dom.log: ${strings[N(strId)]}`); },
};

const consoleImports = {
  log(strId) { say(`console.log: ${strings[N(strId)]}`); },
  warn(strId) { say(`console.warn: ${strings[N(strId)]}`); },
  error(strId) { say(`console.error: ${strings[N(strId)]}`); },
  log_int(v) { say(`console.log_int: ${N(v)}`); },
  log_float(v) { say(`console.log_float: ${v}`); },
};

let nextTimerId = 1;
const cancelled = new Set();
const timer = {
  set_timeout(callbackId, _delayMs) {
    const id = nextTimerId++;
    queue.push({ kind: "timeout", id, callbackId });
    return B(id);
  },
  set_interval(callbackId, _intervalMs) {
    const id = nextTimerId++;
    queue.push({ kind: "interval", id, callbackId, fired: 0 });
    return B(id);
  },
  clear_timer(timerId) { cancelled.add(N(timerId)); },
  request_animation_frame(callbackId) {
    const id = nextTimerId++;
    queue.push({ kind: "timeout", id, callbackId });
    return B(id);
  },
};

let nextReqId = 1;
const fetchImports = {
  get(urlId) {
    const url = strings[N(urlId)];
    const reqId = nextReqId++;
    const [status, body] = url === "test://ok" ? [200, "ok-body"] : [404, ""];
    queue.push({ kind: "fetch", reqId, status, body });
    return B(reqId);
  },
  post(urlId, bodyId, contentTypeId) {
    const body = strings[N(bodyId)];
    const ct = strings[N(contentTypeId)];
    const reqId = nextReqId++;
    queue.push({ kind: "fetch", reqId, status: 201, body: `${ct}|${body}` });
    return B(reqId);
  },
};

// ── Run ──
const wasi = new WASI({ version: "preview1" });
const module = await WebAssembly.compile(readFileSync(wasmPath));
const instance = await WebAssembly.instantiate(module, {
  ...wasi.getImportObject(),
  dom,
  console: consoleImports,
  timer,
  fetch: fetchImports,
});
exportsRef = instance.exports;
wasi.start(instance);

// Drain the event queue in insertion order (intervals re-queue, max 2 fires).
while (queue.length > 0) {
  const ev = queue.shift();
  if (ev.kind === "fetch") {
    const bodyId = pushString(ev.body);
    exportsRef.on_fetch_response?.(B(ev.reqId), B(ev.status), B(bodyId));
  } else {
    if (cancelled.has(ev.id)) continue;
    exportsRef.on_timer?.(B(ev.callbackId));
    if (ev.kind === "interval" && ++ev.fired < 2) queue.push(ev);
  }
}

// ── Report ──
for (const l of lines) console.log(l);
for (const h of [...roots].sort((a, b) => a - b)) {
  console.log(`dom: ${serialize(h)}`);
}
