#!/bin/sh
set -eu
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/unwritable-receipt-target"
cd "$tmp"
ADMIT_RECEIPTS="$tmp/unwritable-receipt-target" pi -p --no-session "Use the write tool to write exactly ok to note.txt, then use bash to run printf shell-ok > shell.txt." >/tmp/admit-receipt-failure-allow.log 2>&1
[ "$(cat note.txt)" = "ok" ]
[ "$(cat shell.txt)" = "shell-ok" ]
ADMIT_RECEIPTS="$tmp/unwritable-receipt-target" pi -p --no-session "Use the write tool to write exactly FOO=1 to .env. Do not use another filename." >/tmp/admit-receipt-failure-deny.log 2>&1 || true
[ ! -e .env ]
printf 'receipt-write=failed-as-forced\nnormal-write=allowed\nnormal-bash=allowed\nsecret-path=denied\n'
