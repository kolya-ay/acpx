import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { fileStorage } from "../src/session/event-store/file-storage.js";
import { createEventStore } from "../src/session/event-store/store.js";
import { SessionClosedError } from "../src/session/event-store/types.js";

async function withTempHome(run: (homeDir: string) => Promise<void>): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "acpx-event-store-"));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    await run(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

const ACPX_RECORD_ID = "rec_test_file";
const ACP_SESSION_ID = "acp_sess_file";

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
  content: { type: "text", text: "hello file" },
};

const userTextUpdate: SessionUpdate = {
  sessionUpdate: "user_message_chunk",
  content: { type: "text", text: "hi" },
};

const toolCallUpdate: SessionUpdate = {
  sessionUpdate: "tool_call",
  toolCallId: "tc_f1",
  title: "Read file",
  status: "completed",
};

// File backend's unique behavior is persistence across createEventStore
// re-instantiation (the memory test covers the lifecycle round-trip; the
// main-compat test covers disk byte-identity).
test("file: events survive a new createEventStore(fileStorage()) instance", async () => {
  await withTempHome(async () => {
    const now = "2026-07-01T00:00:00.000Z";
    const first = createEventStore(fileStorage());
    await first.createSession(createInput(now));
    await first.appendWire(ACPX_RECORD_ID, userTextUpdate, now);
    await first.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
    const expected = await collect(first.events(ACPX_RECORD_ID));

    // Drop the first EventStore; open a fresh one over the same storage.
    const second = createEventStore(fileStorage());
    const actual = await collect(second.events(ACPX_RECORD_ID));

    assert.equal(actual.length, expected.length);
    for (let i = 0; i < actual.length; i += 1) {
      assert.equal(actual[i].kind, expected[i].kind);
      assert.equal(actual[i].seq, expected[i].seq);
    }
  });
});

test("file: getState matches expected fields", async () => {
  await withTempHome(async () => {
    const store = createEventStore(fileStorage());
    const now = "2026-07-01T00:00:00.000Z";
    await store.createSession(createInput(now));
    await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
    await store.appendWire(ACPX_RECORD_ID, toolCallUpdate, now);

    const state = await store.getState(ACPX_RECORD_ID);
    assert.equal(state.acpxRecordId, ACPX_RECORD_ID);
    assert.equal(state.acpSessionId, ACP_SESSION_ID);
    assert.equal(state.cwd, "/tmp/proj");
    assert.equal(state.agentCommand, "claude");
    assert.equal(state.messages.length, 1);
    assert.equal(state.toolCalls.get("tc_f1")?.title, "Read file");
  });
});

test("file: appendWire after close throws SessionClosedError", async () => {
  await withTempHome(async () => {
    const store = createEventStore(fileStorage());
    const now = "2026-07-01T00:00:00.000Z";
    await store.createSession(createInput(now));
    await store.closeSession(ACPX_RECORD_ID);
    await assert.rejects(
      () => store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now),
      SessionClosedError,
    );
  });
});

test("file: reopenSession lets appendWire succeed again", async () => {
  await withTempHome(async () => {
    const store = createEventStore(fileStorage());
    const now = "2026-07-01T00:00:00.000Z";
    await store.createSession(createInput(now));
    await store.closeSession(ACPX_RECORD_ID);
    await store.reopenSession(ACPX_RECORD_ID, "acp_sess_file_new");

    await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
    const state = await store.getState(ACPX_RECORD_ID);
    assert.equal(state.acpSessionId, "acp_sess_file_new");
    assert.equal(state.closed, undefined);
  });
});
