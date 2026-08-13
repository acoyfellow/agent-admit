import { readFileSync } from "node:fs";
import { admit } from "./admit.ts";
import type { Action } from "./types.ts";

const kind = process.argv[2];

function print(decision: { allow: boolean; reason: string }): void {
  console.log(JSON.stringify(decision));
  process.exit(decision.allow ? 0 : 2);
}

if (kind === "bash") {
  const command = process.argv.slice(3).join(" ");
  print(admit({ kind: "bash", command }));
}

if (kind === "write") {
  const path = process.argv[3] ?? "";
  const content = process.argv[4] ?? "";
  print(admit({ kind: "write", path, content }));
}

if (kind === "lockfile") {
  const lockPath = process.argv[3];
  const policyPath = process.argv[4] ?? "policy.json";
  if (!lockPath) {
    console.error("usage: admit lockfile <lockfile> [policy.json]");
    process.exit(1);
  }
  const text = readFileSync(lockPath, "utf8");
  const policyJson = readFileSync(policyPath, "utf8");
  print(admit({ kind: "lockfile", text, policyJson }));
}

console.error("usage: admit <bash|write|lockfile> ...");
process.exit(1);
