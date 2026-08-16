# Eval program

Four gates. Green only if every gate that claims proof has evidence. A no-op must not make the suite green.

```sh
npm test
cargo test
npm run eval
```

Receipts land in `eval/receipts/`. Schema matches `agent-policy/experiments/receipts/SCHEMA.md`.

| # | Gate | Must prove | Kill it by |
| --- | --- | --- | --- |
| 1 | Lockstep + negative control | TS and Rust agree on allow **and** reason for every corpus case. Every deny would pass a no-op. | One reason mismatch, or a no-op that still looks green. |
| 2 | Mute | Missing `admit` module → `ok: false`. Present module loads. | Loader treats a missing file as allow. |
| 3 | WASM artifact | `wasm32-unknown-unknown` produces a real module that can *decide*. | File missing, not wasm, or stub with no `admit` export. |
| 4 | Known bypasses | Documented holes are replayed. Allows here are limitations, not suite failures. | Pretending eval/redirect is denied when it is not. |

Corpus: `eval/corpus.json`. Holes: `eval/bypasses.json`.

## What is not in this program

- Pi calling the Rust binary
- Cedar
- tree-sitter
- A sandbox
- WASM *evaluating* an action (gate 3 currently fails on that)
