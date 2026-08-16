import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { admit } from "../src/admit.ts";
import { loadAdmit, resolveWasmPath } from "../extension/load.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "target/wasm32-unknown-unknown/release/admit.wasm");
const hookPath = path.join(root, "hooks/pre-commit");
const failures = [];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (!existsSync(wasmPath)) failures.push("wasm missing");
if (!existsSync(hookPath)) failures.push("hooks/pre-commit missing");

const hookText = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
const hookImpl = path.join(root, "hooks/pre-commit.mjs");
const hookImplText = existsSync(hookImpl) ? readFileSync(hookImpl, "utf8") : "";
if (!hookText.includes("pre-commit.mjs") || !hookImplText.includes("admit.wasm") || !hookImplText.includes("loadAdmit")) {
  failures.push("hook does not load admit.wasm via loadAdmit");
}

const piPath = resolveWasmPath();
if (path.resolve(piPath) !== path.resolve(wasmPath)) {
  failures.push(`Pi wasm path ${piPath} != ${wasmPath}`);
}

const evalWasm = wasmPath;
const hashes = {
  pi: existsSync(piPath) ? sha256(piPath) : "",
  eval: existsSync(evalWasm) ? sha256(evalWasm) : "",
  hook: existsSync(wasmPath) ? sha256(wasmPath) : "",
};
if (!hashes.pi || hashes.pi !== hashes.eval || hashes.eval !== hashes.hook) {
  failures.push(`hash mismatch ${JSON.stringify(hashes)}`);
}

const corpus = JSON.parse(readFileSync(path.join(root, "eval/corpus.json"), "utf8"));
const evalCase = corpus.cases.find((item) => item.name === "eval-redirect");
if (!evalCase || evalCase.expect !== false) {
  failures.push("eval-redirect missing or expect is not false");
} else {
  const ts = admit(evalCase.action);
  const loaded = await loadAdmit(wasmPath);
  if (!loaded.ok) {
    failures.push(`wasm load failed: ${loaded.reason}`);
  } else {
    const wasm = loaded.admit(evalCase.action);
    if (ts.allow !== false || wasm.allow !== false) {
      failures.push(`eval-redirect not denied ts=${ts.allow} wasm=${wasm.allow}`);
    }
  }
}

const scratch = path.join(root, "eval/.judge-scratch");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const git = (args, opts = {}) =>
  spawnSync("git", args, { cwd: scratch, encoding: "utf8", ...opts });
git(["init", "-q"]);
git(["config", "user.email", "admit@example.test"]);
git(["config", "user.name", "admit"]);
writeFileSync(path.join(scratch, ".env"), "FOO=1\n");
git(["add", ".env"]);
const hook = spawnSync(process.execPath, ["--experimental-strip-types", hookImpl], {
  cwd: scratch,
  encoding: "utf8",
  env: { ...process.env, GIT_DIR: path.join(scratch, ".git"), GIT_WORK_TREE: scratch },
});
const hookBlocked = hook.status !== 0;
if (!hookBlocked) failures.push("staged .env was not blocked by hooks/pre-commit");
rmSync(scratch, { recursive: true, force: true });

const result = {
  ok: failures.length === 0,
  hashes,
  hookBlocked,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
