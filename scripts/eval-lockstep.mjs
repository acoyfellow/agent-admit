import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { admit } from "../src/admit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustBin = path.join(root, "target/debug/admit");
const policy = JSON.stringify({
  publicHosts: ["registry.npmjs.org"],
  suspiciousHostContains: [".corp."],
  suspiciousHostSuffixes: [".internal"],
});

const cases = [
  { name: "ls", kind: "bash", argv: ["ls", "-la"], action: { kind: "bash", command: "ls -la" }, expect: true },
  { name: "write-env", kind: "write", argv: ["./.env", "FOO=1"], action: { kind: "write", path: "./.env", content: "FOO=1" }, expect: false },
  { name: "tee-env", kind: "bash", argv: ["printf FOO=1 | tee -- \"./.env\""], action: { kind: "bash", command: "printf FOO=1 | tee -- \"./.env\"" }, expect: false },
  { name: "token", kind: "write", argv: ["src/a.ts", `const k="sk-${"x".repeat(28)}"`], action: { kind: "write", path: "src/a.ts", content: `const k="sk-${"x".repeat(28)}"` }, expect: false },
  { name: "lockfile-corp", kind: "lockfile-inline", action: { kind: "lockfile", text: '"HTTPS://NPM.CORP.ACME.EXAMPLE/foo/-/foo-1.0.0.tgz"', policyJson: policy }, expect: false },
  { name: "lockfile-npm", kind: "lockfile-inline", action: { kind: "lockfile", text: '"HTTPS://REGISTRY.NPMJS.ORG/a/-/a-1.0.0.tgz"', policyJson: policy }, expect: true },
];

function rustDecide(testCase) {
  if (testCase.kind === "lockfile-inline") {
    const input = JSON.stringify({
      kind: "lockfile",
      text: testCase.action.text,
      policyJson: testCase.action.policyJson,
    });
    const result = spawnSync(rustBin, ["json"], { input, encoding: "utf8", cwd: root });
    if (result.status !== 0 && result.status !== 2) {
      throw new Error(`rust json failed: ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout);
  }
  const result = spawnSync(rustBin, [testCase.kind, ...testCase.argv], { encoding: "utf8", cwd: root });
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`rust ${testCase.name} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function noopDecide() {
  return { allow: true, reason: "noop" };
}

let failed = 0;
const rows = [];
for (const testCase of cases) {
  const ts = admit(testCase.action);
  const rust = rustDecide(testCase);
  const noop = noopDecide();
  const parity = ts.allow === rust.allow;
  const expected = ts.allow === testCase.expect && rust.allow === testCase.expect;
  const negative = noop.allow === true && testCase.expect === false ? "would-pass-noop" : "n/a";
  if (!parity || !expected) failed += 1;
  rows.push({
    name: testCase.name,
    expect: testCase.expect,
    ts: ts.allow,
    rust: rust.allow,
    parity,
    expected,
    negative,
    rustReason: rust.reason,
    tsReason: ts.reason,
  });
}

console.log(JSON.stringify({ ok: failed === 0, failed, rows }, null, 2));
if (failed !== 0) process.exit(1);
