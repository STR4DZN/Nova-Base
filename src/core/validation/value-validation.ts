import { createPublicError } from "../contracts/public-error.js";
import { err, type Result } from "../contracts/result.js";
import { isFoundryUuid, type TypedRef } from "../identity/refs.js";

export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
export const isText = (x: unknown): x is string => typeof x === "string" && !!x && x.trim() === x;
export const isSafeInteger = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
export const isTimestamp = (x: unknown): x is number => isSafeInteger(x) && x >= 0;
export const isNamespaced = (x: unknown): x is string => isText(x) && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(x);
export const isVisibility = (x: unknown): x is "public" | "restricted" | "secret" => x === "public" || x === "restricted" || x === "secret";
export const isTypedRef = (x: unknown): x is TypedRef => isRecord(x) && isText(x.type)
  && ((isText(x.id) && x.uuid === undefined) || (isFoundryUuid(x.uuid) && x.id === undefined));
/** Durable entities are JSON data, without command transport's 1000-item budget.
 * Shared objects serialize normally; only cycles along the current path fail. */
export function isJsonData(value: unknown, depth = 0, path = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64 || (!Array.isArray(value) && !isRecord(value)) || path.has(value)) return false;
  path.add(value);
  const valid = Object.values(value).every(x => isJsonData(x, depth + 1, path));
  path.delete(value); return valid;
}
export const failure = (code: `DM_${string}`, message: string, category: "validation" | "conflict" | "not-found" | "permission" = "validation"): Result<never> =>
  err(createPublicError({ code, category, message }));
export function immutable<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export function boundedInteger(value: bigint, minimum: number, maximum: number): number {
  return Number(value < BigInt(minimum) ? BigInt(minimum) : value > BigInt(maximum) ? BigInt(maximum) : value);
}
export function revisionGuard(revision: number, expected: number): Result<never> | null {
  if (!isTimestamp(expected) || revision !== expected) return failure("DM_REVISION_CONFLICT", "Entity revision is stale", "conflict");
  if (revision === Number.MAX_SAFE_INTEGER) return failure("DM_REVISION_OVERFLOW", "Entity revision cannot be incremented");
  return null;
}
