## Requirement: City Weather Search

### Scenario: Happy path — valid city search
GIVEN an anonymous user on the weather app
WHEN they enter a valid city name (e.g. "London") and submit the search
THEN the app displays current weather for that city including temperature in both °C and °F, a conditions description (e.g. "Partly cloudy"), humidity percentage, and wind speed

### Scenario: Empty search input
GIVEN an anonymous user on the weather app
WHEN they submit the search form with an empty city name field
THEN the app displays a validation message "Please enter a city name" and does not call any external API

### Scenario: City name not found
GIVEN an anonymous user on the weather app
WHEN they enter a city name that cannot be geocoded (e.g. "Xyzzyville")
THEN the app displays "City not found — please check the spelling and try again" and shows no weather data

### Scenario: Ambiguous city name
GIVEN an anonymous user on the weather app
WHEN they enter a city name that matches multiple locations (e.g. "Springfield")
THEN the app displays weather for the top geocoded match and shows the full resolved location (e.g. "Springfield, Illinois, US") so the user can confirm the correct city

### Scenario: Malicious or oversized input
GIVEN an anonymous user on the weather app
WHEN they submit a city name containing script tags, SQL-injection strings, or a string exceeding 100 characters
THEN the app rejects the input with a validation error and does not forward the input to any external API

### Scenario: Invalid or expired API key (upstream 401)
GIVEN the weather data provider API key is missing or invalid
WHEN a user submits a city search
THEN the upstream API returns 401 Unauthorized, and the user sees "Weather service is temporarily unavailable" — the raw upstream error is not exposed to the client

### Scenario: API account over plan quota (upstream 403)
GIVEN the weather data provider account has exceeded its usage quota
WHEN a user submits a city search
THEN the upstream API returns 403 Forbidden, and the user sees "Weather service is temporarily unavailable" — the raw upstream error is not exposed to the client

### Scenario: Weather API unavailable or timed out
GIVEN the weather data provider is unreachable or does not respond within the timeout window
WHEN a user submits a city search
THEN the app displays "Weather data is temporarily unavailable — please try again later" and logs the error server-side

### Scenario: Geocoding API unavailable or timed out
GIVEN the geocoding service is unreachable or does not respond within the timeout window
WHEN a user submits a city search
THEN the app displays "Location lookup is temporarily unavailable — please try again later" and logs the error server-side

@nfr
### Scenario: End-to-end search response time
GIVEN normal load conditions and both external APIs are healthy
WHEN a user submits a valid city name search
THEN weather data is rendered on screen within 2000ms at p95
