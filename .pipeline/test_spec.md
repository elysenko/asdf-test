# Test Specification

> **Warning:** `.pipeline/surface.json` was not found. The API and UI surface
> below was derived from the "Surface contract" section of `.pipeline/tasks.md`
> and the scenarios in `requirements/spec.md`. If `surface.json` is later
> generated, this spec should be reconciled against it.

## Coverage summary
- Total cases: 38
- API endpoints covered: 2 / 2 (derived from tasks.md surface contract)
- User journeys covered: 6

---

## API tests

### `GET /`
- **Happy path**:
  - Request: `GET /` with `Accept: text/html`.
  - Expected: HTTP 200, `Content-Type: text/html`, response body contains a `<form>` element with an input labelled "City" (or `name="city"`), a submit control, and a results region with `aria-live="polite"`.
- **Validation failures**: N/A — route accepts no input.
- **Auth failures**: N/A — anonymous endpoint.
- **Idempotency / edge cases**:
  - Multiple consecutive `GET /` requests return identical 200 responses (idempotent, stateless).
  - `GET /` with `Accept: application/json` still returns the HTML page (single-page app fallback).

### `POST /api/weather`

- **Happy path — valid city ("London")**:
  - Request body: `{ "city": "London" }` with geocoder + weather upstreams stubbed healthy.
  - Expected: HTTP 200, JSON body matching the shape
    `{ location: { name: string, region: string|null, country: string, displayName: string }, temperatureC: number, temperatureF: number, conditions: string, humidity: number, windSpeed: number }`.
  - `temperatureF` MUST equal `round(temperatureC * 9/5 + 32, 1)`.
  - No `error` key present in the response body.

- **Happy path — ambiguous city ("Springfield")**:
  - Request body: `{ "city": "Springfield" }` with geocoder stubbed to return multiple matches whose top match is `Springfield, Illinois, US`.
  - Expected: HTTP 200, `location.displayName == "Springfield, Illinois, US"`, weather payload populated from the top match's lat/lon.

- **Validation failures**:
  - Empty string — `{ "city": "" }` → HTTP 400, body `{ error: { code: "VALIDATION", message: "Please enter a city name" } }`. NO outbound geocoder or weather upstream call is made (assert via stub-call counter).
  - Whitespace-only — `{ "city": "   " }` → same as empty.
  - Missing field — `{}` → HTTP 400, `error.code == "VALIDATION"`.
  - Non-string field — `{ "city": 123 }` → HTTP 400, `error.code == "VALIDATION"`.
  - Length > 100 — `{ "city": "A".repeat(101) }` → HTTP 400, `error.code == "VALIDATION"`, `message == "City name is too long"`. No upstream call.
  - Length == 100 — boundary, accepted (proceeds to upstream).
  - Script tag — `{ "city": "<script>alert(1)</script>" }` → HTTP 400, `error.code == "VALIDATION"`, `message == "Invalid characters in city name"`. No upstream call.
  - SQL meta — `{ "city": "'; DROP TABLE users;--" }` → HTTP 400, `error.code == "VALIDATION"`, `message == "Invalid characters in city name"`. No upstream call.
  - SQL meta — `{ "city": "London' OR 1=1" }` → HTTP 400, `error.code == "VALIDATION"`. No upstream call.
  - Angle-bracket only — `{ "city": "London<>" }` → HTTP 400, `error.code == "VALIDATION"`.

- **Not-found**:
  - Geocoder stubbed to return zero matches for `{ "city": "Xyzzyville" }`.
  - Expected: HTTP 404, `{ error: { code: "NOT_FOUND", message: "City not found — please check the spelling and try again" } }`. Weather upstream is NOT called.

- **Auth failures (no client auth required, but upstream auth is exercised here)**:
  - Weather provider returns 401 → response: HTTP 502 (or 503 — see edge cases), `{ error: { code: "SERVICE_UNAVAILABLE", message: "Weather service is temporarily unavailable" } }`. Response body does NOT contain `401`, the upstream provider's name, or any upstream message text (assert by full-body substring scan).
  - Weather provider returns 403 → identical canonical response and identical no-leak guarantee.

