export type CommandInput = {
  kind: "bash" | "write" | "edit";
  text: string;
  targetPaths: string[];
};

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /glpat-[A-Za-z0-9_-]{16,}/,
  /gh[posru]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
];

const SECRET_PATHS = /(^|\/)(\.env(\.[^/]+)?|\.dev\.vars(\.[^/]+)?|\.npmrc)$/i;
const PATH_SHAPED_PARTS = /[A-Za-z0-9_./~-]+/g;
const BASE64_PARTS = /[A-Za-z0-9+/]{24,}={0,2}/g;
const INLINE_WRITE_INTENT = /\b(?:eval|python3?|node|ruby|perl|php)\b[^\n]*(?:\bwrite(?:File(?:Sync)?|_text)?\b|\bopen\s*\(|>)/i;

type ShellToken = {
  kind: "word" | "redirect" | "separator";
  value: string;
};

function shellTokens(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;

  const pushWord = () => {
    if (word) {
      tokens.push({ kind: "word", value: word });
      word = "";
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        word += command[index];
      } else {
        word += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\" && index + 1 < command.length) {
      index += 1;
      word += command[index];
      continue;
    }
    if (/\s/.test(character)) {
      pushWord();
      if (character === "\n") {
        tokens.push({ kind: "separator", value: character });
      }
      continue;
    }
    if (character === ">" || character === "<") {
      pushWord();
      let redirect = character;
      while (command[index + 1] === character) {
        index += 1;
        redirect += character;
      }
      tokens.push({ kind: "redirect", value: redirect });
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      pushWord();
      tokens.push({ kind: "separator", value: character });
      continue;
    }
    word += character;
  }
  pushWord();
  return tokens;
}

function teeTargets(arguments_: string[]): string[] {
  const targets: string[] = [];
  let options = true;
  for (const argument of arguments_) {
    if (options && argument === "--") {
      options = false;
    } else if (options && argument.startsWith("-")) {
      continue;
    } else {
      options = false;
      targets.push(argument);
    }
  }
  return targets;
}

function copyOrMoveTargets(arguments_: string[]): string[] {
  const operands: string[] = [];
  let targetDirectory: string | undefined;
  let options = true;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && (argument === "-t" || argument === "--target-directory")) {
      targetDirectory = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (options && argument.startsWith("--target-directory=")) {
      targetDirectory = argument.slice("--target-directory=".length);
      continue;
    }
    if (options && argument.startsWith("-")) {
      continue;
    }
    operands.push(argument);
  }

  if (targetDirectory) {
    return [targetDirectory];
  }
  return operands.length > 1 ? [operands.at(-1) as string] : [];
}

function commandIndexAfterEnv(words: string[]): number {
  let commandIndex = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (commandIndex === -1 || words[commandIndex].split("/").at(-1) !== "env") {
    return commandIndex;
  }

  commandIndex += 1;
  while (commandIndex < words.length) {
    const word = words[commandIndex];
    if (word === "--") {
      return commandIndex + 1;
    }
    if (word === "-u" || word === "--unset" || word === "-C" || word === "--chdir") {
      commandIndex += 2;
      continue;
    }
    if (word.startsWith("-")) {
      commandIndex += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      commandIndex += 1;
      continue;
    }
    break;
  }
  return commandIndex;
}

function ddTargets(arguments_: string[]): string[] {
  return arguments_
    .filter((argument) => argument.startsWith("of=") && argument.length > 3)
    .map((argument) => argument.slice(3));
}

function commandTargets(words: string[]): string[] {
  const commandIndex = commandIndexAfterEnv(words);
  if (commandIndex === -1 || commandIndex >= words.length) {
    return [];
  }
  const command = words[commandIndex].split("/").at(-1);
  const arguments_ = words.slice(commandIndex + 1);
  if (command === "tee") {
    return teeTargets(arguments_);
  }
  if (command === "cp" || command === "mv") {
    return copyOrMoveTargets(arguments_);
  }
  if (command === "dd") {
    return ddTargets(arguments_);
  }
  if (command === "bash" || command === "sh" || command === "zsh") {
    const commandArgumentIndex = arguments_.indexOf("-c");
    if (commandArgumentIndex !== -1 && arguments_[commandArgumentIndex + 1]) {
      return extractBashTargetPaths(arguments_[commandArgumentIndex + 1]);
    }
  }
  return [];
}

export function extractBashTargetPaths(command: string): string[] {
  const targets: string[] = [];
  let words: string[] = [];

  const finishCommand = () => {
    targets.push(...commandTargets(words));
    words = [];
  };

  const tokens = shellTokens(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "separator") {
      finishCommand();
      continue;
    }
    if (token.kind === "redirect") {
      const destination = tokens[index + 1];
      if (destination?.kind === "word") {
        if (token.value.startsWith(">")) {
          targets.push(destination.value);
        }
        index += 1;
      }
      continue;
    }
    words.push(token.value);
  }
  finishCommand();
  return targets;
}

function secretPathMention(value: string): string | undefined {
  const pathShapedParts = value.match(PATH_SHAPED_PARTS) ?? [];
  return pathShapedParts.find((part) => SECRET_PATHS.test(part));
}

function containsEncodedSecret(value: string): boolean {
  return (value.match(BASE64_PARTS) ?? []).some((part) => {
    const decoded = Buffer.from(part, "base64").toString("utf8");
    return SECRET_PATTERNS.some((pattern) => pattern.test(decoded));
  });
}

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const PUSH_OPTIONS_WITH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const FORCE_TO_PROTECTED_REASON = "git push --force to main is not allowed";
const FORCE_WITHOUT_TARGET_REASON = "git force push must name its branch";

