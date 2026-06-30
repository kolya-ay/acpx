// EventStore implementation over StoragePrimitives.
//
// Seq invariant (Fix A):
// `record.lastSeq` is the wire-derivable replay watermark — it counts
// header(0) + desired-state events + lifted wire frames. It does NOT count
// the synthesized lifecycle events (session_closed / session_reconnected),
// which are not persisted as wire frames.
//
// closeSession / reopenSession therefore do NOT bump record.lastSeq. They
// emit a LIVE lifecycle event with seq = record.lastSeq + 1 so live
// subscribers see something monotonic, but persist no seq change. On replay,
// `events()` synthesizes the close event with a seq computed from the
// reconstructed counter (which is also record.lastSeq + 1 — the value
// remains stable because we never bumped on close).
//
// Net effect: after appendWire post-reopen, the persisted lastSeq equals
// the max seq yielded by events(); live and replay agree on the watermark.

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpJsonRpcMessage, SessionAcpxState, SessionRecord } from "../../types.js";
import { SESSION_RECORD_SCHEMA } from "../../types.js";
import { defaultSessionEventLog } from "../event-log.js";
import {
  ACPX_EVENT_SCHEMA,
  type AcpxDomainEvent,
  type AcpxEvent,
  type AcpxWireEvent,
} from "./events.js";
import { fromAcp } from "./from-acp.js";
import { reduce, type SessionState } from "./reduce.js";
import {
  synthesizeClose,
  synthesizeDesiredState,
  synthesizeHeader,
  synthesizeReconnected,
} from "./synthesize.js";
import {
  type CreateSessionInput,
  type DesiredStatePatch,
  type EventStore,
  type SessionExitInfo,
  SessionClosedError,
  SessionExistsError,
  SessionNotFoundError,
  type StoragePrimitives,
} from "./types.js";

function seedRecord(input: CreateSessionInput): SessionRecord {
  const now = input.createdAt ?? new Date().toISOString();
  return {
    schema: SESSION_RECORD_SCHEMA,
    acpxRecordId: input.acpxRecordId,
    acpSessionId: input.acpSessionId,
    agentCommand: input.agentCommand,
    cwd: input.cwd,
    createdAt: now,
    lastUsedAt: now,
    lastSeq: 0,
    eventLog: defaultSessionEventLog(input.acpxRecordId),
    closed: false,
    agentCapabilities: input.agentCapabilities,
    messages: [],
    updated_at: now,
    cumulative_token_usage: {},
    request_token_usage: {},
    acpx: {},
  };
}

async function loadOrThrow(p: StoragePrimitives, sessionId: string): Promise<SessionRecord> {
  const record = await p.loadRecord(sessionId);
  if (!record) {
    throw new SessionNotFoundError(sessionId);
  }
  return record;
}

// Desired-state operations are split along two axes:
//   axis 1 (operation): applyDesiredPatch (apply to record) vs
//                       diffDesiredEvents (emit events for changes)
//   axis 2 (helpers): each operation breaks out into small per-section
//                     helpers because the CC gate (8) won't absorb four
//                     nullish branches in one function.
// Spec preference is "one apply + one diff with all four fields inline";
// the lint gate forces small per-section helpers (apply* writes the acpx
// slice; diff* returns 0..1 events).

function applyModeSection(acpx: SessionAcpxState, modeId: DesiredStatePatch["modeId"]): void {
  if (modeId === undefined) {
    return;
  }
  if (modeId === null) {
    delete acpx.desired_mode_id;
    return;
  }
  acpx.desired_mode_id = modeId;
}

function applyModelSection(acpx: SessionAcpxState, modelId: DesiredStatePatch["modelId"]): void {
  if (modelId === undefined) {
    return;
  }
  const session_options = { ...acpx.session_options };
  if (modelId === null) {
    delete session_options.model;
  } else {
    session_options.model = modelId;
  }
  acpx.session_options = session_options;
}

function applyConfigSection(
  acpx: SessionAcpxState,
  patch: DesiredStatePatch["configOptions"],
): void {
  if (!patch) {
    return;
  }
  const out: Record<string, string> = { ...acpx.desired_config_options };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete out[k];
    } else {
      out[k] = v;
    }
  }
  acpx.desired_config_options = out;
}

function applyNameSection(record: SessionRecord, name: DesiredStatePatch["name"]): void {
  if (name === undefined) {
    return;
  }
  if (name === null) {
    delete record.name;
    return;
  }
  record.name = name;
}

function applyDesiredPatch(record: SessionRecord, patch: DesiredStatePatch): SessionRecord {
  const acpx: SessionAcpxState = { ...record.acpx };
  applyModeSection(acpx, patch.modeId);
  applyModelSection(acpx, patch.modelId);
  applyConfigSection(acpx, patch.configOptions);
  const next: SessionRecord = { ...record, acpx };
  applyNameSection(next, patch.name);
  return next;
}

