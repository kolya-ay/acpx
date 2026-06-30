import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpxWireEvent } from "./events.js";

// Lift a wire SessionUpdate into 0..N AcpxWireEvent.
// Returns:
// - [] for unrecognized SDK variants (forward-compat guard).
// - 1-element array for variants that map 1:1.
// - N-element array for config_option_update (one event per option in
//   configOptions[]); seq increments per emitted event.
//
// Null-to-undefined coalescing on tool_call_update fields is intentional:
// the C1 acpx vocabulary uses `?:` (optional, no null), while the SDK
// ToolCallUpdate uses `| null` to mean "no change" / "clear". Both encode
// "absent" — we collapse to a single representation here.

type Variant = SessionUpdate["sessionUpdate"];
type VariantLifter<V extends Variant> = (
  update: Extract<SessionUpdate, { sessionUpdate: V }>,
  seq: number,
  ts: string,
) => AcpxWireEvent[];

const LIFTERS: { [V in Variant]: VariantLifter<V> } = {
  agent_message_chunk: (u, seq, ts) => [
    { kind: "agent_message_chunk", seq, ts, content: u.content },
  ],
  user_message_chunk: (u, seq, ts) => [{ kind: "user_message_chunk", seq, ts, content: u.content }],
  agent_thought_chunk: (u, seq, ts) => [
    { kind: "agent_thought_chunk", seq, ts, content: u.content },
  ],
  tool_call: (u, seq, ts) => [
    {
      kind: "tool_call",
      seq,
      ts,
      toolCallId: u.toolCallId,
      title: u.title,
      toolKind: u.kind,
      status: u.status,
      content: u.content,
      locations: u.locations,
      rawInput: u.rawInput,
      rawOutput: u.rawOutput,
    },
  ],
  tool_call_update: (u, seq, ts) => [
    {
      kind: "tool_call_update",
      seq,
      ts,
      toolCallId: u.toolCallId,
      title: u.title ?? undefined,
      toolKind: u.kind ?? undefined,
      status: u.status ?? undefined,
      content: u.content ?? undefined,
      locations: u.locations ?? undefined,
      rawInput: u.rawInput,
      rawOutput: u.rawOutput,
    },
  ],
  available_commands_update: (u, seq, ts) => [
    { kind: "available_commands_update", seq, ts, availableCommands: u.availableCommands },
  ],
  current_mode_update: (u, seq, ts) => [
    { kind: "current_mode_update", seq, ts, currentModeId: u.currentModeId },
  ],
  config_option_update: (u, seq, ts) => {
    let s = seq;
    return u.configOptions.map((opt) => ({
      kind: "config_option_update" as const,
      seq: s++,
      ts,
      configId: opt.id,
      value: opt.currentValue,
    }));
  },
  session_info_update: (u, seq, ts) => [
    {
      kind: "session_info_update",
      seq,
      ts,
      info: { title: u.title, updatedAt: u.updatedAt },
    },
  ],
  usage_update: (u, seq, ts) => [
    {
      kind: "usage_update",
      seq,
      ts,
      usage: { used: u.used, size: u.size, cost: u.cost },
    },
  ],
  plan: (u, seq, ts) => [{ kind: "plan", seq, ts, entries: u.entries }],
  plan_update: (u, seq, ts) => [{ kind: "plan_update", seq, ts, plan: u.plan }],
  plan_removed: (u, seq, ts) => [{ kind: "plan_removed", seq, ts, id: u.id }],
};

export function fromAcp(update: SessionUpdate, seq: number, ts: string): AcpxWireEvent[] {
  const lifter = LIFTERS[update.sessionUpdate] as VariantLifter<Variant> | undefined;
  if (!lifter) {
    return [];
  }
  return lifter(update, seq, ts);
}
