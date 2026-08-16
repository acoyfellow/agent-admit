import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admit } from "./admit.ts";
import { extractBashTargetPaths } from "./command.ts";
import type { Action } from "./types.ts";

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

  it("applies one target-path rule across actions and shell forms", () => {
    const cases: Array<{ name: string; action: Action; allow: boolean }> = [
      {
        name: "write secret path",
        action: { kind: "write", path: "./.env", content: "FOO=1" },
        allow: false,
      },
      {
        name: "edit secret path",
        action: { kind: "edit", path: "./.env", payload: "FOO=1" },
        allow: false,
      },
      {
        name: "quoted output redirect",
        action: { kind: "bash", command: "printf 'FOO=1\\n' > \"./.env\"" },
        allow: false,
      },
      {
        name: "quoted append redirect",
        action: { kind: "bash", command: "echo FOO=1 >> './.env'" },
        allow: false,
      },
      {
        name: "quoted tee target",
        action: { kind: "bash", command: "printf FOO=1 | tee -- \"./.env\"" },
        allow: false,
      },
      {
        name: "quoted cp target",
        action: { kind: "bash", command: "cp source \"./.env\"" },
        allow: false,
      },
      {
        name: "quoted mv target",
        action: { kind: "bash", command: "mv source './.env'" },
        allow: false,
      },
      {
        name: "python open",
        action: { kind: "bash", command: `python -c "open('.env','w').write('x')"` },
        allow: false,
      },
      {
        name: "node writeFileSync",
        action: {
          kind: "bash",
          command: `node -e "require('fs').writeFileSync('.env','x')"`,
        },
        allow: false,
      },
      ...["python3", "ruby", "perl", "php"].map(
        (interpreter): { name: string; action: Action; allow: boolean } => ({
          name: `${interpreter} one-liner`,
          action: { kind: "bash", command: `${interpreter} -e "write('.env')"` },
          allow: false,
        }),
      ),
      {
        name: "dd output",
        action: { kind: "bash", command: "dd if=foo of=.env" },
        allow: false,
      },
      {
        name: "bash command string redirect",
        action: { kind: "bash", command: `bash -c "printf 'FOO=1\\n' > ./.env"` },
        allow: false,
      },
      {
        name: "sh command string redirect",
        action: { kind: "bash", command: `sh -c 'printf x > ./.env'` },
        allow: false,
      },
      {
        name: "zsh command string redirect",
        action: { kind: "bash", command: `zsh -c 'printf x > ./.env'` },
        allow: false,
      },
      {
        name: "env tee",
        action: { kind: "bash", command: "env tee ./.env" },
        allow: false,
      },
      {
        name: "env assignment tee",
        action: { kind: "bash", command: "env MODE=test tee ./.env" },
        allow: false,
      },
      {
        name: "ls",
        action: { kind: "bash", command: "ls" },
        allow: true,
      },
      {
        name: "git status",
        action: { kind: "bash", command: "git status" },
        allow: true,
      },
      {
        name: "ordinary tee target",
        action: { kind: "bash", command: "tee build.log" },
        allow: true,
      },
      {
        name: "ordinary output redirect",
        action: { kind: "bash", command: "echo hello > output.txt" },
        allow: true,
      },
      {
        name: "ordinary write target",
        action: { kind: "write", path: "src/hello.ts", content: "export {}" },
        allow: true,
      },
      {
        name: "ordinary edit target",
        action: { kind: "edit", path: "src/output.ts", payload: "export const x = 1" },
        allow: true,
      },
    ];

    for (const testCase of cases) {
      const decision = admit(testCase.action);
      assert.equal(decision.allow, testCase.allow, testCase.name);
      if (!testCase.allow) {
        assert.match(decision.reason, /refuse to write secret-shaped path/, testCase.name);
      }
    }
  });

  it("extracts targets from dd and wrapped commands", () => {
    assert.deepEqual(extractBashTargetPaths("dd if=foo of=.env"), [".env"]);
    assert.deepEqual(extractBashTargetPaths(`bash -c "printf 'FOO=1\\n' > ./.env"`), [
      "./.env",
    ]);
    assert.deepEqual(extractBashTargetPaths("sh -c 'printf x > ./.env'"), ["./.env"]);
    assert.deepEqual(extractBashTargetPaths("zsh -c 'printf x > ./.env'"), ["./.env"]);
    assert.deepEqual(extractBashTargetPaths("env tee ./.env"), ["./.env"]);
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
