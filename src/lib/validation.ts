/**
 * Input validation for POST /api/weather.
 *
 * All validation runs *before* any upstream call. Rejections include the
 * canonical user-facing messages from the Surface contract.
 *
 * Rules (in order):
 *   1. Empty / whitespace-only        → "Please enter a city name"
 *   2. Length > 100                   → "City name is too long"
 *   3. Disallowed character sequences → "Invalid characters in city name"
 *
 * Rule 3 is intentionally a deny-list of suspicious tokens (script tags, SQL
 * meta-sequences, angle brackets) rather than a strict allow-list, because
 * legitimate city names contain accents, apostrophes, hyphens, and spaces
 * (e.g. "L'Île-Saint-Denis", "São Paulo"). A naive `^[A-Za-z ]+$` allow-list
 * would falsely reject those.
 */

import { MESSAGES } from "./contract";

export interface ValidationOk {
  ok: true;
  /** The trimmed city string to use for downstream calls. */
  city: string;
}

export interface ValidationFail {
  ok: false;
  message: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

const MAX_LENGTH = 100;

/**
 * Lower-cased, dotted-and-spaced-flat representation used to scan for
 * suspicious tokens. We strip non-alphanumerics so attempts like
 * `s c r i p t` or `s/cript` still trip the script check.
 */
function normalizeForScan(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function containsForbiddenChars(input: string): boolean {
  // Angle brackets are never legitimate in a city name and cover most XSS
  // attempts on their own.
  if (input.includes("<") || input.includes(">")) return true;

  const lower = input.toLowerCase();

  // SQL meta-sequences. We look for the canonical injection fragments rather
  // than every possible permutation — anything containing these is plainly
  // not a city name.
  const sqlFragments = [
    ";--",
    "--",
    "' or ",
    "\" or ",
    " or 1=1",
    " or '1'='1",
    "/*",
    "*/",
    "union select",
    "drop table",
  ];
  for (const frag of sqlFragments) {
    if (lower.includes(frag)) return true;
  }

  // Script-tag fragments. Strip non-alphanumerics first so obfuscations
  // like `s\nc/ript` are still caught.
  const flat = normalizeForScan(input);
  if (flat.includes("script")) return true;
  if (flat.includes("javascript")) return true;
  if (flat.includes("onerror") || flat.includes("onload")) return true;

  return false;
}

export function validateCity(rawInput: unknown): ValidationResult {
  if (typeof rawInput !== "string") {
    return { ok: false, message: MESSAGES.VALIDATION_EMPTY };
  }

  const trimmed = rawInput.trim();

  if (trimmed.length === 0) {
    return { ok: false, message: MESSAGES.VALIDATION_EMPTY };
  }

  // Length is checked against the *original* trimmed input (pre-canonicalize)
  // because the upstream API has its own limits and the spec is explicit
  // about ">100".
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, message: MESSAGES.VALIDATION_TOO_LONG };
  }

  if (containsForbiddenChars(trimmed)) {
    return { ok: false, message: MESSAGES.VALIDATION_INVALID_CHARS };
  }

  return { ok: true, city: trimmed };
}
