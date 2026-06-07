import assert from "node:assert/strict";
import test from "node:test";
import { parsePromptEventLine } from "../src/runtime/public/events.js";

test("parsePromptEventLine handles text chunks, usage updates, tool updates, and compatibility lines", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      }),
    ),
    {
      type: "text_delta",
      text: "hello",
      stream: "output",
      tag: "agent_message_chunk",
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "tool_call_update",
        title: "Read",
        toolCallId: "call_READ_WITH_INPUT",
        rawInput: { path: "src/app.ts" },
        rawOutput: { stdout: "fresh output" },
      }),
    ),
    {
      type: "tool_call",
      text: "Read: fresh output",
      tag: "tool_call_update",
      toolCallId: "call_READ_WITH_INPUT",
      title: "Read",
      rawInput: { path: "src/app.ts" },
      rawOutput: { stdout: "fresh output" },
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_READ",
            status: "in_progress",
            rawOutput: {
              content: [{ type: "text", text: "partial output" }],
              details: { path: "src/app.ts" },
            },
            content: [
              {
                type: "content",
                content: { type: "text", text: "partial output" },
              },
            ],
            locations: [{ path: "src/app.ts", line: 12 }],
          },
        },
      }),
    ),
    {
      type: "tool_call",
      text: "tool call (in_progress): partial output",
      tag: "tool_call_update",
      toolCallId: "call_READ",
      status: "in_progress",
      title: "tool call",
      rawOutput: {
        content: [{ type: "text", text: "partial output" }],
        details: { path: "src/app.ts" },
      },
      content: [
        {
          type: "content",
          content: { type: "text", text: "partial output" },
        },
      ],
      locations: [{ path: "src/app.ts", line: 12 }],
    },
  );

  const longOutput = "x".repeat(600);
  const parsedLongUpdate = parsePromptEventLine(
    JSON.stringify({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_LONG",
      rawOutput: { stdout: longOutput },
    }),
  );
  assert.equal(parsedLongUpdate?.type, "tool_call");
  assert.equal(parsedLongUpdate?.text.length, 511);
  assert.match(parsedLongUpdate?.text ?? "", /^tool call: x+…$/);

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_thought_chunk",
            text: "thinking",
          },
        },
      }),
    ),
    {
      type: "text_delta",
      text: "thinking",
      stream: "thought",
      tag: "agent_thought_chunk",
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "usage_update",
            used: 12,
            size: 500,
          },
        },
      }),
    ),
    {
      type: "status",
      text: "usage updated: 12/500",
      tag: "usage_update",
      used: 12,
      size: 500,
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_ABC123",
            status: "in_progress",
          },
        },
      }),
    ),
    {
      type: "tool_call",
      text: "tool call (in_progress)",
      tag: "tool_call_update",
      toolCallId: "call_ABC123",
      status: "in_progress",
      title: "tool call",
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_SEARCH",
            title: "Search",
            status: "in_progress",
            rawInput: {
              command: "rg",
              args: ["-n", "needle"],
            },
          },
        },
      }),
    ),
    {
      type: "tool_call",
      text: "Search (in_progress): rg -n needle",
      tag: "tool_call",
      toolCallId: "call_SEARCH",
      status: "in_progress",
      rawInput: {
        command: "rg",
        args: ["-n", "needle"],
      },
      title: "Search",
    },
  );

  assert.deepEqual(parsePromptEventLine(JSON.stringify({ type: "text", content: "alpha" })), {
    type: "text_delta",
    text: "alpha",
    stream: "output",
  });
  assert.equal(
    parsePromptEventLine(JSON.stringify({ type: "done", stopReason: "end_turn" })),
    null,
  );
});

test("parsePromptEventLine handles runtime status-style updates", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "session_info_update",
        summary: "ready",
      }),
    ),
    {
      type: "status",
      text: "ready",
      tag: "session_info_update",
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        type: "client_operation",
        method: "write_file",
        status: "ok",
        summary: "saved notes.md",
      }),
    ),
    {
      type: "status",
      text: "write_file ok saved notes.md",
    },
  );

  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ type: "update", update: "loading session" })),
    {
      type: "status",
      text: "loading session",
    },
  );

  assert.equal(
    parsePromptEventLine(
      JSON.stringify({ type: "error", message: "broken", code: "E1", retryable: true }),
    ),
    null,
  );
});

