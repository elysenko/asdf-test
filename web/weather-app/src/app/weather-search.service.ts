import { Injectable } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/**
 * Canonical error codes returned by the weather backend.
 * The UI maps these to user-facing messages and never displays raw payloads.
 */
export type WeatherErrorCode =
  | 'NOT_FOUND'
  | 'GEOCODER_UNAVAILABLE'
  | 'WEATHER_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';

/**
 * Canonical inline-validation codes raised client-side before any network call.
 */
export type ValidationErrorCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_CHARACTER';

export interface WeatherResult {
  /** Resolved location, e.g. "Springfield, Illinois, US" */
  displayName: string;
  /** Temperature in degrees Celsius (rounded to 0.1) */
  temperatureC: number;
  /** Temperature in degrees Fahrenheit (rounded to 0.1) */
  temperatureF: number;
  /** Conditions description, e.g. "Partly cloudy" */
  conditions: string;
  /** Relative humidity, 0–100 */
  humidity: number;
  /** Wind speed value in the units below */
  windSpeed: number;
  /** Unit string for wind speed, e.g. "km/h" or "mph" */
  windUnit: string;
}

export interface WeatherErrorResponse {
  code: WeatherErrorCode;
}

/** Mapping of error codes to canonical user-facing messages. */
const ERROR_MESSAGES: Record<WeatherErrorCode, string> = {
  NOT_FOUND: 'City not found — please check the spelling and try again',
  GEOCODER_UNAVAILABLE: 'Location lookup is temporarily unavailable — please try again later',
  WEATHER_UNAVAILABLE: 'Weather data is temporarily unavailable — please try again later',
  SERVICE_UNAVAILABLE: 'Weather service is temporarily unavailable',
};

/** Mapping of validation codes to inline messages shown under the input. */
const VALIDATION_MESSAGES: Record<ValidationErrorCode, string> = {
  EMPTY: 'Please enter a city name',
  TOO_LONG: 'City name must be 100 characters or fewer',
  INVALID_CHARACTER: 'City name contains invalid characters',
};

/** Stub data used while the backend is not wired up. */
const MOCK_CITIES: Record<string, WeatherResult> = {
  london: {
    displayName: 'London, England, United Kingdom',
    temperatureC: 14.2,
    temperatureF: 57.6,
    conditions: 'Partly cloudy',
    humidity: 72,
    windSpeed: 13,
    windUnit: 'km/h',
  },
  tokyo: {
    displayName: 'Tokyo, Japan',
    temperatureC: 22.8,
    temperatureF: 73.0,
    conditions: 'Clear sky',
    humidity: 58,
    windSpeed: 9,
    windUnit: 'km/h',
  },
  springfield: {
    displayName: 'Springfield, Illinois, United States',
    temperatureC: 18.5,
    temperatureF: 65.3,
    conditions: 'Light rain',
    humidity: 81,
    windSpeed: 17,
    windUnit: 'km/h',
  },
  paris: {
    displayName: 'Paris, Île-de-France, France',
    temperatureC: 16.7,
    temperatureF: 62.1,
    conditions: 'Overcast',
    humidity: 68,
    windSpeed: 11,
    windUnit: 'km/h',
  },
  'new york': {
    displayName: 'New York, New York, United States',
    temperatureC: 21.4,
    temperatureF: 70.5,
    conditions: 'Sunny',
    humidity: 54,
    windSpeed: 15,
    windUnit: 'km/h',
  },
  sydney: {
    displayName: 'Sydney, New South Wales, Australia',
    temperatureC: 19.1,
    temperatureF: 66.4,
    conditions: 'Showers nearby',
    humidity: 74,
    windSpeed: 22,
    windUnit: 'km/h',
  },
};

/** Reject any character that is clearly outside a city-name vocabulary. */
const INVALID_CHARACTER_PATTERN = /[<>{}\[\]\\\/|`~^*=+@#$%&;]|--/;

@Injectable({ providedIn: 'root' })
export class WeatherSearchService {
  /**
   * Validates a raw city input client-side.
   * Returns a ValidationErrorCode if invalid, or null if it should be sent to the backend.
   */
  validate(raw: string): ValidationErrorCode | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return 'EMPTY';
    }
    if (trimmed.length > 100) {
      return 'TOO_LONG';
    }
    if (INVALID_CHARACTER_PATTERN.test(trimmed)) {
      return 'INVALID_CHARACTER';
    }
    return null;
  }

  validationMessage(code: ValidationErrorCode): string {
    return VALIDATION_MESSAGES[code];
  }

  errorMessage(code: WeatherErrorCode): string {
    return ERROR_MESSAGES[code];
  }

  /**
   * Stubbed lookup — simulates the real backend response shape and timing.
   * Trigger words for testing each error code:
   *   - "weatherdown" → WEATHER_UNAVAILABLE
   *   - "geodown"     → GEOCODER_UNAVAILABLE
   *   - "boom"        → SERVICE_UNAVAILABLE
   *   - any other unknown city → NOT_FOUND
   */
  search(city: string): Observable<WeatherResult> {
    const key = city.trim().toLowerCase();

    return timer(700).pipe(
      switchMap(() => {
        if (key === 'weatherdown') {
          return throwError(() => ({ code: 'WEATHER_UNAVAILABLE' as WeatherErrorCode }));
        }
        if (key === 'geodown') {
          return throwError(() => ({ code: 'GEOCODER_UNAVAILABLE' as WeatherErrorCode }));
        }
        if (key === 'boom') {
          return throwError(() => ({ code: 'SERVICE_UNAVAILABLE' as WeatherErrorCode }));
        }
        const hit = MOCK_CITIES[key];
        if (!hit) {
          return throwError(() => ({ code: 'NOT_FOUND' as WeatherErrorCode }));
        }
        return of(hit);
      }),
    );
  }
}
