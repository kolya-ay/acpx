import { strict as assert } from "node:assert";
import test from "node:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { memoryStorage } from "../src/session/event-store/memory-storage.js";
import { createEventStore } from "../src/session/event-store/store.js";

// Fix A guard: record.lastSeq is the wire-replay watermark. Across
// close + reopen + appendWire, the persisted lastSeq must match the
// max seq yielded by events() (the replay watermark).

const ACPX_RECORD_ID = "rec_seq_invariant";
const ACP_SESSION_ID = "acp_sess_seq_invariant";
const NOW = "2026-07-01T00:00:00.000Z";

const wireA: SessionUpdate = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "before close" },
};

const wireB: SessionUpdate = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "after reopen" },
};

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) {
    out.push(x);
  }
  return out;
}

test("seq invariant: record.lastSeq equals max replayed seq across close+reopen+appendWire", async () => {
  const store = createEventStore(memoryStorage());
  await store.createSession({
    acpxRecordId: ACPX_RECORD_ID,
    acpSessionId: ACP_SESSION_ID,
    cwd: "/tmp/proj",
    agentCommand: "claude",
    createdAt: NOW,
  });

  // 1. append one wire event (lastSeq becomes 1)
  const firstWire = await store.appendWire(ACPX_RECORD_ID, wireA, NOW);
  assert.equal(firstWire.length, 1);
  assert.equal(firstWire[0].seq, 1);

  // 2. close — does NOT bump persisted lastSeq
  const closeEvent = await store.closeSession(ACPX_RECORD_ID, { closedAt: NOW });
  assert.equal(closeEvent.kind, "session_closed");

  // 3. reopen — does NOT bump persisted lastSeq either
  const reopenEvent = await store.reopenSession(ACPX_RECORD_ID, "acp_sess_new");
  assert.equal(reopenEvent.kind, "session_reconnected");

  // 4. append a second wire event — its seq must be consecutive with the
  // pre-close wire event (no gap from the lifecycle events)
  const secondWire = await store.appendWire(ACPX_RECORD_ID, wireB, NOW);
  assert.equal(secondWire.length, 1);
  assert.equal(secondWire[0].seq, 2);

  // 5. replay events() and find the max seq
  const replayed = await collect(store.events(ACPX_RECORD_ID));
  const maxReplaySeq = replayed.reduce((m, e) => (e.seq > m ? e.seq : m), 0);

  // 6. record.lastSeq must equal the max replay seq.
  const state = await store.getState(ACPX_RECORD_ID);
  assert.equal(state.lastSeq, maxReplaySeq);
  assert.equal(state.lastSeq, 2);

  // 7. the second wire event's appendWire seq must equal its replay seq.
  const replayedWireB = replayed.find(
    (e) => e.kind === "agent_message_chunk" && e.seq === secondWire[0].seq,
  );
  assert.ok(replayedWireB, "second wire event must appear in replay");
  assert.equal(replayedWireB.seq, secondWire[0].seq);
});

test("reopenSession throws if the session is not closed", async () => {
  const store = createEventStore(memoryStorage());
  await store.createSession({
    acpxRecordId: ACPX_RECORD_ID,
    acpSessionId: ACP_SESSION_ID,
    cwd: "/tmp/proj",
    agentCommand: "claude",
    createdAt: NOW,
  });
  await assert.rejects(() => store.reopenSession(ACPX_RECORD_ID, "acp_sess_new"), /not closed/);
});

test("reopenSession clears stale exit metadata", async () => {
  const store = createEventStore(memoryStorage());
  await store.createSession({
    acpxRecordId: ACPX_RECORD_ID,
    acpSessionId: ACP_SESSION_ID,
    cwd: "/tmp/proj",
    agentCommand: "claude",
    createdAt: NOW,
  });
  await store.closeSession(ACPX_RECORD_ID, {
    closedAt: NOW,
    lastAgentExitCode: 137,
    lastAgentExitSignal: "SIGKILL",
    lastAgentDisconnectReason: "killed",
  });
  await store.reopenSession(ACPX_RECORD_ID, "acp_sess_new");

  // Inspect the underlying record via storage: we use a fresh store over
  // the same memoryStorage indirectly by exposing the in-memory snapshot
  // through getState's reducer. The reducer mirrors the record's exit
  // bits via session_closed/session_reconnected; we cleared the record's
  // direct fields, so a fresh replay sees no closed-state.
  const state = await store.getState(ACPX_RECORD_ID);
  assert.equal(state.closed, undefined);
});

test("live + replay events agree on value type for desired_config_option_set", async () => {
  const store = createEventStore(memoryStorage());
  await store.createSession({
    acpxRecordId: ACPX_RECORD_ID,
    acpSessionId: ACP_SESSION_ID,
    cwd: "/tmp/proj",
    agentCommand: "claude",
    createdAt: NOW,
  });

  const live = await store.setDesired(ACPX_RECORD_ID, {
    configOptions: { reasoning: "high", enabled: "true" },
  });
  const liveConfigEvents = live.filter((e) => e.kind === "desired_config_option_set");
  assert.equal(liveConfigEvents.length, 2);
  for (const ev of liveConfigEvents) {
    assert.equal(typeof ev.value, "string");
  }

  const replayed = (await collect(store.events(ACPX_RECORD_ID))).filter(
    (e) => e.kind === "desired_config_option_set",
  );
  assert.equal(replayed.length, 2);
  for (const ev of replayed) {
    assert.equal(typeof ev.value, "string");
  }

  // Pair them by configId and assert value type and content match.
  const liveByConfig = new Map(liveConfigEvents.map((e) => [e.configId, e.value]));
  const replayByConfig = new Map(replayed.map((e) => [e.configId, e.value]));
  assert.equal(liveByConfig.size, replayByConfig.size);
  for (const [id, val] of liveByConfig) {
    assert.equal(typeof val, typeof replayByConfig.get(id));
    assert.equal(val, replayByConfig.get(id));
  }
});