test("parsePromptEventLine ignores unsupported structured payloads and treats raw lines as status", () => {
  assert.equal(parsePromptEventLine("   "), null);
  assert.deepEqual(parsePromptEventLine("plain runtime note"), {
    type: "status",
    text: "plain runtime note",
  });
  assert.equal(
    parsePromptEventLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "image", text: "ignored" },
          },
        },
      }),
    ),
    null,
  );
  assert.equal(parsePromptEventLine(JSON.stringify({ type: "update", update: "   " })), null);
  assert.deepEqual(parsePromptEventLine(JSON.stringify({ type: "client_operation" })), {
    type: "status",
    text: "operation",
  });
  assert.deepEqual(parsePromptEventLine(JSON.stringify({ type: "plan", entries: [] })), {
    type: "plan",
    entries: [],
  });
  assert.deepEqual(parsePromptEventLine(JSON.stringify(["not", "an", "object"])), {
    type: "status",
    text: '["not","an","object"]',
  });
  assert.deepEqual(parsePromptEventLine(JSON.stringify({ type: "usage_update", used: "bad" })), {
    type: "status",
    text: "usage updated",
    tag: "usage_update",
  });
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        type: "tool_call",
        title: "run",
        status: "started",
        kind: "execute",
        toolCallId: "tool-1",
        rawInput: { command: "node", args: ["--version"] },
        locations: [{ path: "package.json" }],
      }),
    ),
    {
      type: "tool_call",
      text: "run (started): node --version",
      tag: "tool_call",
      title: "run",
      toolCallId: "tool-1",
      status: "started",
      kind: "execute",
      rawInput: { command: "node", args: ["--version"] },
      locations: [{ path: "package.json" }],
    },
  );
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        type: "tool_call_update",
        title: "read",
        content: [
          { type: "resource_link", title: "README.md", uri: "file:///README.md" },
          { type: "resource", resource: { text: "body" } },
          { type: "diff", path: "src/index.ts" },
          { type: "terminal", terminalId: "term-1" },
        ],
      }),
    ),
    {
      type: "tool_call",
      text: "read: README.md\nbody\ndiff src/index.ts\n[terminal] term-1",
      tag: "tool_call_update",
      title: "read",
      content: [
        { type: "resource_link", title: "README.md", uri: "file:///README.md" },
        { type: "resource", resource: { text: "body" } },
        { type: "diff", path: "src/index.ts" },
        { type: "terminal", terminalId: "term-1" },
      ],
    },
  );
  assert.equal(parsePromptEventLine(JSON.stringify({ type: "__proto__", content: "x" })), null);
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        type: "tool_call_update",
        content: [{ type: "__proto__", text: "x" }],
      }),
    ),
    {
      type: "tool_call",
      text: "tool call",
      tag: "tool_call_update",
      title: "tool call",
      content: [{ type: "__proto__", text: "x" }],
    },
  );
});

test("parsePromptEventLine covers status and tool summary fallbacks", () => {
  assert.equal(
    parsePromptEventLine(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} })),
    null,
  );
  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ sessionUpdate: "available_commands_update" })),
    {
      type: "available_commands_update",
      availableCommands: [],
    },
  );
  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ sessionUpdate: "config_option_update" })),
    {
      type: "config_option_update",
      configOptions: [],
    },
  );
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({ sessionUpdate: "session_info_update", message: "ready" }),
    ),
    {
      type: "status",
      text: "ready",
      tag: "session_info_update",
    },
  );
  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ sessionUpdate: "plan", entries: ["skip"] })),
    {
      type: "plan",
      entries: [],
    },
  );
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "agent_message_chunk",
        content: { text: "hello" },
      }),
    ),
    {
      type: "text_delta",
      text: "hello",
      stream: "output",
      tag: "agent_message_chunk",
    },
  );
  assert.equal(
    parsePromptEventLine(
      JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } }),
    ),
    null,
  );
  assert.deepEqual(parsePromptEventLine(JSON.stringify({ type: "tool_call", rawInput: 42 })), {
    type: "tool_call",
    text: "tool call: 42",
    tag: "tool_call",
    title: "tool call",
    rawInput: 42,
  });
  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ type: "tool_call_update", rawOutput: true })),
    {
      type: "tool_call",
      text: "tool call: true",
      tag: "tool_call_update",
      title: "tool call",
      rawOutput: true,
    },
  );
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({ type: "tool_call_update", rawOutput: { stderr: "bad" } }),
    ),
    {
      type: "tool_call",
      text: "tool call: bad",
      tag: "tool_call_update",
      title: "tool call",
      rawOutput: { stderr: "bad" },
    },
  );
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        type: "tool_call_update",
        content: [
          { type: "resource_link", uri: "file:///fallback" },
          { type: "resource", resource: { uri: "file:///resource" } },
          { type: "audio", mimeType: "audio/wav", data: "UklGRg==" },
          { type: "terminal" },
        ],
      }),
    ),
    {
      type: "tool_call",
      text: "tool call: file:///fallback\nfile:///resource\n[audio] audio/wav\n[terminal]",
      tag: "tool_call_update",
      title: "tool call",
      content: [
        { type: "resource_link", uri: "file:///fallback" },
        { type: "resource", resource: { uri: "file:///resource" } },
        { type: "audio", mimeType: "audio/wav", data: "UklGRg==" },
        { type: "terminal" },
      ],
    },
  );
});

