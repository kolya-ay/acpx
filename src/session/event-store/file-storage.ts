// fileStorage composes the StoragePrimitives over main's session/events.ts
// + session/persistence.ts modules. No new disk paths, no new locking.
//
// Lifetime: SessionEventWriter holds an exclusive file lock per session.
// We open + close the writer on every writeFrame call so concurrent
// EventStore instances don't deadlock. createEventStore is the only authority
// over lastSeq / lastUsedAt / updated_at — we pass checkpoint:false on writer
// close to suppress the writer's own record save (stale by a single frame).
//
// The optional stateDir parameter is reserved for parity with future
// non-default-HOME backends; main's helpers derive paths from os.homedir(),
// so changing it requires setting $HOME instead.

import { SessionNotFoundError as MainSessionNotFoundError } from "../../errors.js";
import type { SessionRecord } from "../../types.js";
import { SessionEventWriter, listSessionEvents } from "../events.js";
import { resolveSessionRecord, writeSessionRecord } from "../persistence.js";
import type { StoragePrimitives } from "./types.js";

function isEnoent(e: unknown): boolean {
  return e instanceof Error && "code" in e && (e as { code?: string }).code === "ENOENT";
}

export function fileStorage(_stateDir?: string): StoragePrimitives {
  return {
    async writeFrame(sessionId, frame) {
      const record = await resolveSessionRecord(sessionId);
      const writer = await SessionEventWriter.open(record);
      try {
        await writer.appendMessage(frame, { checkpoint: false });
        // Fix J: writer mutates record.eventLog (segment_count, active_path,
        // last_write_at, etc.) in-memory on each append/rotation. Persist
        // just the eventLog so subsequent saveRecord calls preserve it.
        // checkpoint:false on close still suppresses the writer's full
        // record-save (stale lastSeq/lastUsedAt). EventStore.saveRecord
        // remains the authority over lastSeq/lastUsedAt — we re-fetch &
        // merge only the writer's eventLog.
        const writerRecord = writer.getRecord();
        const latest = await resolveSessionRecord(sessionId);
        await writeSessionRecord({ ...latest, eventLog: writerRecord.eventLog });
      } finally {
        await writer.close({ checkpoint: false });
      }
    },
    async *readFrames(sessionId) {
      const frames = await listSessionEvents(sessionId);
      for (const frame of frames) {
        yield frame;
      }
    },
    // Narrow swallow to "session does not exist" cases only. ENOENT covers
    // missing session file; main's SessionNotFoundError covers a successful
    // index probe that found nothing. Permission errors, parse errors, and
    // resolution ambiguity (SessionResolutionError) must propagate.
    async loadRecord(sessionId): Promise<SessionRecord | undefined> {
      try {
        return await resolveSessionRecord(sessionId);
      } catch (e) {
        if (isEnoent(e)) {
          return undefined;
        }
        if (e instanceof MainSessionNotFoundError) {
          return undefined;
        }
        throw e;
      }
    },
    async saveRecord(record) {
      await writeSessionRecord(record);
    },
  };
}
