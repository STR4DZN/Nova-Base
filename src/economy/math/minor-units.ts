import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { ResourceDefinition } from "../definitions/resource-definition-types.js";

/**
 * Validates that an amount is a safe integer in JavaScript (`Number.isSafeInteger`).
 * Prevents precision loss and silent BigInt conversion (DEC-16728).
 */
export function assertSafeInteger(value: number, fieldName = "amount"): Result<number, PublicError> {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_OVERFLOW",
        category: "validation",
        message: `${fieldName} must be a safe integer (between -(2^53 - 1) and 2^53 - 1): received ${String(value)}`
      })
    );
  }
  return ok(value);
}

/**
 * Converts minor integer units to major decimal representation (e.g. 1050 minor with precision 2 -> 10.5).
 */
export function minorToMajor(amountMinor: number, precision: number): number {
  if (precision === 0) return amountMinor;
  const factor = 10 ** precision;
  return amountMinor / factor;
}

/**
 * Converts major units to minor integer units (e.g. 10.5 with precision 2 -> 1050 minor).
 * Employs exact math rounding to eliminate binary floating point inaccuracies (e.g. 0.1 + 0.2).
 */
export function majorToMinor(amountMajor: number, precision: number): Result<number, PublicError> {
  if (typeof amountMajor !== "number" || !Number.isFinite(amountMajor)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Amount must be a finite number: received ${String(amountMajor)}`
      })
    );
  }

  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 4) {
    return err(
      createPublicError({
        code: "DM_ECON_PRECISION_INVALID",
        category: "validation",
        message: `Precision must be an integer between 0 and 4: received ${String(precision)}`
      })
    );
  }

  const factor = 10 ** precision;
  // Round to eliminate floating point rounding error (e.g. 19.99 * 100 = 1998.9999999999998)
  const minor = Math.round(amountMajor * factor);

  return assertSafeInteger(minor, "Calculated minor units");
}

/**
 * Adds two minor integer amounts with overflow check.
 */
export function addMinorUnits(a: number, b: number): Result<number, PublicError> {
  const checkA = assertSafeInteger(a, "Term A");
  if (!checkA.ok) return checkA;
  const checkB = assertSafeInteger(b, "Term B");
  if (!checkB.ok) return checkB;

  const sum = a + b;
  return assertSafeInteger(sum, "Sum");
}

/**
 * Subtracts two minor integer amounts with overflow check.
 */
export function subtractMinorUnits(a: number, b: number): Result<number, PublicError> {
  const checkA = assertSafeInteger(a, "Minuend");
  if (!checkA.ok) return checkA;
  const checkB = assertSafeInteger(b, "Subtrahend");
  if (!checkB.ok) return checkB;

  const diff = a - b;
  return assertSafeInteger(diff, "Difference");
}

export interface FormatResourceOptions {
  readonly locale?: string;
  readonly showUnit?: boolean;
}

/**
 * Formats a minor-unit integer into a human-readable localized string.
 */
export function formatResourceAmount(
  amountMinor: number,
  definition: ResourceDefinition,
  options?: FormatResourceOptions
): string {
  const precision = definition.precision;
  const major = minorToMajor(amountMinor, precision);

  const locale = options?.locale ?? "en-US";
  const formattedNumber = major.toLocaleString(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });

  if (!options?.showUnit || !definition.displayUnit) {
    return formattedNumber;
  }

  const unit = definition.displayUnit;
  if (unit.abbreviation) {
    return `${formattedNumber} ${unit.abbreviation}`;
  }

  const isSingular = Math.abs(major) === 1;
  const unitLabel = isSingular
    ? (unit.singular ?? unit.plural ?? "")
    : (unit.plural ?? unit.singular ?? "");

  return unitLabel ? `${formattedNumber} ${unitLabel}` : formattedNumber;
}

/**
 * Parses user input text (e.g. "1,250.50" or "1250,50") into integer minor units.
 */
export function parseResourceAmount(
  text: string,
  precision: number
): Result<number, PublicError> {
  if (typeof text !== "string" || text.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: "Amount string cannot be empty"
      })
    );
  }

  const clean = text.trim();

  // Normalize localized input:
  // If text has both ',' and '.', the last one is the decimal separator.
  // E.g. "1,250.50" -> comma is thousand, dot is decimal
  // E.g. "1.250,50" -> dot is thousand, comma is decimal
  let normalized = clean;
  const commaIdx = clean.lastIndexOf(",");
  const dotIdx = clean.lastIndexOf(".");

  if (commaIdx !== -1 && dotIdx !== -1) {
    if (commaIdx > dotIdx) {
      // 1.250,50 -> remove dots, replace comma with dot
      normalized = clean.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,250.50 -> remove commas
      normalized = clean.replace(/,/g, "");
    }
  } else if (commaIdx !== -1) {
    // Only comma present: if precision > 0, treat as decimal separator, else remove
    if (precision > 0) {
      normalized = clean.replace(",", ".");
    } else {
      normalized = clean.replace(/,/g, "");
    }
  }

  const parsedFloat = Number(normalized);
  if (Number.isNaN(parsedFloat) || !Number.isFinite(parsedFloat)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Could not parse '${text}' as a valid number`
      })
    );
  }

  return majorToMinor(parsedFloat, precision);
}