test("parsePromptEventLine surfaces cost and _meta.usage breakdown on usage_update", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "usage_update",
        used: 1200,
        size: 200_000,
        cost: { amount: 0.0123, currency: "USD" },
        _meta: {
          usage: {
            inputTokens: 800,
            outputTokens: 400,
            cachedReadTokens: 600,
            cachedWriteTokens: 50,
            thoughtTokens: 75,
            totalTokens: 1925,
          },
        },
      }),
    ),
    {
      type: "status",
      text: "usage updated: 1200/200000",
      tag: "usage_update",
      used: 1200,
      size: 200_000,
      cost: { amount: 0.0123, currency: "USD" },
      breakdown: {
        inputTokens: 800,
        outputTokens: 400,
        cachedReadTokens: 600,
        cachedWriteTokens: 50,
        thoughtTokens: 75,
        totalTokens: 1925,
      },
    },
  );

  // Cost is forwarded even when only one field is populated.
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "usage_update",
        used: 10,
        size: 100,
        cost: { amount: 0.05 },
      }),
    ),
    {
      type: "status",
      text: "usage updated: 10/100",
      tag: "usage_update",
      used: 10,
      size: 100,
      cost: { amount: 0.05 },
    },
  );

  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "usage_update",
        used: 25,
        size: 100,
        _meta: {
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 2,
            thought_tokens: 1,
            total_tokens: 21,
          },
        },
      }),
    ),
    {
      type: "status",
      text: "usage updated: 25/100",
      tag: "usage_update",
      used: 25,
      size: 100,
      breakdown: {
        inputTokens: 10,
        outputTokens: 5,
        cachedReadTokens: 3,
        cachedWriteTokens: 2,
        thoughtTokens: 1,
        totalTokens: 21,
      },
    },
  );

  // _meta without a usage record is ignored — no synthetic breakdown.
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "usage_update",
        used: 5,
        size: 100,
        _meta: { somethingElse: "ignored" },
      }),
    ),
    {
      type: "status",
      text: "usage updated: 5/100",
      tag: "usage_update",
      used: 5,
      size: 100,
    },
  );
});

test("parsePromptEventLine emits available_commands_update as a top-level event with SDK AvailableCommand shape", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "/compact", description: "Compact context" },
          { name: "/search", description: "Search", input: { hint: "query" } },
          { name: "/clear", description: "Clear context" },
          { name: "/no-desc" }, // missing required `description` — must be dropped
        ],
      }),
    ),
    {
      type: "available_commands_update",
      availableCommands: [
        { name: "/compact", description: "Compact context" },
        { name: "/search", description: "Search", input: { hint: "query" } },
        { name: "/clear", description: "Clear context" },
      ],
    },
  );
});

test("parsePromptEventLine available_commands_update forwards _meta when present", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "/compact", description: "Compact context" }],
        _meta: { source: "agent" },
      }),
    ),
    {
      type: "available_commands_update",
      availableCommands: [{ name: "/compact", description: "Compact context" }],
      _meta: { source: "agent" },
    },
  );
});

