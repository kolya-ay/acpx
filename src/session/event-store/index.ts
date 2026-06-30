export type {
  AcpxDomainEvent,
  AcpxDomainKind,
  AcpxEvent,
  AcpxWireEvent,
  AcpxWireKind,
  SessionInfoUpdatePayload,
} from "./events.js";
export { ACPX_EVENT_SCHEMA, isAcpxDomainKind } from "./events.js";

export { fromAcp } from "./from-acp.js";

export type { ReducedMessage, SessionState, ToolCallSnapshot } from "./reduce.js";
export { reduce } from "./reduce.js";

// synthesize.* helpers are internal to event-store; consumers go through
// createEventStore. Tests import directly from ./synthesize if they need
// to exercise the synth helpers in isolation.

export type {
  CreateSessionInput,
  DesiredStatePatch,
  EventStore,
  SessionExitInfo,
  StoragePrimitives,
} from "./types.js";
export { SessionClosedError, SessionExistsError, SessionNotFoundError } from "./types.js";

export { createEventStore } from "./store.js";
export { fileStorage } from "./file-storage.js";
export { memoryStorage } from "./memory-storage.js";
