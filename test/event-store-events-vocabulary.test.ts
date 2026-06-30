import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ACPX_EVENT_SCHEMA,
  isAcpxDomainKind,
  type AcpxDomainKind,
  type AcpxEvent,
  type AcpxWireKind,
} from "../src/session/event-store/events.js";

const ALL_KINDS = [
  // wire (13)
  "agent_message_chunk",
  "user_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
  "plan",
  "plan_update",
  "plan_removed",
  // domain (8)
  "header",
  "session_closed",
  "session_reconnected",
  "desired_mode_set",
  "desired_model_set",
  "desired_config_option_set",
  "session_renamed",
  "agent_lifecycle_snapshot",
] as const satisfies ReadonlyArray<AcpxEvent["kind"]>;

// Compile-time exhaustiveness: both directions must be empty.
// (A) Catches *missing* kinds — anything in AcpxEvent["kind"] not in ALL_KINDS.
// (B) Catches *extra* kinds — anything in ALL_KINDS not in AcpxEvent["kind"].
// AssertNever<T> errors at the type level whenever T resolves to anything
// other than `never`, so the helper aliases below fail to type-check the
// moment either direction stops being empty.
type AssertNever<T extends never> = T;
type CheckMissing = Exclude<AcpxEvent["kind"], (typeof ALL_KINDS)[number]>;
type CheckExtra = Exclude<(typeof ALL_KINDS)[number], AcpxEvent["kind"]>;
type _CheckMissingIsEmpty = AssertNever<CheckMissing>;
type _CheckExtraIsEmpty = AssertNever<CheckExtra>;

test("ACPX_EVENT_SCHEMA constant is 'v1'", () => {
  assert.equal(ACPX_EVENT_SCHEMA, "v1");
});

test("ALL_KINDS lists exactly 21 distinct kinds", () => {
  assert.equal(ALL_KINDS.length, 21);
  assert.equal(new Set(ALL_KINDS).size, 21);
});

test("isAcpxDomainKind returns true for exactly 8 kinds", () => {
  const domainKinds: AcpxDomainKind[] = [
    "header",
    "session_closed",
    "session_reconnected",
    "desired_mode_set",
    "desired_model_set",
    "desired_config_option_set",
    "session_renamed",
    "agent_lifecycle_snapshot",
  ];
  for (const k of domainKinds) {
    assert.equal(isAcpxDomainKind(k), true, `${k} should be domain`);
  }
  assert.equal(domainKinds.length, 8);
});

test("isAcpxDomainKind returns false for all 13 wire kinds", () => {
  const wireKinds: AcpxWireKind[] = [
    "agent_message_chunk",
    "user_message_chunk",
    "agent_thought_chunk",
    "tool_call",
    "tool_call_update",
    "available_commands_update",
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "usage_update",
    "plan",
    "plan_update",
    "plan_removed",
  ];
  for (const k of wireKinds) {
    assert.equal(isAcpxDomainKind(k), false, `${k} should be wire`);
  }
  assert.equal(wireKinds.length, 13);
});