type PushIntent = { force: boolean; everyBranch: boolean; refspecs: string[] };

function simpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  for (const token of shellTokens(command)) {
    if (token.kind === "separator") {
      commands.push(words);
      words = [];
    } else if (token.kind === "word") {
      words.push(token.value);
    }
  }
  commands.push(words);
  return commands.filter((entry) => entry.length > 0);
}

function gitSubcommandIndex(words: string[]): number {
  const gitIndex = commandIndexAfterEnv(words);
  if (gitIndex === -1 || words[gitIndex]?.split("/").at(-1) !== "git") {
    return -1;
  }
  let index = gitIndex + 1;
  while (index < words.length) {
    const word = words[index];
    if (GIT_OPTIONS_WITH_VALUE.has(word)) {
      index += 2;
    } else if (word.startsWith("-")) {
      index += 1;
    } else {
      return index;
    }
  }
  return -1;
}

function isForceFlag(word: string): boolean {
  return (
    word === "--force" ||
    word.startsWith("--force-with-lease") ||
    (word.startsWith("-") && !word.startsWith("--") && word.slice(1).includes("f"))
  );
}

function pushIntent(arguments_: string[]): PushIntent {
  const intent: PushIntent = { force: false, everyBranch: false, refspecs: [] };
  const positionals: string[] = [];
  let index = 0;
  while (index < arguments_.length) {
    const word = arguments_[index];
    if (PUSH_OPTIONS_WITH_VALUE.has(word)) {
      index += 2;
      continue;
    }
    if (word === "--all" || word === "--mirror" || word === "--branches") {
      intent.everyBranch = true;
    } else if (isForceFlag(word)) {
      intent.force = true;
    } else if (!word.startsWith("-")) {
      positionals.push(word);
    }
    index += 1;
  }
  for (const refspec of positionals.slice(1)) {
    if (refspec.startsWith("+")) {
      intent.force = true;
    }
    intent.refspecs.push(refspec.replace(/^\++/, ""));
  }
  return intent;
}

function refspecTargetsProtectedBranch(refspec: string): boolean {
  const destination = refspec.split(":").at(-1) ?? refspec;
  const branch = destination.startsWith("refs/heads/") ? destination.slice("refs/heads/".length) : destination;
  return branch.includes("*") || PROTECTED_BRANCHES.has(branch);
}

function nestedShellCommand(words: string[]): string | undefined {
  const index = commandIndexAfterEnv(words);
  const shell = index === -1 ? undefined : words[index]?.split("/").at(-1);
  if (shell !== "bash" && shell !== "sh" && shell !== "zsh") {
    return undefined;
  }
  const flag = words.slice(index + 1).indexOf("-c");
  return flag === -1 ? undefined : words[index + 1 + flag + 1];
}

function forcePushDenial(command: string): string | undefined {
  for (const words of simpleCommands(command)) {
    const nested = nestedShellCommand(words);
    const nestedReason = nested === undefined ? undefined : forcePushDenial(nested);
    if (nestedReason) {
      return nestedReason;
    }
    const subcommand = gitSubcommandIndex(words);
    if (subcommand === -1 || words[subcommand] !== "push") {
      continue;
    }
    const intent = pushIntent(words.slice(subcommand + 1));
    if (!intent.force) {
      continue;
    }
    if (intent.everyBranch || intent.refspecs.some(refspecTargetsProtectedBranch)) {
      return FORCE_TO_PROTECTED_REASON;
    }
    if (intent.refspecs.length === 0) {
      return FORCE_WITHOUT_TARGET_REASON;
    }
  }
  return undefined;
}

export function admitCommand(input: CommandInput): { allow: boolean; reason: string } {
  if (input.kind === "bash" && /\bgit\s+commit\b[^\n]*--no-verify\b/i.test(input.text)) {
    return { allow: false, reason: "git commit with hooks disabled is not allowed" };
  }
  const forceReason = input.kind === "bash" ? forcePushDenial(input.text) : undefined;
  if (forceReason) {
    return { allow: false, reason: forceReason };
  }
  if (input.kind === "bash" && /\bgit\s+hash-object\b[^\n]*\s-w(?:\s|$)/i.test(input.text)) {
    return { allow: false, reason: "git hash-object object writes are not allowed" };
  }
  for (const targetPath of input.targetPaths) {
    if (SECRET_PATHS.test(targetPath)) {
      return { allow: false, reason: `refuse to write secret-shaped path ${targetPath}` };
    }
  }
  if (input.kind === "bash") {
    const hasOutputRedirect = shellTokens(input.text).some(
      (token) => token.kind === "redirect" && token.value.startsWith(">"),
    );
    if (hasOutputRedirect || INLINE_WRITE_INTENT.test(input.text)) {
      const secretPath = secretPathMention(input.text);
      if (secretPath) {
        return { allow: false, reason: `refuse to write secret-shaped path ${secretPath}` };
      }
    }
  }
  const hay = `${input.targetPaths.join("\n")}\n${input.text}`;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(hay)) {
      return { allow: false, reason: `secret-shaped token in ${input.kind} payload` };
    }
  }
  if (containsEncodedSecret(hay)) {
    return { allow: false, reason: `encoded secret-shaped token in ${input.kind} payload` };
  }
  return { allow: true, reason: `${input.kind} allowed` };
}
