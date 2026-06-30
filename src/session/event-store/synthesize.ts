import type { SessionRecord } from "../../types.js";
import { ACPX_EVENT_SCHEMA, type AcpxDomainEvent } from "./events.js";

export function synthesizeHeader(record: SessionRecord): AcpxDomainEvent {
  return {
    kind: "header",
    seq: 0,
    ts: record.createdAt,
    schema: ACPX_EVENT_SCHEMA,
    acpxRecordId: record.acpxRecordId,
    acpSessionId: record.acpSessionId,
    cwd: record.cwd,
    agentCommand: record.agentCommand,
    agentCapabilities: record.agentCapabilities,
    createdAt: record.createdAt,
  };
}

export function synthesizeDesiredState(record: SessionRecord, seqStart: number): AcpxDomainEvent[] {
  const out: AcpxDomainEvent[] = [];
  let seq = seqStart;
  const ts = stateTs(record);
  const ax = record.acpx ?? {};
  const modelId = ax.session_options?.model;
  const configs = ax.desired_config_options;

  if (ax.desired_mode_id !== undefined) {
    out.push({
      kind: "desired_mode_set",
      seq: seq++,
      ts,
      schema: ACPX_EVENT_SCHEMA,
      modeId: ax.desired_mode_id,
    });
  }
  if (modelId !== undefined) {
    out.push({
      kind: "desired_model_set",
      seq: seq++,
      ts,
      schema: ACPX_EVENT_SCHEMA,
      modelId,
    });
  }
  for (const [configId, value] of Object.entries(configs ?? {})) {
    out.push({
      kind: "desired_config_option_set",
      seq: seq++,
      ts,
      schema: ACPX_EVENT_SCHEMA,
      configId,
      value,
    });
  }
  if (record.name !== undefined) {
    out.push({
      kind: "session_renamed",
      seq,
      ts,
      schema: ACPX_EVENT_SCHEMA,
      name: record.name,
    });
  }
  return out;
}

function stateTs(record: SessionRecord): string {
  return record.lastUsedAt || record.createdAt;
}

export function synthesizeClose(record: SessionRecord, seq: number): AcpxDomainEvent {
  if (!record.closed || !record.closedAt) {
    throw new Error("synthesizeClose called on non-closed record");
  }
  return {
    kind: "session_closed",
    seq,
    ts: record.closedAt,
    schema: ACPX_EVENT_SCHEMA,
    closedAt: record.closedAt,
    lastAgentExitCode: record.lastAgentExitCode,
    lastAgentExitSignal: record.lastAgentExitSignal,
    lastAgentDisconnectReason: record.lastAgentDisconnectReason,
  };
}

export function synthesizeReconnected(record: SessionRecord, seq: number): AcpxDomainEvent {
  return {
    kind: "session_reconnected",
    seq,
    ts: stateTs(record),
    schema: ACPX_EVENT_SCHEMA,
    acpSessionId: record.acpSessionId,
  };
}
