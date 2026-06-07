import type { AcpEventMeta } from "./contract.js";

export type AcpxHandleState = {
  name: string;
  agent: string;
  cwd: string;
  mode: "persistent" | "oneshot";
  acpxRecordId?: string;
  backendSessionId?: string;
  agentSessionId?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Spread helper that forwards an SDK `_meta` envelope onto a top-level event
 * if present. Returns an empty object when `payload._meta` is missing or
 * not a record — kept symmetric with the contract's `AcpEventMeta` type.
 */
export function forwardMeta(payload: Record<string, unknown>): { _meta?: AcpEventMeta } {
  return isRecord(payload._meta) ? { _meta: payload._meta } : {};
}

export function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asOptionalString(value: unknown): string | undefined {
  const text = asTrimmedString(value);
  return text || undefined;
}

export function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function deriveAgentFromSessionKey(sessionKey: string, fallbackAgent: string): string {
  const match = sessionKey.match(/^agent:([^:]+):/i);
  const candidate = match?.[1] ? asTrimmedString(match[1]) : "";
  return candidate || fallbackAgent;
}
