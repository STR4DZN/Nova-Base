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
  DEFAULT_ROLE_DEFINITIONS,
  validateDomainRole,
  type DomainRole,
  type RoleVisibility
} from "../roles/role-types.js";
import { createOpaqueId, isOpaqueId } from "../../core/identity/ids.js";

export interface CreateRolePayload {
  readonly domainUuid: string;
  readonly role: {
    readonly definitionId: string;
    readonly customLabel?: string;
    readonly occupants?: readonly string[];
    readonly visibility?: RoleVisibility;
    readonly notes?: string;
    readonly tags?: readonly string[];
  };
  readonly expectedRevision?: number;
}

export interface AssignRolePayload {
  readonly domainUuid: string;
  readonly roleId: string;
  readonly notableId: string;
  readonly expectedRevision?: number;
}

export interface UnassignRolePayload {
  readonly domainUuid: string;
  readonly roleId: string;
  readonly notableId: string;
  readonly expectedRevision?: number;
}

export interface DeleteRolePayload {
  readonly domainUuid: string;
  readonly roleId: string;
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
        message: "Only GM can execute role commands"
      })
    );
  }
  return ok(true);
}

export function registerRoleCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. people:create-role
  const createRoleMutation: MutationDefinition<CreateRolePayload, DomainRole, DomainFreshState> = {
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
      const roleInput = ctx.command.payload.role;

      const newRoleId = createOpaqueId("role");
      const candidate = {
        id: newRoleId,
        definitionId: roleInput.definitionId,
        customLabel: roleInput.customLabel,
        occupants: roleInput.occupants ?? [],
        visibility: roleInput.visibility ?? "public",
        notes: roleInput.notes,
        tags: roleInput.tags ?? []
      };

      const roleValidation = validateDomainRole(candidate, DEFAULT_ROLE_DEFINITIONS);
      if (!roleValidation.ok) {
        return roleValidation;
      }
      const newRole = roleValidation.value;

      // Verify all occupants exist in domain notables (DEC-0996)
      for (const occupantId of newRole.occupants) {
        const notableExists = currentPeople.notables.some((n) => n.id === occupantId);
        if (!notableExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_NOT_FOUND",
              category: "not-found",
              message: `Occupant notable '${occupantId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }

      const updatedRoles = Object.freeze([...currentPeople.roles, newRole]);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        roles: updatedRoles
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
        summary: `Create role '${newRole.customLabel ?? newRole.definitionId}' in domain '${domainDoc.name}'`
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
      const createdRole = people.roles[people.roles.length - 1];

      return ok({
        result: createdRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created role in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:create-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a role in a domain",
    mutationDefinition: createRoleMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createRoleMutation as any),
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
      if (!p.role || typeof p.role !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "role is required"
          })
        );
      }
      return ok(payload as CreateRolePayload);
    },
    permissionValidator: requireGmPermission
  });

  // 2. people:assign-role
  const assignRoleMutation: MutationDefinition<AssignRolePayload, DomainRole, DomainFreshState> = {
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
      const { roleId, notableId } = ctx.command.payload;

      const roleIndex = currentPeople.roles.findIndex((r) => r.id === roleId);
      if (roleIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      // Verify notable exists in domain (DEC-0996)
      const notable = currentPeople.notables.find((n) => n.id === notableId);
      if (!notable) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const currentRole = currentPeople.roles[roleIndex];

      // Anti-duplicate occupant in same role
      if (currentRole.occupants.includes(notableId)) {
        return err(
          createPublicError({
            code: "DM_ROLE_DUPLICATE_OCCUPANT",
            category: "validation",
            message: `Notable '${notableId}' is already assigned to role '${currentRole.id}'`
          })
        );
      }

      const definition = DEFAULT_ROLE_DEFINITIONS.find((d) => d.id === currentRole.definitionId);
      if (definition && definition.occupancy.max !== null && currentRole.occupants.length >= definition.occupancy.max) {
        return err(
          createPublicError({
            code: "DM_ROLE_OCCUPANCY_EXCEEDED",
            category: "validation",
            message: `Role '${currentRole.id}' is already at maximum capacity (${definition.occupancy.max})`
          })
        );
      }

      const updatedOccupants = Object.freeze([...currentRole.occupants, notableId]);
      const updatedRole: DomainRole = {
        ...currentRole,
        occupants: updatedOccupants
      };

      const updatedRoles = [...currentPeople.roles];
      updatedRoles[roleIndex] = updatedRole;

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { roleId },
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
        summary: `Assign notable '${notableId}' to role '${currentRole.id}' in domain '${domainDoc.name}'`
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
      const targetRoleId = (plan.customData as { roleId?: string })?.roleId;
      const updatedRole = people.roles.find((r) => r.id === targetRoleId) ?? people.roles[0];

      return ok({
        result: updatedRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Assigned occupant to role in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:assign-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively assigns a notable to a role in a domain",
    mutationDefinition: assignRoleMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, assignRoleMutation as any),
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
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
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
      return ok(payload as AssignRolePayload);
    },
    permissionValidator: requireGmPermission
  });

  // 3. people:unassign-role
  const unassignRoleMutation: MutationDefinition<UnassignRolePayload, DomainRole, DomainFreshState> = {
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
      const { roleId, notableId } = ctx.command.payload;

      const roleIndex = currentPeople.roles.findIndex((r) => r.id === roleId);
      if (roleIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const currentRole = currentPeople.roles[roleIndex];

      if (!currentRole.occupants.includes(notableId)) {
        return err(
          createPublicError({
            code: "DM_ROLE_OCCUPANT_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' is not an occupant of role '${currentRole.id}'`
          })
        );
      }

      const updatedOccupants = Object.freeze(currentRole.occupants.filter((id) => id !== notableId));
      const updatedRole: DomainRole = {
        ...currentRole,
        occupants: updatedOccupants
      };

      const updatedRoles = [...currentPeople.roles];
      updatedRoles[roleIndex] = updatedRole;

      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
      };

      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { roleId },
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
        summary: `Unassign notable '${notableId}' from role '${currentRole.id}' in domain '${domainDoc.name}'`
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
      const targetRoleId = (plan.customData as { roleId?: string })?.roleId;
      const updatedRole = people.roles.find((r) => r.id === targetRoleId) ?? people.roles[0];

      return ok({
        result: updatedRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Unassigned occupant from role in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:unassign-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively unassigns a notable from a role in a domain",
    mutationDefinition: unassignRoleMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, unassignRoleMutation as any),
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
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
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
      return ok(payload as UnassignRolePayload);
    },
    permissionValidator: requireGmPermission
  });

  // 4. people:delete-role
  const deleteRoleMutation: MutationDefinition<DeleteRolePayload, { deletedRoleId: string }, DomainFreshState> = {
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
      const { roleId } = ctx.command.payload;

      const existing = currentPeople.roles.find((r) => r.id === roleId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      const updatedRoles = currentPeople.roles.filter((r) => r.id !== roleId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
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
        summary: `Delete role '${existing.customLabel ?? existing.definitionId}' (${roleId}) in domain '${domainDoc.name}'`
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
        result: { deletedRoleId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted role in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:delete-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a role in a domain",
    mutationDefinition: deleteRoleMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, deleteRoleMutation as any),
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
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
          })
        );
      }
      return ok(payload as DeleteRolePayload);
    },
    permissionValidator: requireGmPermission
  });
}