function diffModeSection(
  prev: SessionRecord,
  modeId: DesiredStatePatch["modeId"],
  seq: number,
  ts: string,
): AcpxDomainEvent | undefined {
  if (modeId === undefined) {
    return undefined;
  }
  const before = prev.acpx?.desired_mode_id ?? null;
  if (modeId === before) {
    return undefined;
  }
  return { kind: "desired_mode_set", seq, ts, schema: ACPX_EVENT_SCHEMA, modeId };
}

function diffModelSection(
  prev: SessionRecord,
  modelId: DesiredStatePatch["modelId"],
  seq: number,
  ts: string,
): AcpxDomainEvent | undefined {
  if (modelId === undefined) {
    return undefined;
  }
  const before = prev.acpx?.session_options?.model ?? null;
  if (modelId === before) {
    return undefined;
  }
  return { kind: "desired_model_set", seq, ts, schema: ACPX_EVENT_SCHEMA, modelId };
}

function diffConfigSection(
  prev: SessionRecord,
  patch: DesiredStatePatch["configOptions"],
  seqStart: number,
  ts: string,
): AcpxDomainEvent[] {
  if (!patch) {
    return [];
  }
  const prevMap = prev.acpx?.desired_config_options ?? {};
  const out: AcpxDomainEvent[] = [];
  let seq = seqStart;
  for (const [configId, value] of Object.entries(patch)) {
    const before = prevMap[configId];
    if (before === undefined && value === null) {
      continue;
    }
    if (before === value) {
      continue;
    }
    out.push({
      kind: "desired_config_option_set",
      seq: seq++,
      ts,
      schema: ACPX_EVENT_SCHEMA,
      configId,
      value,
    });
  }
  return out;
}

function diffNameSection(
  prev: SessionRecord,
  name: DesiredStatePatch["name"],
  seq: number,
  ts: string,
): AcpxDomainEvent | undefined {
  if (name === undefined) {
    return undefined;
  }
  const before = prev.name ?? null;
  if (name === before) {
    return undefined;
  }
  return { kind: "session_renamed", seq, ts, schema: ACPX_EVENT_SCHEMA, name };
}

function diffDesiredEvents(
  before: SessionRecord,
  patch: DesiredStatePatch,
  seqStart: number,
  ts: string,
): AcpxDomainEvent[] {
  const out: AcpxDomainEvent[] = [];
  let seq = seqStart;
  const mode = diffModeSection(before, patch.modeId, seq, ts);
  if (mode) {
    out.push(mode);
    seq += 1;
  }
  const model = diffModelSection(before, patch.modelId, seq, ts);
  if (model) {
    out.push(model);
    seq += 1;
  }
  const cfg = diffConfigSection(before, patch.configOptions, seq, ts);
  out.push(...cfg);
  seq += cfg.length;
  const name = diffNameSection(before, patch.name, seq, ts);
  if (name) {
    out.push(name);
  }
  return out;
}

// Lift a single JSON-RPC frame into 0..N wire events. Inlined frame-shape
// recognition: we only care about `session/update` frames with a valid
// `update` object; fromAcp tolerates unknown SDK variants.
function liftFrame(frame: AcpJsonRpcMessage, seq: number, ts: string): AcpxWireEvent[] {
  const candidate = frame as { method?: unknown; params?: unknown };
  if (candidate.method !== "session/update") {
    return [];
  }
  const params = candidate.params as { update?: unknown } | undefined;
  if (!params || typeof params.update !== "object" || params.update === null) {
    return [];
  }
  return fromAcp(params.update as SessionUpdate, seq, ts);
}

async function* iterateEvents(p: StoragePrimitives, sessionId: string): AsyncIterable<AcpxEvent> {
  const record = await loadOrThrow(p, sessionId);
  yield synthesizeHeader(record);
  let seq = 1;
  for (const desired of synthesizeDesiredState(record, seq)) {
    yield desired;
    seq += 1;
  }
  for await (const frame of p.readFrames(sessionId)) {
    const lifted = liftFrame(frame, seq, new Date().toISOString());
    for (const event of lifted) {
      yield event;
      seq += 1;
    }
  }
  if (record.closed === true && record.closedAt) {
    yield synthesizeClose(record, seq);
  }
}

async function foldState(p: StoragePrimitives, sessionId: string): Promise<SessionState> {
  let state: SessionState | null = null;
  for await (const event of iterateEvents(p, sessionId)) {
    state = reduce(state, event);
  }
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }
  return state;
}

async function createSessionImpl(
  p: StoragePrimitives,
  input: CreateSessionInput,
): Promise<SessionRecord> {
  const existing = await p.loadRecord(input.acpxRecordId);
  if (existing) {
    throw new SessionExistsError(input.acpxRecordId);
  }
  const record = seedRecord(input);
  await p.saveRecord(record);
  return record;
}

