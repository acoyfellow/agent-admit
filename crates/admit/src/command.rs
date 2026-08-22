use crate::Decision;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq)]
enum TokenKind {
    Word,
    Redirect,
    Separator,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ShellToken {
    kind: TokenKind,
    value: String,
}

fn secret_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"sk-[A-Za-z0-9]{20,}").expect("sk"),
            Regex::new(r"glpat-[A-Za-z0-9_-]{16,}").expect("glpat"),
            Regex::new(r"gh[posru]_[A-Za-z0-9]{20,}").expect("gh"),
            Regex::new(r"\bAKIA[0-9A-Z]{16}\b").expect("akia"),
            Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._-]{20,}").expect("bearer"),
        ]
    })
}

fn secret_paths() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(^|/)(\.env(\.[^/]+)?|\.dev\.vars(\.[^/]+)?|\.npmrc)$").expect("paths")
    })
}

fn path_shaped_parts() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9_./~-]+").expect("parts"))
}

fn base64_parts() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9+/]{24,}={0,2}").expect("base64"))
}

fn inline_write_intent() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b(?:eval|python3?|node|ruby|perl|php)\b[^\n]*(?:\bwrite(?:File(?:Sync)?|_text)?\b|\bopen\s*\(|>)")
            .expect("inline write")
    })
}

fn hook_off() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\bgit\s+commit\b[^\n]*--no-verify\b").expect("hook"))
}

fn force_push() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\bgit\s+push\b[^\n]*--force\b").expect("force"))
}

fn main_branch() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\bmain\b").expect("main"))
}

fn hash_object_write() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bgit\s+hash-object\b[^\n]*\s-w(?:\s|$)").expect("hash-object")
    })
}

fn env_assign() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*=").expect("env"))
}

fn shell_tokens(command: &str) -> Vec<ShellToken> {
    let chars: Vec<char> = command.chars().collect();
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;

    let push_word = |word: &mut String, tokens: &mut Vec<ShellToken>| {
        if !word.is_empty() {
            tokens.push(ShellToken {
                kind: TokenKind::Word,
                value: std::mem::take(word),
            });
        }
    };

    while index < chars.len() {
        let character = chars[index];
        if let Some(q) = quote {
            if character == q {
                quote = None;
            } else if character == '\\' && q == '"' && index + 1 < chars.len() {
                index += 1;
                word.push(chars[index]);
            } else {
                word.push(character);
            }
            index += 1;
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
            index += 1;
            continue;
        }
        if character == '\\' && index + 1 < chars.len() {
            index += 1;
            word.push(chars[index]);
            index += 1;
            continue;
        }
        if character.is_whitespace() {
            push_word(&mut word, &mut tokens);
            if character == '\n' {
                tokens.push(ShellToken {
                    kind: TokenKind::Separator,
                    value: character.to_string(),
                });
            }
            index += 1;
            continue;
        }
        if character == '>' || character == '<' {
            push_word(&mut word, &mut tokens);
            let mut redirect = character.to_string();
            while index + 1 < chars.len() && chars[index + 1] == character {
                index += 1;
                redirect.push(character);
            }
            tokens.push(ShellToken {
                kind: TokenKind::Redirect,
                value: redirect,
            });
            index += 1;
            continue;
        }
        if character == ';' || character == '|' || character == '&' {
            push_word(&mut word, &mut tokens);
            tokens.push(ShellToken {
                kind: TokenKind::Separator,
                value: character.to_string(),
            });
            index += 1;
            continue;
        }
        word.push(character);
        index += 1;
    }
    push_word(&mut word, &mut tokens);
    tokens
}

fn tee_targets(arguments: &[String]) -> Vec<String> {
    let mut targets = Vec::new();
    let mut options = true;
    for argument in arguments {
        if options && argument == "--" {
            options = false;
        } else if options && argument.starts_with('-') {
            continue;
        } else {
            options = false;
            targets.push(argument.clone());
        }
    }
    targets
}

