import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadAdmit, resolveWasmPath } from "./load.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = path.join(root, "target/wasm32-unknown-unknown/release/admit.wasm");
const extensionSource = readFileSync(path.join(root, "extension/index.ts"), "utf8");
const loadSource = readFileSync(path.join(root, "extension/load.ts"), "utf8");

function ensureWasm(): void {
  const cargo = spawnSync("rustup", ["which", "cargo", "--toolchain", "stable"], {
    encoding: "utf8",
  });
  const rustc = spawnSync("rustup", ["which", "rustc", "--toolchain", "stable"], {
    encoding: "utf8",
  });
  const built = spawnSync(cargo.stdout.trim(), [
    "build",
    "--manifest-path",
    "Cargo.toml",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--lib",
    "--quiet",
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CARGO: cargo.stdout.trim(),
      RUSTC: rustc.stdout.trim(),
    },
  });
  assert.equal(built.status, 0, built.stderr);
}

describe("wasm adapter", () => {
  it("uses WebAssembly admit_json and does not import src/admit.ts", () => {
    assert.equal(extensionSource.includes("../src/admit.ts"), false);
    assert.equal(loadSource.includes("../src/admit.ts"), false);
    assert.match(loadSource, /WebAssembly/);
    assert.match(loadSource, /admit_json/);
    assert.doesNotMatch(loadSource, /target\/debug\/admit[^\.]/);
  });

  it("resolves the wasm module by default", () => {
    assert.equal(resolveWasmPath(), wasm);
  });

  it("fails closed when the wasm is missing", async () => {
    const loaded = await loadAdmit(path.join(root, "target/missing-admit.wasm"));
    assert.equal(loaded.ok, false);
    if (!loaded.ok) {
      assert.match(loaded.reason, /missing|stub/);
    }
  });

  it("decides through admit_json", async () => {
    ensureWasm();
    const loaded = await loadAdmit(wasm);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      throw new Error(loaded.reason);
    }
    assert.equal(loaded.kernel, wasm);
    const allow = loaded.admit({ kind: "bash", command: "ls" });
    assert.equal(allow.allow, true);
    const deny = loaded.admit({ kind: "write", path: "./.env", content: "FOO=1" });
    assert.equal(deny.allow, false);
    assert.match(deny.reason, /secret-shaped path/);
  });
});
