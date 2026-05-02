/**
 * Dismissible banner for transport / upstream errors (everything that isn't
 * an inline VALIDATION failure). Uses `role="alert"` so screen readers
 * announce the message when it appears.
 */

"use client";

export interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__icon" aria-hidden="true">!</span>
      <p className="error-banner__text">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          className="error-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
