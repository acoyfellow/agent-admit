import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proof = JSON.parse(readFileSync(path.join(root, "outputs/terrarium-proof.json"), "utf8"));
const terrariumHome = process.env.TERRARIUM_HOME || path.join(homedir(), ".terrarium");
const metadata = JSON.parse(
  readFileSync(path.join(terrariumHome, "runs", `${proof.runId}.json`), "utf8"),
);
const rows = readFileSync(
  path.join(terrariumHome, "runs", `${proof.runId}.admit.jsonl`),
  "utf8",
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function validCorrelation(receipts, run) {
  const sessionIds = new Set(receipts.map((receipt) => receipt.piSessionId));
  return (
    receipts.length >= 2 &&
    sessionIds.size === 1 &&
    typeof receipts[0].piSessionId === "string" &&
    receipts[0].piSessionId.length > 0 &&
    receipts.every(
      (receipt) =>
        receipt.schemaVersion === 1 &&
        receipt.terrariumRunId === run.runId &&
        receipt.terrariumParentRunId === run.parentRunId &&
        receipt.cwd === run.cwd,
    )
  );
}

assert.equal(metadata.runId, proof.runId);
assert.equal(metadata.status, "done");
assert.equal(metadata.ok, true);
assert.equal(metadata.taskContractStatus, "verified");
assert.equal(metadata.taskProofStatus, "proved");
assert.equal(metadata.isolation, "copy");
assert.equal(validCorrelation(rows, metadata), true);
assert.equal(
  rows.some(
    (receipt) =>
      receipt.tool === "write" && receipt.allow === true && receipt.reason === "write allowed",
  ),
  true,
);
assert.equal(
  rows.some(
    (receipt) =>
      receipt.tool === "write" &&
      receipt.allow === false &&
      receipt.reason.includes("secret-shaped path"),
  ),
  true,
);
assert.equal(
  validCorrelation([{ ...rows[0], terrariumRunId: "ter_mixed" }, ...rows.slice(1)], metadata),
  false,
);

console.log(`run=${metadata.runId}`);
console.log(`pi-session=${rows[0].piSessionId}`);
console.log(`cwd=${metadata.cwd}`);
console.log("allowed-write=present");
console.log("denied-write=present");
console.log("mixed-attribution=rejected");
console.log("external-proof=proved");
