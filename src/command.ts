export type CommandInput = {
  kind: "bash" | "write" | "edit";
  text: string;
  path?: string;
};

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /glpat-[A-Za-z0-9_-]{16,}/,
  /gh[posru]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
];

const SECRET_PATHS = /(^|\/)(\.env(\.[^/]+)?|\.dev\.vars(\.[^/]+)?|\.npmrc)$/i;

export function admitCommand(input: CommandInput): { allow: boolean; reason: string } {
  const text = input.text;
  const path = input.path ?? "";

  if (input.kind === "bash" && /\bgit\s+commit\b[^\n]*--no-verify\b/i.test(text)) {
    return { allow: false, reason: "git commit with hooks disabled is not allowed" };
  }
  if (input.kind === "bash" && /\bgit\s+push\b[^\n]*--force\b/i.test(text) && /\bmain\b/.test(text)) {
    return { allow: false, reason: "git push --force to main is not allowed" };
  }
  if (path && SECRET_PATHS.test(path)) {
    return { allow: false, reason: `refuse to write secret-shaped path ${path}` };
  }
  const hay = `${path}\n${text}`;
  for (const rx of SECRET_PATTERNS) {
    if (rx.test(hay)) {
      return { allow: false, reason: `secret-shaped token in ${input.kind} payload` };
    }
  }
  return { allow: true, reason: `${input.kind} allowed` };
}
