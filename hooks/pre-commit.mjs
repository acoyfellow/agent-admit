import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "target/wasm32-unknown-unknown/release/admit.wasm");

if (!existsSync(wasmPath)) {
  console.error("admit wasm missing; commit refused");
  process.exit(1);
}

const { loadAdmit } = await import(pathToFileURL(path.join(root, "extension/load.ts")).href);
const loaded = await loadAdmit(wasmPath);
if (!loaded.ok) {
  console.error(loaded.reason);
  process.exit(1);
}

const names = spawnSync("git", ["diff", "--cached", "--name-only", "-z"], {
  encoding: "buffer",
});
if (names.status !== 0) {
  console.error("git diff --cached failed");
  process.exit(1);
}
const files = names.stdout.length
  ? names.stdout.toString("utf8").split("\0").filter(Boolean)
  : [];

for (const file of files) {
  const blob = spawnSync("git", ["show", `:${file}`], { encoding: "utf8" });
  const content = blob.status === 0 ? blob.stdout : "";
  const decision = loaded.admit({ kind: "write", path: file, content });
  if (!decision.allow) {
    console.error(decision.reason);
    process.exit(1);
  }
}

process.exit(0);
