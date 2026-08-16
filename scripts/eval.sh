#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"
cargo build --manifest-path Cargo.toml
CARGO="$(rustup which cargo --toolchain stable)"
RUSTC="$(rustup which rustc --toolchain stable)"
export CARGO RUSTC
"$CARGO" build --manifest-path Cargo.toml --release --target wasm32-unknown-unknown --lib
node --experimental-strip-types eval/run.mjs
