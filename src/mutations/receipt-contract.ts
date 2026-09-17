import type { CommandId } from "../commands/command-envelope.js";
import type { PublicError } from "../core/contracts/public-error.js";
import { sanitizeDiagnosticsValue } from "../diagnostics/sanitize.js";

export type MutationReceiptStatus = "executed" | "rejected" | "no_op";

/**
 * Normative Mutation Receipt contract (Master Spec §12.1, DEC-635–644, DEC-732–744).
 *
 * Returned upon completion of authoritative mutation execution.
 * Represents outcome metadata; is NEVER a replacement for domain entities or source-of-truth.
 */
export interface MutationReceipt<TResult = unknown> {
  readonly receiptId: string;
  readonly commandId: CommandId;
  readonly transactionId?: string;
  readonly correlationId?: string;
  readonly status: MutationReceiptStatus;
  readonly changed: boolean;
  readonly resultingRevisions: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly summary?: string;
  readonly result?: TResult;
  readonly error?: PublicError;
  readonly executedAt: number;
  readonly childReceipts?: readonly MutationReceipt[];
}

export interface PublicMutationReceipt<TResult = unknown> {
  readonly receiptId: string;
  readonly commandId: CommandId;
  readonly correlationId?: string;
  readonly status: MutationReceiptStatus;
  readonly changed: boolean;
  readonly resultingRevisions: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly summary?: string;
  readonly result?: TResult;
  readonly error?: PublicError;
  readonly executedAt: number;
}

export interface CreateMutationReceiptParams<TResult = unknown> {
  readonly commandId: CommandId;
  readonly receiptId?: string;
  readonly transactionId?: string;
  readonly correlationId?: string;
  readonly status: MutationReceiptStatus;
  readonly changed: boolean;
  readonly resultingRevisions?: Record<string, number>;
  readonly warnings?: readonly string[];
  readonly summary?: string;
  readonly result?: TResult;
  readonly error?: PublicError;
  readonly executedAt?: number;
  readonly childReceipts?: readonly MutationReceipt[];
}

export function createMutationReceipt<TResult = unknown>(
  params: CreateMutationReceiptParams<TResult>
): MutationReceipt<TResult> {
  const executedAt = params.executedAt ?? Date.now();
  const receiptId =
    params.receiptId ?? `rcpt_${params.commandId}_${executedAt}`;

  return Object.freeze({
    receiptId,
    commandId: params.commandId,
    transactionId: params.transactionId,
    correlationId: params.correlationId,
    status: params.status,
    changed: params.changed,
    resultingRevisions: Object.freeze({ ...params.resultingRevisions }),
    warnings: Object.freeze(params.warnings ? [...params.warnings] : []),
    summary: params.summary,
    result: params.result,
    error: params.error,
    executedAt,
    childReceipts: params.childReceipts
      ? Object.freeze([...params.childReceipts])
      : undefined
  });
}

export function sanitizeReceiptForPublic<TResult = unknown>(
  receipt: MutationReceipt<TResult>
): PublicMutationReceipt<TResult> {
  const sanitizedError = receipt.error
    ? Object.freeze({
        code: receipt.error.code,
        category: receipt.error.category,
        message: receipt.error.message,
        details:
          receipt.error.details !== undefined
            ? sanitizeDiagnosticsValue(receipt.error.details)
            : undefined,
        retryable: receipt.error.retryable,
        userActionRequired: receipt.error.userActionRequired,
        correlationId: receipt.error.correlationId
      })
    : undefined;

  return Object.freeze({
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    correlationId: receipt.correlationId,
    status: receipt.status,
    changed: receipt.changed,
    resultingRevisions: receipt.resultingRevisions,
    warnings: receipt.warnings,
    summary: receipt.summary,
    result:
      receipt.result !== undefined
        ? (sanitizeDiagnosticsValue(receipt.result) as TResult)
        : undefined,
    error: sanitizedError,
    executedAt: receipt.executedAt
  });
}
