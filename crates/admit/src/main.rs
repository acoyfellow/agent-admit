use admit::{admit, Action};
use serde_json::json;
use std::env;
use std::fs;
use std::process;

fn print_decision(decision: admit::Decision) -> ! {
    println!(
        "{}",
        json!({
            "allow": decision.allow,
            "reason": decision.reason,
        })
    );
    process::exit(if decision.allow { 0 } else { 2 });
}

fn main() {
    let mut args = env::args().skip(1);
    let Some(kind) = args.next() else {
        eprintln!("usage: admit <bash|write|lockfile> ...");
        process::exit(1);
    };
    match kind.as_str() {
        "bash" => {
            let command = args.collect::<Vec<_>>().join(" ");
            print_decision(admit(Action::Bash { command }));
        }
        "write" => {
            let path = args.next().unwrap_or_default();
            let content = args.next().unwrap_or_default();
            print_decision(admit(Action::Write { path, content }));
        }
        "json" => {
            let raw = std::io::read_to_string(std::io::stdin()).expect("stdin");
            let action: Action = serde_json::from_str(&raw).expect("action json");
            print_decision(admit(action));
        }
        "lockfile" => {
            let Some(lock_path) = args.next() else {
                eprintln!("usage: admit lockfile <lockfile> [policy.json]");
                process::exit(1);
            };
            let policy_path = args.next().unwrap_or_else(|| "policy.json".to_string());
            let text = fs::read_to_string(lock_path).expect("lockfile");
            let policy_json = fs::read_to_string(policy_path).expect("policy");
            print_decision(admit(Action::Lockfile { text, policy_json }));
        }
        _ => {
            eprintln!("usage: admit <bash|write|lockfile> ...");
            process::exit(1);
        }
    }
}
