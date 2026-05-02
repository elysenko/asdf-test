/**
 * GeocoderClient — wraps the OpenWeatherMap Geocoding API
 * (https://openweathermap.org/api/geocoding-api).
 *
 * Responsibilities:
 *   - issue a GET to `/direct?q=<city>&limit=1&appid=<key>`
 *   - cancel via AbortController if the configured timeout elapses
 *   - normalize the response into a structured `{ status, location? }` shape
 *   - never let the upstream status / body / stack reach the route handler
 *     in a form that could be returned to the client
 *
 * The route handler is the only place that decides what message the user
 * sees. This module only reports *what happened* upstream.
 */

import { logger } from "../logger";

export interface GeocoderLocation {
  /** Full resolved location, e.g. "Springfield, Illinois, US". */
  displayName: string;
  /** ISO country code (two-letter, uppercase). */
  country: string;
  /** Optional state / region / admin1 (when reported by the geocoder). */
  state?: string;
  /** Resolved city name as returned by the geocoder. */
  name: string;
  latitude: number;
  longitude: number;
}

export type GeocoderResult =
  | { status: "ok"; location: GeocoderLocation }
  | { status: "not_found" }
  | {
      status: "unavailable";
      /** HTTP status from the upstream, if one was received. */
      upstreamStatus?: number;
      /** Optional upstream body / error message — for logging only. */
      upstreamMessage?: string;
    };

export interface GeocoderClientOptions {
  apiKey: string;
  /** Defaults to https://api.openweathermap.org/geo/1.0 */
  baseUrl?: string;
  /** Defaults to 1500ms. */
  timeoutMs?: number;
  /** Override for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape of a single result from the OWM geocoding API. */
interface OwmGeoResponseItem {
  name?: unknown;
  local_names?: unknown;
  lat?: unknown;
  lon?: unknown;
  country?: unknown;
  state?: unknown;
}

const DEFAULT_BASE_URL = "https://api.openweathermap.org/geo/1.0";
const DEFAULT_TIMEOUT_MS = 1500;

export class GeocoderClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GeocoderClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async geocode(city: string): Promise<GeocoderResult> {
    const url = new URL(`${this.baseUrl}/direct`);
    url.searchParams.set("q", city);
    // Per the spec: take only the top match for ambiguous results.
    url.searchParams.set("limit", "1");
    url.searchParams.set("appid", this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const res = await this.fetchImpl(url.toString(), {
        method: "GET",
        signal: controller.signal,
        // Geocoding rarely changes; a stale lookup is fine.
        cache: "no-store",
      });

      // Auth failure on the geocoder is treated as "unavailable" — same as
      // any other upstream error from the geocoder. The Surface contract
      // only distinguishes auth_failed for the *weather* upstream.
      if (!res.ok) {
        const body = await safeReadText(res);
        return {
          status: "unavailable",
          upstreamStatus: res.status,
          upstreamMessage: body,
        };
      }

      const json: unknown = await res.json();
      if (!Array.isArray(json) || json.length === 0) {
        return { status: "not_found" };
      }

      const top = json[0] as OwmGeoResponseItem;
      const lat = numberOrNull(top.lat);
      const lon = numberOrNull(top.lon);
      const name = typeof top.name === "string" ? top.name : "";
      const country = typeof top.country === "string" ? top.country : "";
      const state = typeof top.state === "string" ? top.state : undefined;

      if (lat === null || lon === null || !name || !country) {
        // Malformed top match — treat as not_found rather than crashing.
        // The geocoder occasionally returns rows without lat/lon for
        // ambiguous queries.
        return { status: "not_found" };
      }

      const displayName = formatDisplayName(name, state, country);

      return {
        status: "ok",
        location: { displayName, country, state, name, latitude: lat, longitude: lon },
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      logger.warn({
        event: aborted ? "geocoder.timeout" : "geocoder.network_error",
        latencyMs: Date.now() - startedAt,
        msg: err instanceof Error ? err.message : "unknown error",
      });
      return { status: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Try to read the body as text; never throw. */
async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

/** Build "Name, State, Country" or "Name, Country" if no state. */
function formatDisplayName(
  name: string,
  state: string | undefined,
  country: string,
): string {
  return state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
}
