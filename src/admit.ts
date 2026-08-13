import { admitCommand } from "./command.ts";
import { admitLockfile } from "./lockfile.ts";
import type { Action, Decision } from "./types.ts";

export function admit(action: Action): Decision {
  if (action.kind === "bash") {
    return admitCommand({ kind: "bash", text: action.command });
  }
  if (action.kind === "write") {
    return admitCommand({
      kind: "write",
      path: action.path,
      text: action.content,
    });
  }
  if (action.kind === "edit") {
    return admitCommand({
      kind: "edit",
      path: action.path,
      text: action.payload,
    });
  }
  const result = admitLockfile(action.text, action.policyJson);
  return { allow: result.allow, reason: result.reason };
}

export { admitCommand } from "./command.ts";
export { admitLockfile, parsePolicy, policySha256 } from "./lockfile.ts";
export type { Action, Decision } from "./types.ts";
