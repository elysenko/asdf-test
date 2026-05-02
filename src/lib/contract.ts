/**
 * Surface contract for POST /api/weather.
 *
 * This is the canonical mapping between internal failure modes, the public
 * error code, the HTTP status returned to the client, and the user-facing
 * message. The route handler MUST return only these messages to the client —
 * upstream status codes, response bodies, and stack traces never leak.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "WEATHER_AUTH_FAILED"
  | "WEATHER_UNAVAILABLE"
  | "GEOCODER_UNAVAILABLE";

export interface ErrorBody {
  code: ErrorCode;
  message: string;
}

export interface SuccessBody {
  location: {
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
  };
  weather: {
    /** Temperature in Celsius (as reported by the upstream). */
    tempC: number;
    /** Temperature in Fahrenheit, computed as `tempC * 9/5 + 32`, 1 decimal. */
    tempF: number;
    /** Short conditions description, e.g. "Partly cloudy". */
    description: string;
    /** Relative humidity in percent (0–100). */
    humidity: number;
    /** Wind speed in m/s as reported by the upstream. */
    windSpeed: number;
  };
}

export type ApiResponse =
  | { ok: true; data: SuccessBody }
  | { ok: false; error: ErrorBody };

/**
 * Canonical user-facing messages. Each message is sourced from the technical
 * plan / Surface contract; do not edit without updating the corresponding
 * scenario in the plan.
 */
export const MESSAGES = {
  VALIDATION_EMPTY: "Please enter a city name",
  VALIDATION_TOO_LONG: "City name is too long",
  VALIDATION_INVALID_CHARS: "Invalid characters in city name",
  NOT_FOUND: "City not found — please check the spelling and try again",
  WEATHER_AUTH_FAILED: "Weather service is temporarily unavailable",
  WEATHER_UNAVAILABLE:
    "Weather data is temporarily unavailable — please try again later",
  GEOCODER_UNAVAILABLE:
    "Location lookup is temporarily unavailable — please try again later",
} as const;

/**
 * HTTP status codes for each error code, per the Surface contract.
 * - 400 for validation
 * - 404 for unknown city
 * - 503 for any upstream unavailability (auth-failed, timeout, network, 5xx)
 */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  WEATHER_AUTH_FAILED: 503,
  WEATHER_UNAVAILABLE: 503,
  GEOCODER_UNAVAILABLE: 503,
};

/** Convert Celsius to Fahrenheit, rounded to one decimal place. */
export function celsiusToFahrenheit(c: number): number {
  const f = (c * 9) / 5 + 32;
  return Math.round(f * 10) / 10;
}
