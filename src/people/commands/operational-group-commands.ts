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
  validateOperationalGroup,
  type OperationalGroup,
  type OperationalGroupLifecycle,
  type OperationalGroupMembershipMode,
  type OperationalGroupVisibility
} from "../operational-groups/operational-group-types.js";
import { createOpaqueId, isOpaqueId } from "../../core/identity/ids.js";

export interface CreateOperationalGroupPayload {
  readonly domainUuid: string;
  readonly group: {
    readonly name: string;
    readonly definitionId: string;
    readonly membershipMode?: OperationalGroupMembershipMode;
    readonly size?: number;
    readonly members?: readonly string[];
    readonly lifecycle?: OperationalGroupLifecycle;
    readonly visibility?: OperationalGroupVisibility;
    readonly populationGroupId?: string;
    readonly notes?: string;
    readonly tags?: readonly string[];
  };
  readonly expectedRevision?: number;
}

export interface UpdateOperationalGroupPayload {
  readonly domainUuid: string;
  readonly groupId: string;
  readonly update: {
    readonly name?: string;
    readonly membershipMode?: OperationalGroupMembershipMode;
    readonly size?: number;
    readonly members?: readonly string[];
    readonly lifecycle?: OperationalGroupLifecycle;
    readonly visibility?: OperationalGroupVisibility;
    readonly populationGroupId?: string | null;
    readonly notes?: string | null;
    readonly tags?: readonly string[];
  };
  readonly expectedRevision?: number;
}

export interface DeleteOperationalGroupPayload {
  readonly domainUuid: string;
  readonly groupId: string;
  readonly expectedRevision?: number;
}

function resolveDomainId(domainUuid: string): string {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}

function requireGmPermission(ctx: AuthenticatedCommandContext): Result<boolean, PublicError> {
  if (ctx.senderUserId !== null && ctx.senderUserId !== ctx.authorityUserId) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Only GM can execute operational group commands"
      })
    );
  }
  return ok(true);
}

