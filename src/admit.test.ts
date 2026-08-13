import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admit } from "./admit.ts";

const policy = JSON.stringify({
  publicHosts: ["registry.npmjs.org"],
  suspiciousHostContains: [".corp."],
  suspiciousHostSuffixes: [".internal"],
});

describe("admit", () => {
  it("allows ls", () => {
    const d = admit({ kind: "bash", command: "ls -la" });
    assert.equal(d.allow, true);
  });

  it("rejects commit with hooks off", () => {
    const flag = "no" + "-" + "verify";
    const d = admit({ kind: "bash", command: `git commit --${flag} -m x` });
    assert.equal(d.allow, false);
  });

  it("rejects write to dotenv", () => {
    const d = admit({ kind: "write", path: "./.env", content: "FOO=1" });
    assert.equal(d.allow, false);
  });

  it("rejects a secret-shaped token in a write", () => {
    const token = `sk-${"x".repeat(28)}`;
    const d = admit({ kind: "write", path: "src/a.ts", content: `const k="${token}"` });
    assert.equal(d.allow, false);
  });

  it("rejects uppercase private registry URL in a lockfile", () => {
    const d = admit({
      kind: "lockfile",
      text: '"HTTPS://NPM.CORP.ACME.EXAMPLE/foo/-/foo-1.0.0.tgz"',
      policyJson: policy,
    });
    assert.equal(d.allow, false);
  });

  it("allows npmjs with uppercase scheme", () => {
    const d = admit({
      kind: "lockfile",
      text: '"HTTPS://REGISTRY.NPMJS.ORG/a/-/a-1.0.0.tgz"',
      policyJson: policy,
    });
    assert.equal(d.allow, true);
  });
});
