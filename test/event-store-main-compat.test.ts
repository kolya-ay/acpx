import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { fileStorage } from "../src/session/event-store/file-storage.js";
import { createEventStore } from "../src/session/event-store/store.js";
import { listSessionEvents } from "../src/session/events.js";
import { resolveSessionRecord } from "../src/session/persistence.js";

async function withTempHome(run: (homeDir: string) => Promise<void>): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "acpx-event-store-compat-"));
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

const ACPX_RECORD_ID = "rec_compat";
const ACP_SESSION_ID = "acp_sess_compat";

const agentTextUpdate: SessionUpdate = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "compat works" },
};

const toolCallUpdate: SessionUpdate = {
  sessionUpdate: "tool_call",
  toolCallId: "tc_c1",
  title: "Search",
  status: "completed",
};

test("compat: EventStore-written session record is readable via resolveSessionRecord", async () => {
  await withTempHome(async () => {
    const now = "2026-07-01T00:00:00.000Z";
    const store = createEventStore(fileStorage());

    await store.createSession({
      acpxRecordId: ACPX_RECORD_ID,
      acpSessionId: ACP_SESSION_ID,
      cwd: "/tmp/proj",
      agentCommand: "claude",
      createdAt: now,
    });

    await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
    await store.appendWire(ACPX_RECORD_ID, toolCallUpdate, now);
    await store.setDesired(ACPX_RECORD_ID, { modeId: "plan", modelId: "haiku" });
    await store.closeSession(ACPX_RECORD_ID, { closedAt: now });

    // Read via main's helpers.
    const record = await resolveSessionRecord(ACPX_RECORD_ID);
    assert.equal(record.acpxRecordId, ACPX_RECORD_ID);
    assert.equal(record.acpSessionId, ACP_SESSION_ID);
    assert.equal(record.cwd, "/tmp/proj");
    assert.equal(record.agentCommand, "claude");
    assert.equal(record.createdAt, now);
    assert.equal(record.closed, true);
    assert.equal(record.closedAt, now);
    // appendWire x2 (+2) + setDesired modeId+modelId (+2) = 4.
    // closeSession does NOT bump lastSeq (Fix A: lastSeq is the wire-replay
    // watermark; lifecycle events synthesize their seq on read).
    assert.equal(record.lastSeq, 4);
    assert.equal(record.acpx?.desired_mode_id, "plan");
    assert.equal(record.acpx?.session_options?.model, "haiku");
  });
});

test("compat: EventStore-written wire frames are readable via listSessionEvents", async () => {
  await withTempHome(async () => {
    const now = "2026-07-01T00:00:00.000Z";
    const store = createEventStore(fileStorage());

    await store.createSession({
      acpxRecordId: ACPX_RECORD_ID,
      acpSessionId: ACP_SESSION_ID,
      cwd: "/tmp/proj",
      agentCommand: "claude",
      createdAt: now,
    });

    await store.appendWire(ACPX_RECORD_ID, agentTextUpdate, now);
    await store.appendWire(ACPX_RECORD_ID, toolCallUpdate, now);

    const frames = await listSessionEvents(ACPX_RECORD_ID);
    assert.equal(frames.length, 2);

    const first = frames[0] as {
      method: string;
      params: { sessionId: string; update: { sessionUpdate: string } };
    };
    assert.equal(first.method, "session/update");
    assert.equal(first.params.sessionId, ACP_SESSION_ID);
    assert.equal(first.params.update.sessionUpdate, "agent_message_chunk");

    const second = frames[1] as {
      params: { update: { sessionUpdate: string; toolCallId: string } };
    };
    assert.equal(second.params.update.sessionUpdate, "tool_call");
    assert.equal(second.params.update.toolCallId, "tc_c1");
  });
});
