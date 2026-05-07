# Pipeline Task Decomposition

## Summary
City Weather Search is an anonymous, single-page weather lookup tool. A user types a city name, submits the form, and the app resolves the location via a geocoding service and renders current weather (temperature in °C and °F, conditions description, humidity %, wind speed) for the top match, including the resolved location string so the user can verify ambiguity (e.g. "Springfield, Illinois, US"). The system must validate input (non-empty, ≤100 chars, sanitized against script/SQL injection), surface friendly messages for not-found / ambiguous / upstream-failure cases, never leak raw upstream errors, log failures server-side, and render results within 2000ms p95.

## Surface contract
**Routes / endpoints**
- `GET /` — single-page weather search UI (search form + results region).
- `POST /api/weather` — request body `{ "city": string }`; success response `{ location: { name, region, country, displayName }, temperatureC: number, temperatureF: number, conditions: string, humidity: number, windSpeed: number }`; error response `{ error: { code: "VALIDATION" | "NOT_FOUND" | "GEOCODER_UNAVAILABLE" | "WEATHER_UNAVAILABLE" | "SERVICE_UNAVAILABLE", message: string } }` with HTTP 400 / 404 / 502 / 503 as appropriate.

**Screens / UI states (single page)**
- Idle (form only).
- Submitting / loading.
- Result rendered (weather card with resolved location header).
- Validation error inline ("Please enter a city name", "City name is too long", "Invalid characters in city name").
- Not-found state ("City not found — please check the spelling and try again").
- Geocoder-down state ("Location lookup is temporarily unavailable — please try again later").
- Weather-down state ("Weather data is temporarily unavailable — please try again later").
- Generic upstream-auth state ("Weather service is temporarily unavailable").

**Entities / domain objects**
- `WeatherQuery { city: string }` — validated request.
- `ResolvedLocation { name, region, country, displayName, lat, lon }` — geocoder output.
- `CurrentWeather { temperatureC, temperatureF, conditions, humidity, windSpeed }` — weather provider output.
- `UpstreamErrorLog { id, occurredAt, source: "geocoder" | "weather", upstreamStatus, upstreamMessage, requestCity }` — server-side log record.

**Error-message contract (verbatim, used by UI and tests)**
- `Please enter a city name`
- `City not found — please check the spelling and try again`
- `Weather service is temporarily unavailable` (upstream 401 / 403)
- `Weather data is temporarily unavailable — please try again later` (weather provider unreachable / timeout)
- `Location lookup is temporarily unavailable — please try again later` (geocoder unreachable / timeout)

**NFR**
- p95 end-to-end render ≤ 2000ms under healthy upstream conditions.
- Geocoder + weather upstream calls must each have a bounded timeout (target ≤ 1500ms each, configurable).
- No raw upstream payload, status code, or message may reach the client.

## db_agent tasks
- [ ] Create migration adding `upstream_error_log` table with columns `id` (pk), `occurred_at` (timestamp, default now), `source` (enum / check constraint: `geocoder` | `weather`), `upstream_status` (int nullable), `upstream_message` (text nullable, truncated to 1KB), `request_city` (varchar(100) nullable) — supports the "logs the error server-side" requirement for the geocoder-unavailable and weather-unavailable scenarios.
- [ ] Add index on `upstream_error_log(occurred_at)` and `upstream_error_log(source, occurred_at)` so operators can quickly inspect recent failures per upstream.
- [ ] Provide a thin DB access module (e.g. `db/upstreamErrorLog.{ts,py}`) exposing `insertUpstreamError(record)` only — no read endpoints are in scope for this spec.
- [ ] Document in the migration header that no user, session, or search-history tables are created (anonymous, stateless feature) so backend_agent does not assume persistence beyond the error log.

## backend_agent tasks
- [ ] Implement `POST /api/weather` handler that accepts `{ city: string }` JSON body and returns the success / error envelope defined in the Surface contract.
- [ ] Implement input validation middleware: reject empty / whitespace-only city → `VALIDATION` "Please enter a city name"; reject length > 100 → `VALIDATION` "City name is too long"; reject inputs containing `<`, `>`, `script` tag fragments, or SQL meta-sequences (`;--`, `' OR `, etc.) → `VALIDATION` "Invalid characters in city name". Validation must run before any upstream call.
- [ ] Build a `GeocoderClient` wrapping the chosen geocoding API with a configurable timeout (default 1500ms), an AbortController/cancellation, and structured result `{ status: "ok" | "not_found" | "unavailable", location? }`. Take only the top match for ambiguous results and include full `displayName` (e.g. "Springfield, Illinois, US").
- [ ] Build a `WeatherClient` wrapping the chosen weather provider with the same timeout pattern, returning `{ status: "ok" | "auth_failed" | "unavailable", weather? }`. Auth_failed must cover both upstream 401 and 403.
- [ ] Wire the orchestration in the route handler: validate → geocode → fetch weather → compute °F from °C (`F = C * 9/5 + 32`, rounded to 1 decimal) → respond. Map outcomes to the error-code / HTTP-status / user-message table in the Surface contract.
- [ ] Ensure no upstream status code, body, or stack trace appears in the response sent to the client; only the canonical messages from the Surface contract may be returned.
- [ ] Call `insertUpstreamError(...)` from db_agent whenever a geocoder or weather upstream returns a non-OK / timeout / network error, capturing the request city (post-validation) and the upstream status.
- [ ] Read upstream API keys from environment variables (e.g. `GEOCODER_API_KEY`, `WEATHER_API_KEY`); never log them.
- [ ] Add a structured server-side logger call (info on success, warn on validation rejection, error on upstream failure) so operators can correlate with the error log table.

