import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandRegistry } from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { EconomyService } from "../services/economy-service.js";
import { validateEconomyCommandPermission } from "./economy-permissions.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import { isNamespacedResourceId } from "../definitions/resource-definition-types.js";

export interface RegisterEconomyCommandsOptions {
  readonly registry: CommandRegistry;
  readonly economyService: EconomyService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
}

export interface ResourceAdjustCommandPayload {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly deltaMinor?: number;
  readonly targetBalanceMinor?: number;
  readonly reason: string;
}

export interface ResourceTransferCommandPayload {
  readonly sourceDomainUuid: string;
  readonly targetDomainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly reason?: string;
}

export interface ResourceConvertCommandPayload {
  readonly domainUuid: string;
  readonly fromResourceId: string;
  readonly toResourceId: string;
  readonly fromAmountMinor: number;
  readonly toAmountMinor: number;
  readonly rateDescription?: string;
  readonly reason?: string;
}

export interface ResourceReserveCommandPayload {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly amountMinor: number;
  readonly source?: any;
  readonly expiresAtWorld?: number | null;
  readonly expiresAtReal?: number | null;
}

export interface ResourceConsumeReservationCommandPayload {
  readonly domainUuid: string;
  readonly reservationId: string;
  readonly amountMinor: number;
  readonly reason?: string;
}

export interface ResourceReleaseReservationCommandPayload {
  readonly domainUuid: string;
  readonly reservationId: string;
  readonly amountMinor?: number;
}

export interface ResourceCreateAccountCommandPayload {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly mode?: "native" | "provider" | "derived";
  readonly initialBalanceMinor?: number;
  readonly baseCapacityMinor?: number | null;
  readonly visibility?: "public" | "restricted" | "secret";
  readonly providerId?: string;
  readonly providerRef?: string;
  readonly resolverId?: string;
  readonly reason?: string;
}

export interface ResourceCloseAccountCommandPayload {
  readonly domainUuid: string;
  readonly resourceId: string;
  readonly reason?: string;
}

export interface ResourceReversalCommandPayload {
  readonly domainUuid: string;
  readonly entryId: string;
  readonly reason: string;
}

