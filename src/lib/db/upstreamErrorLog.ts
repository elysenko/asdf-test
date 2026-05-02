/**
 * DB access module for the `upstream_error_log` table.
 *
 * Per db_agent_summary, this is the ONLY surface backend code uses to talk to
 * Postgres. Read endpoints are out of scope; operators inspect the table
 * directly via psql.
 *
 * Application-level rule: `upstreamMessage` MUST be truncated to 1024 bytes
 * before insert. The column is unbounded TEXT as a safety net, but we enforce
 * the limit here so a runaway upstream body cannot bloat the table.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";

/** Discriminator for which upstream the failure originated from. */
export type UpstreamSource = "GEOCODER" | "WEATHER";

export interface UpstreamErrorRecord {
  source: UpstreamSource;
  /** HTTP status from the upstream, if one was received. Undefined for network/timeout. */
  upstreamStatus?: number;
  /** Free-form upstream message (will be truncated to 1 KB). */
  upstreamMessage?: string;
  /** Sanitized request city (post-validation, ≤ 100 chars). May be omitted. */
  requestCity?: string;
}

const MAX_MESSAGE_BYTES = 1024;

/**
 * Truncate to a UTF-8 byte budget without splitting a multi-byte char.
 * We encode, slice, then decode with `fatal: false` so any partial code unit
 * at the boundary is replaced rather than thrown.
 */
function truncateUtf8(input: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  if (bytes.length <= maxBytes) return input;
  const sliced = bytes.subarray(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
}

/**
 * Insert a row into `upstream_error_log`. Failures here are logged but never
 * rethrown — the calling route handler still has to return its canonical
 * error response to the user, and a logging-table outage must not turn into
 * a second user-visible failure.
 */
export async function insertUpstreamError(
  record: UpstreamErrorRecord,
): Promise<void> {
  try {
    await prisma.upstreamErrorLog.create({
      data: {
        source: record.source,
        upstreamStatus: record.upstreamStatus,
        upstreamMessage:
          record.upstreamMessage !== undefined
            ? truncateUtf8(record.upstreamMessage, MAX_MESSAGE_BYTES)
            : undefined,
        requestCity: record.requestCity,
      },
    });
  } catch (err) {
    logger.error({
      event: "upstream_error_log.insert_failed",
      source: record.source,
      msg: err instanceof Error ? err.message : "unknown error",
    });
  }
}
