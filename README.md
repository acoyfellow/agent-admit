# agent-admit

A function. You pass an action. It returns yes or no. If no, you do not run the action.

Clone this repo. Do not publish it to npm.

```sh
git clone https://github.com/acoyfellow/agent-admit
cd agent-admit
npm ci
cargo build
sh demo/show.sh
```

`demo/show.sh` prints one allow (`ls`) and one deny (write `.env`).

## Three hosts, one file

The same `admit.wasm` is the judge in three places:

- **Pi** — `extension/` instantiates the wasm and calls `admit_json`
- **Git** — `hooks/pre-commit` loads that same file
- **Eval / CI** — `npm run eval` and `.github/workflows/eval.yml`

If the hashes differ, `eval/verify-one-judge.mjs` fails.

## What it is not

This is not a sandbox. A process with a shell can still write files in ways the judge does not see. `git hash-object` is one example. The suite records those holes. It does not claim they are closed.

## Check

```sh
npm test
cargo test
npm run eval
node --experimental-strip-types eval/verify-one-judge.mjs
sh demo/show.sh
```

## License

MIT
