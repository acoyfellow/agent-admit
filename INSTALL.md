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
mkdir -p ~/.pi/agent/extensions
ln -sfn "$(pwd)/extension" ~/.pi/agent/extensions/admit
```

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

```sh
export ADMIT_RECEIPTS=/tmp/admit-receipts.jsonl
```

Each tool call appends one JSON line.
