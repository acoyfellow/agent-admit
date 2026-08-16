use regex::Regex;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::OnceLock;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub public_hosts: Vec<String>,
    #[serde(default)]
    pub suspicious_host_contains: Vec<String>,
    #[serde(default)]
    pub suspicious_host_suffixes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub host: String,
    pub sample_url: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockfileDecision {
    pub allow: bool,
    pub reason: String,
    pub policy_sha256: String,
    pub findings: Vec<Finding>,
}

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)https://[^\s"',\]\)}]+"#).expect("url"))
}

fn package_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\.(tgz|tar\.gz|zip)(\?|$)").expect("pkg"))
}

pub fn parse_policy(raw: &str) -> Result<Policy, String> {
    let mut value: Policy = serde_json::from_str(raw).map_err(|error| error.to_string())?;
    if value.public_hosts.is_empty() {
        return Err("policy.publicHosts must be a non-empty array".to_string());
    }
    for host in &mut value.public_hosts {
        *host = host.to_ascii_lowercase();
    }
    for part in &mut value.suspicious_host_contains {
        *part = part.to_ascii_lowercase();
    }
    for part in &mut value.suspicious_host_suffixes {
        *part = part.to_ascii_lowercase();
    }
    Ok(value)
}

pub fn policy_sha256(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn extract_registry_urls(text: &str) -> Vec<String> {
    url_re()
        .find_iter(text)
        .map(|found| found.as_str().trim_end_matches([')', ',', ';']).to_string())
        .filter(|url| package_url_re().is_match(url) || url.contains("/-/"))
        .collect()
}

fn host_from_url(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_ascii_lowercase()))
}

fn is_public_host(host: &str, policy: &Policy) -> bool {
    policy
        .public_hosts
        .iter()
        .any(|allowed| host == allowed || host.ends_with(&format!(".{allowed}")))
}

fn is_suspicious_host(host: &str, policy: &Policy) -> bool {
    if policy.suspicious_host_contains.iter().any(|part| host.contains(part)) {
        return true;
    }
    policy.suspicious_host_suffixes.iter().any(|suffix| {
        let trimmed = suffix.trim_start_matches('.');
        host == trimmed || host.ends_with(suffix)
    })
}

pub fn admit_lockfile(text: &str, policy_raw: &str) -> LockfileDecision {
    let policy = parse_policy(policy_raw).expect("policy.publicHosts must be a non-empty array");
    let sha = policy_sha256(policy_raw);
    let mut findings = Vec::new();
    let mut seen = HashSet::new();
    for url in extract_registry_urls(text) {
        let Some(host) = host_from_url(&url) else {
            continue;
        };
        if is_public_host(&host, &policy) || seen.contains(&host) {
            continue;
        }
        seen.insert(host.clone());
        let kind = if is_suspicious_host(&host, &policy) {
            "SuspiciousRegistry"
        } else {
            "NonPublicRegistry"
        };
        findings.push(Finding {
            host,
            sample_url: url,
            kind,
        });
    }
    if findings.is_empty() {
        return LockfileDecision {
            allow: true,
            reason: "lockfile allowed".to_string(),
            policy_sha256: sha,
            findings,
        };
    }
    let count = findings.len();
    LockfileDecision {
        allow: false,
        reason: format!("lockfile has {count} host(s) not on the public list"),
        policy_sha256: sha,
        findings,
    }
}