export function registerOperationalGroupCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. people:create-operational-group
  const createOperationalGroupMutation: MutationDefinition<
    CreateOperationalGroupPayload,
    OperationalGroup,
    DomainFreshState
  > = {
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

      const newGroupId = createOpaqueId("opg");
      const candidate = {
        id: newGroupId,
        name: groupInput.name,
        definitionId: groupInput.definitionId,
        membershipMode: groupInput.membershipMode,
        size: groupInput.size,
        members: groupInput.members,
        lifecycle: groupInput.lifecycle,
        visibility: groupInput.visibility,
        populationGroupId: groupInput.populationGroupId,
        notes: groupInput.notes,
        tags: groupInput.tags
      };

      const groupValidation = validateOperationalGroup(candidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }
      const newGroup = groupValidation.value;

      // Verify all members exist in domain notables (DEC-1069)
      for (const memberId of newGroup.members) {
        const notableExists = currentPeople.notables.some((n) => n.id === memberId);
        if (!notableExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_NOT_FOUND",
              category: "not-found",
              message: `Member notable '${memberId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }

      // Verify populationGroupId if linked
      if (newGroup.populationGroupId !== undefined) {
        const popGroupExists = currentPeople.populationGroups.some(
          (pg) => pg.id === newGroup.populationGroupId
        );
        if (!popGroupExists) {
          return err(
            createPublicError({
              code: "DM_POPULATION_GROUP_NOT_FOUND",
              category: "not-found",
              message: `Linked population group '${newGroup.populationGroupId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }

      const updatedGroups = Object.freeze([...currentPeople.operationalGroups, newGroup]);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        operationalGroups: updatedGroups
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
        summary: `Create operational group '${newGroup.name}' in domain '${domainDoc.name}'`
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
      const createdGroup = people.operationalGroups[people.operationalGroups.length - 1];

      return ok({
        result: createdGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created operational group in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:create-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates an operational group in a domain",
    mutationDefinition: createOperationalGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createOperationalGroupMutation as any),
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
      return ok(payload as CreateOperationalGroupPayload);
    },
    permissionValidator: requireGmPermission
  });

  // 2. people:update-operational-group
  const updateOperationalGroupMutation: MutationDefinition<
    UpdateOperationalGroupPayload,
    OperationalGroup,
    DomainFreshState
  > = {
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
      const { groupId, update } = ctx.command.payload;

      const groupIndex = currentPeople.operationalGroups.findIndex((g) => g.id === groupId);
      if (groupIndex === -1) {
        return err(
          createPublicError({
            code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
            category: "not-found",
            message: `OperationalGroup '${groupId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const existing = currentPeople.operationalGroups[groupIndex];
      const mergedCandidate = {
        id: existing.id,
        name: update.name !== undefined ? update.name : existing.name,
        definitionId: existing.definitionId,
        membershipMode: update.membershipMode !== undefined ? update.membershipMode : existing.membershipMode,
        size: update.size !== undefined ? update.size : existing.size,
        members: update.members !== undefined ? update.members : existing.members,
        lifecycle: update.lifecycle !== undefined ? update.lifecycle : existing.lifecycle,
        visibility: update.visibility !== undefined ? update.visibility : existing.visibility,
        populationGroupId:
          update.populationGroupId === null
            ? undefined
            : update.populationGroupId !== undefined
              ? update.populationGroupId
              : existing.populationGroupId,
        notes:
          update.notes === null
            ? undefined
            : update.notes !== undefined
              ? update.notes
              : existing.notes,
        tags: update.tags !== undefined ? update.tags : existing.tags
      };

      const groupValidation = validateOperationalGroup(mergedCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }

      const updatedGroup = groupValidation.value;

      // Validate member existence if explicit or partial
      if (updatedGroup.membershipMode !== "abstract" && updatedGroup.members.length > 0) {
        for (const notableId of updatedGroup.members) {
          const notableExists = currentPeople.notables.some((n) => n.id === notableId);
          if (!notableExists) {
            return err(
              createPublicError({
                code: "DM_OPERATIONAL_GROUP_NOTABLE_NOT_FOUND",
                category: "not-found",
                message: `Member notable '${notableId}' not found in domain '${domainDoc.name}'`
              })
            );
          }
        }
      }

      // Validate populationGroupId if linked
      if (updatedGroup.populationGroupId) {
        const popGroupExists = currentPeople.populationGroups.some((g) => g.id === updatedGroup.populationGroupId);
        if (!popGroupExists) {
          return err(
            createPublicError({
              code: "DM_OPERATIONAL_GROUP_POP_NOT_FOUND",
              category: "not-found",
              message: `Linked PopulationGroup '${updatedGroup.populationGroupId}' not found in domain '${domainDoc.name}'`
            })
          );
        }
      }

      const updatedGroups = [...currentPeople.operationalGroups];
      updatedGroups[groupIndex] = updatedGroup;

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        operationalGroups: Object.freeze(updatedGroups)
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
        summary: `Update operational group '${updatedGroup.name}' in domain '${domainDoc.name}'`
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
      const updatedGroup = people.operationalGroups.find((g) => g.id === targetGroupId) ?? people.operationalGroups[0];

      return ok({
        result: updatedGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated operational group in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:update-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates an operational group in a domain",
    mutationDefinition: updateOperationalGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, updateOperationalGroupMutation as any),
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
      if (!isOpaqueId(p.groupId, "opg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (opg_*) is required"
          })
        );
      }
      if (!p.update || typeof p.update !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "update is required"
          })
        );
      }
      return ok(payload as UpdateOperationalGroupPayload);
    },
    permissionValidator: requireGmPermission
  });

  // 3. people:delete-operational-group
  const deleteOperationalGroupMutation: MutationDefinition<
    DeleteOperationalGroupPayload,
    { deletedGroupId: string },
    DomainFreshState
  > = {
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

      const existing = currentPeople.operationalGroups.find((g) => g.id === groupId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
            category: "not-found",
            message: `OperationalGroup '${groupId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const updatedGroups = currentPeople.operationalGroups.filter((g) => g.id !== groupId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        operationalGroups: Object.freeze(updatedGroups)
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
        summary: `Delete operational group '${existing.name}' (${groupId}) in domain '${domainDoc.name}'`
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
        summary: `Deleted operational group in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:delete-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes an operational group in a domain",
    mutationDefinition: deleteOperationalGroupMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, deleteOperationalGroupMutation as any),
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
      if (!isOpaqueId(p.groupId, "opg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (opg_*) is required"
          })
        );
      }
      return ok(payload as DeleteOperationalGroupPayload);
    },
    permissionValidator: requireGmPermission
  });
}
