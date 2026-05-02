/**
 * POST /api/weather
 *
 * Request body:  { city: string }
 * Response:      see `src/lib/contract.ts` (`ApiResponse`)
 *
 * Pipeline:
 *   1. Validate the input. Reject before any upstream call.
 *   2. Geocode (1 result, top match).
 *   3. Fetch current weather for the resolved coordinates.
 *   4. Convert °C → °F using the Surface contract formula.
 *   5. Map outcomes to the `(error code, http status, user message)` table.
 *
 * Invariants:
 *   - The client only ever sees a message from `MESSAGES` in `contract.ts`.
 *     No upstream status codes, body fragments, or stack traces leak.
 *   - API keys are read from env each request and are never logged.
 *   - All upstream failures (timeout, network, non-OK status) call
 *     `insertUpstreamError(...)` with the post-validation city.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  ApiResponse,
  ErrorCode,
  HTTP_STATUS,
  MESSAGES,
  celsiusToFahrenheit,
} from "@/lib/contract";
import { validateCity } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { GeocoderClient } from "@/lib/clients/geocoder";
import { WeatherClient } from "@/lib/clients/weather";
import { insertUpstreamError } from "@/lib/db/upstreamErrorLog";

// Force the Node.js runtime so `@prisma/client` works (the Edge runtime
// can't load native Prisma engines).
export const runtime = "nodejs";
// This endpoint is per-request and depends on env / live upstream calls;
// never cache it at the framework level.
export const dynamic = "force-dynamic";

function jsonResponse(body: ApiResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function errorResponse(code: ErrorCode, message: string): NextResponse {
  return jsonResponse({ ok: false, error: { code, message } }, HTTP_STATUS[code]);
}

interface UpstreamConfig {
  geocoderApiKey: string;
  weatherApiKey: string;
  geocoderBaseUrl?: string;
  weatherBaseUrl?: string;
  geocoderTimeoutMs: number;
  weatherTimeoutMs: number;
}

function readUpstreamConfig(): UpstreamConfig | null {
  const geocoderApiKey = process.env.GEOCODER_API_KEY ?? "";
  const weatherApiKey = process.env.WEATHER_API_KEY ?? "";
  if (!geocoderApiKey || !weatherApiKey) return null;

  return {
    geocoderApiKey,
    weatherApiKey,
    geocoderBaseUrl: process.env.GEOCODER_BASE_URL,
    weatherBaseUrl: process.env.WEATHER_BASE_URL,
    geocoderTimeoutMs: parseTimeout(process.env.GEOCODER_TIMEOUT_MS, 1500),
    weatherTimeoutMs: parseTimeout(process.env.WEATHER_TIMEOUT_MS, 1500),
  };
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  // --- 1. Parse JSON body ---------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // A malformed body is a client error and should not leak parse details.
    logger.warn({ event: "weather.bad_json" });
    return errorResponse("VALIDATION", MESSAGES.VALIDATION_EMPTY);
  }

  const rawCity =
    body && typeof body === "object" && "city" in body
      ? (body as { city: unknown }).city
      : undefined;

  // --- 2. Validate ----------------------------------------------------------
  const validation = validateCity(rawCity);
  if (!validation.ok) {
    logger.warn({
      event: "weather.validation_rejected",
      msg: validation.message,
    });
    return errorResponse("VALIDATION", validation.message);
  }
  const city = validation.city;

  // --- 3. Read upstream config ---------------------------------------------
  // Treat a missing API key on our side as "weather service unavailable".
  // The user-facing surface is the same as upstream 401/403, so we report
  // the same canonical message — but log a clearly different event so
  // operators can tell config drift from real upstream auth failures.
  const config = readUpstreamConfig();
  if (!config) {
    logger.error({
      event: "weather.config_missing",
      msg: "GEOCODER_API_KEY or WEATHER_API_KEY is not set",
    });
    return errorResponse("WEATHER_AUTH_FAILED", MESSAGES.WEATHER_AUTH_FAILED);
  }

  // --- 4. Geocode -----------------------------------------------------------
  const geocoder = new GeocoderClient({
    apiKey: config.geocoderApiKey,
    baseUrl: config.geocoderBaseUrl,
    timeoutMs: config.geocoderTimeoutMs,
  });
  const geo = await geocoder.geocode(city);

  if (geo.status === "unavailable") {
    logger.error({
      event: "weather.geocoder_unavailable",
      source: "GEOCODER",
      city,
      upstreamStatus: geo.upstreamStatus,
    });
    await insertUpstreamError({
      source: "GEOCODER",
      upstreamStatus: geo.upstreamStatus,
      upstreamMessage: geo.upstreamMessage,
      requestCity: city,
    });
    return errorResponse(
      "GEOCODER_UNAVAILABLE",
      MESSAGES.GEOCODER_UNAVAILABLE,
    );
  }

  if (geo.status === "not_found") {
    logger.info({ event: "weather.not_found", city });
    return errorResponse("NOT_FOUND", MESSAGES.NOT_FOUND);
  }

  // --- 5. Fetch weather ----------------------------------------------------
  const weatherClient = new WeatherClient({
    apiKey: config.weatherApiKey,
    baseUrl: config.weatherBaseUrl,
    timeoutMs: config.weatherTimeoutMs,
  });
  const wx = await weatherClient.fetchCurrent(
    geo.location.latitude,
    geo.location.longitude,
  );

  if (wx.status === "auth_failed") {
    logger.error({
      event: "weather.auth_failed",
      source: "WEATHER",
      city,
      upstreamStatus: wx.upstreamStatus,
    });
    await insertUpstreamError({
      source: "WEATHER",
      upstreamStatus: wx.upstreamStatus,
      upstreamMessage: wx.upstreamMessage,
      requestCity: city,
    });
    return errorResponse(
      "WEATHER_AUTH_FAILED",
      MESSAGES.WEATHER_AUTH_FAILED,
    );
  }

  if (wx.status === "unavailable") {
    logger.error({
      event: "weather.weather_unavailable",
      source: "WEATHER",
      city,
      upstreamStatus: wx.upstreamStatus,
    });
    await insertUpstreamError({
      source: "WEATHER",
      upstreamStatus: wx.upstreamStatus,
      upstreamMessage: wx.upstreamMessage,
      requestCity: city,
    });
    return errorResponse(
      "WEATHER_UNAVAILABLE",
      MESSAGES.WEATHER_UNAVAILABLE,
    );
  }

  // --- 6. Compose successful response --------------------------------------
  const tempF = celsiusToFahrenheit(wx.weather.tempC);
  const latencyMs = Date.now() - startedAt;

  logger.info({
    event: "weather.success",
    city,
    resolvedTo: geo.location.displayName,
    latencyMs,
  });

  return jsonResponse(
    {
      ok: true,
      data: {
        location: geo.location,
        weather: {
          tempC: wx.weather.tempC,
          tempF,
          description: wx.weather.description,
          humidity: wx.weather.humidity,
          windSpeed: wx.weather.windSpeed,
        },
      },
    },
    200,
  );
}

/**
 * Method-not-allowed handler. We keep this explicit so the response is a
 * clean JSON envelope rather than Next's default 405 HTML.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "POST a JSON body with a `city` field.",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