async function appendWireImpl(
  p: StoragePrimitives,
  sessionId: string,
  update: SessionUpdate,
  ts: string,
): Promise<AcpxEvent[]> {
  const record = await loadOrThrow(p, sessionId);
  if (record.closed === true) {
    throw new SessionClosedError(sessionId);
  }
  const frame: AcpJsonRpcMessage = {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: record.acpSessionId, update },
  };
  await p.writeFrame(sessionId, frame);
  const startSeq = record.lastSeq + 1;
  const events = fromAcp(update, startSeq, ts);
  if (events.length === 0) {
    return events;
  }
  // Reload after writeFrame so any backend-side mutations (e.g. fileStorage's
  // SessionEventWriter bumping eventLog.segment_count on rotation) survive
  // this save. Fall back to the cached record if loadRecord returns nothing.
  const fresh = (await p.loadRecord(sessionId)) ?? record;
  await p.saveRecord({
    ...fresh,
    lastSeq: startSeq + events.length - 1,
    lastUsedAt: ts,
    updated_at: ts,
    eventLog: { ...fresh.eventLog, last_write_at: ts },
  });
  return events;
}

async function setDesiredImpl(
  p: StoragePrimitives,
  sessionId: string,
  patch: DesiredStatePatch,
  ts: string,
): Promise<AcpxEvent[]> {
  const record = await loadOrThrow(p, sessionId);
  if (record.closed === true) {
    throw new SessionClosedError(sessionId);
  }
  const after = applyDesiredPatch(record, patch);
  const events = diffDesiredEvents(record, patch, record.lastSeq + 1, ts);
  if (events.length === 0) {
    await p.saveRecord({ ...after, updated_at: ts });
    return events;
  }
  const endSeq = events[events.length - 1].seq;
  await p.saveRecord({
    ...after,
    lastSeq: endSeq,
    lastUsedAt: ts,
    updated_at: ts,
    eventLog: { ...after.eventLog, last_write_at: ts },
  });
  return events;
}

async function closeSessionImpl(
  p: StoragePrimitives,
  sessionId: string,
  exit: SessionExitInfo | undefined,
  ts: string,
): Promise<AcpxEvent> {
  const record = await loadOrThrow(p, sessionId);
  if (record.closed === true) {
    throw new SessionClosedError(sessionId);
  }
  const closedAt = exit?.closedAt ?? ts;
  // Fix A: record.lastSeq is the wire-replay watermark — do NOT bump it for
  // the synthesized lifecycle event. The live event's seq is approximate
  // (record.lastSeq + 1) for ordering only.
  const liveSeq = record.lastSeq + 1;
  const closed: SessionRecord = {
    ...record,
    closed: true,
    closedAt,
    lastAgentExitCode: exit?.lastAgentExitCode,
    lastAgentExitSignal: exit?.lastAgentExitSignal,
    lastAgentDisconnectReason: exit?.lastAgentDisconnectReason,
    lastUsedAt: ts,
    updated_at: ts,
  };
  await p.saveRecord(closed);
  return synthesizeClose(closed, liveSeq);
}

async function reopenSessionImpl(
  p: StoragePrimitives,
  sessionId: string,
  newAcpSessionId: string,
  ts: string,
): Promise<AcpxEvent> {
  const record = await loadOrThrow(p, sessionId);
  // Fix D: refuse to reopen a non-closed session.
  if (record.closed !== true) {
    throw new Error(`session is not closed: ${sessionId}`);
  }
  // Fix A: live seq for ordering; do NOT bump persisted lastSeq.
  const liveSeq = record.lastSeq + 1;
  const reopened: SessionRecord = {
    ...record,
    acpSessionId: newAcpSessionId,
    closed: undefined,
    closedAt: undefined,
    // Fix D: stale exit metadata must not leak into the next live run.
    lastAgentExitCode: undefined,
    lastAgentExitSignal: undefined,
    lastAgentDisconnectReason: undefined,
    lastUsedAt: ts,
    updated_at: ts,
  };
  await p.saveRecord(reopened);
  return synthesizeReconnected(reopened, liveSeq);
}

export function createEventStore(p: StoragePrimitives): EventStore {
  return {
    createSession(input) {
      return createSessionImpl(p, input);
    },
    appendWire(sessionId, update, ts = new Date().toISOString()) {
      return appendWireImpl(p, sessionId, update, ts);
    },
    setDesired(sessionId, patch) {
      return setDesiredImpl(p, sessionId, patch, new Date().toISOString());
    },
    closeSession(sessionId, exit) {
      return closeSessionImpl(p, sessionId, exit, new Date().toISOString());
    },
    reopenSession(sessionId, newAcpSessionId) {
      return reopenSessionImpl(p, sessionId, newAcpSessionId, new Date().toISOString());
    },
    events(sessionId) {
      return iterateEvents(p, sessionId);
    },
    getState(sessionId) {
      return foldState(p, sessionId);
    },
  };
}
