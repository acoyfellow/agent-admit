# agent-admit

I told agents not to write `.env`. They wrote `.env`.

Agent-admit checks a proposed action before the action runs. It accepts `write`, `edit`, `bash`, and `lockfile` actions. It returns `{ allow, reason }`.

The caller must not run an action when `allow` is false.

## Try it

```sh
git clone https://github.com/acoyfellow/agent-admit
cd agent-admit
npm ci
cargo build
sh demo/show.sh
```

The demo allows `ls`. It denies a write to `.env`.

## Install it in Pi

```sh
npm run install:pi
```

This command builds the WASM policy kernel. It installs a self-contained Pi extension at `~/.pi/agent/extensions/admit`.

Start a new Pi session or run `/reload`.

See [INSTALL.md](INSTALL.md) for verification and receipt settings.

## How it works

`src/admit.ts` is the TypeScript reference implementation. `crates/admit` contains the Rust implementation.

The build compiles the Rust implementation to `admit.wasm`. The Pi extension loads this WASM file and calls `admit_json` for each tool action.

The evaluation suite sends the same cases to TypeScript, native Rust, and WASM. All three implementations must return the same decision and reason.

The evaluator also tests an implementation that always allows actions. The evaluator must reject that implementation.

## What it denies

The current policy denies these actions:

- writes and edits to `.env`, `.dev.vars`, and `.npmrc` files;
- shell commands that write to those protected paths;
- recognized secret-shaped tokens, including encoded tokens;
- `git commit --no-verify`;
- force-pushes to `main`;
- `git hash-object` commands that use `-w`;
- private registry URLs that are not in the public-host policy.

The tests also check allowed actions. Examples include ordinary files, benign base64 data, read-only `git hash-object`, and force-pushes to branches other than `main`.

## Security boundary

Agent-admit is a guardrail. It is not a sandbox.

It checks the proposed action text before execution. A new form of indirect execution can require a new policy case.

A missing or invalid WASM kernel blocks every tool. A receipt-write failure does not change the policy decision. The tool can run, but the receipt can be missing.

## Terrarium receipts

Local Terrarium children receive a stable `TERRARIUM_RUN_ID`. Agent-admit uses this value to write a separate receipt file for each run:

```text
~/.terrarium/runs/<run-id>.admit.jsonl
```

Each receipt contains the schema version, Pi session ID, Terrarium run ID, parent run ID, working directory, tool, decision, reason, and time.

This integration applies when Terrarium starts a local Pi child that loads the global extension. It does not apply to a non-Pi child, a remote child without the extension, or Terrarium's external `taskProof` command.

## Verify it

```sh
npm run check
npm test
npm run test:rust
npm run eval
sh demo/show.sh
```

The committed mutation receipt covers the decision logic in `src/command.ts`:

```sh
./outputs/verify-mutant-receipt.sh
```

The current receipt reports 79 killed mutants, zero survivors, zero timeouts, and zero errors.

The installer proof forces a failure after backup creation. The previous installation must return unchanged:

```sh
./outputs/prove-installer-failure.sh
```

The headless proofs require Pi:

```sh
npm run install:pi
./outputs/prove-global-install.sh
./outputs/prove-receipt-failure.sh
```

GitHub Actions runs the portable checks on each pull request and each push to `main`.

## License

MIT
