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

export function admitCommand(input: CommandInput): { allow: boolean; reason: string } {
  if (input.kind === "bash" && /\bgit\s+commit\b[^\n]*--no-verify\b/i.test(input.text)) {
    return { allow: false, reason: "git commit with hooks disabled is not allowed" };
  }
  if (
    input.kind === "bash" &&
    /\bgit\s+push\b[^\n]*--force\b/i.test(input.text) &&
    /\bmain\b/.test(input.text)
  ) {
    return { allow: false, reason: "git push --force to main is not allowed" };
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
