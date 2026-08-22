import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(readFileSync(path.join(root, "outputs/mutant-receipt.json"), "utf8"));
const raw = JSON.parse(readFileSync(path.join(root, "outputs/mutant-command.json"), "utf8"));
const source = readFileSync(path.join(root, receipt.file));
const sourceSha256 = createHash("sha256").update(source).digest("hex");

assert.equal(receipt.sourceSha256, sourceSha256);
assert.equal(receipt.baselinePassed, true);
assert.equal(receipt.sourceRestored, true);
assert.equal(receipt.total, raw.total);
assert.equal(receipt.killed, raw.killed);
assert.equal(receipt.survived, raw.survived);
assert.equal(receipt.timeout, raw.timeout);
assert.equal(receipt.error, raw.error);
assert.equal(receipt.score, raw.score);
assert.equal(raw.total > 0, true);
assert.equal(raw.survived, 0);
assert.equal(raw.timeout, 0);
assert.equal(raw.error, 0);
assert.equal(raw.mutants.every((mutant) => mutant.status === "killed"), true);
assert.deepEqual(receipt.classifications, []);

console.log(`mutant=${raw.killed}/${raw.total} killed`);
console.log("survivors=0");
console.log("source-hash=matched");
console.log("source-restored=yes");
