import type { PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { isCommandType } from "./command-envelope.js";
import type { AuthenticatedCommandContext } from "./authenticated-command-context.js";
import type { MutationDefinition } from "../mutations/mutation-coordinator.js";

export type CommandVisibility = "public" | "internal";

export type CommandHandlerFn<TPayload = unknown, TResult = unknown> = (
  context: AuthenticatedCommandContext<TPayload>
) => Promise<Result<TResult, PublicError>>;

export type CommandSchemaValidator<TPayload = unknown> = (
  payload: unknown
) => Result<TPayload, PublicError>;

export type CommandPermissionValidator<TPayload = unknown> = (
  context: AuthenticatedCommandContext<TPayload>
) => Result<boolean, PublicError> | Promise<Result<boolean, PublicError>>;

export interface CommandRegistration<TPayload = unknown, TResult = unknown> {
  readonly type: string;
  readonly visibility: CommandVisibility;
  readonly transactional?: boolean;
  readonly description?: string;
  readonly schemaValidator?: CommandSchemaValidator<TPayload>;
  readonly permissionValidator?: CommandPermissionValidator<TPayload>;
  readonly handler: CommandHandlerFn<TPayload, TResult>;
  readonly mutationDefinition?: MutationDefinition<TPayload, TResult, any>;
}

export function createTransactionalHandler<TPayload, TResult>(
  coordinator: {
    execute: (
      context: AuthenticatedCommandContext<TPayload>,
      definition: MutationDefinition<TPayload, TResult, any>
    ) => Promise<Result<{ status: string; result?: unknown; error?: PublicError }, PublicError>>;
  },
  definition: MutationDefinition<TPayload, TResult, any>
): CommandHandlerFn<TPayload, TResult> {
  const handler: CommandHandlerFn<TPayload, TResult> = async (context) => {
    const coordRes = await coordinator.execute(context, definition);
    if (!coordRes.ok) return err(coordRes.error);
    const receipt = coordRes.value;
    if (receipt.status === "rejected") {
      return err(
        receipt.error ?? {
          code: "DM_TRANSACTION_REJECTED",
          category: "internal",
          message: "Transaction execution rejected"
        }
      );
    }
    return ok(receipt.result as TResult);
  };
  (handler as any).__isTransactionalWrapped = true;
  return handler;
}

export class CommandRegistryCollisionError extends Error {
  readonly code = "DM_COMMAND_REGISTRY_COLLISION";

  constructor(readonly commandType: string) {
    super(`Command handler for '${commandType}' is already registered`);
    this.name = "CommandRegistryCollisionError";
  }
}

export class CommandRegistryFrozenError extends Error {
  readonly code = "DM_COMMAND_REGISTRY_FROZEN";

  constructor() {
    super("CommandRegistry is frozen and cannot accept new command handlers");
    this.name = "CommandRegistryFrozenError";
  }
}

/**
 * Registry of domain command handlers.
 *
 * Enforces:
 * - Handlers are identified by strictly namespaced command types (<namespace>:<action>).
 * - Handlers are explicitly marked as "public" (callable by players/GMs via transport)
 *   or "internal" (callable strictly within local authority context, rejected via network).
 * - Duplicate registrations collision detection.
 * - Freezable state to prevent runtime tampering after initialization.
 */
export class CommandRegistry {
  readonly #handlers = new Map<string, CommandRegistration<any, any>>();
  #isFrozen = false;

  register<TPayload, TResult>(registration: CommandRegistration<TPayload, TResult>): void {
    if (this.#isFrozen) {
      throw new CommandRegistryFrozenError();
    }

    if (!isCommandType(registration.type)) {
      throw new TypeError(
        `Command type '${registration.type}' must be a valid namespace:action identifier`
      );
    }

    if (this.#handlers.has(registration.type)) {
      throw new CommandRegistryCollisionError(registration.type);
    }

    if (typeof registration.handler !== "function") {
      throw new TypeError(`Handler for '${registration.type}' must be a function`);
    }

    if (
      registration.transactional &&
      !registration.mutationDefinition &&
      !(registration.handler as any)?.__isTransactionalWrapped
    ) {
      throw new TypeError(
        `Transactional command '${registration.type}' must provide a MutationDefinition or be created with createTransactionalHandler`
      );
    }

    this.#handlers.set(
      registration.type,
      Object.freeze({ ...registration })
    );
  }

  get<TPayload = unknown, TResult = unknown>(
    type: string
  ): CommandRegistration<TPayload, TResult> | undefined {
    return this.#handlers.get(type);
  }

  has(type: string): boolean {
    return this.#handlers.has(type);
  }

  freeze(): void {
    this.#isFrozen = true;
  }

  get isFrozen(): boolean {
    return this.#isFrozen;
  }

  listRegisteredTypes(): readonly string[] {
    return Object.freeze(Array.from(this.#handlers.keys()));
  }
}
