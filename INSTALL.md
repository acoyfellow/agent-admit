# Install

## What it is

- `target/wasm32-unknown-unknown/release/admit.wasm` is the kernel. The extension instantiates it and calls `admit_json`.
- `extension/index.ts` connects that module to Pi. If the wasm is missing, no tool runs.
- `src/admit.ts` is the TypeScript reference used by lockstep eval.

## What it is not

Not a cloud service. Not Access. Not a sandbox. A local file next to the agent.

## Pi, this session only

From the clone:

```sh
cargo build --release --target wasm32-unknown-unknown --lib
pi -e ./extension/index.ts
```

## Pi, every session

```sh
npm run install:pi
```

This builds the WASM kernel and installs a self-contained extension under `~/.pi/agent/extensions/admit`. The installed extension does not depend on the checkout remaining in place.

Start a new Pi session, or run `/reload`.

## Try it

Ask Pi to run `ls`. That should work.

Ask Pi to write `FOO=1` to `./.env`. That should be blocked. The file must not appear.

Ask Pi to write `ok` to `note.txt`. That should work.

## Mute

```sh
ADMIT_WASM=/tmp/admit-missing.wasm pi -e ./extension/index.ts
```

Ask it to run `ls`. It must not. No wasm, no tools.

## Without Pi

```sh
npm test
cargo run --quiet -- bash ls
cargo run --quiet -- write ./.env FOO=1
```

## Receipts

Set a fixed receipt path when you run Pi directly:

```sh
export ADMIT_RECEIPTS=/tmp/admit-receipts.jsonl
```

A local Terrarium child uses its run ID when `ADMIT_RECEIPTS` is not set:

```text
~/.terrarium/runs/<run-id>.admit.jsonl
```

Each JSON line contains these fields:

- `schemaVersion`
- `piSessionId`
- `terrariumRunId`
- `terrariumParentRunId`
- `cwd`
- `tool`
- `allow`
- `reason`
- `at`

Receipt persistence is best effort. A persistence failure does not change the policy decision.
