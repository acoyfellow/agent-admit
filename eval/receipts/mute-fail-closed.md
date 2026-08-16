---
id: mute-fail-closed
kind: mechanical-gate
---

**claim:** If the admit module cannot load, the loader reports `ok: false` so a host can refuse every tool.

**intent:** INSTALL.md's mute rule: no file, no tools. That is only true if load failure is visible.

**execution:** `extension/load.ts` imported a missing module and the real `src/admit.ts`.

**evidence:**

```
$ npm run eval
  "mute": { "ok": true }
```

See `mute-fail-closed.json`.

**verified:** Missing module → `ok: false`. Present module exports `admit`.

**projected:** Pi `extension/index.ts` already blocks all tools on that failure. This gate does not spawn Pi.

**realized:**

**cost:** Small. Reuses the existing loader.
