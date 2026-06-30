import type {
  AgentCapabilities,
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  PlanFile,
  PlanMarkdown,
  SessionConfigOption,
  SessionModeId,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type { AcpxEvent, SessionInfoUpdatePayload } from "./events.js";

export type ReducedMessage = {
  role: "user" | "agent";
  content: ContentBlock[];
  thinking?: ContentBlock[];
};

export type ToolCallSnapshot = {
  toolCallId: string;
  title: string;
  toolKind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
};

export type ReducedUsage = {
  tokens: { used: number; size: number };
  totalCostUsd?: number;
};

export type SessionState = {
  acpxRecordId: string;
  acpSessionId: string;
  cwd: string;
  agentCommand: string;
  agentCapabilities?: AgentCapabilities;
  createdAt: string;
  name?: string | null;
  messages: ReducedMessage[];
  toolCalls: Map<string, ToolCallSnapshot>;
  currentPlan?: { entries: PlanEntry[] };
  currentPlanFile?: PlanFile;
  currentPlanMarkdown?: PlanMarkdown;
  availableCommands?: AvailableCommand[];
  currentModeId?: SessionModeId;
  configOptions?: Record<string, SessionConfigOption["currentValue"]>;
  desiredModeId?: SessionModeId | null;
  desiredModelId?: string | null;
  desiredConfigOptions?: Record<string, SessionConfigOption["currentValue"] | null>;
  sessionInfo?: SessionInfoUpdatePayload;
  // Snapshot of latest UsageUpdate. SDK semantics: `used`/`size` are
  // current-context-window snapshots; `cost.amount` is cumulative session
  // cost already accumulated server-side. Reducer overwrites all three on
  // each event (matches main's applyTokenUsage replacement semantics).
  tokenUsage?: ReducedUsage;
  closed?: { closedAt: string; lastAgentExitCode?: number | null };
  lastSeq: number;
  agentLifecycle?: { pid?: number; agentStartedAt?: string; lastPromptAt?: string };
};

type HandlerTable = {
  [K in AcpxEvent["kind"]]: (
    state: SessionState,
    event: Extract<AcpxEvent, { kind: K }>,
  ) => SessionState;
};

function appendChunk(
  state: SessionState,
  role: "user" | "agent",
  content: ContentBlock,
  bucket: "content" | "thinking",
  seq: number,
): SessionState {
  const messages = state.messages.slice();
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    const prev = last[bucket] ?? [];
    messages[messages.length - 1] = { ...last, [bucket]: prev.concat(content) };
  } else {
    messages.push({
      role,
      content: bucket === "content" ? [content] : [],
      thinking: bucket === "thinking" ? [content] : undefined,
    });
  }
  return { ...state, messages, lastSeq: seq };
}

function mergeToolCall(state: SessionState, snapshot: ToolCallSnapshot, seq: number): SessionState {
  const toolCalls = new Map(state.toolCalls);
  const existing = toolCalls.get(snapshot.toolCallId);
  const next: ToolCallSnapshot = existing ? { ...existing, ...snapshot } : snapshot;
  toolCalls.set(snapshot.toolCallId, next);
  return { ...state, toolCalls, lastSeq: seq };
}

function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return out;
}

