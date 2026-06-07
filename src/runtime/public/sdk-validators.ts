import type {
  AvailableCommand,
  PlanEntry,
  PlanEntryPriority,
  PlanEntryStatus,
} from "@agentclientprotocol/sdk";
import { asTrimmedString, forwardMeta, isRecord } from "./shared.js";

/**
 * Whitelisted SDK enums. Single source of truth shared by the runtime event
 * parser (`events.ts`) and the persistence parser (`session/persistence/parse.ts`).
 */
const PLAN_ENTRY_PRIORITIES: ReadonlySet<PlanEntryPriority> = new Set(["high", "medium", "low"]);

const PLAN_ENTRY_STATUSES: ReadonlySet<PlanEntryStatus> = new Set([
  "pending",
  "in_progress",
  "completed",
]);

/**
 * Validate an unknown value against the SDK `PlanEntry` shape. Returns the
 * normalized entry when the shape matches, otherwise `undefined`. Used by
 * both the runtime parser and the persistence parser so the priority/status
 * whitelists do not drift apart between the two parse paths.
 */
export function validatePlanEntry(raw: unknown): PlanEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const content = asTrimmedString(raw.content);
  if (!content) {
    return undefined;
  }
  const priorityRaw = asTrimmedString(raw.priority);
  if (!priorityRaw || !PLAN_ENTRY_PRIORITIES.has(priorityRaw as PlanEntryPriority)) {
    return undefined;
  }
  const statusRaw = asTrimmedString(raw.status);
  if (!statusRaw || !PLAN_ENTRY_STATUSES.has(statusRaw as PlanEntryStatus)) {
    return undefined;
  }
  return {
    content,
    priority: priorityRaw as PlanEntryPriority,
    status: statusRaw as PlanEntryStatus,
    ...forwardMeta(raw),
  };
}

/**
 * Validate an unknown value against the SDK `AvailableCommand` shape. Returns
 * the normalized command when the shape matches, otherwise `undefined`. Used
 * by both the runtime parser and the persistence parser.
 *
 * Legacy persisted entries that lack `description` (acpx ≤ 0.10 only stored
 * `name`/`has_input`) are dropped on load; the next `available_commands_update`
 * notification will refill with SDK-shaped data.
 */
export function validateAvailableCommand(raw: unknown): AvailableCommand | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const name = asTrimmedString(raw.name);
  const description = asTrimmedString(raw.description);
  if (!name || !description) {
    return undefined;
  }
  return {
    name,
    description,
    ...(isRecord(raw.input) ? { input: raw.input as AvailableCommand["input"] } : {}),
    ...forwardMeta(raw),
  };
}
