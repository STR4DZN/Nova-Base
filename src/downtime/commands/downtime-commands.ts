import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import {
  createTransactionalHandler,
  type CommandRegistry
} from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { DowntimeService } from "../services/downtime-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";
import type {
  FreshStateWithRevision,
  MutationCoordinator,
  MutationDefinition
} from "../../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../mutations/plans/plan-contract.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";

export interface RegisterDowntimeCommandsOptions {
  readonly registry: CommandRegistry;
  readonly downtimeService: DowntimeService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
  readonly coordinator?: MutationCoordinator;
}

interface DomainFreshState extends FreshStateWithRevision {
  readonly state: DomainDocument;
}

export function registerDowntimeCommands(options: RegisterDowntimeCommandsOptions): void {
  const { registry, downtimeService, domains, controllerProvider, coordinator } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  function makeMutationDef<TPayload extends { domainUuid: string; activityId?: string; expectedRevision?: number }, TResult>(
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

  // 1. downtime:start-activity
  const startMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`],
    (p: any) => `Start downtime activity '${p.label ?? p.definitionId}' in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.startActivity({
        domainUuid: p.domainUuid,
        definitionId: p.definitionId,
        label: p.label,
        scope: p.scope,
        durationTicks: p.durationTicks,
        participantRef: p.participantRef,
        participants: p.participants,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:start-activity",
    visibility: "public",
    transactional: true,
    description: "Authoritatively starts a new downtime activity after validating participant requirements",
    mutationDefinition: startMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, startMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.startActivity({
            domainUuid: p.domainUuid,
            definitionId: p.definitionId,
            label: p.label,
            scope: p.scope,
            durationTicks: p.durationTicks,
            participantRef: p.participantRef,
            participants: p.participants,
            userId: ctx.senderUserId
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

  // 2. downtime:advance-activity
  const advanceMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `downtime:${p.activityId}`],
    (p: any) => `Advance downtime activity '${p.activityId}' by ${p.ticks} ticks in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.advanceActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        ticks: p.ticks,
        notes: p.notes,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:advance-activity",
    visibility: "public",
    transactional: true,
    description: "Advances downtime activity progress and automatically resolves outcomes upon reaching duration",
    mutationDefinition: advanceMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, advanceMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.advanceActivity({
            domainUuid: p.domainUuid,
            activityId: p.activityId,
            ticks: p.ticks,
            notes: p.notes,
            userId: ctx.senderUserId
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
    permissionValidator: validatePerms
  });

  // 3. downtime:complete-activity
  const completeMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `downtime:${p.activityId}`],
    (p: any) => `Complete downtime activity '${p.activityId}' in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.completeActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        outcomeKey: p.outcomeKey,
        notes: p.notes,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:complete-activity",
    visibility: "public",
    transactional: true,
    description: "Authoritatively completes a downtime activity and resolves configured outcomes",
    mutationDefinition: completeMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, completeMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.completeActivity({
            domainUuid: p.domainUuid,
            activityId: p.activityId,
            outcomeKey: p.outcomeKey,
            notes: p.notes,
            userId: ctx.senderUserId
          });
        },
    permissionValidator: validatePerms
  });

  // 4. downtime:pause-activity
  const pauseMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `downtime:${p.activityId}`],
    (p: any) => `Pause downtime activity '${p.activityId}' in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.pauseActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:pause-activity",
    visibility: "public",
    transactional: true,
    description: "Pauses an in-progress downtime activity",
    mutationDefinition: pauseMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, pauseMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.pauseActivity({
            domainUuid: p.domainUuid,
            activityId: p.activityId,
            reason: p.reason,
            userId: ctx.senderUserId
          });
        },
    permissionValidator: validatePerms
  });

  // 5. downtime:resume-activity
  const resumeMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `downtime:${p.activityId}`],
    (p: any) => `Resume downtime activity '${p.activityId}' in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.resumeActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:resume-activity",
    visibility: "public",
    transactional: true,
    description: "Resumes a paused downtime activity",
    mutationDefinition: resumeMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, resumeMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.resumeActivity({
            domainUuid: p.domainUuid,
            activityId: p.activityId,
            reason: p.reason,
            userId: ctx.senderUserId
          });
        },
    permissionValidator: validatePerms
  });

  // 6. downtime:cancel-activity
  const cancelMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `downtime:${p.activityId}`],
    (p: any) => `Cancel downtime activity '${p.activityId}' in domain '${p.domainUuid}'`,
    (p, ctx) =>
      downtimeService.cancelActivity({
        domainUuid: p.domainUuid,
        activityId: p.activityId,
        reason: p.reason,
        userId: p.userId ?? ctx.senderUserId
      })
  );

  registry.register({
    type: "downtime:cancel-activity",
    visibility: "public",
    transactional: true,
    description: "Cancels a downtime activity",
    mutationDefinition: cancelMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, cancelMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return downtimeService.cancelActivity({
            domainUuid: p.domainUuid,
            activityId: p.activityId,
            reason: p.reason,
            userId: ctx.senderUserId
          });
        },
    permissionValidator: validatePerms
  });
}

