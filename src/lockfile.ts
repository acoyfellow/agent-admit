import { createHash } from "node:crypto";

export type Policy = {
  publicHosts: string[];
  suspiciousHostContains: string[];
  suspiciousHostSuffixes: string[];
};

export type Finding = {
  host: string;
  sampleUrl: string;
  kind: "NonPublicRegistry" | "SuspiciousRegistry";
};

const URL_RE = /https:\/\/[^\s"',\]\)}]+/gi;

export function parsePolicy(raw: string): Policy {
  const value = JSON.parse(raw) as Partial<Policy>;
  if (!Array.isArray(value.publicHosts) || value.publicHosts.length === 0) {
    throw new Error("policy.publicHosts must be a non-empty array");
  }
  return {
    publicHosts: value.publicHosts.map((host) => host.toLowerCase()),
    suspiciousHostContains: (value.suspiciousHostContains ?? []).map((part) =>
      part.toLowerCase(),
    ),
    suspiciousHostSuffixes: (value.suspiciousHostSuffixes ?? []).map((part) =>
      part.toLowerCase(),
    ),
  };
}

export function policySha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function extractRegistryUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  const urls: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[),;]+$/, "");
    if (
      /\.(tgz|tar\.gz|zip)(\?|$)/i.test(url) ||
      /\/-\//.test(url)
    ) {
      urls.push(url);
    }
  }
  return urls;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isPublicHost(host: string, policy: Policy): boolean {
  return policy.publicHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function isSuspiciousHost(host: string, policy: Policy): boolean {
  if (policy.suspiciousHostContains.some((part) => host.includes(part))) {
    return true;
  }
  return policy.suspiciousHostSuffixes.some(
    (suffix) => host === suffix.replace(/^\./, "") || host.endsWith(suffix),
  );
}

export function admitLockfile(
  text: string,
  policyRaw: string,
): { allow: boolean; reason: string; policySha256: string; findings: Finding[] } {
  const policy = parsePolicy(policyRaw);
  const sha = policySha256(policyRaw);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const url of extractRegistryUrls(text)) {
    const host = hostFromUrl(url);
    if (host === null || isPublicHost(host, policy) || seen.has(host)) {
      continue;
    }
    seen.add(host);
    findings.push({
      host,
      sampleUrl: url,
      kind: isSuspiciousHost(host, policy) ? "SuspiciousRegistry" : "NonPublicRegistry",
    });
  }
  if (findings.length === 0) {
    return { allow: true, reason: "lockfile allowed", policySha256: sha, findings };
  }
  return {
    allow: false,
    reason: `lockfile has ${findings.length} host(s) not on the public list`,
    policySha256: sha,
    findings,
  };
}
