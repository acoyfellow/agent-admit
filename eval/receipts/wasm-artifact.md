---
id: wasm-artifact
kind: verified-disproved
---

**claim:** The Rust crate compiles to `wasm32-unknown-unknown` as a portable artifact that can decide.

**intent:** The 6–12 month bet is a checked-in kernel every harness can run. A native `admit` binary is not that.

**execution:** `rustup` stable `cargo build --release --target wasm32-unknown-unknown --lib`. Homebrew `cargo` cannot see the rustup wasm sysroot; the eval script pins rustup's `CARGO`/`RUSTC`. The gate requires a wasm magic header and size > 1 KiB so an empty `cdylib` cannot pass.

**evidence:**

```
target/wasm32-unknown-unknown/release/admit.wasm
  WebAssembly module, 313 bytes, magic \\0asm
  no exported admit
$ npm run eval
  "wasm": { "ok": false, "bytes": 313 }
```

**verified:** The claim is false today. The target compiles. The artifact is a stub: `cdylib` with no `#[no_mangle]` / wasm-bindgen export of `admit`. It cannot evaluate a corpus case.

**projected:** Exporting `admit` over a C or wasm-bindgen ABI, then running the corpus inside the module, would make this a mechanical-gate instead of a disproof.

**realized:**

**cost:** The fail was cheap and useful. Homebrew vs rustup sysroot and empty cdylib are the two cracks.
