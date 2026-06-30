import { strict as assert } from "node:assert";
import test from "node:test";
import type { AcpxEvent } from "../src/session/event-store/events.js";
import { ACPX_EVENT_SCHEMA } from "../src/session/event-store/events.js";
import { reduce, type SessionState } from "../src/session/event-store/reduce.js";

const TS = "2026-07-01T00:00:00.000Z";

function header(): AcpxEvent {
  return {
    kind: "header",
    seq: 0,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    acpxRecordId: "rec-1",
    acpSessionId: "acp-1",
    cwd: "/tmp",
    agentCommand: "codex",
    createdAt: TS,
  };
}

function seed(): SessionState {
  return reduce(null, header());
}

test("reduce(null, non-header) throws", () => {
  assert.throws(
    () =>
      reduce(null, {
        kind: "agent_message_chunk",
        seq: 1,
        ts: TS,
        content: { type: "text", text: "x" },
      }),
    /first event must be 'header'/,
  );
});

test("reduce(null, header) seeds fields and lastSeq:0", () => {
  const s = seed();
  assert.equal(s.acpxRecordId, "rec-1");
  assert.equal(s.acpSessionId, "acp-1");
  assert.equal(s.cwd, "/tmp");
  assert.equal(s.agentCommand, "codex");
  assert.equal(s.createdAt, TS);
  assert.deepEqual(s.messages, []);
  assert.equal(s.toolCalls.size, 0);
  assert.equal(s.lastSeq, 0);
});

test("two agent_message_chunks merge into one message", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "agent_message_chunk",
    seq: 1,
    ts: TS,
    content: { type: "text", text: "hello " },
  });
  const s2 = reduce(s1, {
    kind: "agent_message_chunk",
    seq: 2,
    ts: TS,
    content: { type: "text", text: "world" },
  });
  assert.equal(s2.messages.length, 1);
  assert.equal(s2.messages[0].role, "agent");
  assert.equal(s2.messages[0].content.length, 2);
  assert.equal(s2.lastSeq, 2);
});

test("agent_thought_chunk attaches as thinking on existing agent message", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "agent_message_chunk",
    seq: 1,
    ts: TS,
    content: { type: "text", text: "hi" },
  });
  const s2 = reduce(s1, {
    kind: "agent_thought_chunk",
    seq: 2,
    ts: TS,
    content: { type: "text", text: "think" },
  });
  assert.equal(s2.messages.length, 1);
  assert.equal(s2.messages[0].thinking?.length, 1);
});

test("tool_call then tool_call_update merges with toolKind propagated", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "tool_call",
    seq: 1,
    ts: TS,
    toolCallId: "tc-1",
    title: "read file",
  });
  const s2 = reduce(s1, {
    kind: "tool_call_update",
    seq: 2,
    ts: TS,
    toolCallId: "tc-1",
    status: "completed",
    toolKind: "read",
  });
  const snap = s2.toolCalls.get("tc-1");
  assert.ok(snap);
  assert.equal(snap.title, "read file");
  assert.equal(snap.status, "completed");
  assert.equal(snap.toolKind, "read");
});

test("plan then plan_removed clears currentPlan", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "plan",
    seq: 1,
    ts: TS,
    entries: [{ content: "a", priority: "low", status: "pending" }],
  });
  assert.equal(s1.currentPlan?.entries.length, 1);
  const s2 = reduce(s1, { kind: "plan_removed", seq: 2, ts: TS, id: "p1" });
  assert.equal(s2.currentPlan, undefined);
});

test("plan_update with type:items replaces entries", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "plan_update",
    seq: 1,
    ts: TS,
    plan: {
      type: "items",
      id: "p1",
      entries: [{ content: "a", priority: "low", status: "pending" }],
    },
  });
  assert.equal(s1.currentPlan?.entries.length, 1);
});

test("plan_update with type:markdown sets currentPlanMarkdown", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "plan_update",
    seq: 1,
    ts: TS,
    plan: { type: "markdown", id: "p1", content: "# plan" },
  });
  assert.equal(s1.currentPlanMarkdown?.content, "# plan");
});

test("plan_update with type:file sets currentPlanFile", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "plan_update",
    seq: 1,
    ts: TS,
    plan: { type: "file", id: "p1", uri: "file:///tmp/plan.md" },
  });
  assert.equal(s1.currentPlanFile?.uri, "file:///tmp/plan.md");
});

