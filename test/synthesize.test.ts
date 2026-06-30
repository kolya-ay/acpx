import { strict as assert } from "node:assert";
import test from "node:test";
import { ACPX_EVENT_SCHEMA } from "../src/session/event-store/events.js";
import {
  synthesizeClose,
  synthesizeDesiredState,
  synthesizeHeader,
  synthesizeReconnected,
} from "../src/session/event-store/synthesize.js";
import type { SessionRecord } from "../src/types.js";

const TS = "2026-07-01T00:00:00.000Z";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    schema: "acpx.session.v1",
    acpxRecordId: "rec-1",
    acpSessionId: "acp-1",
    agentCommand: "codex",
    cwd: "/tmp",
    createdAt: TS,
    lastUsedAt: TS,
    lastSeq: 0,
    eventLog: {
      active_path: "/tmp/ev.ndjson",
      segment_count: 0,
      max_segment_bytes: 1024,
      max_segments: 2,
    },
    messages: [],
    updated_at: TS,
    cumulative_token_usage: {},
    request_token_usage: {},
    ...overrides,
  };
}

test("synthesizeHeader returns seq:0 and schema:v1", () => {
  const ev = synthesizeHeader(makeRecord());
  assert.equal(ev.kind, "header");
  assert.equal(ev.seq, 0);
  if (ev.kind === "header") {
    assert.equal(ev.schema, ACPX_EVENT_SCHEMA);
    assert.equal(ev.acpxRecordId, "rec-1");
    assert.equal(ev.acpSessionId, "acp-1");
    assert.equal(ev.cwd, "/tmp");
    assert.equal(ev.agentCommand, "codex");
  }
});

test("synthesizeDesiredState returns 0 events for an empty record", () => {
  const evs = synthesizeDesiredState(makeRecord(), 1);
  assert.equal(evs.length, 0);
});

test("synthesizeDesiredState emits one event per non-null desired field + session_renamed", () => {
  const evs = synthesizeDesiredState(
    makeRecord({
      name: "renamed",
      acpx: {
        desired_mode_id: "edit",
        session_options: { model: "gpt" },
        desired_config_options: { thought_level: "deep" },
      },
    }),
    1,
  );
  assert.equal(evs.length, 4);
  assert.equal(evs[0].kind, "desired_mode_set");
  assert.equal(evs[1].kind, "desired_model_set");
  assert.equal(evs[2].kind, "desired_config_option_set");
  assert.equal(evs[3].kind, "session_renamed");
  assert.equal(evs[0].seq, 1);
  assert.equal(evs[3].seq, 4);
});

test("synthesizeClose throws on non-closed record", () => {
  assert.throws(() => synthesizeClose(makeRecord(), 1), /non-closed/);
});

test("synthesizeClose returns session_closed with correct fields", () => {
  const ev = synthesizeClose(
    makeRecord({
      closed: true,
      closedAt: TS,
      lastAgentExitCode: 0,
      lastAgentDisconnectReason: "agent_exited",
    }),
    7,
  );
  assert.equal(ev.kind, "session_closed");
  if (ev.kind === "session_closed") {
    assert.equal(ev.closedAt, TS);
    assert.equal(ev.lastAgentExitCode, 0);
    assert.equal(ev.lastAgentDisconnectReason, "agent_exited");
    assert.equal(ev.seq, 7);
  }
});

test("synthesizeReconnected carries acpSessionId", () => {
  const ev = synthesizeReconnected(makeRecord({ acpSessionId: "acp-2" }), 3);
  assert.equal(ev.kind, "session_reconnected");
  if (ev.kind === "session_reconnected") {
    assert.equal(ev.acpSessionId, "acp-2");
    assert.equal(ev.seq, 3);
  }
});