test("parsePromptEventLine emits current_mode_update as a top-level event", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      }),
    ),
    {
      type: "current_mode_update",
      currentModeId: "code",
    },
  );
});

test("parsePromptEventLine current_mode_update forwards _meta when present", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "current_mode_update",
        currentModeId: "architect",
        _meta: { reason: "user-set" },
      }),
    ),
    {
      type: "current_mode_update",
      currentModeId: "architect",
      _meta: { reason: "user-set" },
    },
  );
});

test("parsePromptEventLine current_mode_update returns null when currentModeId is missing or empty", () => {
  assert.equal(
    parsePromptEventLine(JSON.stringify({ sessionUpdate: "current_mode_update" })),
    null,
  );
  assert.equal(
    parsePromptEventLine(
      JSON.stringify({ sessionUpdate: "current_mode_update", currentModeId: "   " }),
    ),
    null,
  );
});

test("parsePromptEventLine emits config_option_update as a top-level event with SDK shape", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "approval_policy",
            name: "Approval Policy",
            type: "boolean",
            currentValue: true,
          },
          {
            id: "reasoning_effort",
            name: "Reasoning Effort",
            category: "mode",
            type: "select",
            options: [
              { name: "Low", value: "low" },
              { name: "High", value: "high" },
            ],
            currentValue: "high",
          },
        ],
      }),
    ),
    {
      type: "config_option_update",
      configOptions: [
        {
          id: "approval_policy",
          name: "Approval Policy",
          type: "boolean",
          currentValue: true,
        },
        {
          id: "reasoning_effort",
          name: "Reasoning Effort",
          category: "mode",
          type: "select",
          options: [
            { name: "Low", value: "low" },
            { name: "High", value: "high" },
          ],
          currentValue: "high",
        },
      ],
    },
  );
});

test("parsePromptEventLine config_option_update forwards _meta when present", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "config_option_update",
        configOptions: [],
        _meta: { source: "agent" },
      }),
    ),
    {
      type: "config_option_update",
      configOptions: [],
      _meta: { source: "agent" },
    },
  );
});

test("parsePromptEventLine config_option_update returns empty configOptions when array is missing", () => {
  assert.deepEqual(
    parsePromptEventLine(JSON.stringify({ sessionUpdate: "config_option_update" })),
    {
      type: "config_option_update",
      configOptions: [],
    },
  );
});

test("parsePromptEventLine emits plan as a top-level event with PlanEntry[]", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "plan",
        entries: [
          { content: "research", priority: "high", status: "in_progress" },
          { content: "draft", priority: "medium", status: "pending" },
          { content: "review", priority: "low", status: "completed" },
        ],
      }),
    ),
    {
      type: "plan",
      entries: [
        { content: "research", priority: "high", status: "in_progress" },
        { content: "draft", priority: "medium", status: "pending" },
        { content: "review", priority: "low", status: "completed" },
      ],
    },
  );
});

test("parsePromptEventLine plan returns empty entries when array is missing", () => {
  assert.deepEqual(parsePromptEventLine(JSON.stringify({ sessionUpdate: "plan" })), {
    type: "plan",
    entries: [],
  });
});

test("parsePromptEventLine plan forwards _meta when present", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "plan",
        entries: [{ content: "step", priority: "high", status: "pending" }],
        _meta: { source: "agent" },
      }),
    ),
    {
      type: "plan",
      entries: [{ content: "step", priority: "high", status: "pending" }],
      _meta: { source: "agent" },
    },
  );
});

test("parsePromptEventLine plan drops entries with invalid priority/status or empty content", () => {
  assert.deepEqual(
    parsePromptEventLine(
      JSON.stringify({
        sessionUpdate: "plan",
        entries: [
          { content: "ok", priority: "high", status: "pending" },
          { content: "bad priority", priority: "urgent", status: "pending" },
          { content: "bad status", priority: "high", status: "blocked" },
          { content: "   ", priority: "high", status: "pending" },
          { content: "missing priority", status: "pending" },
          { content: "missing status", priority: "low" },
          "string entry",
        ],
      }),
    ),
    {
      type: "plan",
      entries: [{ content: "ok", priority: "high", status: "pending" }],
    },
  );
});