test("usage_update snapshots tokens (overwrite) and cost (cumulative server-side)", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "usage_update",
    seq: 1,
    ts: TS,
    usage: { used: 100, size: 200000, cost: { amount: 0.1, currency: "USD" } },
  });
  const s2 = reduce(s1, {
    kind: "usage_update",
    seq: 2,
    ts: TS,
    usage: { used: 50, size: 200000, cost: { amount: 0.42, currency: "USD" } },
  });
  // `used` is "tokens currently in context" — snapshot, not delta. Overwrite.
  assert.equal(s2.tokenUsage?.tokens.used, 50);
  assert.equal(s2.tokenUsage?.tokens.size, 200000);
  // SDK `cost.amount` is documented as cumulative session cost; reducer keeps
  // the latest reported value.
  assert.equal(s2.tokenUsage?.totalCostUsd, 0.42);
});

test("desired_config_option_set with value:null deletes the entry", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "desired_config_option_set",
    seq: 1,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    configId: "opt",
    value: "x",
  });
  assert.equal(s1.desiredConfigOptions?.opt, "x");
  const s2 = reduce(s1, {
    kind: "desired_config_option_set",
    seq: 2,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    configId: "opt",
    value: null,
  });
  assert.equal(s2.desiredConfigOptions?.opt, undefined);
});

test("session_closed sets closed and lastSeq", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "session_closed",
    seq: 5,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    closedAt: TS,
    lastAgentExitCode: 0,
  });
  assert.equal(s1.closed?.closedAt, TS);
  assert.equal(s1.closed?.lastAgentExitCode, 0);
  assert.equal(s1.lastSeq, 5);
});

test("session_reconnected clears closed and updates acpSessionId", () => {
  const s0 = seed();
  const s1 = reduce(s0, {
    kind: "session_closed",
    seq: 1,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    closedAt: TS,
  });
  const s2 = reduce(s1, {
    kind: "session_reconnected",
    seq: 2,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    acpSessionId: "acp-2",
  });
  assert.equal(s2.closed, undefined);
  assert.equal(s2.acpSessionId, "acp-2");
});

test("available_commands_update, current_mode_update, config_option_update, session_info_update, session_renamed each set field", () => {
  let s = seed();
  s = reduce(s, {
    kind: "available_commands_update",
    seq: 1,
    ts: TS,
    availableCommands: [{ name: "c", description: "d" }],
  });
  assert.equal(s.availableCommands?.length, 1);
  s = reduce(s, { kind: "current_mode_update", seq: 2, ts: TS, currentModeId: "edit" });
  assert.equal(s.currentModeId, "edit");
  s = reduce(s, { kind: "config_option_update", seq: 3, ts: TS, configId: "model", value: "x" });
  assert.equal(s.configOptions?.model, "x");
  s = reduce(s, {
    kind: "session_info_update",
    seq: 4,
    ts: TS,
    info: { title: "Hi", updatedAt: TS },
  });
  assert.equal(s.sessionInfo?.title, "Hi");
  s = reduce(s, {
    kind: "session_renamed",
    seq: 5,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    name: "renamed",
  });
  assert.equal(s.name, "renamed");
});

test("desired_mode_set, desired_model_set, agent_lifecycle_snapshot set fields", () => {
  let s = seed();
  s = reduce(s, {
    kind: "desired_mode_set",
    seq: 1,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    modeId: "edit",
  });
  assert.equal(s.desiredModeId, "edit");
  s = reduce(s, {
    kind: "desired_model_set",
    seq: 2,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    modelId: "gpt",
  });
  assert.equal(s.desiredModelId, "gpt");
  s = reduce(s, {
    kind: "agent_lifecycle_snapshot",
    seq: 3,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    pid: 42,
    agentStartedAt: TS,
    lastPromptAt: TS,
  });
  assert.equal(s.agentLifecycle?.pid, 42);
});

test("desired_mode_set with modeId:null clears desiredModeId", () => {
  let s = seed();
  s = reduce(s, {
    kind: "desired_mode_set",
    seq: 1,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    modeId: "edit",
  });
  s = reduce(s, {
    kind: "desired_mode_set",
    seq: 2,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    modeId: null,
  });
  assert.equal(s.desiredModeId, undefined);
});

test("session_renamed with name:null clears name", () => {
  let s = seed();
  s = reduce(s, {
    kind: "session_renamed",
    seq: 1,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    name: "x",
  });
  s = reduce(s, {
    kind: "session_renamed",
    seq: 2,
    ts: TS,
    schema: ACPX_EVENT_SCHEMA,
    name: null,
  });
  assert.equal(s.name, undefined);
});
