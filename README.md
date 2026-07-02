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

## Testing (headless vectors)

`spec/run_host_test.sh` builds `spec/host_app.almd` to wasm and runs it under
`runtime/headless.mjs` — a Node.js reference implementation of the full import
surface (virtual DOM handle table, captured console, deterministic timer/fetch
event queue). The run's stdout is byte-diffed against
`spec/expected_host_output.txt`. Every binding and the string-intern protocol
(`begin_str`/`push_byte`/`commit_str`) plus both callback re-entries
(`on_timer`, `on_fetch_response`) are exercised.

```bash
./spec/run_host_test.sh
```

The headless host doubles as the executable specification for
`runtime/web.js` (the browser host implements the same semantics against the
real DOM).
