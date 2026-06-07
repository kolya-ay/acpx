import type {
  AvailableCommand,
  PlanEntry,
  SessionConfigOption,
  SessionModeId,
  ToolCallContent,
  ToolCallLocation,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type {
  AcpPermissionDecision,
  AcpPermissionRequest,
  McpServer,
  NonInteractivePermissionPolicy,
  PermissionMode,
  SessionRecord,
} from "../../types.js";
import type { SessionAgentOptions } from "../engine/session-options.js";

export type { SessionAgentOptions, SystemPromptOption } from "../engine/session-options.js";

export type { AcpPermissionDecision, AcpPermissionRequest } from "../../types.js";

/**
 * SDK shapes re-exported from `acpx/runtime` so embedders can type acpx's
 * public surface without reaching into `@agentclientprotocol/sdk` directly.
 */
export type {
  AvailableCommand,
  PlanEntry,
  SessionConfigOption,
  SessionInfoUpdate,
  SessionModeId,
} from "@agentclientprotocol/sdk";

/**
 * `_meta` envelope carried on top-level event variants. Mirrors the ACP SDK
 * shape (`{ [key: string]: unknown } | null`). `null` is meaningful — it is
 * the explicit "no metadata" signal from the agent.
 */
export type AcpEventMeta = { [key: string]: unknown } | null;

export type AcpRuntimePromptMode = "prompt" | "steer";

export type AcpRuntimeSessionMode = "persistent" | "oneshot";

export type AcpSessionUpdateTag =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "usage_update"
  | "available_commands_update"
  | "current_mode_update"
  | "config_option_update"
  | "session_info_update"
  | "plan"
  | (string & {});

export type AcpRuntimeControl = "session/set_mode" | "session/set_config_option" | "session/status";

export type AcpRuntimeHandle = {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  cwd?: string;
  acpxRecordId?: string;
  backendSessionId?: string;
  agentSessionId?: string;
};

export type AcpRuntimeEnsureInput = {
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  /**
   * Per-session agent options applied when a fresh ACP session is created.
   * Threaded into `_meta.systemPrompt` (and `_meta.claudeCode.options.*`)
   * on the underlying `session/new` request, and persisted onto the new
   * record. Ignored when an existing persistent session is reused — system
   * prompts are fixed at `newSession` time, so changing them requires a
   * different sessionKey or closing the prior record first.
   */
  sessionOptions?: SessionAgentOptions;
};

export type AcpRuntimeTurnAttachment = {
  /**
   * Media type for binary prompt attachments. The runtime currently maps
   * image/* and audio/* attachments to ACP prompt content blocks.
   */
  mediaType: string;
  data: string;
};

export type AcpRuntimeTurnInput = {
  handle: AcpRuntimeHandle;
  text: string;
  attachments?: AcpRuntimeTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AcpRuntimeCapabilities = {
  controls: AcpRuntimeControl[];
  configOptionKeys?: string[];
};

export type AcpRuntimeSessionModels = {
  currentModelId?: string;
  availableModelIds: string[];
};

/**
 * Cumulative session cost as reported by the agent. Mirrors ACP's
 * `Cost`, but both fields are optional here because not every adapter
 * populates them on every event.
 */
export type AcpRuntimeUsageCost = {
  amount?: number;
  currency?: string;
};

/**
 * Per-turn token breakdown. Sourced from final prompt response usage or
 * `UsageUpdate._meta.usage` on adapters that populate it. All fields optional —
 * consumers should treat missing fields as "unknown", not "zero".
 */
export type AcpRuntimeUsageBreakdown = {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
};

/**
 * Session-level usage roll-up surfaced through `getStatus()`. The
 * reducer persists the breakdowns onto the session record; this type
 * exposes them on the runtime contract.
 */
export type AcpRuntimeSessionUsage = {
  cumulative?: AcpRuntimeUsageBreakdown;
  /** Cumulative session cost when the agent reported it. */
  cost?: AcpRuntimeUsageCost;
  /** Keyed by user-message id, matching the persisted reducer state. */
  perRequest?: Record<string, AcpRuntimeUsageBreakdown>;
};

export type AcpRuntimeStatus = {
  summary?: string;
  acpxRecordId?: string;
  backendSessionId?: string;
  agentSessionId?: string;
  models?: AcpRuntimeSessionModels;
  /** Token usage and cost from the persisted session record. */
  usage?: AcpRuntimeSessionUsage;
  /**
   * Commands the agent advertised via `available_commands_update`.
   * Sourced from the persisted record — older session files may
   * only carry `name`, and entries lacking `description` (required
   * by the SDK shape) are dropped on load.
   */
  availableCommands?: AvailableCommand[];
  details?: Record<string, unknown>;
};

export type AcpRuntimeDoctorReport = {
  ok: boolean;
  code?: string;
  message: string;
  installCommand?: string;
  details?: string[];
};

export type AcpRuntimeEvent =
  | {
      type: "text_delta";
      text: string;
      stream?: "output" | "thought";
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "status";
      text: string;
      tag?: AcpSessionUpdateTag;
      used?: number;
      size?: number;
      /** Populated on `usage_update` events when the agent reported a cost. */
      cost?: AcpRuntimeUsageCost;
      /**
       * Populated on `usage_update` events when the agent attached a
       * per-turn breakdown via `_meta.usage` (Claude Code does this; not
       * every adapter does).
       */
      breakdown?: AcpRuntimeUsageBreakdown;
    }
  | {
      type: "tool_call";
      text: string;
      tag?: AcpSessionUpdateTag;
      toolCallId?: string;
      status?: string;
      title?: string;
      kind?: ToolKind;
      locations?: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
      content?: ToolCallContent[];
    }
  /**
   * Mirrors ACP `available_commands_update`. Carries the FULL snapshot of
   * commands the agent advertises this turn (not an incremental delta).
   */
  | {
      type: "available_commands_update";
      availableCommands: AvailableCommand[];
      _meta?: AcpEventMeta;
    }
  /**
   * Mirrors ACP `current_mode_update`. Carries the SDK `SessionModeId`
   * (currently a string alias) for the newly active mode.
   *
   * @deprecated The ACP spec is phasing `session/set_mode` out in favor of
   * unified `set_config_option` with `category: "mode"`. Consumers should
   * prefer reading mode state from `config_option_update`. Removal targeted
   * for acpx 0.12.0.
   */
  | {
      type: "current_mode_update";
      currentModeId: SessionModeId;
      _meta?: AcpEventMeta;
    }
  /**
   * Mirrors ACP `config_option_update`. Carries the FULL snapshot of
   * configuration options (not a per-option delta) per SDK schema.
   */
  | {
      type: "config_option_update";
      configOptions: SessionConfigOption[];
      _meta?: AcpEventMeta;
    }
  /**
   * Mirrors ACP `plan`. Carries the FULL plan snapshot as SDK
   * `PlanEntry[]` (not an incremental delta). Each entry preserves
   * `content`, `priority`, and `status` directly. Entries that fail
   * SDK shape validation (missing/empty `content`, unknown `priority`
   * or `status`) are dropped on parse.
   */
  | {
      type: "plan";
      entries: PlanEntry[];
      _meta?: AcpEventMeta;
    }
  /**
   * Mirrors ACP `session_info_update`. Carries session metadata updates
   * from the agent — `title` and/or `updatedAt`. A field set to `null`
   * explicitly clears the session's stored value; an omitted field
   * means "no change". Consumers should distinguish present-as-null
   * from absent.
   */
  | {
      type: "session_info_update";
      title?: string | null;
      updatedAt?: string | null;
      _meta?: AcpEventMeta;
    }
  /**
   * Compatibility terminal event emitted by runTurn(...). startTurn(...).events
   * does not emit terminal events; use AcpRuntimeTurn.result instead.
   */
  | {
      type: "done";
      stopReason?: string;
    }
  /**
   * Compatibility failure event emitted by runTurn(...). startTurn(...).events
   * does not emit terminal events; use AcpRuntimeTurn.result instead.
   */
  | {
      type: "error";
      message: string;
      code?: string;
      detailCode?: string;
      retryable?: boolean;
    };

export type AcpRuntimeTurnResultError = {
  message: string;
  code?: string;
  detailCode?: string;
  retryable?: boolean;
};

export type AcpRuntimeTurnResult =
  | {
      status: "completed";
      stopReason?: string;
    }
  | {
      status: "cancelled";
      stopReason?: string;
    }
  | {
      status: "failed";
      error: AcpRuntimeTurnResultError;
    };

export interface AcpRuntimeTurn {
  readonly requestId: string;
  readonly events: AsyncIterable<AcpRuntimeEvent>;
  readonly result: Promise<AcpRuntimeTurnResult>;
  cancel(input?: { reason?: string }): Promise<void>;
  closeStream(input?: { reason?: string }): Promise<void>;
}

export interface AcpRuntime {
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
  startTurn(input: AcpRuntimeTurnInput): AcpRuntimeTurn;
  /**
   * Compatibility adapter for consumers that expect terminal status in the
   * event stream. Prefer startTurn(...), which separates live events from the
   * terminal result.
   */
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;
  getCapabilities?(input: {
    handle?: AcpRuntimeHandle;
  }): Promise<AcpRuntimeCapabilities> | AcpRuntimeCapabilities;
  getStatus?(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus>;
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;
  setConfigOption?(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void>;
  doctor?(): Promise<AcpRuntimeDoctorReport>;
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
  close(input: {
    handle: AcpRuntimeHandle;
    reason: string;
    discardPersistentState?: boolean;
  }): Promise<void>;
}

export type AcpSessionRecord = SessionRecord;

export interface AcpSessionStore {
  load(sessionId: string): Promise<AcpSessionRecord | undefined>;
  save(record: AcpSessionRecord): Promise<void>;
}

export interface AcpAgentRegistry {
  resolve(agentName: string): string;
  list(): string[];
}

export type AcpRuntimeOptions = {
  cwd: string;
  sessionStore: AcpSessionStore;
  agentRegistry: AcpAgentRegistry;
  mcpServers?: McpServer[];
  permissionMode: PermissionMode;
  nonInteractivePermissions?: NonInteractivePermissionPolicy;
  timeoutMs?: number;
  probeAgent?: string;
  verbose?: boolean;
  onPermissionRequest?: (
    req: AcpPermissionRequest,
    ctx: { signal: AbortSignal },
  ) => Promise<AcpPermissionDecision | undefined>;
};

export type AcpFileSessionStoreOptions = {
  stateDir: string;
};
