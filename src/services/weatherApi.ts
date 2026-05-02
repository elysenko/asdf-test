/**
 * Typed client for `POST /api/weather`.
 *
 * Returns a discriminated union that mirrors the Surface contract envelope
 * defined in `src/lib/contract.ts`. The route returns canonical user-facing
 * messages already, so the client never has to invent message text — it just
 * forwards `error.message` to the UI. A small helper, `messageForCode`, is
 * exported as a single source of truth in case the UI ever needs to render
 * a message for a code without a server response (e.g. a synthesised
 * client-side validation failure).
 */

import {
  ApiResponse,
  ErrorCode,
  ErrorBody,
  MESSAGES,
  SuccessBody,
} from "@/lib/contract";

/** Successful response wrapper. */
export type WeatherResult = { ok: true; data: SuccessBody };

/** Error response wrapper. Mirrors the server envelope. */
export type WeatherError = { ok: false; error: ErrorBody };

/** Canonical response type — discriminated on `ok`. */
export type WeatherApiResponse = WeatherResult | WeatherError;

/** Re-export so UI components have a single import for shared types. */
export type { ErrorCode, ErrorBody, SuccessBody };

export interface SearchWeatherOptions {
  /**
   * Optional AbortSignal. When the signal fires, the in-flight request is
   * cancelled and `searchWeather` rejects with an `AbortError`-shaped error.
   * Callers should detect aborts via `isAbortError(err)` and silently drop
   * the result — that's the contract for stale-response handling.
   */
  signal?: AbortSignal;
}

/**
 * Centralised error-code → user-message map. The server already includes a
 * `message` for every error response; this is the fallback used when the UI
 * needs to render a code without a server payload (e.g. the empty-input
 * short-circuit). Keeping the mapping here means the UI only imports one
 * module to render an error.
 */
export function messageForCode(code: ErrorCode): string {
  switch (code) {
    case "VALIDATION":
      return MESSAGES.VALIDATION_EMPTY;
    case "NOT_FOUND":
      return MESSAGES.NOT_FOUND;
    case "WEATHER_AUTH_FAILED":
      return MESSAGES.WEATHER_AUTH_FAILED;
    case "WEATHER_UNAVAILABLE":
      return MESSAGES.WEATHER_UNAVAILABLE;
    case "GEOCODER_UNAVAILABLE":
      return MESSAGES.GEOCODER_UNAVAILABLE;
  }
}

/**
 * True when an unknown error came from an aborted fetch. We detect both the
 * standard DOMException name and Node's AbortError shape so the helper works
 * in jsdom, the browser, and SSR.
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown };
  return e.name === "AbortError";
}

/** Build a synthetic VALIDATION error envelope (used by the UI short-circuit). */
export function makeValidationError(message: string): WeatherError {
  return { ok: false, error: { code: "VALIDATION", message } };
}

/**
 * Generic transport-failure envelope. Used when fetch itself fails (network
 * down, DNS failure, JSON parse error). We surface the same canonical
 * "weather data unavailable" message rather than the raw exception text.
 */
function transportFailure(): WeatherError {
  return {
    ok: false,
    error: {
      code: "WEATHER_UNAVAILABLE",
      message: MESSAGES.WEATHER_UNAVAILABLE,
    },
  };
}

/**
 * Call POST /api/weather with the given city.
 *
 * Behaviour:
 *   - Always returns a discriminated `WeatherApiResponse` for any HTTP outcome
 *     (the route handler returns the envelope at every status code).
 *   - If the response body is not parseable JSON or is missing the envelope
 *     shape, returns a synthesised WEATHER_UNAVAILABLE envelope rather than
 *     throwing — so the UI's render path is uniform.
 *   - If the caller cancels via `options.signal`, the underlying fetch is
 *     aborted and this function rejects so the caller can ignore the stale
 *     result. Use `isAbortError(err)` to detect.
 */
export async function searchWeather(
  city: string,
  options: SearchWeatherOptions = {},
): Promise<WeatherApiResponse> {
  let response: Response;
  try {
    response = await fetch("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ city }),
      signal: options.signal,
      // Keep the request a credentialed same-origin call; the API doesn't use
      // cookies today but this prevents a future auth toggle from silently
      // breaking the UI.
      credentials: "same-origin",
    });
  } catch (err) {
    // Re-throw aborts so callers can ignore them; everything else collapses
    // into a generic transport failure.
    if (isAbortError(err)) throw err;
    return transportFailure();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return transportFailure();
  }

  if (isWeatherApiResponse(payload)) {
    return payload;
  }
  return transportFailure();
}

/** Type guard for the discriminated envelope. */
function isWeatherApiResponse(value: unknown): value is ApiResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as { ok?: unknown };
  if (v.ok === true) {
    return "data" in (value as object);
  }
  if (v.ok === false) {
    const e = (value as { error?: unknown }).error;
    return !!e && typeof e === "object" && "code" in (e as object) && "message" in (e as object);
  }
  return false;
}
