// In-memory StoragePrimitives — test double for the seam.
// Keyed by acpxRecordId (same id appendWire/loadRecord/saveRecord use).

import type { AcpJsonRpcMessage, SessionRecord } from "../../types.js";
import type { StoragePrimitives } from "./types.js";

export function memoryStorage(): StoragePrimitives {
  const frames = new Map<string, AcpJsonRpcMessage[]>();
  const records = new Map<string, SessionRecord>();

  return {
    async writeFrame(sessionId, frame) {
      const buf = frames.get(sessionId) ?? [];
      buf.push(frame);
      frames.set(sessionId, buf);
    },
    async *readFrames(sessionId) {
      const buf = frames.get(sessionId) ?? [];
      for (const frame of buf) {
        yield frame;
      }
    },
    async loadRecord(sessionId) {
      return records.get(sessionId);
    },
    async saveRecord(record) {
      records.set(record.acpxRecordId, { ...record });
    },
  };
}
