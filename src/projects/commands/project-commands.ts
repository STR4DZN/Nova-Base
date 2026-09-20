import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import {
  createTransactionalHandler,
  type CommandRegistry
} from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { ProjectsService } from "../services/projects-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";
import type {
  FreshStateWithRevision,
  MutationCoordinator,
  MutationDefinition
} from "../../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../mutations/plans/plan-contract.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";

export interface RegisterProjectCommandsOptions {
  readonly registry: CommandRegistry;
  readonly projectsService: ProjectsService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
  readonly coordinator?: MutationCoordinator;
}

interface DomainFreshState extends FreshStateWithRevision {
  readonly state: DomainDocument;
}

export function registerProjectCommands(options: RegisterProjectCommandsOptions): void {
  const { registry, projectsService, domains, controllerProvider, coordinator } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  function makeMutationDef<TPayload extends { domainUuid: string; projectId?: string; expectedRevision?: number }, TResult>(
    getLockKeys: (p: TPayload) => readonly string[],
    summary: (p: TPayload) => string,
    execute: (p: TPayload, ctx: AuthenticatedCommandContext<TPayload>) => Promise<Result<TResult, PublicError>>
  ): MutationDefinition<TPayload, TResult, DomainFreshState> {
    return {
      getLockKeys: (ctx) => getLockKeys(ctx.command.payload),
      freshRead: async (ctx) => {
        const cleanId = normalizeJournalEntryId(ctx.command.payload.domainUuid);
        const readRes = await domains.read(cleanId);
        if (!readRes.ok) return readRes;
        return ok({
          revision: readRes.value.record.revision,
          state: readRes.value
        });
      },
      buildPlan: async (ctx, freshState) => {
        const p = ctx.command.payload;
        return ok(
          createMutationPlan({
            commandId: ctx.command.commandId,
            lockKeys: getLockKeys(p),
            writeSet: [
              {
                targetRef: `domain:${freshState.state.uuid}`,
                operationType: "update",
                payload: {
                  ...p,
                  commandId: ctx.command.commandId,
                  userId: ctx.senderUserId
                }
              }
            ],
            summary: summary(p)
          })
        );
      },
      commit: async (plan, freshState) => {
        const payload = plan.writeSet[0]?.payload as TPayload;
        const execRes = await execute(payload, { command: { commandId: plan.commandId, payload } } as any);
        if (!execRes.ok) return execRes;
        const readRes = await domains.read(freshState.state.uuid);
        return ok({
          result: execRes.value,
          resultingRevisions: {
            [freshState.state.uuid]: readRes.ok ? readRes.value.record.revision : (freshState.revision ?? 0) + 1
          },
          changed: true,
          summary: summary(payload)
        });
      }
    };
  }

  // 1. projects:start-project
  const startMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`],
    (p: any) => `Start project '${p.name ?? p.definitionId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.startProject({
      domainUuid: p.domainUuid,
      definitionId: p.definitionId,
      name: p.name,
      workRequired: p.workRequired,
      targetRef: p.targetRef,
      initialState: p.initialState,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision,
      workforceRequired: p.workforceRequired,
      contributors: p.contributors,
      commandId: ctx.command.commandId
    })
  );

  registry.register({
    type: "projects:start-project",
    visibility: "public",
    transactional: true,
    description: "Evaluates start preconditions and authoritatively starts a new project",
    mutationDefinition: startMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, startMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.startProject({
            ...p,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId
          });
        },
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
    permissionValidator: validatePerms
  });

  // 2. projects:advance-project
  const advanceMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Advance project '${p.projectId}' by ${p.delta ?? p.units ?? 0} in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.advanceProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      delta: p.delta ?? p.units ?? 0,
      notes: p.notes,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision,
      commandId: ctx.command.commandId
    })
  );

  registry.register({
    type: "projects:advance-project",
    visibility: "public",
    transactional: true,
    description: "Evaluates advance preconditions and authoritatively applies progress to a project",
    mutationDefinition: advanceMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, advanceMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          const delta = p.delta ?? p.units ?? 0;
          return projectsService.advanceProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            delta,
            notes: p.notes,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision,
            commandId: ctx.command.commandId
          });
        },
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
    permissionValidator: validatePerms
  });

  // 3. projects:pause-project
  const pauseMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Pause project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.pauseProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision
    })
  );

  registry.register({
    type: "projects:pause-project",
    visibility: "public",
    transactional: true,
    description: "Pauses an active project",
    mutationDefinition: pauseMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, pauseMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.pauseProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            reason: p.reason,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision
          });
        },
    permissionValidator: validatePerms
  });

  // 4. projects:resume-project
  const resumeMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Resume project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.resumeProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision
    })
  );

  registry.register({
    type: "projects:resume-project",
    visibility: "public",
    transactional: true,
    description: "Resumes a paused project",
    mutationDefinition: resumeMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, resumeMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.resumeProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            reason: p.reason,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision
          });
        },
    permissionValidator: validatePerms
  });

  // 5. projects:cancel-project
  const cancelMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Cancel project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.cancelProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision
    })
  );

  registry.register({
    type: "projects:cancel-project",
    visibility: "public",
    transactional: true,
    description: "Cancels an active or paused project",
    mutationDefinition: cancelMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, cancelMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.cancelProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            reason: p.reason,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision
          });
        },
    permissionValidator: validatePerms
  });

  // 6. projects:block-project
  const blockMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Block project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.blockProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      reason: p.reason ?? "Blocked by authority",
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision
    })
  );

  registry.register({
    type: "projects:block-project",
    visibility: "public",
    transactional: true,
    description: "Blocks a project with a mandatory reason",
    mutationDefinition: blockMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, blockMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.blockProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            reason: p.reason ?? "Blocked by authority",
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision
          });
        },
    permissionValidator: validatePerms
  });

  // 7. projects:unblock-project
  const unblockMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Unblock project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.unblockProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision
    })
  );

  registry.register({
    type: "projects:unblock-project",
    visibility: "public",
    transactional: true,
    description: "Unblocks a blocked project",
    mutationDefinition: unblockMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, unblockMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.unblockProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            reason: p.reason,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision
          });
        },
    permissionValidator: validatePerms
  });

  // 8. projects:complete-project
  const completeMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `project:${p.projectId}`],
    (p: any) => `Complete project '${p.projectId}' in domain '${p.domainUuid}'`,
    (p, ctx) => projectsService.completeProject({
      domainUuid: p.domainUuid,
      projectId: p.projectId,
      options: p.options,
      userId: p.userId ?? ctx.senderUserId,
      expectedRevision: p.expectedRevision,
      commandId: ctx.command.commandId
    })
  );

  registry.register({
    type: "projects:complete-project",
    visibility: "public",
    transactional: true,
    description: "Authoritatively completes a project and resolves coordinated side effects",
    mutationDefinition: completeMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, completeMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return projectsService.completeProject({
            domainUuid: p.domainUuid,
            projectId: p.projectId,
            options: p.options,
            userId: ctx.senderUserId,
            expectedRevision: p.expectedRevision,
            commandId: ctx.command.commandId
          });
        },
    permissionValidator: validatePerms
  });
}