fn copy_or_move_targets(arguments: &[String]) -> Vec<String> {
    let mut operands = Vec::new();
    let mut target_directory: Option<String> = None;
    let mut options = true;
    let mut index = 0;
    while index < arguments.len() {
        let argument = &arguments[index];
        if options && argument == "--" {
            options = false;
            index += 1;
            continue;
        }
        if options && (argument == "-t" || argument == "--target-directory") {
            target_directory = arguments.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if options && argument.starts_with("--target-directory=") {
            target_directory = Some(argument["--target-directory=".len()..].to_string());
            index += 1;
            continue;
        }
        if options && argument.starts_with('-') {
            index += 1;
            continue;
        }
        operands.push(argument.clone());
        index += 1;
    }
    if let Some(directory) = target_directory {
        return vec![directory];
    }
    if operands.len() > 1 {
        operands.pop().into_iter().collect()
    } else {
        Vec::new()
    }
}

fn command_index_after_env(words: &[String]) -> Option<usize> {
    let mut command_index = words.iter().position(|word| !env_assign().is_match(word))?;
    let basename = words[command_index].rsplit('/').next().unwrap_or("");
    if basename != "env" {
        return Some(command_index);
    }
    command_index += 1;
    while command_index < words.len() {
        let word = &words[command_index];
        if word == "--" {
            return Some(command_index + 1);
        }
        if word == "-u" || word == "--unset" || word == "-C" || word == "--chdir" {
            command_index += 2;
            continue;
        }
        if word.starts_with('-') {
            command_index += 1;
            continue;
        }
        if env_assign().is_match(word) {
            command_index += 1;
            continue;
        }
        break;
    }
    Some(command_index)
}

fn dd_targets(arguments: &[String]) -> Vec<String> {
    arguments
        .iter()
        .filter(|argument| argument.starts_with("of=") && argument.len() > 3)
        .map(|argument| argument[3..].to_string())
        .collect()
}

fn command_targets(words: &[String]) -> Vec<String> {
    let Some(command_index) = command_index_after_env(words) else {
        return Vec::new();
    };
    if command_index >= words.len() {
        return Vec::new();
    }
    let command = words[command_index].rsplit('/').next().unwrap_or("");
    let arguments = &words[command_index + 1..];
    if command == "tee" {
        return tee_targets(arguments);
    }
    if command == "cp" || command == "mv" {
        return copy_or_move_targets(arguments);
    }
    if command == "dd" {
        return dd_targets(arguments);
    }
    if command == "bash" || command == "sh" || command == "zsh" {
        if let Some(command_argument_index) = arguments.iter().position(|argument| argument == "-c")
        {
            if let Some(nested) = arguments.get(command_argument_index + 1) {
                return extract_bash_target_paths(nested);
            }
        }
    }
    Vec::new()
}

pub fn extract_bash_target_paths(command: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut words: Vec<String> = Vec::new();
    let tokens = shell_tokens(command);
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        match token.kind {
            TokenKind::Separator => {
                targets.extend(command_targets(&words));
                words.clear();
            }
            TokenKind::Redirect => {
                if let Some(destination) = tokens.get(index + 1) {
                    if destination.kind == TokenKind::Word {
                        if token.value.starts_with('>') {
                            targets.push(destination.value.clone());
                        }
                        index += 1;
                    }
                }
            }
            TokenKind::Word => words.push(token.value.clone()),
        }
        index += 1;
    }
    targets.extend(command_targets(&words));
    targets
}

fn secret_path_mention(value: &str) -> Option<String> {
    path_shaped_parts()
        .find_iter(value)
        .map(|part| part.as_str().to_string())
        .find(|part| secret_paths().is_match(part))
}

fn contains_encoded_secret(value: &str) -> bool {
    base64_parts().find_iter(value).any(|part| {
        BASE64_STANDARD
            .decode(part.as_str())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .is_some_and(|decoded| {
                secret_patterns()
                    .iter()
                    .any(|pattern| pattern.is_match(&decoded))
            })
    })
}

pub fn admit_command(kind: &str, text: &str, target_paths: &[String]) -> Decision {
    if kind == "bash" && hook_off().is_match(text) {
        return Decision {
            allow: false,
            reason: "git commit with hooks disabled is not allowed".to_string(),
        };
    }
    if kind == "bash" && force_push().is_match(text) && main_branch().is_match(text) {
        return Decision {
            allow: false,
            reason: "git push --force to main is not allowed".to_string(),
        };
    }
    if kind == "bash" && hash_object_write().is_match(text) {
        return Decision {
            allow: false,
            reason: "git hash-object object writes are not allowed".to_string(),
        };
    }
    for target_path in target_paths {
        if secret_paths().is_match(target_path) {
            return Decision {
                allow: false,
                reason: format!("refuse to write secret-shaped path {target_path}"),
            };
        }
    }
    if kind == "bash" {
        let has_output_redirect = shell_tokens(text)
            .iter()
            .any(|token| token.kind == TokenKind::Redirect && token.value.starts_with('>'));
        if has_output_redirect || inline_write_intent().is_match(text) {
            if let Some(secret_path) = secret_path_mention(text) {
                return Decision {
                    allow: false,
                    reason: format!("refuse to write secret-shaped path {secret_path}"),
                };
            }
        }
    }
    let hay = format!("{}\n{text}", target_paths.join("\n"));
    for pattern in secret_patterns() {
        if pattern.is_match(&hay) {
            return Decision {
                allow: false,
                reason: format!("secret-shaped token in {kind} payload"),
            };
        }
    }
    if contains_encoded_secret(&hay) {
        return Decision {
            allow: false,
            reason: format!("encoded secret-shaped token in {kind} payload"),
        };
    }
    Decision {
        allow: true,
        reason: format!("{kind} allowed"),
    }
}
