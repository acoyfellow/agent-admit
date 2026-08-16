import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Decision = { allow: boolean; reason: string };

export type AdmitLoadResult =
  | { ok: true; admit: (action: unknown) => Decision; kernel: string }
  | { ok: false; reason: string };

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultWasmPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../target/wasm32-unknown-unknown/release/admit.wasm");
}

export function resolveWasmPath(override = process.env.ADMIT_WASM): string {
  return override && override.trim() ? override : defaultWasmPath();
}

function readPacked(memory: WebAssembly.Memory, packed: bigint): { ptr: number; size: number; text: string } {
  const ptr = Number(packed >> 32n);
  const size = Number(packed & 0xffffffffn);
  const view = new Uint8Array(memory.buffer, ptr, size);
  return { ptr, size, text: new TextDecoder().decode(view) };
}

type WasmExports = {
  memory: WebAssembly.Memory;
  admit_alloc: (size: number) => number;
  admit_free: (ptr: number, size: number) => void;
  admit_json: (ptr: number, len: number) => bigint;
};

function bindExports(exports: WebAssembly.Exports): WasmExports {
  const memory = exports.memory;
  const admit_alloc = exports.admit_alloc;
  const admit_free = exports.admit_free;
  const admit_json = exports.admit_json;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("wasm memory export missing");
  }
  if (typeof admit_alloc !== "function" || typeof admit_json !== "function") {
    throw new Error("admit_json not exported");
  }
  return {
    memory,
    admit_alloc: admit_alloc as WasmExports["admit_alloc"],
    admit_free: (typeof admit_free === "function" ? admit_free : () => undefined) as WasmExports["admit_free"],
    admit_json: admit_json as WasmExports["admit_json"],
  };
}

function decideWithWasm(wasm: WasmExports, action: unknown): Decision {
  const payload = Buffer.from(JSON.stringify(action), "utf8");
  const inPtr = wasm.admit_alloc(payload.byteLength);
  if (!inPtr) {
    throw new Error("admit_alloc failed");
  }
  new Uint8Array(wasm.memory.buffer, inPtr, payload.byteLength).set(payload);
  const packed = BigInt(wasm.admit_json(inPtr, payload.byteLength));
  const out = readPacked(wasm.memory, packed);
  wasm.admit_free(inPtr, payload.byteLength);
  wasm.admit_free(out.ptr, out.size);
  const decision = JSON.parse(out.text) as Decision;
  if (typeof decision.allow !== "boolean" || typeof decision.reason !== "string") {
    throw new Error("admit_json returned invalid decision");
  }
  return decision;
}

export async function loadAdmit(wasmPath = resolveWasmPath()): Promise<AdmitLoadResult> {
  try {
    if (!existsSync(wasmPath)) {
      return { ok: false, reason: `admit wasm missing: ${wasmPath}` };
    }
    const bytes = readFileSync(wasmPath);
    if (bytes.subarray(0, 4).toString("utf8") !== "\0asm" || bytes.byteLength <= 1024) {
      return { ok: false, reason: `admit wasm stub: ${wasmPath}` };
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const wasm = bindExports(instance.exports);
    const probe = decideWithWasm(wasm, { kind: "bash", command: "true" });
    if (typeof probe.allow !== "boolean") {
      return { ok: false, reason: "admit wasm probe failed" };
    }
    return {
      ok: true,
      kernel: wasmPath,
      admit: (action: unknown) => decideWithWasm(wasm, action),
    };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
}
