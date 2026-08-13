# agent-admit

The model proposes an action.
Something it does not own decides if the action runs.
If the answer is no, the world does not change.

That split is the work.
This repository is the map.
It does not contain the checkers.

## What this is

Admission control for agents.

Same job as a kernel hook or a deploy webhook: sit in front of a side effect, stay small, stay off the model’s authorship.

A check has four parts:

1. It runs **before** the action lands.
2. It returns **pass** or **fail**.
3. The agent on this turn does **not** write it.
4. A failed check means the action **does not happen**.

Optional: a hash of the checker or of the policy file is the version.

## What is live on public GitHub today

Verified 2026-08-12 against `main` on GitHub (and GitLab for guardrail).

| Place | What you can clone and see | Status |
| --- | --- | --- |
| [witness-pi](https://github.com/acoyfellow/witness-pi) `3d0bca2` | Pi extension. Default rule: `pantry push` through a TypeScript recipe checker. Signed receipts. | **Live on `main`.** Everyday `bash` / `write` / `edit` rules and the hashed Wasm checker are **not** on `main`. They are in draft [PR #1](https://github.com/acoyfellow/witness-pi/pull/1). |
| [no-added-comments](https://github.com/acoyfellow/no-added-comments) | Pi extension + git hook. Blocks new source comments. Blocks `git commit` with hooks off (in the agent). | **Live.** README says it is deprecated in favor of agent-policy. Still public. |
| [mutant](https://github.com/acoyfellow/mutant) `9f9605a` | `--skip-invalid`: do not run the test suite on a mutant that fails typecheck. | **Live on `main`.** |
| [my-ax](https://github.com/acoyfellow/my-ax) `scripts/native-proxy/` | TypeScript Access MCP proxy, built with scriptc. No Node in the binary. | **Live on `main`.** |
| [deja](https://github.com/acoyfellow/deja) `native/` | TypeScript MCP server without the SDK. Fail closed if storage is not linked. | **Live on `main`.** |
| [agent-adversary](https://github.com/acoyfellow/agent-adversary) | Zero-import Wasm validator for agent-operation records. | **Live.** Earlier line, same shape. |
| [pantry](https://github.com/acoyfellow/pantry) | Recipe store. Witness’s default pantry rule sits in front of `push`. | **Live.** The store is not the admitter. |

## What is built and not public

| Place | What it is | Why it is not in the table above |
| --- | --- | --- |
| GitLab `jcoeyman/guardrail` `5c34bf8` | Lockfile host scan. Uppercase `https://` is included. Optional Wasm build with a pinned hash. | Employee GitLab. Not a public GitHub repo. |
| [lockfile-gate](https://github.com/acoyfellow/lockfile-gate) | Same lockfile idea: your `policy.json`, fail CI on exit 2, print `policySha256`. | **Private** on GitHub. |
| [scratch-serve](https://github.com/acoyfellow/scratch-serve) | One TypeScript HTTP file → one native binary. | **Private** on GitHub. Shows scriptc, not admission. |
| witness-pi [PR #1](https://github.com/acoyfellow/witness-pi/pull/1) | Hashed `recipe_safety.wasm`. Also gates `bash`, `write`, `edit`. | **Draft.** Headless Pi blocked `.env`, token writes, hook-skipping commit, and force-push to `main`. Not on `main`. |

Do not say those last four are live in public product until the visibility or merge changes.

## What we measured and will not ship as a feature

`--skip-equivalent` on mutant: with a real program entry, **0 of 13** mutants were equivalent. The earlier “13 of 16” figure was dead code. Do not advertise it.

scriptc has no Workers target. Native binaries go to a machine or a Container, not to a Worker.

## How to talk about this

Not: “I built a check.”
Not: “We found a hole.”

Yes: the agent proposes. An admitter it does not author decides. Fail closed. Receipt on disk.

## License

MIT. This map contains no company-internal host names and no employee-only URLs.
