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
  validateNotable,
  type Notable,
  type NotableVisibility
} from "../notables/notable-types.js";
import { createOpaqueId, isOpaqueId } from "../../core/identity/ids.js";
import { isActorUuid } from "../../core/identity/refs.js";
import { validatePeopleCommandPermission } from "./people-permissions.js";

export interface CreateNotablePayload {
  readonly domainUuid: string;
  readonly notable: {
    readonly type: "inline" | "actor";
    readonly name?: string;
    readonly actorUuid?: string;
    readonly portrait?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly visibility?: NotableVisibility;
  };
  readonly expectedRevision?: number;
}

export interface UpdateNotablePayload {
  readonly domainUuid: string;
  readonly notableId: string;
  readonly patch: {
    readonly name?: string;
    readonly portrait?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly visibility?: NotableVisibility;
    readonly convertToActorUuid?: string;
  };
  readonly expectedRevision?: number;
}

export interface DeleteNotablePayload {
  readonly domainUuid: string;
  readonly notableId: string;
  readonly expectedRevision?: number;
}

function resolveDomainId(domainUuid: string): string {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}

export function registerNotableCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. people:create-notable
  const createNotableMutation: MutationDefinition<CreateNotablePayload, Notable, DomainFreshState> = {
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
      const notableInput = ctx.command.payload.notable;

      const newNotableId = createOpaqueId("not");
      const candidate = {
        id: newNotableId,
        ...notableInput
      };

      const notableValidation = validateNotable(candidate);
      if (!notableValidation.ok) {
        return notableValidation;
      }
      const newNotable = notableValidation.value;

      // Anti-duplicate Actor check within the same domain (DEC-0974)
      if (newNotable.type === "actor") {
        const alreadyExists = currentPeople.notables.some(
          (n) => n.type === "actor" && n.actorUuid === newNotable.actorUuid
        );
        if (alreadyExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_DUPLICATE_ACTOR",
              category: "validation",
              message: `Actor '${newNotable.actorUuid}' is already linked to a Notable in domain '${domainDoc.name}'`
            })
          );
        }
      }

      const updatedNotables = Object.freeze([...currentPeople.notables, newNotable]);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        notables: updatedNotables
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
        summary: `Create notable '${newNotable.type === "inline" ? newNotable.name : (newNotable.name ?? newNotable.actorUuid)}' in domain '${domainDoc.name}'`
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
      const createdNotable = people.notables[people.notables.length - 1];

      return ok({
        result: createdNotable,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created notable in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:create-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a notable in a domain",
    mutationDefinition: createNotableMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createNotableMutation as any),
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
      if (!p.notable || typeof p.notable !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "notable is required"
          })
        );
      }
      return ok(payload as CreateNotablePayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });

  // 2. people:update-notable
  const updateNotableMutation: MutationDefinition<UpdateNotablePayload, Notable, DomainFreshState> = {
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
      const { notableId, patch } = ctx.command.payload;

      const existingIndex = currentPeople.notables.findIndex((n) => n.id === notableId);
      if (existingIndex === -1) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const existing = currentPeople.notables[existingIndex];
      let candidate: Record<string, unknown>;

      if (patch.convertToActorUuid) {
        // Converting to actor-linked (DEC-0962)
        if (!isActorUuid(patch.convertToActorUuid)) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_INVALID_ACTOR",
              category: "validation",
              message: `Invalid Foundry Actor UUID: '${patch.convertToActorUuid}'`
            })
          );
        }
        // Anti-duplicate check
        const alreadyLinked = currentPeople.notables.some(
          (n) => n.id !== notableId && n.type === "actor" && n.actorUuid === patch.convertToActorUuid
        );
        if (alreadyLinked) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_DUPLICATE_ACTOR",
              category: "validation",
              message: `Actor '${patch.convertToActorUuid}' is already linked to another Notable in this domain`
            })
          );
        }

        candidate = {
          id: existing.id,
          type: "actor",
          actorUuid: patch.convertToActorUuid,
          name: patch.name !== undefined ? patch.name : existing.name,
          description: patch.description !== undefined ? patch.description : existing.description,
          tags: patch.tags !== undefined ? patch.tags : existing.tags,
          visibility: patch.visibility !== undefined ? patch.visibility : existing.visibility
        };
      } else if (existing.type === "actor") {
        candidate = {
          id: existing.id,
          type: "actor",
          actorUuid: existing.actorUuid,
          name: patch.name !== undefined ? patch.name : existing.name,
          description: patch.description !== undefined ? patch.description : existing.description,
          tags: patch.tags !== undefined ? patch.tags : existing.tags,
          visibility: patch.visibility !== undefined ? patch.visibility : existing.visibility
        };
      } else {
        candidate = {
          id: existing.id,
          type: "inline",
          name: patch.name !== undefined ? patch.name : existing.name,
          portrait: patch.portrait !== undefined ? patch.portrait : existing.portrait,
          description: patch.description !== undefined ? patch.description : existing.description,
          tags: patch.tags !== undefined ? patch.tags : existing.tags,
          visibility: patch.visibility !== undefined ? patch.visibility : existing.visibility
        };
      }

      const notableValidation = validateNotable(candidate);
      if (!notableValidation.ok) {
        return notableValidation;
      }

      const updatedNotables = [...currentPeople.notables];
      updatedNotables[existingIndex] = notableValidation.value;

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        notables: Object.freeze(updatedNotables)
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { notableId },
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
        summary: `Update notable '${notableId}' in domain '${domainDoc.name}'`
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
      const targetNotableId = (plan.customData as { notableId?: string })?.notableId;
      const updatedNotable = people.notables.find((n) => n.id === targetNotableId) ?? people.notables[0];

      return ok({
        result: updatedNotable,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated notable in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:update-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates a notable in a domain",
    mutationDefinition: updateNotableMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, updateNotableMutation as any),
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
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      if (!p.patch || typeof p.patch !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "patch is required"
          })
        );
      }
      return ok(payload as UpdateNotablePayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });

  // 3. people:delete-notable
  const deleteNotableMutation: MutationDefinition<DeleteNotablePayload, { deletedNotableId: string }, DomainFreshState> = {
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
      const { notableId } = ctx.command.payload;

      const existing = currentPeople.notables.find((n) => n.id === notableId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      // Guard: Cannot delete a Notable that is currently assigned to a Role (DEC-0954)
      const assignedRole = currentPeople.roles.find((r) => r.occupants.includes(notableId));
      if (assignedRole) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_ASSIGNED_TO_ROLE",
            category: "conflict",
            message: `Cannot delete notable '${notableId}': currently assigned to role '${assignedRole.customLabel ?? assignedRole.definitionId}' (${assignedRole.id})`
          })
        );
      }

      const updatedNotables = currentPeople.notables.filter((n) => n.id !== notableId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        notables: Object.freeze(updatedNotables)
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
        summary: `Delete notable '${notableId}' in domain '${domainDoc.name}'`
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
        result: { deletedNotableId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted notable in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:delete-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a notable in a domain",
    mutationDefinition: deleteNotableMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, deleteNotableMutation as any),
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
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      return ok(payload as DeleteNotablePayload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

