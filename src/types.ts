export type Decision = {
  allow: boolean;
  reason: string;
};

export type Action =
  | { kind: "bash"; command: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; payload: string }
  | { kind: "lockfile"; text: string; policyJson: string };
