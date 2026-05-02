/**
 * WeatherClient — wraps the OpenWeatherMap Current Weather API
 * (https://openweathermap.org/current).
 *
 * Returns °C from the upstream (`units=metric`); the caller is responsible
 * for the °F conversion so the rounding rule from the Surface contract is
 * applied in exactly one place.
 *
 * Status semantics:
 *   - "ok": valid weather data returned
 *   - "auth_failed": upstream 401 OR 403 (per the Surface contract these
 *     map to the SAME user message — but we keep them as one status here
 *     so the route handler can still report the cause to the error log).
 *   - "unavailable": timeout, network error, 4xx other than 401/403, 5xx,
 *     malformed response.
 */

import { logger } from "../logger";

export interface WeatherSnapshot {
  /** Temperature in Celsius (as reported by the upstream when units=metric). */
  tempC: number;
  /** Short conditions description, e.g. "Partly cloudy". */
  description: string;
  /** Relative humidity in percent (0–100). */
  humidity: number;
  /** Wind speed in m/s. */
  windSpeed: number;
}

export type WeatherResult =
  | { status: "ok"; weather: WeatherSnapshot }
  | {
      status: "auth_failed";
      upstreamStatus: 401 | 403;
      upstreamMessage?: string;
    }
  | {
      status: "unavailable";
      upstreamStatus?: number;
      upstreamMessage?: string;
    };

export interface WeatherClientOptions {
  apiKey: string;
  /** Defaults to https://api.openweathermap.org/data/2.5 */
  baseUrl?: string;
  /** Defaults to 1500ms. */
  timeoutMs?: number;
  /** Override for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Shape of the OWM current-weather response (only fields we read). */
interface OwmWeatherResponse {
  weather?: Array<{ description?: unknown }>;
  main?: { temp?: unknown; humidity?: unknown };
  wind?: { speed?: unknown };
}

const DEFAULT_BASE_URL = "https://api.openweathermap.org/data/2.5";
const DEFAULT_TIMEOUT_MS = 1500;

export class WeatherClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WeatherClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async fetchCurrent(latitude: number, longitude: number): Promise<WeatherResult> {
    const url = new URL(`${this.baseUrl}/weather`);
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("units", "metric");
    url.searchParams.set("appid", this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const res = await this.fetchImpl(url.toString(), {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        const body = await safeReadText(res);
        return {
          status: "auth_failed",
          upstreamStatus: res.status,
          upstreamMessage: body,
        };
      }

      if (!res.ok) {
        const body = await safeReadText(res);
        return {
          status: "unavailable",
          upstreamStatus: res.status,
          upstreamMessage: body,
        };
      }

      const json = (await res.json()) as OwmWeatherResponse;
      const tempC = numberOrNull(json.main?.temp);
      const humidity = numberOrNull(json.main?.humidity);
      const windSpeed = numberOrNull(json.wind?.speed);
      const description =
        typeof json.weather?.[0]?.description === "string"
          ? capitalizeFirst(json.weather[0].description)
          : "";

      if (
        tempC === null ||
        humidity === null ||
        windSpeed === null ||
        !description
      ) {
        return {
          status: "unavailable",
          upstreamStatus: res.status,
          upstreamMessage: "malformed upstream response",
        };
      }

      return {
        status: "ok",
        weather: { tempC, description, humidity, windSpeed },
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      logger.warn({
        event: aborted ? "weather.timeout" : "weather.network_error",
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

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

/** "partly cloudy" → "Partly cloudy". OWM returns lowercased descriptions. */
function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
