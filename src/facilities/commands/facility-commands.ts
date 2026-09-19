import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandRegistry } from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { FacilitiesService } from "../services/facilities-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";

export interface RegisterFacilityCommandsOptions {
  readonly registry: CommandRegistry;
  readonly facilitiesService: FacilitiesService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
}

export function registerFacilityCommands(options: RegisterFacilityCommandsOptions): void {
  const { registry, facilitiesService, domains, controllerProvider } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  // 1. facilities:create-facility
  registry.register({
    type: "facilities:create-facility",
    visibility: "public",
    description: "Authoritatively creates a new facility in the domain",
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
      if (typeof p.definitionId !== "string" || !p.definitionId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "definitionId is required"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return facilitiesService.createFacility({
        domainUuid: p.domainUuid,
        definitionId: p.definitionId,
        name: p.name,
        level: p.level,
        initialLifecycle: p.initialLifecycle,
        userId: ctx.senderUserId
      });
    }
  });

  // 2. facilities:maintain-facility
  registry.register({
    type: "facilities:maintain-facility",
    visibility: "public",
    description: "Authoritatively executes facility maintenance using evaluateFacilityMaintenancePlan",
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
      if (typeof p.facilityId !== "string" || !p.facilityId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "facilityId is required"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return facilitiesService.maintainFacility({
        domainUuid: p.domainUuid,
        facilityId: p.facilityId,
        notes: p.notes,
        userId: ctx.senderUserId
      });
    }
  });

  // 3. facilities:repair-facility
  registry.register({
    type: "facilities:repair-facility",
    visibility: "public",
    description: "Authoritatively executes facility repair; fails closed if engineering project is required",
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
      if (typeof p.facilityId !== "string" || !p.facilityId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "facilityId is required"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return facilitiesService.repairFacility({
        domainUuid: p.domainUuid,
        facilityId: p.facilityId,
        restoreIntegrity: p.restoreIntegrity,
        removeConditionIds: p.removeConditionIds,
        notes: p.notes,
        userId: ctx.senderUserId
      });
    }
  });

  // 4. facilities:apply-damage
  registry.register({
    type: "facilities:apply-damage",
    visibility: "public",
    description: "Applies damage and degradation to a facility (GM only)",
    permissionValidator: (ctx) =>
      validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
        controllerProvider
      }),
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return facilitiesService.applyDamage({
        domainUuid: p.domainUuid,
        facilityId: p.facilityId,
        damage: p.damage ?? 0,
        conditionId: p.conditionId,
        condition: p.condition,
        reason: p.reason,
        userId: ctx.senderUserId
      });
    }
  });

  // 5. facilities:decommission-facility
  registry.register({
    type: "facilities:decommission-facility",
    visibility: "public",
    description: "Decommissions an existing facility",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return facilitiesService.decommissionFacility({
        domainUuid: p.domainUuid,
        facilityId: p.facilityId,
        reason: p.reason,
        userId: ctx.senderUserId
      });
    }
  });
}
