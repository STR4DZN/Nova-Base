import type { PublicError, Warning } from "./public-error.js";

export type Result<T, E extends PublicError = PublicError> =
  | { readonly ok: true; readonly value: T; readonly warnings?: readonly Warning[] }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T, warnings?: readonly Warning[]): Result<T> {
  return warnings === undefined ? { ok: true, value } : { ok: true, value, warnings };
}

export function err<E extends PublicError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E extends PublicError>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: true }> {
  return result.ok;
}

export function isErr<T, E extends PublicError>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: false }> {
  return !result.ok;
}
