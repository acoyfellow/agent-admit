#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
dest="${ADMIT_INSTALL_DIR:-$HOME/.pi/agent/extensions/admit}"
parent="$(dirname "$dest")"
CARGO="$(rustup which cargo --toolchain stable)"
RUSTC="$(rustup which rustc --toolchain stable)"
export CARGO RUSTC
"$CARGO" build --manifest-path "$root/Cargo.toml" --release --target wasm32-unknown-unknown --lib
mkdir -p "$parent"
stage="$(mktemp -d "$parent/.admit-install.XXXXXX")"
backup="$parent/.admit-backup.$$"
previous=0
committed=0
cleanup() {
  code=$?
  trap - EXIT
  if [ "$committed" -ne 1 ]; then
    rm -rf "$dest"
    if [ "$previous" -eq 1 ] && { [ -e "$backup" ] || [ -L "$backup" ]; }; then
      mv "$backup" "$dest"
    fi
  fi
  rm -rf "$stage" "$backup"
  exit "$code"
}
trap cleanup EXIT
cp "$root/extension/index.ts" "$stage/index.ts"
cp "$root/extension/load.ts" "$stage/load.ts"
cp "$root/target/wasm32-unknown-unknown/release/admit.wasm" "$stage/admit.wasm"
if [ -e "$dest" ] || [ -L "$dest" ]; then
  mv "$dest" "$backup"
  previous=1
fi
if [ "${ADMIT_INSTALL_FAIL_AFTER_BACKUP:-0}" = "1" ]; then
  false
fi
mv "$stage" "$dest"
committed=1
rm -rf "$backup"
trap - EXIT
printf 'installed agent-admit at %s\n' "$dest"
