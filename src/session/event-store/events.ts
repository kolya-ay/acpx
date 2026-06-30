import type {
  AgentCapabilities,
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  PlanUpdateContent,
  SessionConfigOption,
  SessionInfoUpdate,
  SessionModeId,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
  UsageUpdate,
} from "@agentclientprotocol/sdk";

export const ACPX_EVENT_SCHEMA = "v1" as const;

// Payload of session_info_update — alias for the SDK SessionInfoUpdate shape
// (title/updatedAt; partial-update semantics).
export type SessionInfoUpdatePayload = SessionInfoUpdate;

// NOTE: SDK ConfigOptionUpdate carries `configOptions: SessionConfigOption[]`
// (a snapshot of the full set). Our event carries one (configId, value) pair.
// fromAcp (C2) MUST fan out: one acpx event per option in configOptions[].

// 13 ACP wire events — mirror SDK SessionUpdate discriminants.
// Only rename: SDK's `tool_call.kind` -> our `toolKind` to free `kind` for the discriminator.
export type AcpxWireEvent =
  | { kind: "agent_message_chunk"; seq: number; ts: string; content: ContentBlock }
  | { kind: "user_message_chunk"; seq: number; ts: string; content: ContentBlock }
  | { kind: "agent_thought_chunk"; seq: number; ts: string; content: ContentBlock }
  | {
      kind: "tool_call";
      seq: number;
      ts: string;
      toolCallId: string;
      title: string;
      toolKind?: ToolKind;
      status?: ToolCallStatus;
      content?: ToolCallContent[];
      locations?: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | {
      kind: "tool_call_update";
      seq: number;
      ts: string;
      toolCallId: string;
      title?: string;
      toolKind?: ToolKind | null;
      status?: ToolCallStatus;
      content?: ToolCallContent[];
      locations?: ToolCallLocation[];
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  | {
      kind: "available_commands_update";
      seq: number;
      ts: string;
      availableCommands: AvailableCommand[];
    }
  | {
      kind: "current_mode_update";
      seq: number;
      ts: string;
      currentModeId: SessionModeId;
    }
  | {
      kind: "config_option_update";
      seq: number;
      ts: string;
      configId: string;
      value: SessionConfigOption["currentValue"];
    }
  | {
      kind: "session_info_update";
      seq: number;
      ts: string;
      info: SessionInfoUpdatePayload;
    }
  | { kind: "usage_update"; seq: number; ts: string; usage: UsageUpdate }
  | { kind: "plan"; seq: number; ts: string; entries: PlanEntry[] }
  | { kind: "plan_update"; seq: number; ts: string; plan: PlanUpdateContent }
  | { kind: "plan_removed"; seq: number; ts: string; id: string };

// 8 acpx-domain events — synthesized from SessionRecord on read; emitted on
// explicit writes via createEventStore. Carry schema for forward-compat.
export type AcpxDomainEvent =
  | {
      kind: "header";
      seq: 0;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      acpxRecordId: string;
      acpSessionId: string;
      cwd: string;
      agentCommand: string;
      agentCapabilities?: AgentCapabilities;
      createdAt: string;
    }
  | {
      kind: "session_closed";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      closedAt: string;
      lastAgentExitCode?: number | null;
      lastAgentExitSignal?: NodeJS.Signals | null;
      lastAgentDisconnectReason?: string;
    }
  | {
      kind: "session_reconnected";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      acpSessionId: string;
    }
  | {
      kind: "desired_mode_set";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      modeId: SessionModeId | null;
    }
  | {
      kind: "desired_model_set";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      modelId: string | null;
    }
  | {
      kind: "desired_config_option_set";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      configId: string;
      value: SessionConfigOption["currentValue"] | null;
    }
  | {
      kind: "session_renamed";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      name: string | null;
    }
  | {
      kind: "agent_lifecycle_snapshot";
      seq: number;
      ts: string;
      schema: typeof ACPX_EVENT_SCHEMA;
      pid?: number;
      agentStartedAt?: string;
      lastPromptAt?: string;
    };

export type AcpxEvent = AcpxWireEvent | AcpxDomainEvent;

export type AcpxDomainKind = AcpxDomainEvent["kind"];
export type AcpxWireKind = AcpxWireEvent["kind"];

const DOMAIN_KINDS: ReadonlySet<AcpxDomainKind> = new Set<AcpxDomainKind>([
  "header",
  "session_closed",
  "session_reconnected",
  "desired_mode_set",
  "desired_model_set",
  "desired_config_option_set",
  "session_renamed",
  "agent_lifecycle_snapshot",
]);

export function isAcpxDomainKind(kind: AcpxEvent["kind"]): kind is AcpxDomainKind {
  return (DOMAIN_KINDS as ReadonlySet<string>).has(kind);
}
