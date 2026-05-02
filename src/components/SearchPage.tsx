/**
 * SearchPage — the City Weather Search UI.
 *
 * Owns the `idle | loading | success | error` view state, routes the server's
 * `error.code` to the correct slot (inline validation message vs. dismissible
 * banner), short-circuits empty submits without issuing a network call, and
 * cancels stale in-flight requests when the user submits a new search.
 */

"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ErrorBanner } from "@/components/ErrorBanner";
import { WeatherResultCard } from "@/components/WeatherResultCard";
import { MESSAGES } from "@/lib/contract";
import {
  ErrorBody,
  SuccessBody,
  isAbortError,
  searchWeather,
} from "@/services/weatherApi";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: SuccessBody }
  | { kind: "error"; error: ErrorBody };

const SUGGESTION_CHIPS = ["London", "Tokyo", "Springfield", "Paris", "Sydney"];

export function SearchPage() {
  const [city, setCity] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "idle" });

  // The currently in-flight AbortController. We keep a ref (not state) so
  // updating it doesn't trigger re-renders; the controller is internal
  // plumbing, not view data.
  const inFlight = useRef<AbortController | null>(null);

  // Cancel anything still in flight on unmount — prevents the "set state
  // after unmount" warning and a stray network request after navigation.
  useEffect(() => {
    return () => {
      inFlight.current?.abort();
    };
  }, []);

  const runSearch = useCallback(async (rawCity: string) => {
    const trimmed = rawCity.trim();

    // --- Empty-input short-circuit -----------------------------------------
    // Spec: "submits the search form with an empty city name field" must
    // show the validation message and "does not call any external API".
    // We render the validation slot *without* hitting the network.
    if (trimmed.length === 0) {
      // Cancel any in-flight request from a previous keystroke.
      inFlight.current?.abort();
      inFlight.current = null;
      setView({
        kind: "error",
        error: { code: "VALIDATION", message: MESSAGES.VALIDATION_EMPTY },
      });
      return;
    }

    // --- Stale-response guard ----------------------------------------------
    // Abort the prior in-flight request before starting the new one. The
    // prior promise will reject with an AbortError which we catch below and
    // ignore, so its result never updates the view (no flicker, no race).
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setView({ kind: "loading" });

    try {
      const response = await searchWeather(trimmed, { signal: controller.signal });

      // If a newer request started while we were awaiting, this controller is
      // no longer the current one — drop the result on the floor.
      if (inFlight.current !== controller) return;
      inFlight.current = null;

      if (response.ok) {
        setView({ kind: "success", data: response.data });
      } else {
        setView({ kind: "error", error: response.error });
      }
    } catch (err) {
      if (isAbortError(err)) {
        // Expected when a newer search superseded this one — do nothing.
        return;
      }
      // searchWeather collapses transport failures into an envelope, so
      // reaching here means something genuinely unexpected happened. Render
      // the canonical "weather unavailable" message rather than a raw
      // Error.message — the user surface stays clean.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setView({
          kind: "error",
          error: {
            code: "WEATHER_UNAVAILABLE",
            message: MESSAGES.WEATHER_UNAVAILABLE,
          },
        });
      }
    }
  }, []);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void runSearch(city);
    },
    [city, runSearch],
  );

  const onChipClick = useCallback(
    (suggestion: string) => {
      setCity(suggestion);
      void runSearch(suggestion);
    },
    [runSearch],
  );

  // Derive surface flags from the discriminated state.
  const isLoading = view.kind === "loading";
  const validationError =
    view.kind === "error" && view.error.code === "VALIDATION"
      ? view.error.message
      : null;
  const transportError =
    view.kind === "error" && view.error.code !== "VALIDATION"
      ? view.error.message
      : null;
  const successData = view.kind === "success" ? view.data : null;

  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">City Weather Search</h1>
        <p className="page__subtitle">
          Search any city to see current conditions.
        </p>
      </header>

      <section className="page__panel" aria-labelledby="search-heading">
        <h2 id="search-heading" className="visually-hidden">
          Search
        </h2>
        <form onSubmit={onSubmit} className="search-form" noValidate>
          <label htmlFor="city" className="search-form__label">
            City name
          </label>
          <div className="search-form__row">
            <input
              id="city"
              name="city"
              type="text"
              className="search-form__input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. London"
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              maxLength={120 /* generous; the server enforces 100 */}
              disabled={isLoading}
              aria-describedby="search-help city-validation"
              aria-invalid={validationError != null}
            />
            <button
              type="submit"
              className="search-form__submit"
              disabled={isLoading}
            >
              {isLoading ? "Searching…" : "Search"}
            </button>
          </div>
          <p id="search-help" className="search-form__help">
            Enter a city name and press Search.
          </p>
          <p
            id="city-validation"
            className={`search-form__validation${
              validationError ? " is-visible" : ""
            }`}
            role="status"
            aria-live="polite"
          >
            {validationError ?? ""}
          </p>
        </form>

        <div className="page__try">
          <span className="page__try-label">Try:</span>
          {SUGGESTION_CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              className="page__chip"
              onClick={() => onChipClick(s)}
              disabled={isLoading}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {transportError ? (
        <ErrorBanner
          message={transportError}
          onDismiss={() => setView({ kind: "idle" })}
        />
      ) : null}

      <section className="page__results" aria-live="polite" aria-busy={isLoading}>
        {isLoading ? (
          <div className="loading-skeleton" aria-hidden="true">
            <div className="loading-skeleton__line loading-skeleton__line--lg" />
            <div className="loading-skeleton__line" />
            <div className="loading-skeleton__line loading-skeleton__line--sm" />
          </div>
        ) : successData ? (
          <WeatherResultCard data={successData} />
        ) : view.kind === "idle" ? (
          <p className="page__empty">
            Search a city above to see current weather.
          </p>
        ) : null}
      </section>
    </main>
  );
}
