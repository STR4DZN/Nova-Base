import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import {
  createTransactionalHandler,
  type CommandRegistry
} from "../../commands/command-registry.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DomainControllerProvider } from "../../domains/domain-controller-provider.js";
import type { FacilitiesService } from "../services/facilities-service.js";
import { validatePeopleCommandPermission } from "../../people/commands/people-permissions.js";
import { validateGmOnlyCommandPermission } from "./facility-permissions.js";
import type {
  FreshStateWithRevision,
  MutationCoordinator,
  MutationDefinition
} from "../../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../mutations/plans/plan-contract.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";

export interface RegisterFacilityCommandsOptions {
  readonly registry: CommandRegistry;
  readonly facilitiesService: FacilitiesService;
  readonly domains: DomainRepositoryContract;
  readonly controllerProvider?: DomainControllerProvider;
  readonly coordinator?: MutationCoordinator;
}

interface DomainFreshState extends FreshStateWithRevision {
  readonly state: DomainDocument;
}

export function registerFacilityCommands(options: RegisterFacilityCommandsOptions): void {
  const { registry, facilitiesService, domains, controllerProvider, coordinator } = options;

  function validatePerms(ctx: AuthenticatedCommandContext<any>) {
    return validatePeopleCommandPermission(ctx, domains, (p) => p.domainUuid, {
      controllerProvider
    });
  }

  function makeMutationDef<TPayload extends { domainUuid: string; facilityId?: string; expectedRevision?: number }, TResult>(
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
        const correlationId = (ctx.command as any).correlationId ?? (p as any).correlationId;
        const causationId = (ctx.command as any).causationId ?? (p as any).causationId ?? ctx.command.commandId;
        const authorityEpoch = ctx.authorityEpoch;
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
                  userId: ctx.senderUserId,
                  authorityEpoch,
                  correlationId,
                  causationId
                }
              }
            ],
            customData: {
              authorityEpoch,
              correlationId,
              causationId,
              senderUserId: ctx.senderUserId
            },
            summary: summary(p)
          })
        );
      },
      commit: async (plan, freshState) => {
        const payload = plan.writeSet[0]?.payload as TPayload;
        const customData = (plan.customData ?? {}) as Record<string, unknown>;
        const mergedPayload = {
          ...payload,
          authorityEpoch: customData.authorityEpoch ?? (payload as any).authorityEpoch,
          correlationId: customData.correlationId ?? (payload as any).correlationId,
          causationId: customData.causationId ?? (payload as any).causationId
        };
        const execRes = await execute(mergedPayload, {
          command: { commandId: plan.commandId, payload: mergedPayload },
          senderUserId: (customData.senderUserId as string) ?? (payload as any).userId,
          authorityEpoch: (customData.authorityEpoch as number) ?? 1
        } as any);
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

  // 1. facilities:create-facility
  const createMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`],
    (p: any) => `Create facility '${p.name ?? p.definitionId}' in domain '${p.domainUuid}'`,
    (p, ctx) => facilitiesService.createFacility({
      domainUuid: p.domainUuid,
      definitionId: p.definitionId,
      name: p.name,
      level: p.level,
      initialLifecycle: p.initialLifecycle,
      userId: p.userId ?? ctx.senderUserId,
      commandId: ctx.command.commandId,
      authorityEpoch: ctx.authorityEpoch,
      correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
      causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
    })
  );

  registry.register({
    type: "facilities:create-facility",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a new facility in the domain",
    mutationDefinition: createMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, createMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return facilitiesService.createFacility({
            domainUuid: p.domainUuid,
            definitionId: p.definitionId,
            name: p.name,
            level: p.level,
            initialLifecycle: p.initialLifecycle,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId,
            authorityEpoch: ctx.authorityEpoch,
            correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
            causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
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

  // 2. facilities:maintain-facility
  const maintainMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `facility:${p.facilityId}`],
    (p: any) => `Maintain facility '${p.facilityId}' in domain '${p.domainUuid}'`,
    (p, ctx) => facilitiesService.maintainFacility({
      domainUuid: p.domainUuid,
      facilityId: p.facilityId,
      channelId: p.channelId,
      notes: p.notes,
      userId: p.userId ?? ctx.senderUserId,
      commandId: ctx.command.commandId,
      authorityEpoch: ctx.authorityEpoch,
      correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
      causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
    })
  );

  registry.register({
    type: "facilities:maintain-facility",
    visibility: "public",
    transactional: true,
    description: "Authoritatively executes facility maintenance using evaluateFacilityMaintenancePlan",
    mutationDefinition: maintainMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, maintainMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return facilitiesService.maintainFacility({
            domainUuid: p.domainUuid,
            facilityId: p.facilityId,
            channelId: p.channelId,
            notes: p.notes,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId,
            authorityEpoch: ctx.authorityEpoch,
            correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
            causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
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
    permissionValidator: validatePerms
  });

  // 3. facilities:repair-facility
  const repairMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `facility:${p.facilityId}`],
    (p: any) => `Repair facility '${p.facilityId}' in domain '${p.domainUuid}'`,
    (p, ctx) => facilitiesService.repairFacility({
      domainUuid: p.domainUuid,
      facilityId: p.facilityId,
      restoreIntegrity: p.restoreIntegrity,
      removeConditionIds: p.removeConditionIds,
      notes: p.notes,
      userId: p.userId ?? ctx.senderUserId,
      commandId: ctx.command.commandId,
      authorityEpoch: ctx.authorityEpoch,
      correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
      causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
    })
  );

  registry.register({
    type: "facilities:repair-facility",
    visibility: "public",
    transactional: true,
    description: "Authoritatively executes facility repair; fails closed if engineering project is required",
    mutationDefinition: repairMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, repairMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return facilitiesService.repairFacility({
            domainUuid: p.domainUuid,
            facilityId: p.facilityId,
            restoreIntegrity: p.restoreIntegrity,
            removeConditionIds: p.removeConditionIds,
            notes: p.notes,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId,
            authorityEpoch: ctx.authorityEpoch,
            correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
            causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
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
    permissionValidator: validatePerms
  });

  // 4. facilities:apply-damage
  const damageMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `facility:${p.facilityId}`],
    (p: any) => `Apply damage to facility '${p.facilityId}' in domain '${p.domainUuid}'`,
    (p, ctx) => facilitiesService.applyDamage({
      domainUuid: p.domainUuid,
      facilityId: p.facilityId,
      damage: p.damage ?? 0,
      conditionId: p.conditionId,
      condition: p.condition,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      commandId: ctx.command.commandId,
      authorityEpoch: ctx.authorityEpoch,
      correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
      causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
    })
  );

  registry.register({
    type: "facilities:apply-damage",
    visibility: "public",
    transactional: true,
    description: "Applies damage and degradation to a facility (GM only)",
    mutationDefinition: damageMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, damageMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return facilitiesService.applyDamage({
            domainUuid: p.domainUuid,
            facilityId: p.facilityId,
            damage: p.damage ?? 0,
            conditionId: p.conditionId,
            condition: p.condition,
            reason: p.reason,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId,
            authorityEpoch: ctx.authorityEpoch,
            correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
            causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
          });
        },
    permissionValidator: (ctx) => validateGmOnlyCommandPermission(ctx)
  });

  // 5. facilities:decommission-facility
  const decommissionMutation = makeMutationDef(
    (p: any) => [`domain:${normalizeJournalEntryId(p.domainUuid)}`, `facility:${p.facilityId}`],
    (p: any) => `Decommission facility '${p.facilityId}' in domain '${p.domainUuid}'`,
    (p, ctx) => facilitiesService.decommissionFacility({
      domainUuid: p.domainUuid,
      facilityId: p.facilityId,
      reason: p.reason,
      userId: p.userId ?? ctx.senderUserId,
      commandId: ctx.command.commandId,
      authorityEpoch: ctx.authorityEpoch,
      correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
      causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
    })
  );

  registry.register({
    type: "facilities:decommission-facility",
    visibility: "public",
    transactional: true,
    description: "Decommissions an existing facility",
    mutationDefinition: decommissionMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: coordinator
      ? createTransactionalHandler(coordinator, decommissionMutation as any)
      : async (ctx: AuthenticatedCommandContext<any>) => {
          const p = ctx.command.payload;
          return facilitiesService.decommissionFacility({
            domainUuid: p.domainUuid,
            facilityId: p.facilityId,
            reason: p.reason,
            userId: ctx.senderUserId,
            commandId: ctx.command.commandId,
            authorityEpoch: ctx.authorityEpoch,
            correlationId: (p as any).correlationId ?? (ctx.command as any).correlationId,
            causationId: (p as any).causationId ?? (ctx.command as any).causationId ?? ctx.command.commandId
          });
        },
    permissionValidator: validatePerms
  });
}
