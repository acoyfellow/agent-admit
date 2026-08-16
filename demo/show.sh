#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ ! -x target/debug/admit ]; then
  cargo build --quiet --manifest-path Cargo.toml
fi

allow="$(cargo run --quiet --manifest-path Cargo.toml -- bash ls)"
deny="$(cargo run --quiet --manifest-path Cargo.toml -- write ./.env FOO=1 || true)"

printf '%s\n' "$allow"
printf '%s\n' "$deny"

echo "$allow" | grep -q '"allow":true'
echo "$deny" | grep -q '"allow":false'
echo "demo ok: one allow, one deny"
