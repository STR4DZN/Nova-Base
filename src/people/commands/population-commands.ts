import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../../commands/authenticated-command-context.js";
import {
  createTransactionalHandler,
  type CommandRegistry
} from "../../commands/command-registry.js";
import type {
  CommitResult,
  FreshStateWithRevision,
  MutationCoordinator,
  MutationDefinition
} from "../../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../../mutations/plans/plan-contract.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";

interface DomainFreshState extends FreshStateWithRevision {
  readonly state: DomainDocument;
}
import {
  getDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../people-data.js";
import {
  validatePopulationGroup,
  validatePopulationState,
  type PopulationGroup,
  type PopulationState
} from "../population/population-types.js";
import { createOpaqueId, isOpaqueId } from "../../core/identity/ids.js";
import { validatePeopleCommandPermission } from "./people-permissions.js";

export interface SetPopulationPayload {
  readonly domainUuid: string;
  readonly population: {
    readonly mode: string;
    readonly total: number | null;
    readonly precision: string;
  };
  readonly expectedRevision?: number;
}

export interface CreatePopulationGroupPayload {
  readonly domainUuid: string;
  readonly group: {
    readonly name: string;
    readonly count: number | null;
    readonly precision?: "exact" | "estimated" | "unknown";
    readonly includedInTotal: boolean;
    readonly visibility?: "public" | "secret";
    readonly workforceContributions?: readonly { readonly workforceTypeId: string; readonly amount: number }[];
    readonly tags?: readonly string[];
    readonly notes?: string;
  };
  readonly expectedRevision?: number;
}

export interface UpdatePopulationGroupPayload {
  readonly domainUuid: string;
  readonly groupId: string;
  readonly patch: {
    readonly name?: string;
    readonly count?: number | null;
    readonly precision?: "exact" | "estimated" | "unknown";
    readonly includedInTotal?: boolean;
    readonly visibility?: "public" | "secret";
    readonly workforceContributions?: readonly { readonly workforceTypeId: string; readonly amount: number }[];
    readonly tags?: readonly string[];
    readonly notes?: string;
  };
  readonly expectedRevision?: number;
}

export interface DeletePopulationGroupPayload {
  readonly domainUuid: string;
  readonly groupId: string;
  readonly expectedRevision?: number;
}

function resolveDomainId(domainUuid: string): string {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}

export function registerPopulationCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. people:set-population
  const setPopulationMutation: MutationDefinition<SetPopulationPayload, DomainDocument, DomainFreshState> = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state as DomainDocument;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const popValidation = validatePopulationState(ctx.command.payload.population);
      if (!popValidation.ok) {
        return popValidation;
      }

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        population: popValidation.value
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Set population on domain '${domainDoc.name}' (${domainDoc.uuid}) to mode '${popValidation.value.mode}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload as DomainDocument;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: targetDoc,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated population for domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:set-population",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates population state for a domain",
    mutationDefinition: setPopulationMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, setPopulationMutation as any),
    schemaValidator: (payload) => {
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      const val = validatePopulationState(p.population);
      if (!val.ok) return val;
      return ok(payload as SetPopulationPayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });

  // 2. people:create-population-group
  const createGroupMutation: MutationDefinition<CreatePopulationGroupPayload, PopulationGroup, DomainFreshState> = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state as DomainDocument;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const groupInput = ctx.command.payload.group;

      const newGroupId = createOpaqueId("pop");
      const groupCandidate = {
        id: newGroupId,
        name: groupInput.name,
        count: groupInput.count,
        precision: groupInput.precision,
        includedInTotal: groupInput.includedInTotal,
        visibility: groupInput.visibility,
        workforceContributions: groupInput.workforceContributions,
        tags: groupInput.tags ?? [],
        notes: groupInput.notes
      };

      const groupValidation = validatePopulationGroup(groupCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }

      const updatedGroups = Object.freeze([...currentPeople.populationGroups, groupValidation.value]);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        populationGroups: updatedGroups
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Create population group '${groupValidation.value.name}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload as DomainDocument;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);

      const people = getDomainPeopleData(targetDoc.record);
      const createdGroup = people.populationGroups[people.populationGroups.length - 1];

      return ok({
        result: createdGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created population group '${createdGroup.name}' (${createdGroup.id})`
      });
    }
  };

  registry.register({
    type: "people:create-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a population group in a domain",
    mutationDefinition: createGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createGroupMutation as any),
    schemaValidator: (payload) => {
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.group || typeof p.group !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "group is required"
          })
        );
      }
      const g = p.group as Record<string, unknown>;
      if (typeof g.name !== "string" || g.name.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "group.name must be a non-empty string"
          })
        );
      }
      return ok(payload as CreatePopulationGroupPayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });

  // 3. people:update-population-group
  const updateGroupMutation: MutationDefinition<UpdatePopulationGroupPayload, PopulationGroup, DomainFreshState> = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state as DomainDocument;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId, patch } = ctx.command.payload;

      const existingIndex = currentPeople.populationGroups.findIndex((g) => g.id === groupId);
      if (existingIndex === -1) {
        return err(
          createPublicError({
            code: "DM_POPULATION_GROUP_NOT_FOUND",
            category: "not-found",
            message: `PopulationGroup '${groupId}' not found`
          })
        );
      }

      const existing = currentPeople.populationGroups[existingIndex];
      const mergedCandidate = {
        id: existing.id,
        name: patch.name !== undefined ? patch.name : existing.name,
        count: patch.count !== undefined ? patch.count : existing.count,
        precision: patch.precision !== undefined ? patch.precision : existing.precision,
        includedInTotal: patch.includedInTotal !== undefined ? patch.includedInTotal : existing.includedInTotal,
        visibility: patch.visibility !== undefined ? patch.visibility : existing.visibility,
        workforceContributions: patch.workforceContributions !== undefined ? patch.workforceContributions : existing.workforceContributions,
        tags: patch.tags !== undefined ? patch.tags : existing.tags,
        notes: patch.notes !== undefined ? patch.notes : existing.notes
      };

      const groupValidation = validatePopulationGroup(mergedCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }

      const updatedGroups = [...currentPeople.populationGroups];
      updatedGroups[existingIndex] = groupValidation.value;

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        populationGroups: Object.freeze(updatedGroups)
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { groupId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Update population group '${groupValidation.value.name}' (${groupId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload as DomainDocument;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);

      const people = getDomainPeopleData(targetDoc.record);
      const targetGroupId = (plan.customData as { groupId?: string })?.groupId;
      const updatedGroup = people.populationGroups.find((g) => g.id === targetGroupId) ?? people.populationGroups[0];

      return ok({
        result: updatedGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated population group in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:update-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates a population group in a domain",
    mutationDefinition: updateGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, updateGroupMutation as any),
    schemaValidator: (payload) => {
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "pop")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (pop_*) is required"
          })
        );
      }
      return ok(payload as UpdatePopulationGroupPayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });

  // 4. people:delete-population-group
  const deleteGroupMutation: MutationDefinition<DeletePopulationGroupPayload, { deletedGroupId: string }, DomainFreshState> = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state as DomainDocument;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId } = ctx.command.payload;

      const existing = currentPeople.populationGroups.find((g) => g.id === groupId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_POPULATION_GROUP_NOT_FOUND",
            category: "not-found",
            message: `PopulationGroup '${groupId}' not found`
          })
        );
      }

      const updatedGroups = currentPeople.populationGroups.filter((g) => g.id !== groupId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        populationGroups: Object.freeze(updatedGroups)
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Delete population group '${existing.name}' (${groupId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload as DomainDocument;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);

      return ok({
        result: { deletedGroupId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted population group in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:delete-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a population group in a domain",
    mutationDefinition: deleteGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, deleteGroupMutation as any),
    schemaValidator: (payload) => {
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "pop")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (pop_*) is required"
          })
        );
      }
      return ok(payload as DeletePopulationGroupPayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}
