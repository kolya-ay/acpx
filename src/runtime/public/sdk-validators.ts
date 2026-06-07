import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { asTrimmedString, forwardMeta, isRecord } from "./shared.js";

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
