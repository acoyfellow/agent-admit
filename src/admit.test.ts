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

  it("extracts targets from shell syntax and command options", () => {
    const cases: Array<[string, string[]]> = [
      ["dd if=foo of=.env", [".env"]],
      ["dd if=foo of=", []],
      ["printf x > './.env'", ["./.env"]],
      ['printf x > "./.env"', ["./.env"]],
      ['printf x > "escaped\\\"quote"', ['escaped"quote']],
      ['printf x > "trailing\\', ["trailing\\"]],
      ["printf x > escaped\\ target", ["escaped target"]],
      ["printf x > trailing\\", ["trailing\\"]],
      ["echo one > first; echo two > second", ["first", "second"]],
      ["echo one > first & echo two > second", ["first", "second"]],
      ["echo one > first | tee second", ["first", "second"]],
      ["cp -- source ./.env", ["./.env"]],
      ["cp -f source ./.env", ["./.env"]],
      ["cp -t secrets source", ["secrets"]],
      ["cp --target-directory secrets source", ["secrets"]],
      ["cp --target-directory=secrets source", ["secrets"]],
      ["cp source", []],
      ["mv source ./.env", ["./.env"]],
      ["env", []],
      ["env MODE=test", []],
      ["env --", []],
      ["env -- tee ./.env", ["./.env"]],
      ["env -u MODE tee ./.env", ["./.env"]],
      ["env --unset MODE tee ./.env", ["./.env"]],
      ["env -C /tmp tee ./.env", ["./.env"]],
      ["env --chdir /tmp tee ./.env", ["./.env"]],
      ["env -i MODE=test tee ./.env", ["./.env"]],
      [`bash -c "printf 'FOO=1\\n' > ./.env"`, ["./.env"]],
      ["bash -c", []],
      ["sh -c 'printf x > ./.env'", ["./.env"]],
      ["zsh -c 'printf x > ./.env'", ["./.env"]],
      ["env tee ./.env", ["./.env"]],
      ["", []],
    ];
    for (const [command, expected] of cases) {
      assert.deepEqual(extractBashTargetPaths(command), expected, command);
    }
  });

  it("rejects a secret-shaped token in a write", () => {
    const token = `sk-${"x".repeat(28)}`;
    const d = admit({ kind: "write", path: "src/a.ts", content: `const k="${token}"` });
    assert.equal(d.allow, false);
  });

  it("rejects a base64-encoded secret-shaped token", () => {
    const token = Buffer.from(`sk-${"x".repeat(28)}`).toString("base64");
    const d = admit({ kind: "write", path: "src/a.ts", content: `Buffer.from("${token}", "base64")` });
    assert.equal(d.allow, false);
    assert.match(d.reason, /encoded secret-shaped token/);
  });

  it("distinguishes protected Git operations from benign variants", () => {
    const cases: Array<[string, boolean, RegExp?]> = [
      ["git hash-object -w --stdin", false, /hash-object/],
      ["git hash-object --stdin -w", false, /hash-object/],
      ["GIT_DIR=.git git hash-object -w file", false, /hash-object/],
      ["git hash-object --stdin", true],
      ["git hash-object file", true],
      ["git push --force origin main", false, /force/],
      ["git push --force origin feature", true],
      ["git push origin main", true],
    ];
    for (const [command, allow, reason] of cases) {
      const decision = admit({ kind: "bash", command });
      assert.equal(decision.allow, allow, command);
      if (reason) assert.match(decision.reason, reason, command);
    }
    const write = admit({
      kind: "write",
      path: "docs/git.txt",
      content: "git push --force origin main and git hash-object -w --stdin",
    });
    assert.equal(write.allow, true);
  });

  it("allows read-only inspection of protected-path text", () => {
    const commands = [
      "rg -n 'process\\.env' src",
      "rg -n '\\.env' .",
      "grep -R '.env' docs",
      "cat .env",
      "cat < .env",
    ];
    for (const command of commands) {
      const decision = admit({ kind: "bash", command });
      assert.equal(decision.allow, true, command);
    }
    const redirect = admit({ kind: "bash", command: "cat source > .env" });
    assert.equal(redirect.allow, false);
    const variableRedirect = admit({ kind: "bash", command: 'p=./.env; echo FOO=1 > "$p"' });
    assert.equal(variableRedirect.allow, false);
  });

  it("allows benign base64 while denying encoded secrets", () => {
    const cases: Array<[string, boolean]> = [
      [Buffer.from("ordinary configuration payload").toString("base64"), true],
      ["A".repeat(32), true],
      [Buffer.from(`sk-${"x".repeat(28)}`).toString("base64"), false],
      [Buffer.from(`Bearer ${"x".repeat(24)}`).toString("base64"), false],
    ];
    for (const [encoded, allow] of cases) {
      const decision = admit({
        kind: "write",
        path: "src/fixture.ts",
        content: `Buffer.from("${encoded}", "base64")`,
      });
      assert.equal(decision.allow, allow, encoded);
    }
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
