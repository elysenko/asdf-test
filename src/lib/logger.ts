/**
 * Minimal structured logger.
 *
 * Emits one JSON object per log line to stdout/stderr so operators can
 * grep / ship to Loki / pipe through `jq`. Intentionally dependency-free —
 * pino would be a better fit at scale, but every Node runtime supports
 * `console.log`, and we only have a handful of call sites.
 *
 * Never log API keys. The route handler / clients pass *only* sanitized
 * fields (status codes, request city after validation, latency).
 */

type Level = "info" | "warn" | "error";

export interface LogFields {
  /** Optional event name, e.g. "weather.success", "geocoder.timeout". */
  event?: string;
  /** Sanitized request city (post-validation). May be omitted on rejection. */
  city?: string;
  /** Upstream status code, when applicable. */
  upstreamStatus?: number;
  /** Internal millis elapsed for the relevant operation. */
  latencyMs?: number;
  /** Free-form message for human readers. */
  msg?: string;
  /** Error code from the surface contract, when known. */
  errorCode?: string;
  /** Origin of an upstream failure: "GEOCODER" | "WEATHER". */
  source?: string;
  /** Anything else; keys are passed through verbatim. */
  [extra: string]: unknown;
}

function emit(level: Level, fields: LogFields): void {
  const record = {
    level,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  // Route warn/error to stderr so they show up in container error streams.
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};