const HANDLERS: HandlerTable = {
  header: (_state, e) => ({
    acpxRecordId: e.acpxRecordId,
    acpSessionId: e.acpSessionId,
    cwd: e.cwd,
    agentCommand: e.agentCommand,
    agentCapabilities: e.agentCapabilities,
    createdAt: e.createdAt,
    messages: [],
    toolCalls: new Map<string, ToolCallSnapshot>(),
    lastSeq: 0,
  }),
  agent_message_chunk: (s, e) => appendChunk(s, "agent", e.content, "content", e.seq),
  user_message_chunk: (s, e) => appendChunk(s, "user", e.content, "content", e.seq),
  agent_thought_chunk: (s, e) => appendChunk(s, "agent", e.content, "thinking", e.seq),
  tool_call: (s, e) =>
    mergeToolCall(
      s,
      {
        toolCallId: e.toolCallId,
        title: e.title,
        toolKind: e.toolKind,
        status: e.status,
        content: e.content,
        locations: e.locations,
        rawInput: e.rawInput,
        rawOutput: e.rawOutput,
      },
      e.seq,
    ),
  tool_call_update: (s, e) => {
    const partial = pickDefined({
      toolCallId: e.toolCallId,
      title: e.title,
      toolKind: e.toolKind,
      status: e.status,
      content: e.content,
      locations: e.locations,
      rawInput: e.rawInput,
      rawOutput: e.rawOutput,
    });
    return mergeToolCall(s, partial as ToolCallSnapshot, e.seq);
  },
  available_commands_update: (s, e) => ({
    ...s,
    availableCommands: e.availableCommands,
    lastSeq: e.seq,
  }),
  current_mode_update: (s, e) => ({ ...s, currentModeId: e.currentModeId, lastSeq: e.seq }),
  config_option_update: (s, e) => {
    const configOptions = { ...s.configOptions, [e.configId]: e.value };
    return { ...s, configOptions, lastSeq: e.seq };
  },
  session_info_update: (s, e) => ({ ...s, sessionInfo: e.info, lastSeq: e.seq }),
  usage_update: (s, e) => {
    const tokenUsage: ReducedUsage = { tokens: { used: e.usage.used, size: e.usage.size } };
    if (e.usage.cost) {
      tokenUsage.totalCostUsd = e.usage.cost.amount;
    }
    return { ...s, tokenUsage, lastSeq: e.seq };
  },
  plan: (s, e) => ({ ...s, currentPlan: { entries: e.entries }, lastSeq: e.seq }),
  plan_update: (s, e) => {
    const lastSeq = e.seq;
    if (e.plan.type === "items") {
      return { ...s, currentPlan: { entries: e.plan.entries }, lastSeq };
    }
    if (e.plan.type === "file") {
      return { ...s, currentPlanFile: e.plan, lastSeq };
    }
    return { ...s, currentPlanMarkdown: e.plan, lastSeq };
  },
  plan_removed: (s, e) => {
    // SDK contract: PlanRemoved carries a plan id, but the reducer keeps a
    // single-plan view per kind (matches main). Clear all three slots on
    // any plan_removed. Tracking multiple plans by id would require
    // consumer-level callsites we don't have yet (Iron Law).
    const next = { ...s, lastSeq: e.seq };
    delete next.currentPlan;
    delete next.currentPlanFile;
    delete next.currentPlanMarkdown;
    return next;
  },
  session_closed: (s, e) => ({
    ...s,
    closed: { closedAt: e.closedAt, lastAgentExitCode: e.lastAgentExitCode ?? null },
    lastSeq: e.seq,
  }),
  session_reconnected: (s, e) => {
    const next = { ...s, acpSessionId: e.acpSessionId, lastSeq: e.seq };
    delete next.closed;
    return next;
  },
  desired_mode_set: (s, e) => {
    const next = { ...s, lastSeq: e.seq };
    if (e.modeId === null) {
      delete next.desiredModeId;
    } else {
      next.desiredModeId = e.modeId;
    }
    return next;
  },
  desired_model_set: (s, e) => {
    const next = { ...s, lastSeq: e.seq };
    if (e.modelId === null) {
      delete next.desiredModelId;
    } else {
      next.desiredModelId = e.modelId;
    }
    return next;
  },
  desired_config_option_set: (s, e) => {
    const desiredConfigOptions = { ...s.desiredConfigOptions };
    if (e.value === null) {
      delete desiredConfigOptions[e.configId];
    } else {
      desiredConfigOptions[e.configId] = e.value;
    }
    return { ...s, desiredConfigOptions, lastSeq: e.seq };
  },
  session_renamed: (s, e) => {
    const next = { ...s, lastSeq: e.seq };
    if (e.name === null) {
      delete next.name;
    } else {
      next.name = e.name;
    }
    return next;
  },
  agent_lifecycle_snapshot: (s, e) => ({
    ...s,
    agentLifecycle: { pid: e.pid, agentStartedAt: e.agentStartedAt, lastPromptAt: e.lastPromptAt },
    lastSeq: e.seq,
  }),
};

export function reduce(state: SessionState | null, event: AcpxEvent): SessionState {
  if (state === null) {
    if (event.kind !== "header") {
      throw new Error(`reduce: first event must be 'header', got '${event.kind}'`);
    }
    return HANDLERS.header({} as SessionState, event);
  }
  // Mapped-type dispatch table: TS can't auto-narrow a HANDLERS[event.kind]
  // lookup back to the corresponding handler signature, so we cast on the
  // HandlerTable side (not on the AcpxEvent side) — `event` keeps its full
  // discriminated-union type and the called handler sees the matching variant.
  const handler = HANDLERS[event.kind] as (s: SessionState, e: typeof event) => SessionState;
  return handler(state, event);
}
