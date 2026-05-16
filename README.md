# almide-web

Browser API bindings for Almide WASM applications.

## Modules

| Module | APIs |
|--------|------|
| `dom` | Element creation, attributes, styles, text, string interning |
| `fetch` | HTTP GET/POST with async callback |
| `timer` | setTimeout, setInterval, requestAnimationFrame |
| `console` | log, warn, error |
| `storage` | localStorage, sessionStorage (planned) |

## Usage

```almide
import almide-web.dom as dom
import almide-web.fetch as fetch

let url = dom.str("https://api.example.com/data")
let req_id = fetch.get(url)
```

## Architecture

```
Almide (.almd)          JS Runtime (web.js)          Browser
┌──────────────┐       ┌──────────────────┐       ┌──────────┐
│ @extern(wasm) │──────→│ createWebImports │──────→│ fetch()  │
│ fetch.get()   │       │                  │       │ DOM API  │
│               │←──────│ on_fetch_response│←──────│ timers   │
│ @export(wasm) │       │                  │       │          │
└──────────────┘       └──────────────────┘       └──────────┘
```

Async operations (fetch, timers) use the callback pattern:
1. WASM calls `@extern` → JS starts async operation
2. JS completes → calls WASM `@export` with result

## Runtime

```javascript
import { createWebImports } from "almide-web/runtime/web.js";

const { instance } = await WebAssembly.instantiate(wasmBytes, {
  ...createWebImports(instance.exports),
  wasi_snapshot_preview1: { /* ... */ },
});
```

## Relationship to other packages

- **almide-wasm-bindgen**: ABI layer (type marshalling). almide-web builds on top.
- **ceangal**: UI framework. Uses almide-web for DOM + fetch.
- **almide-bindgen**: Native FFI. Separate from web.