- **Upstream unavailability / timeout**:
  - Weather provider hangs past the configured timeout (~1500ms) → HTTP 503, `{ error: { code: "WEATHER_UNAVAILABLE", message: "Weather data is temporarily unavailable — please try again later" } }`. An `upstream_error_log` row is inserted with `source = "weather"` and `request_city` equal to the post-validation city.
  - Weather provider returns network error (ECONNREFUSED) → same canonical response + same log insert.
  - Weather provider returns 5xx → same canonical response + same log insert.
  - Geocoder hangs past timeout → HTTP 503, `{ error: { code: "GEOCODER_UNAVAILABLE", message: "Location lookup is temporarily unavailable — please try again later" } }`. An `upstream_error_log` row is inserted with `source = "geocoder"`. Weather upstream is NOT called.
  - Geocoder returns network error → same canonical response + same log insert.
  - Geocoder returns 5xx → same canonical response + same log insert.

- **Idempotency / edge cases**:
  - Two identical `POST /api/weather` requests with the same valid city return structurally identical success bodies (allowing for upstream value drift in stubs: with the same stub fixture, bodies are byte-equal modulo timestamp fields if any).
  - `Content-Type` other than `application/json` (e.g. `text/plain`) → HTTP 400 or 415; no upstream call.
  - Malformed JSON body → HTTP 400, `error.code == "VALIDATION"`; no upstream call.
  - Leading/trailing whitespace in a valid city (`"  London  "`) is trimmed before validation and forwarded as `"London"` to the geocoder.
  - Response NEVER contains keys named `stack`, `upstreamStatus`, `upstreamMessage`, `provider`, or any non-canonical message string (assert via JSON-key walk + message-allowlist check).
  - Upstream API keys (`GEOCODER_API_KEY`, `WEATHER_API_KEY`) never appear in response body or in the server log lines emitted for the request.

---

## UI / journey tests

### Journey: Successful weather lookup (happy path)
- **Steps**:
  1. Navigate to `/`.
  2. Type `London` into the city input.
  3. Click Submit.
- **Expected outcomes**:
  - Submit button becomes disabled and a loading indicator (spinner or skeleton) appears in the results region while the request is in flight.
  - On response, the result card renders:
    - Header text equal to the resolved `location.displayName` (e.g. `London, England, GB`).
    - Temperature shown as `<°C value> °C / <°F value> °F` (both units visible in the same node).
    - Conditions description string visible (e.g. "Partly cloudy").
    - Humidity percentage visible with `%` suffix.
    - Wind speed visible with units suffix.
  - No error banner or validation message is rendered.
  - URL remains `/` (no navigation).
- **Negative path**: If the API returns a `WEATHER_UNAVAILABLE` mid-journey, the result card is NOT rendered and the error banner shows "Weather data is temporarily unavailable — please try again later".

### Journey: Empty submit
- **Steps**:
  1. Navigate to `/`.
  2. Leave the city input blank (or type only spaces).
  3. Click Submit.
- **Expected outcomes**:
  - Inline validation message under the city input reads exactly `Please enter a city name`.
  - **No** network request is made to `/api/weather` (assert via fetch-spy / network panel — this enforces the client-side short-circuit).
  - Submit button does not enter a loading state.
  - No result card is rendered.
- **Negative path**: N/A — this IS the negative path of the happy journey.

### Journey: Not-found city
- **Steps**:
  1. Navigate to `/`.
  2. Type `Xyzzyville` into the city input (geocoder stubbed to return zero matches).
  3. Click Submit.
- **Expected outcomes**:
  - Loading state shown briefly, then cleared.
  - Error banner shows exactly `City not found — please check the spelling and try again`.
  - No result card is rendered (assert absence of the result-card test id / component).
  - The city input retains its value so the user can edit and retry.
- **Negative path**: After the not-found error, editing the input and submitting a valid city succeeds and replaces the error banner with a result card.

### Journey: Ambiguous city resolves to top match
- **Steps**:
  1. Navigate to `/`.
  2. Type `Springfield` (geocoder stubbed to return multiple matches with `Springfield, Illinois, US` first).
  3. Click Submit.
- **Expected outcomes**:
  - Result card header reads exactly `Springfield, Illinois, US`.
  - Weather body matches the top match's lat/lon weather payload.
  - No disambiguation picker is shown (top-match-only behaviour).
- **Negative path**: If the geocoder returns zero matches instead, the not-found banner is shown (covered above).

### Journey: Malicious / oversized input rejected
- **Steps** (parametrised — run once per input):
  1. Navigate to `/`.
  2. Type the input.
  3. Click Submit.