## ui_agent tasks
- [ ] Build the search page (single route `/`) with a heading, a `<form>` containing a labelled `City` text input (maxlength=100), a Submit button, and a results region with `aria-live="polite"`.
- [ ] Implement the weather result card component displaying: resolved location displayName as the card header, temperature shown as `<°C value> °C / <°F value> °F`, conditions description, humidity %, and wind speed with units.
- [ ] Implement loading state (spinner or skeleton) shown between submit and response, and ensure the submit button is disabled while in flight.
- [ ] Implement inline validation messaging slot under the city input that renders the exact strings from the Surface contract for empty / too-long / invalid-character cases.
- [ ] Implement the error banner / message slot that renders the exact strings from the Surface contract for `NOT_FOUND`, `GEOCODER_UNAVAILABLE`, `WEATHER_UNAVAILABLE`, and `SERVICE_UNAVAILABLE` error codes.
- [ ] Ensure the UI never renders raw error payloads or stack traces — only the canonical messages mapped from the error code returned by the backend.
- [ ] Add minimal styling so the result card and error states are visually distinct and the page is usable on mobile widths.

## service_agent tasks
- [ ] Create a typed API client module (e.g. `services/weatherApi.{ts,py}`) exporting `searchWeather(city: string): Promise<WeatherResult | WeatherError>` that calls `POST /api/weather` and returns a discriminated union matching the Surface contract envelope.
- [ ] Define shared TypeScript / dataclass types for `WeatherResult`, `WeatherError`, and the `error.code` literal union, and re-use them across UI components so error-code → message mapping is centralised.
- [ ] Implement the form-submit handler in the UI page that: calls `searchWeather`, manages `idle | loading | success | error` view state, and routes `error.code` to the correct UI slot (validation slot vs. error banner).
- [ ] Implement client-side empty-string short-circuit so a blank submit shows "Please enter a city name" without issuing the network request, matching the "does not call any external API" expectation.
- [ ] Ensure the client aborts / ignores stale responses if the user submits a new search before the prior one resolves (prevents flicker and matches the p95 NFR by avoiding wasted renders).

## tester tasks
- [ ] End-to-end happy path: submit "London", assert °C and °F both visible, conditions / humidity / wind speed all rendered, resolved location displayed.
- [ ] Validation: submit empty string → assert "Please enter a city name" inline and assert no network request to `/api/weather` was made.
- [ ] Not-found: stub geocoder to return zero matches for "Xyzzyville" → assert "City not found — please check the spelling and try again" and no weather card rendered.
- [ ] Ambiguous: stub geocoder to return multiple matches for "Springfield" with top match Illinois → assert weather card header shows "Springfield, Illinois, US".
- [ ] Malicious / oversized input: submit `<script>alert(1)</script>`, `'; DROP TABLE users;--`, and a 101-character string → assert each is rejected client- or server-side with a validation error and that no upstream geocoder/weather call is observed.
- [ ] Upstream 401: stub weather provider to return 401 → assert UI shows "Weather service is temporarily unavailable" and that the response body contains no upstream status code or raw message.
- [ ] Upstream 403: stub weather provider to return 403 → assert same canonical message and same no-leak guarantee.
- [ ] Weather provider timeout / network error: stub weather provider to hang past timeout → assert "Weather data is temporarily unavailable — please try again later" and that an `upstream_error_log` row was inserted with `source = 'weather'`.
- [ ] Geocoder timeout / network error: stub geocoder to hang past timeout → assert "Location lookup is temporarily unavailable — please try again later" and that an `upstream_error_log` row was inserted with `source = 'geocoder'`.
- [ ] NFR check: with both upstreams stubbed to respond in <300ms, run 50 sequential `/api/weather` requests and assert p95 end-to-end (request submit → result rendered) ≤ 2000ms.

## Open questions
- Persistence beyond error logging is not specified — should successful weather lookups be cached to help meet the p95 NFR, and if so, with what TTL? Decision needed before db_agent / backend_agent can add a cache layer.
- The spec does not name a specific geocoding provider or weather data provider — backend_agent will need a chosen provider (e.g. Open-Meteo + its geocoder, OpenWeather, etc.) and corresponding API-key environment variable names.
- Localisation / units: the spec mandates °C and °F together but does not specify wind-speed units (m/s vs. km/h vs. mph) or humidity precision — backend_agent will need to pick defaults; tester assertions should match.
- "Logs the error server-side" — is database logging sufficient, or is a structured stdout/file logger also required for ops tooling? Current plan does both; confirm if only one is wanted.
- Rate limiting / abuse protection for the anonymous endpoint is not specified; if required it would add tasks to backend_agent.
- Accessibility scope (keyboard nav, screen-reader labels beyond `aria-live`) is not specified; ui_agent has assumed minimum-viable accessibility only.
