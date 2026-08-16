import { appendFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAdmit, type AdmitLoadResult } from "./load.ts";

const DEFAULT_RECEIPTS_PATH = "/tmp/admit-receipts.jsonl";
const GATED_TOOLS = new Set(["bash", "write", "edit"]);
const MISSING_REASON = "admit kernel missing; no tools run";

let cachedLoad: Promise<AdmitLoadResult> | undefined;

type ToolInput = Record<string, unknown>;
type Decision = { allow: boolean; reason: string };

function getLoad(): Promise<AdmitLoadResult> {
  cachedLoad ??= loadAdmit();
  return cachedLoad;
}

async function appendReceipt(tool: string, decision: Decision): Promise<void> {
  const receiptPath = process.env.ADMIT_RECEIPTS || DEFAULT_RECEIPTS_PATH;
  const receipt = {
    tool,
    allow: decision.allow,
    reason: decision.reason,
    at: new Date().toISOString(),
  };
  await appendFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
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
  pi.on("tool_call", async (event) => {
    const loaded = await getLoad();
    if (!loaded.ok) {
      const decision = { allow: false, reason: MISSING_REASON };
      await appendReceipt(event.toolName, decision);
      return { block: true, reason: decision.reason };
    }

    if (!GATED_TOOLS.has(event.toolName)) {
      await appendReceipt(event.toolName, { allow: true, reason: "tool allowed" });
      return undefined;
    }

    const decision = decide(loaded.admit, event.toolName, event.input as ToolInput);
    await appendReceipt(event.toolName, decision);
    if (!decision.allow) {
      return { block: true, reason: decision.reason };
    }
    return undefined;
  });
}
