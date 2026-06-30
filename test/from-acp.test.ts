import { strict as assert } from "node:assert";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { fromAcp } from "../src/session/event-store/from-acp.js";

const TS = "2026-07-01T00:00:00.000Z";

test("agent_message_chunk -> single event", () => {
  const evs = fromAcp(
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
    1,
    TS,
  );
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, "agent_message_chunk");
});

test("user_message_chunk -> single event", () => {
  const evs = fromAcp(
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "x" } },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "user_message_chunk");
});

test("agent_thought_chunk -> single event", () => {
  const evs = fromAcp(
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "x" } },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "agent_thought_chunk");
});

test("tool_call lifts SDK kind -> toolKind", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "T",
      kind: "read",
      status: "in_progress",
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "tool_call");
  if (evs[0].kind === "tool_call") {
    assert.equal(evs[0].toolKind, "read");
    assert.equal(evs[0].title, "T");
  }
});

test("tool_call_update lifts SDK kind -> toolKind, null coalesces to undefined", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      kind: null,
      title: null,
      status: null,
      content: null,
      locations: null,
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "tool_call_update");
  if (evs[0].kind === "tool_call_update") {
    assert.equal(evs[0].toolKind, undefined);
    assert.equal(evs[0].title, undefined);
    assert.equal(evs[0].status, undefined);
    assert.equal(evs[0].content, undefined);
    assert.equal(evs[0].locations, undefined);
  }
});

test("available_commands_update -> single event", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "c", description: "d" }],
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "available_commands_update");
});

test("current_mode_update -> single event", () => {
  const evs = fromAcp({ sessionUpdate: "current_mode_update", currentModeId: "edit" }, 1, TS);
  assert.equal(evs[0].kind, "current_mode_update");
});

test("config_option_update fans out one event per option with sequential seqs", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "config_option_update",
      configOptions: [
        { id: "a", name: "A", type: "boolean", currentValue: true },
        { id: "b", name: "B", type: "boolean", currentValue: false },
        {
          id: "m",
          name: "M",
          type: "select",
          currentValue: "v",
          options: [{ value: "v", name: "V" }],
        },
      ],
    },
    10,
    TS,
  );
  assert.equal(evs.length, 3);
  assert.equal(evs[0].kind, "config_option_update");
  if (evs[0].kind === "config_option_update") {
    assert.equal(evs[0].configId, "a");
    assert.equal(evs[0].value, true);
    assert.equal(evs[0].seq, 10);
  }
  assert.equal(evs[1].seq, 11);
  assert.equal(evs[2].seq, 12);
});

test("session_info_update projects title/updatedAt", () => {
  const evs = fromAcp({ sessionUpdate: "session_info_update", title: "T", updatedAt: TS }, 1, TS);
  assert.equal(evs[0].kind, "session_info_update");
  if (evs[0].kind === "session_info_update") {
    assert.equal(evs[0].info.title, "T");
    assert.equal(evs[0].info.updatedAt, TS);
  }
});

test("usage_update carries used/size/cost", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "usage_update",
      used: 100,
      size: 200000,
      cost: { amount: 0.5, currency: "USD" },
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "usage_update");
  if (evs[0].kind === "usage_update") {
    assert.equal(evs[0].usage.used, 100);
    assert.equal(evs[0].usage.size, 200000);
    assert.equal(evs[0].usage.cost?.amount, 0.5);
  }
});

test("plan -> single event with entries", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "plan",
      entries: [{ content: "a", priority: "low", status: "pending" }],
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "plan");
});

test("plan_update -> single event with PlanUpdateContent", () => {
  const evs = fromAcp(
    {
      sessionUpdate: "plan_update",
      plan: { type: "markdown", id: "p", content: "x" },
    },
    1,
    TS,
  );
  assert.equal(evs[0].kind, "plan_update");
});

test("plan_removed -> single event with id", () => {
  const evs = fromAcp({ sessionUpdate: "plan_removed", id: "p" }, 1, TS);
  assert.equal(evs[0].kind, "plan_removed");
  if (evs[0].kind === "plan_removed") {
    assert.equal(evs[0].id, "p");
  }
});

test("unknown SDK variant returns empty array", () => {
  const evs = fromAcp(
    { sessionUpdate: "future_unknown_variant" } as unknown as SessionUpdate,
    1,
    TS,
  );
  assert.deepEqual(evs, []);
});
