// almide-web runtime — JS implementation of browser API bindings
//
// Usage:
//   import { createWebImports } from "almide-web/runtime/web.js";
//   const imports = createWebImports(wasmExports);
//   // imports.dom, imports.fetch, imports.timer, imports.console

const B = (n) => BigInt(n);
const N = (b) => Number(b);

// ── String table (shared across all modules) ──

const strings = [];
let strBuf = [];

export function getString(id) { return strings[id]; }
export function pushString(s) { strings.push(s); return strings.length - 1; }

// ── DOM imports ──

// Element handle table: WASM sees opaque Int handles, JS maps them to real
// nodes. Same semantics as the headless reference host (runtime/headless.mjs).
const elements = [];
export function getElement(id) { return elements[id]; }
export function registerElement(el) { elements.push(el); return elements.length - 1; }

export function createDomImports() {
  return {
    begin_str() { strBuf = []; },
    push_byte(b) { strBuf.push(N(b)); },
    commit_str() {
      strings.push(new TextDecoder().decode(new Uint8Array(strBuf)));
      return B(strings.length - 1);
    },
    create_element(tagId) {
      return B(registerElement(document.createElement(strings[N(tagId)])));
    },
    set_text(elId, textId) { elements[N(elId)].textContent = strings[N(textId)]; },
    set_attr(elId, nameId, valId) {
      elements[N(elId)].setAttribute(strings[N(nameId)], strings[N(valId)]);
    },
    set_style(elId, propId, valId) {
      elements[N(elId)].style.setProperty(strings[N(propId)], strings[N(valId)]);
    },
    append_child(parentId, childId) {
      elements[N(parentId)].appendChild(elements[N(childId)]);
    },
    get_offset_width(elId) { return elements[N(elId)].offsetWidth; },
    clear_children(elId) { elements[N(elId)].replaceChildren(); },
    log(strId) { console.log("[almide-web]", strings[N(strId)]); },
  };
}

// ── Fetch imports ──

export function createFetchImports(wasmExports) {
  let nextReqId = 1;
  return {
    get(urlId) {
      const url = strings[N(urlId)];
      const reqId = nextReqId++;
      fetch(url)
        .then(r => r.text())
        .then(body => {
          const bodyId = pushString(body);
          wasmExports.on_fetch_response?.(B(reqId), B(200), B(bodyId));
        })
        .catch(() => {
          wasmExports.on_fetch_response?.(B(reqId), B(0), B(0));
        });
      return B(reqId);
    },
    post(urlId, bodyId, contentTypeId) {
      const url = strings[N(urlId)];
      const body = strings[N(bodyId)];
      const ct = strings[N(contentTypeId)];
      const reqId = nextReqId++;
      fetch(url, { method: "POST", headers: { "Content-Type": ct }, body })
        .then(r => r.text())
        .then(respBody => {
          const respId = pushString(respBody);
          wasmExports.on_fetch_response?.(B(reqId), B(200), B(respId));
        })
        .catch(() => {
          wasmExports.on_fetch_response?.(B(reqId), B(0), B(0));
        });
      return B(reqId);
    },
  };
}

// ── Timer imports ──

export function createTimerImports(wasmExports) {
  return {
    set_timeout(callbackId, delayMs) {
      const id = setTimeout(() => {
        wasmExports.on_timer?.(callbackId);
      }, N(delayMs));
      return B(id);
    },
    set_interval(callbackId, intervalMs) {
      const id = setInterval(() => {
        wasmExports.on_timer?.(callbackId);
      }, N(intervalMs));
      return B(id);
    },
    clear_timer(timerId) {
      clearTimeout(N(timerId));
      clearInterval(N(timerId));
    },
    request_animation_frame(callbackId) {
      const id = requestAnimationFrame(() => {
        wasmExports.on_timer?.(callbackId);
      });
      return B(id);
    },
  };
}

// ── Console imports ──

export function createConsoleImports() {
  return {
    log(strId) { console.log(strings[N(strId)]); },
    warn(strId) { console.warn(strings[N(strId)]); },
    error(strId) { console.error(strings[N(strId)]); },
    log_int(v) { console.log(N(v)); },
    log_float(v) { console.log(v); },
  };
}

// ── Combined: all imports for WASM instantiation ──

export function createWebImports(wasmExports) {
  return {
    dom: createDomImports(),
    fetch: createFetchImports(wasmExports),
    timer: createTimerImports(wasmExports),
    console: createConsoleImports(),
  };
}
