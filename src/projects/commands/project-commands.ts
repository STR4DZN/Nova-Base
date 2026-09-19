import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { CommandRegistry } from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { ProjectsService } from "../services/projects-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";

export interface RegisterProjectCommandsOptions {
  readonly registry: CommandRegistry;
  readonly projectsService: ProjectsService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
}

export function registerProjectCommands(options: RegisterProjectCommandsOptions): void {
  const { registry, projectsService, domains, controllerProvider } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  // 1. projects:start-project
  registry.register({
    type: "projects:start-project",
    visibility: "public",
    description: "Evaluates start preconditions and authoritatively starts a new project",
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
      return projectsService.startProject({
        domainUuid: p.domainUuid,
        definitionId: p.definitionId,
        name: p.name,
        workRequired: p.workRequired,
        targetRef: p.targetRef,
        initialState: p.initialState,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 2. projects:advance-project
  registry.register({
    type: "projects:advance-project",
    visibility: "public",
    description: "Evaluates advance preconditions and authoritatively applies progress to a project",
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
      if (typeof p.projectId !== "string" || !p.projectId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "projectId is required"
          })
        );
      }
      if (typeof p.delta !== "number" && typeof p.units !== "number") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "delta (or units) must be a number"
          })
        );
      }
      return ok(p as any);
    },
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      const delta = p.delta ?? p.units ?? 0;
      return projectsService.advanceProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        delta,
        notes: p.notes,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 3. projects:pause-project
  registry.register({
    type: "projects:pause-project",
    visibility: "public",
    description: "Pauses an active project",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.pauseProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        reason: p.reason,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 4. projects:resume-project
  registry.register({
    type: "projects:resume-project",
    visibility: "public",
    description: "Resumes a paused project",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.resumeProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        reason: p.reason,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 5. projects:cancel-project
  registry.register({
    type: "projects:cancel-project",
    visibility: "public",
    description: "Cancels an active or paused project",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.cancelProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        reason: p.reason,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 6. projects:block-project
  registry.register({
    type: "projects:block-project",
    visibility: "public",
    description: "Blocks a project with a mandatory reason",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.blockProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        reason: p.reason ?? "Blocked by authority",
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 7. projects:unblock-project
  registry.register({
    type: "projects:unblock-project",
    visibility: "public",
    description: "Unblocks a blocked project",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.unblockProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        reason: p.reason,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });

  // 8. projects:complete-project
  registry.register({
    type: "projects:complete-project",
    visibility: "public",
    description: "Authoritatively completes a project and resolves coordinated side effects",
    permissionValidator: validatePerms,
    handler: async (ctx: AuthenticatedCommandContext<any>) => {
      const p = ctx.command.payload;
      return projectsService.completeProject({
        domainUuid: p.domainUuid,
        projectId: p.projectId,
        options: p.options,
        userId: ctx.senderUserId,
        expectedRevision: p.expectedRevision
      });
    }
  });
}