export function registerEconomyCommands(options: RegisterEconomyCommandsOptions): void {
  const { registry, economyService, domains, controllerProvider } = options;

  // 1. economy:adjust (GM only)
  registry.register({
    type: "economy:adjust",
    visibility: "public",
    description: "Authoritatively adjusts resource balance on a domain (GM only)",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (typeof p.reason !== "string" || !p.reason.trim()) {
        return err(
          createPublicError({
            code: "DM_ECON_ADJUST_REASON_REQUIRED",
            category: "validation",
            message: "Adjustment requires a reason"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider,
        gmOnly: true
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.commitAdjust({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        deltaMinor: p.deltaMinor,
        targetBalanceMinor: p.targetBalanceMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.command.authorityEpoch ?? 1
      });
    }
  });

  // 2. economy:transfer
  registry.register({
    type: "economy:transfer",
    visibility: "public",
    description: "Authoritatively transfers resources between two domains",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.sourceDomainUuid !== "string" || !p.sourceDomainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "sourceDomainUuid is required"
          })
        );
      }
      if (typeof p.targetDomainUuid !== "string" || !p.targetDomainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "targetDomainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (
        typeof p.amountMinor !== "number" ||
        !Number.isSafeInteger(p.amountMinor) ||
        p.amountMinor <= 0
      ) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(
        ctx,
        domains,
        [ctx.command.payload.sourceDomainUuid, ctx.command.payload.targetDomainUuid],
        { controllerProvider }
      ),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.commitTransfer({
        sourceDomainUuid: p.sourceDomainUuid,
        targetDomainUuid: p.targetDomainUuid,
        resourceId: p.resourceId,
        amountMinor: p.amountMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.command.authorityEpoch ?? 1
      });
    }
  });

  // 3. economy:convert
  registry.register({
    type: "economy:convert",
    visibility: "public",
    description: "Converts one resource to another within a domain",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.fromResourceId) || !isNamespacedResourceId(p.toResourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "fromResourceId and toResourceId must be namespaced"
          })
        );
      }
      if (
        typeof p.fromAmountMinor !== "number" ||
        !Number.isSafeInteger(p.fromAmountMinor) ||
        p.fromAmountMinor <= 0
      ) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "fromAmountMinor must be a positive safe integer"
          })
        );
      }
      if (
        typeof p.toAmountMinor !== "number" ||
        !Number.isSafeInteger(p.toAmountMinor) ||
        p.toAmountMinor <= 0
      ) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "toAmountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.commitConvert({
        domainUuid: p.domainUuid,
        fromResourceId: p.fromResourceId,
        toResourceId: p.toResourceId,
        fromAmountMinor: p.fromAmountMinor,
        toAmountMinor: p.toAmountMinor,
        rateDescription: p.rateDescription,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.command.authorityEpoch ?? 1
      });
    }
  });

  // 4. economy:reserve
  registry.register({
    type: "economy:reserve",
    visibility: "public",
    description: "Creates a resource reservation",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (
        typeof p.amountMinor !== "number" ||
        !Number.isSafeInteger(p.amountMinor) ||
        p.amountMinor <= 0
      ) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.reserve({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        amountMinor: p.amountMinor,
        source: p.source ?? { type: "command", ref: ctx.command.commandId },
        expiresAtWorld: p.expiresAtWorld,
        expiresAtReal: p.expiresAtReal
      });
    }
  });

  // 5. economy:consume-reservation
  registry.register({
    type: "economy:consume-reservation",
    visibility: "public",
    description: "Consumes a reservation, debiting account balance and recording ledger entry",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.reservationId !== "string" || !p.reservationId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservationId is required"
          })
        );
      }
      if (
        typeof p.amountMinor !== "number" ||
        !Number.isSafeInteger(p.amountMinor) ||
        p.amountMinor <= 0
      ) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.consumeReservation({
        domainUuid: p.domainUuid,
        reservationId: p.reservationId,
        amountMinor: p.amountMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.command.authorityEpoch ?? 1
      });
    }
  });

  // 6. economy:release-reservation
  registry.register({
    type: "economy:release-reservation",
    visibility: "public",
    description: "Releases a reservation, freeing up availability without changing balance",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.reservationId !== "string" || !p.reservationId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservationId is required"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.releaseReservation({
        domainUuid: p.domainUuid,
        reservationId: p.reservationId,
        amountMinor: p.amountMinor
      });
    }
  });

  // 7. economy:create-account (GM only)
  registry.register({
    type: "economy:create-account",
    visibility: "public",
    description: "Creates a resource account in a domain (GM only)",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider,
        gmOnly: true
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.createAccount({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        mode: p.mode,
        initialBalanceMinor: p.initialBalanceMinor,
        baseCapacityMinor: p.baseCapacityMinor,
        visibility: p.visibility,
        providerId: p.providerId,
        providerRef: p.providerRef,
        resolverId: p.resolverId,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined
      });
    }
  });

  // 8. economy:close-account (GM only)
  registry.register({
    type: "economy:close-account",
    visibility: "public",
    description: "Closes an empty resource account in a domain (GM only)",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider,
        gmOnly: true
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.closeAccount({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined
      });
    }
  });

  // 9. economy:reversal (GM only)
  registry.register({
    type: "economy:reversal",
    visibility: "public",
    description: "Appends a compensating reversal entry to the ledger and updates balance (GM only)",
    schemaValidator: (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload as Record<string, unknown>;
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.entryId !== "string" || !p.entryId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "entryId is required"
          })
        );
      }
      if (typeof p.reason !== "string" || !p.reason.trim()) {
        return err(
          createPublicError({
            code: "DM_ECON_ADJUST_REASON_REQUIRED",
            category: "validation",
            message: "Reversal requires a reason"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: (ctx: AuthenticatedCommandContext<any>) =>
      validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
        controllerProvider,
        gmOnly: true
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return economyService.reverseLedgerEntry({
        domainUuid: p.domainUuid,
        entryId: p.entryId,
        reason: p.reason,
        userId: ctx.senderUserId ?? undefined
      });
    }
  });
}