- **Inputs**:
  - `<script>alert(1)</script>`
  - `'; DROP TABLE users;--`
  - 101-character string (`"A".repeat(101)`)
- **Expected outcomes** (per input):
  - Inline validation message shows the appropriate canonical string (`Invalid characters in city name` for the first two, `City name is too long` for the third).
  - No upstream geocoder or weather call is observed (assert via stub-call counters).
  - The page DOM is inspected after submission: no `<script>` tag injected by the malicious input is present (XSS sanity check on the rendered validation message).
- **Negative path**: N/A — these inputs must always be rejected.

### Journey: Upstream failure messaging
- **Steps** (parametrised — run once per failure mode):
  1. Navigate to `/`.
  2. Type a valid city (e.g. `London`).
  3. Click Submit with the relevant upstream stub configured.
- **Failure modes & expected banner text**:
  - Weather provider 401 → `Weather service is temporarily unavailable`.
  - Weather provider 403 → `Weather service is temporarily unavailable`.
  - Weather provider timeout → `Weather data is temporarily unavailable — please try again later`.
  - Geocoder timeout → `Location lookup is temporarily unavailable — please try again later`.
- **Expected outcomes** (per mode):
  - Loading state clears.
  - Error banner shows the exact canonical string above and only that string.
  - No result card is rendered.
  - The DOM contains no upstream status code, upstream provider name, stack trace, or raw upstream message string.
- **Negative path**: N/A — failure IS the path under test.

### NFR Journey: End-to-end response time under healthy load
- **Steps**:
  1. Configure both geocoder and weather stubs to respond in < 300ms.
  2. Drive 50 sequential happy-path searches (`London`) measuring time from form-submit to result-card render.
- **Expected outcomes**:
  - p95 of the 50 measurements ≤ 2000ms.
  - All 50 responses are successful (no errors, no aborts).
- **Negative path**: If any single response exceeds 2000ms or any request errors out, the NFR test fails with the offending sample(s) reported.

---

## Data integrity tests

- After any `POST /api/weather` that results in a geocoder upstream failure (timeout / network error / 5xx), exactly one new row exists in `upstream_error_log` with:
  - `source == "geocoder"`,
  - `occurred_at` within the test's wall-clock window,
  - `request_city` equal to the post-validation city sent in the request,
  - `upstream_status` either NULL (timeout / network) or the upstream HTTP status code (5xx),
  - `upstream_message` length ≤ 1024 bytes (truncation rule from the migration).
- After any `POST /api/weather` that results in a weather upstream failure (401 / 403 / timeout / network / 5xx), exactly one new row exists in `upstream_error_log` with `source == "weather"` and the same field constraints as above.
- After a successful `POST /api/weather`, NO new row is inserted into `upstream_error_log`.
- After a validation rejection (HTTP 400), NO new row is inserted into `upstream_error_log` (validation never reaches an upstream).
- No table other than `upstream_error_log` is mutated by any `POST /api/weather` request (the feature is stateless beyond error logging — no user, session, or search-history tables exist or are written).
- The `upstream_error_log` rows never contain values from `GEOCODER_API_KEY` or `WEATHER_API_KEY` (assert via substring scan of `upstream_message` for the configured key values).

---

## Out of scope

- **Caching of successful lookups** — the spec is silent on persistence beyond error logging, and `tasks.md` lists this as an open question. No cache-hit / TTL / cache-invalidation tests are specified.
- **Choice of upstream provider** — the spec does not name a geocoder or weather provider; tests stub the upstream interface, not a specific vendor. Provider-specific contract tests are out of scope.
- **Wind-speed unit and humidity precision** — the spec mandates that wind speed and humidity be displayed but does not pin the units (m/s vs. km/h vs. mph) or precision. Tests assert presence and a units suffix only, not a specific unit string.
- **Rate limiting / abuse protection** — not in the spec; no throttling tests.
- **Authentication / accounts / search history** — the feature is anonymous and stateless; no auth tests beyond "no auth header is required".
- **Accessibility beyond `aria-live` on the results region** — `tasks.md` notes accessibility scope is unspecified; full a11y audit (keyboard traps, screen-reader narration, contrast) is not under test here.
- **Localisation / i18n of canonical error strings** — error messages are asserted in English exactly as written in the Surface contract; no locale-switching tests.
- **Observability / metrics emission** — server-side logging is asserted only by the `upstream_error_log` row insertion; structured-logger output format is not asserted.
