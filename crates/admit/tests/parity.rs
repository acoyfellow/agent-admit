use admit::{admit, extract_bash_target_paths, Action};

fn policy() -> String {
    r#"{
      "publicHosts": ["registry.npmjs.org"],
      "suspiciousHostContains": [".corp."],
      "suspiciousHostSuffixes": [".internal"]
    }"#
    .to_string()
}

#[test]
fn allows_ls() {
    let decision = admit(Action::Bash {
        command: "ls -la".to_string(),
    });
    assert!(decision.allow);
}

#[test]
fn rejects_commit_with_hooks_off() {
    let flag = format!("{}-{}", "no", "verify");
    let decision = admit(Action::Bash {
        command: format!("git commit --{flag} -m x"),
    });
    assert!(!decision.allow);
}

#[test]
fn one_target_path_rule() {
    let cases: Vec<(&str, Action, bool)> = vec![
        (
            "write secret path",
            Action::Write {
                path: "./.env".to_string(),
                content: "FOO=1".to_string(),
            },
            false,
        ),
        (
            "edit secret path",
            Action::Edit {
                path: "./.env".to_string(),
                payload: "FOO=1".to_string(),
            },
            false,
        ),
        (
            "quoted output redirect",
            Action::Bash {
                command: "printf 'FOO=1\\n' > \"./.env\"".to_string(),
            },
            false,
        ),
        (
            "quoted append redirect",
            Action::Bash {
                command: "echo FOO=1 >> './.env'".to_string(),
            },
            false,
        ),
        (
            "quoted tee target",
            Action::Bash {
                command: "printf FOO=1 | tee -- \"./.env\"".to_string(),
            },
            false,
        ),
        (
            "quoted cp target",
            Action::Bash {
                command: "cp source \"./.env\"".to_string(),
            },
            false,
        ),
        (
            "quoted mv target",
            Action::Bash {
                command: "mv source './.env'".to_string(),
            },
            false,
        ),
        (
            "python open",
            Action::Bash {
                command: r#"python -c "open('.env','w').write('x')""#.to_string(),
            },
            false,
        ),
        (
            "node writeFileSync",
            Action::Bash {
                command: r#"node -e "require('fs').writeFileSync('.env','x')""#.to_string(),
            },
            false,
        ),
        (
            "python3 one-liner",
            Action::Bash {
                command: r#"python3 -e "write('.env')""#.to_string(),
            },
            false,
        ),
        (
            "ruby one-liner",
            Action::Bash {
                command: r#"ruby -e "write('.env')""#.to_string(),
            },
            false,
        ),
        (
            "perl one-liner",
            Action::Bash {
                command: r#"perl -e "write('.env')""#.to_string(),
            },
            false,
        ),
        (
            "php one-liner",
            Action::Bash {
                command: r#"php -e "write('.env')""#.to_string(),
            },
            false,
        ),
        (
            "dd output",
            Action::Bash {
                command: "dd if=foo of=.env".to_string(),
            },
            false,
        ),
        (
            "bash command string redirect",
            Action::Bash {
                command: r#"bash -c "printf 'FOO=1\n' > ./.env""#.to_string(),
            },
            false,
        ),
        (
            "sh command string redirect",
            Action::Bash {
                command: "sh -c 'printf x > ./.env'".to_string(),
            },
            false,
        ),
        (
            "zsh command string redirect",
            Action::Bash {
                command: "zsh -c 'printf x > ./.env'".to_string(),
            },
            false,
        ),
        (
            "env tee",
            Action::Bash {
                command: "env tee ./.env".to_string(),
            },
            false,
        ),
        (
            "env assignment tee",
            Action::Bash {
                command: "env MODE=test tee ./.env".to_string(),
            },
            false,
        ),
        (
            "ls",
            Action::Bash {
                command: "ls".to_string(),
            },
            true,
        ),
        (
            "git status",
            Action::Bash {
                command: "git status".to_string(),
            },
            true,
        ),
        (
            "ordinary tee target",
            Action::Bash {
                command: "tee build.log".to_string(),
            },
            true,
        ),
        (
            "ordinary output redirect",
            Action::Bash {
                command: "echo hello > output.txt".to_string(),
            },
            true,
        ),
        (
            "ordinary write target",
            Action::Write {
                path: "src/hello.ts".to_string(),
                content: "export {}".to_string(),
            },
            true,
        ),
        (
            "ordinary edit target",
            Action::Edit {
                path: "src/output.ts".to_string(),
                payload: "export const x = 1".to_string(),
            },
            true,
        ),
    ];

    for (name, action, allow) in cases {
        let decision = admit(action);
        assert_eq!(decision.allow, allow, "{name}");
        if !allow {
            assert!(
                decision.reason.contains("refuse to write secret-shaped path"),
                "{name}: {}",
                decision.reason
            );
        }
    }
}

#[test]
fn extracts_targets_from_dd_and_wrapped_commands() {
    assert_eq!(extract_bash_target_paths("dd if=foo of=.env"), vec![".env"]);
    assert_eq!(
        extract_bash_target_paths(r#"bash -c "printf 'FOO=1\n' > ./.env""#),
        vec!["./.env"]
    );
    assert_eq!(
        extract_bash_target_paths("sh -c 'printf x > ./.env'"),
        vec!["./.env"]
    );
    assert_eq!(
        extract_bash_target_paths("zsh -c 'printf x > ./.env'"),
        vec!["./.env"]
    );
    assert_eq!(extract_bash_target_paths("env tee ./.env"), vec!["./.env"]);
}

#[test]
fn rejects_secret_shaped_token_in_write() {
    let token = format!("sk-{}", "x".repeat(28));
    let decision = admit(Action::Write {
        path: "src/a.ts".to_string(),
        content: format!(r#"const k="{token}""#),
    });
    assert!(!decision.allow);
}

#[test]
fn rejects_base64_encoded_secret() {
    let decision = admit(Action::Write {
        path: "src/a.ts".to_string(),
        content: "Buffer.from('c2steHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4','base64')".to_string(),
    });
    assert!(!decision.allow);
    assert!(decision.reason.contains("encoded secret-shaped token"));
}

#[test]
fn rejects_git_hash_object_write() {
    let decision = admit(Action::Bash {
        command: "git hash-object -w --stdin".to_string(),
    });
    assert!(!decision.allow);
    assert!(decision.reason.contains("hash-object"));
}

#[test]
fn rejects_uppercase_private_registry_url() {
    let decision = admit(Action::Lockfile {
        text: format!("\"{}://NPM.CORP.ACME.EXAMPLE/foo/-/foo-1.0.0.tgz\"", "HTTPS"),
        policy_json: policy(),
    });
    assert!(!decision.allow);
}

#[test]
fn allows_npmjs_with_uppercase_scheme() {
    let decision = admit(Action::Lockfile {
        text: format!("\"{}://REGISTRY.NPMJS.ORG/a/-/a-1.0.0.tgz\"", "HTTPS"),
        policy_json: policy(),
    });
    assert!(decision.allow);
}
