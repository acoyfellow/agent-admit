import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appendReceipt, resolveReceiptPath } from "./index.ts";

test("receipt persistence failure does not reject", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "admit-receipt-test-"));
  const previous = process.env.ADMIT_RECEIPTS;
  process.env.ADMIT_RECEIPTS = directory;
  try {
    await assert.doesNotReject(appendReceipt("bash", { allow: true, reason: "bash allowed" }));
  } finally {
    if (previous === undefined) {
      delete process.env.ADMIT_RECEIPTS;
    } else {
      process.env.ADMIT_RECEIPTS = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Terrarium receipts use a per-run path and carry correlation fields", async () => {
  const terrariumHome = mkdtempSync(path.join(tmpdir(), "admit-terrarium-test-"));
  const runId = "ter_receipt_test";
  const receiptPath = path.join(terrariumHome, "runs", `${runId}.admit.jsonl`);
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const previous = {
    ADMIT_RECEIPTS: process.env.ADMIT_RECEIPTS,
    TERRARIUM_HOME: process.env.TERRARIUM_HOME,
    TERRARIUM_RUN_ID: process.env.TERRARIUM_RUN_ID,
  };
  delete process.env.ADMIT_RECEIPTS;
  process.env.TERRARIUM_HOME = terrariumHome;
  process.env.TERRARIUM_RUN_ID = runId;
  try {
    assert.equal(resolveReceiptPath(), receiptPath);
    await appendReceipt(
      "write",
      { allow: false, reason: "protected path" },
      {
        piSessionId: "pi_test",
        terrariumRunId: runId,
        terrariumParentRunId: "ter_parent",
        cwd: "/tmp/worktree",
      },
    );
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.piSessionId, "pi_test");
    assert.equal(receipt.terrariumRunId, runId);
    assert.equal(receipt.terrariumParentRunId, "ter_parent");
    assert.equal(receipt.cwd, "/tmp/worktree");
    assert.equal(receipt.tool, "write");
    assert.equal(receipt.allow, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(terrariumHome, { recursive: true, force: true });
  }
});
