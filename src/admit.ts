import { admitCommand, extractBashTargetPaths } from "./command.ts";
import { admitLockfile } from "./lockfile.ts";
import type { Action, Decision } from "./types.ts";

export function admit(action: Action): Decision {
  if (action.kind === "bash") {
    return admitCommand({
      kind: "bash",
      text: action.command,
      targetPaths: extractBashTargetPaths(action.command),
    });
  }
  if (action.kind === "write") {
    return admitCommand({
      kind: "write",
      text: action.content,
      targetPaths: [action.path],
    });
  }
  if (action.kind === "edit") {
    return admitCommand({
      kind: "edit",
      text: action.payload,
      targetPaths: [action.path],
    });
  }
  const result = admitLockfile(action.text, action.policyJson);
  return { allow: result.allow, reason: result.reason };
}

export { admitCommand } from "./command.ts";
export { admitLockfile, parsePolicy, policySha256 } from "./lockfile.ts";
export type { Action, Decision } from "./types.ts";
