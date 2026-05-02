/**
 * Pure presentational card for a successful weather lookup. Receives the
 * server's `SuccessBody` directly so there's no client-side reshaping of the
 * contract — the type is the contract.
 */

import type { SuccessBody } from "@/services/weatherApi";

export interface WeatherResultCardProps {
  data: SuccessBody;
}

export function WeatherResultCard({ data }: WeatherResultCardProps) {
  const { location, weather } = data;
  return (
    <article className="result-card" aria-label={`Current weather for ${location.displayName}`}>
      <header className="result-card__header">
        <p className="result-card__eyebrow">Current weather</p>
        <h2 className="result-card__location">{location.displayName}</h2>
      </header>
      <div className="result-card__temp">
        <span className="result-card__temp-c">{formatTemp(weather.tempC)}&nbsp;°C</span>
        <span className="result-card__temp-sep" aria-hidden="true">/</span>
        <span className="result-card__temp-f">{formatTemp(weather.tempF)}&nbsp;°F</span>
      </div>
      <p className="result-card__conditions">{weather.description}</p>
      <dl className="result-card__stats">
        <div className="result-card__stat">
          <dt>Humidity</dt>
          <dd>{Math.round(weather.humidity)}%</dd>
        </div>
        <div className="result-card__stat">
          <dt>Wind</dt>
          <dd>{formatWind(weather.windSpeed)} m/s</dd>
        </div>
      </dl>
    </article>
  );
}

function formatTemp(value: number): string {
  // Keep one decimal so 12.3 stays 12.3 and integers stay integer-ish.
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function formatWind(value: number): string {
  return value.toFixed(1);
}
