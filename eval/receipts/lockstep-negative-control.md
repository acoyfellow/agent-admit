---
id: lockstep-negative-control
kind: mechanical-gate
---

**claim:** TypeScript and Rust `admit()` agree on allow and reason, and a no-op cannot make the suite green.

**intent:** A six-case allow-only lockstep is too weak. Reasons can drift while booleans match. A suite that only counts denies on the real engine passes identically against an always-allow function.

**execution:** `eval/corpus.json` (28 cases) run through `src/admit.ts` and `target/debug/admit json`. A no-op always returns allow. Green only if allow and reason match, expected verdicts hold, and every deny would pass the no-op.

**evidence:**

```
$ npm run eval
  "lockstep": { "ok": true, "failed": 0, "corpus": 28, "oracleRejectsFakePass": true }
```

See `lockstep-negative-control.json`.

**verified:** 28/28 cases match on allow and reason. 21 denies would all pass a no-op. `oracleRejectsFakePass` is computed from that count.

**projected:** WASM or Cedar can reuse this corpus without rewriting cases.

**realized:**

**cost:** One session to extract the corpus and add reason equality.
