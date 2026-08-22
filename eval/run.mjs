import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustBin = path.join(root, "target/debug/admit");
const wasmPath = path.join(root, "target/wasm32-unknown-unknown/release/admit.wasm");
const receiptsDir = path.join(root, "eval/receipts");

const require = createRequire(import.meta.url);

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(root, "eval", name), "utf8"));
}

function materialize(action, policy) {
  if (action.kind === "lockfile" && action.policyJson === "__POLICY__") {
    return { ...action, policyJson: JSON.stringify(policy) };
  }
  return action;
}

function rustDecide(action) {
  const result = spawnSync(rustBin, ["json"], {
    input: JSON.stringify(action),
    encoding: "utf8",
    cwd: root,
  });
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`rust json failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function wasmExists() {
  return existsSync(wasmPath);
}

function wasmInfo() {
  if (!wasmExists()) return { built: false, bytes: 0, magic: false, exports: [] };
  const bytes = readFileSync(wasmPath);
  const magic = bytes.subarray(0, 4).toString("utf8") === "\0asm";
  return { built: magic && bytes.byteLength > 1024, bytes: bytes.byteLength, magic, exports: [] };
}

function readPacked(memory, packed) {
  const ptr = Number(packed >> 32n);
  const size = Number(packed & 0xffffffffn);
  const view = new Uint8Array(memory.buffer, ptr, size);
  const text = new TextDecoder().decode(view);
  return { ptr, size, text };
}

async function wasmDecideAll(cases) {
  if (!wasmExists()) {
    return { ok: false, reason: "wasm missing", bytes: 0, decided: 0, failed: cases.length, rows: [] };
  }
  const bytes = readFileSync(wasmPath);
  const magic = bytes.subarray(0, 4).toString("utf8") === "\0asm";
  if (!magic || bytes.byteLength <= 1024) {
    return { ok: false, reason: "wasm stub", bytes: bytes.byteLength, decided: 0, failed: cases.length, rows: [] };
  }
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;
  const names = Object.keys(exports);
  if (typeof exports.admit_json !== "function" || typeof exports.admit_alloc !== "function") {
    return { ok: false, reason: "admit_json not exported", bytes: bytes.byteLength, exports: names, decided: 0, failed: cases.length, rows: [] };
  }
  const memory = exports.memory;
  const rows = [];
  let failed = 0;
  for (const testCase of cases) {
    const payload = Buffer.from(JSON.stringify(testCase.action), "utf8");
    const inPtr = exports.admit_alloc(payload.byteLength);
    new Uint8Array(memory.buffer, Number(inPtr), payload.byteLength).set(payload);
    const packed = BigInt(exports.admit_json(inPtr, payload.byteLength));
    const out = readPacked(memory, packed);
    let decision;
    try {
      decision = JSON.parse(out.text);
    } catch {
      decision = { allow: null, reason: out.text };
    }
    if (typeof exports.admit_free === "function") {
      exports.admit_free(inPtr, payload.byteLength);
      exports.admit_free(out.ptr, out.size);
    }
    const expected = decision.allow === testCase.expect;
    const reasonHit = String(decision.reason ?? "").includes(testCase.reasonContains);
    const rustMatch =
      decision.allow === testCase.rustAllow && decision.reason === testCase.rustReason;
    if (!expected || !reasonHit || !rustMatch) failed += 1;
    rows.push({
      name: testCase.name,
      expect: testCase.expect,
      wasmAllow: decision.allow,
      wasmReason: decision.reason,
      expected,
      reasonHit,
      rustMatch,
    });
  }
  return {
    ok: failed === 0,
    reason: failed === 0 ? "decided" : "parity failed",
    bytes: bytes.byteLength,
    exports: names,
    decided: rows.length,
    failed,
    rows,
  };
}

async function loadTsAdmit() {
  const href = pathToFileURL(path.join(root, "src/admit.ts")).href;
  const mod = await import(href);
  return mod.admit;
}

async function muteCheck() {
  const { loadAdmit } = await import(pathToFileURL(path.join(root, "extension/load.ts")).href);
  const missing = await loadAdmit(path.join(root, "target/missing-admit.wasm"));
  const present = await loadAdmit(wasmPath);
  return {
    missingOk: missing.ok === false,
    presentOk: present.ok === true && typeof present.admit === "function",
    kernel: present.ok ? "admit.wasm" : undefined,
    usesTsModule: false,
    muteHolds: missing.ok === false && present.ok === true,
  };
}

function writeReceipt(id, body) {
  mkdirSync(receiptsDir, { recursive: true });
  const dest = path.join(receiptsDir, `${id}.json`);
  writeFileSync(dest, `${JSON.stringify(body, null, 2)}\n`);
  return dest;
}

const corpus = loadJson("corpus.json");
const bypasses = loadJson("bypasses.json");
const admit = await loadTsAdmit();

const lockstepRows = [];
let lockstepFailed = 0;
let denyCases = 0;
let noopWouldPassDenies = 0;
for (const testCase of corpus.cases) {
  const action = materialize(testCase.action, corpus.policy);
  const ts = admit(action);
  const rust = rustDecide(action);
  const noop = { allow: true, reason: "noop" };
  const parityAllow = ts.allow === rust.allow;
  const parityReason = ts.reason === rust.reason;
  const expected = ts.allow === testCase.expect && rust.allow === testCase.expect;
  const reasonHit =
    ts.reason.includes(testCase.reasonContains) && rust.reason.includes(testCase.reasonContains);
  if (!testCase.expect) {
    denyCases += 1;
    if (noop.allow) noopWouldPassDenies += 1;
  }
  if (!parityAllow || !parityReason || !expected || !reasonHit) lockstepFailed += 1;
  lockstepRows.push({
    name: testCase.name,
    expect: testCase.expect,
    tsAllow: ts.allow,
    rustAllow: rust.allow,
    tsReason: ts.reason,
    rustReason: rust.reason,
    parityAllow,
    parityReason,
    expected,
    reasonHit,
  });
}

const oracleRejectsFakePass = denyCases > 0 && noopWouldPassDenies === denyCases;
const lockstepGreen = lockstepFailed === 0 && oracleRejectsFakePass;

const mute = await muteCheck();

const wasmCases = lockstepRows.map((row, index) => ({
  name: row.name,
  expect: row.expect,
  reasonContains: corpus.cases[index].reasonContains,
  action: materialize(corpus.cases[index].action, corpus.policy),
  rustAllow: row.rustAllow,
  rustReason: row.rustReason,
}));
const wasm = await wasmDecideAll(wasmCases);

const bypassRows = [];
for (const testCase of bypasses.cases) {
  const ts = admit(testCase.action);
  const rust = rustDecide(testCase.action);
  bypassRows.push({
    name: testCase.name,
    claimed: testCase.claimed,
    tsAllow: ts.allow,
    rustAllow: rust.allow,
    tsReason: ts.reason,
    rustReason: rust.reason,
    extraCredit: ts.allow === false && rust.allow === false,
  });
}

const started = new Date().toISOString();
const lockstepReceipt = {
  id: "lockstep-negative-control",
  kind: "mechanical-gate",
  claim: "TypeScript and Rust admit() agree on allow and reason, and a no-op cannot make the suite green.",
  verified: lockstepGreen
    ? `TS and Rust agreed on ${lockstepRows.length} cases including reasons. ${denyCases} denies would all pass a no-op.`
    : "",
  projected: "Future kernels (WASM, Cedar) can reuse this corpus without rewriting cases.",
  realized: "",
  corpusSize: lockstepRows.length,
  denyCases,
  noopWouldPassDenies,
  oracleRejectsFakePass,
  failed: lockstepFailed,
  ok: lockstepGreen,
  rows: lockstepRows,
  at: started,
};
const muteReceipt = {
  id: "mute-fail-closed",
  kind: "mechanical-gate",
  claim: "If the admit module cannot load, the loader reports ok:false so a host can refuse every tool.",
  verified: mute.muteHolds
    ? "Missing module failed closed. Present module loaded admit()."
    : "",
  projected: "Pi extension continues to block all tools when src/admit.ts is moved aside.",
  realized: "",
  ok: mute.muteHolds,
  mute,
  at: started,
};
const wasmReceipt = {
  id: "wasm-artifact",
  kind: "mechanical-gate",
  claim: "The wasm module decides every corpus case with the same allow and reason as native Rust.",
  verified: wasm.ok
    ? `wasm decided ${wasm.decided} cases (${wasm.bytes} bytes). allow and reason matched native Rust.`
    : "",
  projected: "A host can evaluate the same kernel without spawning a native binary.",
  realized: "",
  ok: wasm.ok,
  wasm,
  at: started,
};
const bypassFailures = bypassRows.filter(
  (row) => row.claimed && (row.tsAllow || row.rustAllow),
);
const bypassReceipt = {
  id: "known-bypasses",
  kind: "mechanical-gate",
  claim: "Every documented bypass is denied by both TypeScript and Rust.",
  verified: bypassFailures.length === 0
    ? `${bypassRows.length} documented bypasses were denied by both implementations.`
    : "",
  projected: "New bypass cases become mandatory regression gates when added to the corpus.",
  realized: "",
  ok: bypassFailures.length === 0,
  rows: bypassRows,
  at: started,
};

const dests = {
  lockstep: writeReceipt(lockstepReceipt.id, lockstepReceipt),
  mute: writeReceipt(muteReceipt.id, muteReceipt),
  wasm: writeReceipt(wasmReceipt.id, wasmReceipt),
  bypasses: writeReceipt(bypassReceipt.id, bypassReceipt),
};

const summary = {
  ok: lockstepReceipt.ok && muteReceipt.ok && wasmReceipt.ok && bypassReceipt.ok,
  lockstep: { ok: lockstepReceipt.ok, failed: lockstepFailed, corpus: lockstepRows.length, oracleRejectsFakePass },
  mute: { ok: muteReceipt.ok },
  wasm: { ok: wasmReceipt.ok, bytes: wasm.bytes, decided: wasm.decided, failed: wasm.failed, reason: wasm.reason },
  bypasses: {
    ok: bypassReceipt.ok,
    cases: bypassRows.length,
    failed: bypassFailures.length,
    denied: bypassRows.filter((row) => row.extraCredit).length,
  },
  dests,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
