import { strict as assert } from "node:assert";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { ACPX_EVENT_SCHEMA } from "../src/session/event-store/events.js";
import { memoryStorage } from "../src/session/event-store/memory-storage.js";
import { createEventStore } from "../src/session/event-store/store.js";
import {
  SessionClosedError,
  SessionExistsError,
  SessionNotFoundError,
} from "../src/session/event-store/types.js";

const ACPX_RECORD_ID = "rec_test_mem";
const ACP_SESSION_ID = "acp_sess_mem";

function createInput(now: string) {
  return {
    acpxRecordId: ACPX_RECORD_ID,
    acpSessionId: ACP_SESSION_ID,
    cwd: "/tmp/proj",
    agentCommand: "claude",
    createdAt: now,
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) {
    out.push(x);
  }
  return out;
}

const agentTextUpdate: SessionUpdate = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "hello world" },
};

const toolCallUpdate: SessionUpdate = {
  sessionUpdate: "tool_call",
  toolCallId: "tc_1",
  title: "List files",
  status: "in_progress",
};

const usageUpdate: SessionUpdate = {
  sessionUpdate: "usage_update",
  used: 100,
  size: 1_000,
};

test("memory: full lifecycle createSession + appendWire x3 + setDesired + close yields header..close", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));

  await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
  await store.appendWire(ACPX_RECORD_ID, toolCallUpdate, now);
  await store.appendWire(ACPX_RECORD_ID, usageUpdate, now);

  await store.setDesired(ACPX_RECORD_ID, { modeId: "plan", modelId: "haiku" });

  await store.closeSession(ACPX_RECORD_ID, { closedAt: now });

  const events = await collect(store.events(ACPX_RECORD_ID));
  assert.equal(events[0].kind, "header");
  assert.equal(events[events.length - 1].kind, "session_closed");

  const kinds = new Set(events.map((e) => e.kind));
  assert.ok(kinds.has("agent_message_chunk"));
  assert.ok(kinds.has("tool_call"));
  assert.ok(kinds.has("usage_update"));
  // synthesizeDesiredState emits desired_mode_set, desired_model_set from acpx state on read.
  assert.ok(kinds.has("desired_mode_set"));
  assert.ok(kinds.has("desired_model_set"));
});

test("memory: getState folds to expected snapshot", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));
  await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
  await store.appendWire(ACPX_RECORD_ID, toolCallUpdate, now);

  const state = await store.getState(ACPX_RECORD_ID);
  assert.equal(state.acpxRecordId, ACPX_RECORD_ID);
  assert.equal(state.acpSessionId, ACP_SESSION_ID);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].role, "agent");
  assert.equal(state.toolCalls.get("tc_1")?.title, "List files");
});

test("memory: createSession twice throws SessionExistsError", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));
  await assert.rejects(() => store.createSession(createInput(now)), SessionExistsError);
});

test("memory: appendWire after close throws SessionClosedError", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));
  await store.closeSession(ACPX_RECORD_ID);
  await assert.rejects(
    () => store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now),
    SessionClosedError,
  );
});

test("memory: events() on missing session throws SessionNotFoundError", async () => {
  const store = createEventStore(memoryStorage());
  await assert.rejects(async () => {
    await collect(store.events("nope"));
  }, SessionNotFoundError);
});

test("memory: getState on missing session throws SessionNotFoundError", async () => {
  const store = createEventStore(memoryStorage());
  await assert.rejects(() => store.getState("nope"), SessionNotFoundError);
});

test("memory: reopenSession clears closed and updates acpSessionId", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));
  await store.closeSession(ACPX_RECORD_ID);

  const reconnected = await store.reopenSession(ACPX_RECORD_ID, "acp_sess_new");
  assert.equal(reconnected.kind, "session_reconnected");
  assert.equal(reconnected.schema, ACPX_EVENT_SCHEMA);

  // After reopen, appendWire should succeed again.
  await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
  const state = await store.getState(ACPX_RECORD_ID);
  assert.equal(state.acpSessionId, "acp_sess_new");
  assert.equal(state.closed, undefined);
});

test("memory: appendWire with unknown SDK variant returns [] and does not bump lastSeq", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));
  await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
  const stateBefore = await store.getState(ACPX_RECORD_ID);

  const unknown = { sessionUpdate: "unknown_variant" } as unknown as SessionUpdate;
  const result = await store.appendWire(ACPX_RECORD_ID, unknown, now);
  assert.deepEqual(result, []);

  const stateAfter = await store.getState(ACPX_RECORD_ID);
  assert.equal(stateAfter.lastSeq, stateBefore.lastSeq);
});

test("memory: appendWire config_option_update fans out to N events with consecutive seqs", async () => {
  const storage = memoryStorage();
  const store = createEventStore(storage);
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));

  const update: SessionUpdate = {
    sessionUpdate: "config_option_update",
    configOptions: [
      { id: "opt_a", name: "A", type: "select", currentValue: "1", options: [] },
      { id: "opt_b", name: "B", type: "select", currentValue: "2", options: [] },
      { id: "opt_c", name: "C", type: "boolean", currentValue: true },
    ],
  };

  // Count frames before & after via the storage iterator.
  async function countFrames(): Promise<number> {
    let n = 0;
    for await (const frame of storage.readFrames(ACPX_RECORD_ID)) {
      void frame;
      n += 1;
    }
    return n;
  }
  assert.equal(await countFrames(), 0);

  const live = await store.appendWire(ACPX_RECORD_ID, update, now);
  // (a) exactly ONE wire frame persisted
  assert.equal(await countFrames(), 1);

  // (b) appendWire returns 3 events with consecutive seqs
  assert.equal(live.length, 3);
  assert.equal(live[0].seq, 1);
  assert.equal(live[1].seq, 2);
  assert.equal(live[2].seq, 3);
  assert.equal(live[0].kind, "config_option_update");

  // (c) replay yields the same 3 events with the same seqs
  const replayed = (await collect(store.events(ACPX_RECORD_ID))).filter(
    (e) => e.kind === "config_option_update",
  );
  assert.equal(replayed.length, 3);
  assert.deepEqual(
    replayed.map((e) => e.seq),
    [1, 2, 3],
  );

  // (d) record.lastSeq equals the highest replay seq (3)
  const state = await store.getState(ACPX_RECORD_ID);
  assert.equal(state.lastSeq, 3);
});

test("memory: setDesired emits desired_mode_set/desired_model_set/desired_config_option_set", async () => {
  const store = createEventStore(memoryStorage());
  const now = "2026-07-01T00:00:00.000Z";
  await store.createSession(createInput(now));

  const events = await store.setDesired(ACPX_RECORD_ID, {
    modeId: "plan",
    modelId: "sonnet",
    configOptions: { reasoning: "high" },
    name: "branch-x",
  });
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, [
    "desired_mode_set",
    "desired_model_set",
    "desired_config_option_set",
    "session_renamed",
  ]);
});
