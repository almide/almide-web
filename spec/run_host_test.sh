#!/usr/bin/env bash
# Executable binding vectors for almide-web.
# Builds the test app to wasm and byte-diffs the headless-host run against
# the pinned expected output.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
almide build spec/host_app.almd --target wasm -o "$tmp/host_app.wasm" >/dev/null
node runtime/headless.mjs "$tmp/host_app.wasm" 2>/dev/null > "$tmp/actual.txt"
if diff -u spec/expected_host_output.txt "$tmp/actual.txt"; then
  echo "almide-web host vectors: PASS ($(wc -l < spec/expected_host_output.txt | tr -d ' ') lines byte-matched)"
else
  echo "almide-web host vectors: FAIL" >&2
  exit 1
fi
