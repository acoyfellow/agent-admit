# agent-admit

I told agents not to write `.env`. They wrote `.env`.

`admit` is a function. You give it a proposed `write`, `edit`, `bash`, or `lockfile` action. It returns `{ allow, reason }`. If `allow` is false, do not run the action.

```sh
git clone https://github.com/acoyfellow/agent-admit
cd agent-admit
npm ci
cargo build
sh demo/show.sh
```

`demo/show.sh` prints one allow (`ls`) and one deny (write `.env`).

## How it is wired

Pi, the git hook, and `npm run eval` all load `target/wasm32-unknown-unknown/release/admit.wasm` and call `admit_json`.

`eval/verify-one-judge.mjs` hashes that file on each of those three paths. The script fails if the hashes differ. A throwaway git repo that stages `.env` must also fail the hook.

TypeScript in `src/admit.ts` is the reference implementation. Rust in `crates/admit` is the compiled copy. The eval suite requires them to agree on both `allow` and `reason` for every case in `eval/corpus.json`. A no-op that always allows would pass the deny cases. The suite treats that as failure.

## What still writes

The scanner looks at the action text before the command runs. `eval "echo FOO=1 > ./.env"` is denied because `.env` is still in the string. `git hash-object -w --stdin` does not name `.env`, so `admit` allows it. Those cases live in `eval/bypasses.json`.

## Check

```sh
npm test
cargo test
npm run eval
node --experimental-strip-types eval/verify-one-judge.mjs
sh demo/show.sh
```

GitHub Actions runs the same commands on push to `main`.

## License

MIT
