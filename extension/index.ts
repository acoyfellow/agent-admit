import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAdmit, type AdmitLoadResult } from "./load.ts";

const DEFAULT_RECEIPTS_PATH = "/tmp/admit-receipts.jsonl";
const GATED_TOOLS = new Set(["bash", "write", "edit"]);
const MISSING_REASON = "admit kernel missing; no tools run";

let cachedLoad: Promise<AdmitLoadResult> | undefined;

type ToolInput = Record<string, unknown>;
type Decision = { allow: boolean; reason: string };
type ReceiptIdentity = {
  piSessionId: string | null;
  terrariumRunId: string | null;
  terrariumParentRunId: string | null;
  cwd: string;
};

function getLoad(): Promise<AdmitLoadResult> {
  cachedLoad ??= loadAdmit();
  return cachedLoad;
}

export function resolveReceiptPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ADMIT_RECEIPTS) return env.ADMIT_RECEIPTS;
  if (!env.TERRARIUM_RUN_ID) return DEFAULT_RECEIPTS_PATH;
  const runId = env.TERRARIUM_RUN_ID.replace(/[^A-Za-z0-9_-]/g, "_");
  const terrariumHome = env.TERRARIUM_HOME || path.join(homedir(), ".terrarium");
  return path.join(terrariumHome, "runs", `${runId}.admit.jsonl`);
}

function receiptIdentity(ctx?: ExtensionContext): ReceiptIdentity {
  return {
    piSessionId: ctx?.sessionManager.getSessionId() ?? process.env.PI_SESSION_ID ?? null,
    terrariumRunId: process.env.TERRARIUM_RUN_ID || null,
    terrariumParentRunId: process.env.TERRARIUM_PARENT_RUN_ID || null,
    cwd: ctx?.cwd ?? process.cwd(),
  };
}

export async function appendReceipt(
  tool: string,
  decision: Decision,
  identity: ReceiptIdentity = receiptIdentity(),
): Promise<void> {
  const receiptPath = resolveReceiptPath();
  const receipt = {
    schemaVersion: 1,
    ...identity,
    tool,
    allow: decision.allow,
    reason: decision.reason,
    at: new Date().toISOString(),
  };
  try {
    await appendFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
  } catch {
    return;
  }
}

function decide(admit: (action: unknown) => Decision, tool: string, input: ToolInput): Decision {
  if (tool === "bash") {
    return admit({ kind: "bash", command: String(input.command ?? "") });
  }
  if (tool === "write") {
    return admit({
      kind: "write",
      path: String(input.path ?? ""),
      content: String(input.content ?? ""),
    });
  }
  return admit({
    kind: "edit",
    path: String(input.path ?? ""),
    payload: JSON.stringify(input),
  });
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    const loaded = await getLoad();
    const identity = receiptIdentity(ctx);
    if (!loaded.ok) {
      const decision = { allow: false, reason: MISSING_REASON };
      await appendReceipt(event.toolName, decision, identity);
      return { block: true, reason: decision.reason };
    }

    if (!GATED_TOOLS.has(event.toolName)) {
      await appendReceipt(event.toolName, { allow: true, reason: "tool allowed" }, identity);
      return undefined;
    }

    const decision = decide(loaded.admit, event.toolName, event.input as ToolInput);
    await appendReceipt(event.toolName, decision, identity);
    if (!decision.allow) {
      return { block: true, reason: decision.reason };
    }
    return undefined;
  });
}
