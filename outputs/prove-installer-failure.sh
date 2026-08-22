#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dest="$tmp/extensions/admit"
before="$tmp/before"
mkdir -p "$dest"
printf 'previous-working-install\n' > "$dest/sentinel"
cp -R "$dest" "$before"
if ADMIT_INSTALL_DIR="$dest" ADMIT_INSTALL_FAIL_AFTER_BACKUP=1 sh "$root/scripts/install.sh" >/tmp/admit-install-failure.log 2>&1; then
  exit 1
fi
diff -r "$before" "$dest"
set -- "$tmp/extensions"/.admit-backup.*
[ ! -e "$1" ]
ADMIT_INSTALL_DIR="$dest" sh "$root/scripts/install.sh" >/tmp/admit-install-success.log 2>&1
[ ! -e "$dest/sentinel" ]
[ -f "$dest/index.ts" ]
[ -f "$dest/load.ts" ]
[ -s "$dest/admit.wasm" ]
printf 'injected-failure=observed\nprevious-install=restored\nsuccessful-install=self-contained\n'
