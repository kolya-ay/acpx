import type { AgentCapabilities, SessionModeId, SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpJsonRpcMessage, SessionRecord } from "../../types.js";
import type { AcpxEvent } from "./events.js";
import type { SessionState } from "./reduce.js";

// Backend authors implement these 4 plain async ops.
// fileStorage composes over main's SessionEventWriter + persistence helpers;
// memoryStorage is an in-memory test double.
export interface StoragePrimitives {
  writeFrame(sessionId: string, frame: AcpJsonRpcMessage): Promise<void>;
  readFrames(sessionId: string): AsyncIterable<AcpJsonRpcMessage>;
  loadRecord(sessionId: string): Promise<SessionRecord | undefined>;
  saveRecord(record: SessionRecord): Promise<void>;
}

export interface CreateSessionInput {
  acpxRecordId: string;
  acpSessionId: string;
  cwd: string;
  agentCommand: string;
  agentCapabilities?: AgentCapabilities;
  createdAt?: string;
}

export interface DesiredStatePatch {
  modeId?: SessionModeId | null;
  modelId?: string | null;
  // Disk format is Record<string, string>; callers coerce booleans/numbers
  // before reaching setDesired so live and replay events agree on value type.
  configOptions?: Record<string, string | null>;
  name?: string | null;
}

export interface SessionExitInfo {
  closedAt?: string;
  lastAgentExitCode?: number | null;
  lastAgentExitSignal?: NodeJS.Signals | null;
  lastAgentDisconnectReason?: string;
}

// Returned by createEventStore. 7 domain ops.
// appendWire returns AcpxEvent[] because fromAcp may fan out
// (e.g. config_option_update lifts to N events).
export interface EventStore {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  appendWire(sessionId: string, update: SessionUpdate, ts?: string): Promise<AcpxEvent[]>;
  setDesired(sessionId: string, patch: DesiredStatePatch): Promise<AcpxEvent[]>;
  closeSession(sessionId: string, exit?: SessionExitInfo): Promise<AcpxEvent>;
  reopenSession(sessionId: string, newAcpSessionId: string): Promise<AcpxEvent>;
  events(sessionId: string): AsyncIterable<AcpxEvent>;
  getState(sessionId: string): Promise<SessionState>;
}

export class SessionExistsError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`session already exists: ${sessionId}`);
    this.name = "SessionExistsError";
    this.sessionId = sessionId;
  }
}

// Class name preserved (Iron Law: external API), but .name differs from
// main's src/errors.ts SessionNotFoundError so error.name discriminates the
// two even though instanceof is the authoritative check.
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`session not found: ${sessionId}`);
    this.name = "EventStoreSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export class SessionClosedError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`session is closed: ${sessionId}`);
    this.name = "SessionClosedError";
    this.sessionId = sessionId;
  }
}
