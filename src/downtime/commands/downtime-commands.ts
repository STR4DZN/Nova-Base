import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandRegistry } from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { DowntimeService } from "../services/downtime-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";

export interface RegisterDowntimeCommandsOptions {
  readonly registry: CommandRegistry;
  readonly downtimeService: DowntimeService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
}

export function registerDowntimeCommands(options: RegisterDowntimeCommandsOptions): void {
  const { registry, downtimeService, domains, controllerProvider } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  // 1. downtime:start-activity
  registry.register({
    type: "downtime:start-activity",
    visibility: "public",
    description: "Authoritatively starts a new downtime activity after validating participant requirements",
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
      return downtimeService.startActivity({
        domainUuid: p.domainUuid,
        definitionId: p.definitionId,
        label: p.label,
        scope: p.scope,
        durationTicks: p.durationTicks,
        participantRef: p.participantRef,
        userId: ctx.senderUserId
      });
    }
  });

  // 2. downtime:advance-activity
  registry.register({
    type: "downtime:advance-activity",
    visibility: "public",
    description: "Advances downtime activity progress and automatically resolves outcomes upon reaching duration",
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
      if (typeof p.activityId !== "string" || !p.activityId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "activityId is required"
          })
        );
      }
      if (typeof p.ticks !== "number") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "ticks must be a number"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return downtimeService.advanceActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        ticks: p.ticks,
        notes: p.notes,
        userId: ctx.senderUserId
      });
    }
  });

  // 3. downtime:complete-activity
  registry.register({
    type: "downtime:complete-activity",
    visibility: "public",
    description: "Authoritatively completes a downtime activity and resolves configured outcomes",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return downtimeService.completeActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        outcomeKey: p.outcomeKey,
        notes: p.notes,
        userId: ctx.senderUserId
      });
    }
  });

  // 4. downtime:pause-activity
  registry.register({
    type: "downtime:pause-activity",
    visibility: "public",
    description: "Pauses an in-progress downtime activity",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return downtimeService.pauseActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: ctx.senderUserId
      });
    }
  });

  // 5. downtime:resume-activity
  registry.register({
    type: "downtime:resume-activity",
    visibility: "public",
    description: "Resumes a paused downtime activity",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return downtimeService.resumeActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: ctx.senderUserId
      });
    }
  });

  // 6. downtime:cancel-activity
  registry.register({
    type: "downtime:cancel-activity",
    visibility: "public",
    description: "Cancels a downtime activity",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return downtimeService.cancelActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: ctx.senderUserId
      });
    }
  });
}
