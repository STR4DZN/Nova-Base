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
  validateAssignment,
  validateReservation,
  type Assignment,
  type Reservation
} from "../assignments/assignment-types.js";
import {
  calculateWorkforce,
  resolveOperationalGroupWorkforceType
} from "../workforce/workforce-calculator.js";
import { createOpaqueId, isOpaqueId } from "../../core/identity/ids.js";

export interface SourceCapacityReport {
  readonly capacity: number;
  readonly committed: number;
  readonly reserved: number;
  readonly available: number;
}

export function getSourceCapacity(
  people: DomainPeopleData,
  sourceRef: string,
  workforceTypeId: string,
  nowReal: number = Date.now()
): SourceCapacityReport | null {
  // 1. Check if sourceRef is an OperationalGroup
  const opGroup = people.operationalGroups?.find((og) => og.id === sourceRef);
  if (opGroup) {
    const baseType = resolveOperationalGroupWorkforceType(opGroup.definitionId);
    const capacity = (opGroup.lifecycle === "active" && baseType === workforceTypeId) ? opGroup.size : 0;

    const committed = (people.assignments ?? [])
      .filter((a) => a.sourceRef === sourceRef && a.workforceTypeId === workforceTypeId && a.status === "active")
      .reduce((sum, a) => sum + a.amount, 0);

    const reserved = (people.reservations ?? [])
      .filter((r) => r.sourceRef === sourceRef && r.workforceTypeId === workforceTypeId && r.status === "active" && (r.expiresAtReal === undefined || r.expiresAtReal >= nowReal))
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      capacity,
      committed,
      reserved,
      available: capacity - committed - reserved
    };
  }

  // 2. Check if sourceRef is a PopulationGroup
  const popGroup = people.populationGroups?.find((pg) => pg.id === sourceRef);
  if (popGroup) {
    const contr = (popGroup.workforceContributions ?? [])
      .filter((c) => c.workforceTypeId === workforceTypeId)
      .reduce((sum, c) => sum + c.amount, 0);

    // Subtract deductions from linked active operational groups
    const linkedDeduction = (people.operationalGroups ?? [])
      .filter((og) => og.populationGroupId === popGroup.id && og.lifecycle === "active" && resolveOperationalGroupWorkforceType(og.definitionId) === workforceTypeId)
      .reduce((sum, og) => sum + og.size, 0);

    const capacity = Math.max(0, contr - linkedDeduction);

    const committed = (people.assignments ?? [])
      .filter((a) => a.sourceRef === sourceRef && a.workforceTypeId === workforceTypeId && a.status === "active")
      .reduce((sum, a) => sum + a.amount, 0);

    const reserved = (people.reservations ?? [])
      .filter((r) => r.sourceRef === sourceRef && r.workforceTypeId === workforceTypeId && r.status === "active" && (r.expiresAtReal === undefined || r.expiresAtReal >= nowReal))
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      capacity,
      committed,
      reserved,
      available: capacity - committed - reserved
    };
  }

  return null;
}

export interface CreateAssignmentPayload {
  readonly domainUuid: string;
  readonly assignment: {
    readonly sourceRef: string;
    readonly targetRef: string;
    readonly workforceTypeId: string;
    readonly amount: number;
    readonly notes?: string;
  };
  readonly allowOvercommit?: boolean;
  readonly expectedRevision?: number;
}

export interface CancelAssignmentPayload {
  readonly domainUuid: string;
  readonly assignmentId: string;
  readonly expectedRevision?: number;
}

export interface CreateReservationPayload {
  readonly domainUuid: string;
  readonly reservation: {
    readonly sourceRef: string;
    readonly targetRef: string;
    readonly workforceTypeId: string;
    readonly amount: number;
    readonly expiresAtReal?: number;
    readonly notes?: string;
  };
  readonly allowOvercommit?: boolean;
  readonly expectedRevision?: number;
}

export interface ReleaseReservationPayload {
  readonly domainUuid: string;
  readonly reservationId: string;
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
        message: "Only GM can execute workforce assignment commands"
      })
    );
  }
  return ok(true);
}

export function registerAssignmentCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. people:create-assignment
  const createAssignmentMutation: MutationDefinition<
    CreateAssignmentPayload,
    Assignment,
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
      const input = ctx.command.payload.assignment;

      const newId = createOpaqueId("asg");
      const candidate = {
        id: newId,
        sourceRef: input.sourceRef,
        targetRef: input.targetRef,
        workforceTypeId: input.workforceTypeId,
        amount: input.amount,
        createdAtReal: Date.now(),
        notes: input.notes
      };

      const asgValidation = validateAssignment(candidate);
      if (!asgValidation.ok) {
        return asgValidation;
      }
      const newAsg = asgValidation.value;

      // Check for overcommit unless GM override allowed (DEC-1033, DEC-1145)
      if (!ctx.command.payload.allowOvercommit) {
        // DEC-1145: Source-specific capacity check
        const sourceCap = getSourceCapacity(currentPeople, newAsg.sourceRef, newAsg.workforceTypeId);
        if (sourceCap !== null && sourceCap.available < newAsg.amount) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "validation",
              message: `Source '${newAsg.sourceRef}' does not have enough available '${newAsg.workforceTypeId}' workforce: available ${sourceCap.available} < requested ${newAsg.amount}`
            })
          );
        }

        const candidatePeople: DomainPeopleData = {
          ...currentPeople,
          assignments: Object.freeze([...currentPeople.assignments, newAsg])
        };
        const wfReport = calculateWorkforce(candidatePeople);
        const wfTypeStat = wfReport.types[newAsg.workforceTypeId];
        if (wfTypeStat && wfTypeStat.isOvercommitted) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "validation",
              message: `Workforce type '${newAsg.workforceTypeId}' would be overcommitted: available ${wfTypeStat.available} < 0`
            })
          );
        }
      }

      const updatedAssignments = Object.freeze([...currentPeople.assignments, newAsg]);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        assignments: updatedAssignments
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
        summary: `Assign ${newAsg.amount} of '${newAsg.workforceTypeId}' from '${newAsg.sourceRef}' to '${newAsg.targetRef}' in domain '${domainDoc.name}'`
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
      const createdAsg = people.assignments[people.assignments.length - 1];

      return ok({
        result: createdAsg,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Assigned workforce in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:create-assignment",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates an active workforce assignment",
    mutationDefinition: createAssignmentMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createAssignmentMutation as any),
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
      if (!p.assignment || typeof p.assignment !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "assignment object is required"
          })
        );
      }
      return ok(payload as CreateAssignmentPayload);
    },
    permissionValidator: requireGmPermission
  });

  // 2. people:cancel-assignment
  const cancelAssignmentMutation: MutationDefinition<
    CancelAssignmentPayload,
    { cancelledAssignmentId: string },
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
      const { assignmentId } = ctx.command.payload;

      const asgIndex = currentPeople.assignments.findIndex((a) => a.id === assignmentId);
      if (asgIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ASSIGNMENT_NOT_FOUND",
            category: "not-found",
            message: `Assignment '${assignmentId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      // Removing / cancelling frees workforce (DEC-1124)
      const updatedAssignments = currentPeople.assignments.filter((a) => a.id !== assignmentId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        assignments: Object.freeze(updatedAssignments)
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
        summary: `Cancel assignment '${assignmentId}' in domain '${domainDoc.name}'`
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
        result: { cancelledAssignmentId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Cancelled assignment in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:cancel-assignment",
    visibility: "public",
    transactional: true,
    description: "Authoritatively cancels an assignment and frees committed workforce",
    mutationDefinition: cancelAssignmentMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, cancelAssignmentMutation as any),
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
      if (!isOpaqueId(p.assignmentId, "asg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid assignmentId (asg_*) is required"
          })
        );
      }
      return ok(payload as CancelAssignmentPayload);
    },
    permissionValidator: requireGmPermission
  });

  // 3. people:create-reservation
  const createReservationMutation: MutationDefinition<
    CreateReservationPayload,
    Reservation,
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
      const input = ctx.command.payload.reservation;

      const newId = createOpaqueId("resv");
      const candidate = {
        id: newId,
        sourceRef: input.sourceRef,
        targetRef: input.targetRef,
        workforceTypeId: input.workforceTypeId,
        amount: input.amount,
        status: "active" as const,
        expiresAtReal: input.expiresAtReal,
        notes: input.notes
      };

      const resvValidation = validateReservation(candidate);
      if (!resvValidation.ok) {
        return resvValidation;
      }
      const newResv = resvValidation.value;

      const updatedReservations = Object.freeze([...(currentPeople.reservations ?? []), newResv]);
      const provisionalPeople: DomainPeopleData = {
        ...currentPeople,
        reservations: updatedReservations
      };

      // Overcommit check (DEC-1125, DEC-1145)
      if (!ctx.command.payload.allowOvercommit) {
        // DEC-1145: Source-specific capacity check
        const sourceCap = getSourceCapacity(currentPeople, newResv.sourceRef, newResv.workforceTypeId, newResv.expiresAtReal);
        if (sourceCap !== null && sourceCap.available < newResv.amount) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "conflict",
              message: `Source '${newResv.sourceRef}' does not have enough available '${newResv.workforceTypeId}' workforce: available ${sourceCap.available} < requested ${newResv.amount}`
            })
          );
        }

        const report = calculateWorkforce(provisionalPeople);
        const typeRes = report.types[newResv.workforceTypeId];
        if (typeRes && typeRes.available < 0) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "conflict",
              message: `Reservation requires ${newResv.amount} of '${newResv.workforceTypeId}', but only ${typeRes.capacity - typeRes.committed - (typeRes.reserved - newResv.amount)} is available`
            })
          );
        }
      }

      const updatedRecord = withDomainPeopleData(domainDoc.record, provisionalPeople);
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
        summary: `Reserve ${newResv.amount} workforce (${newResv.workforceTypeId}) for '${newResv.targetRef}' in domain '${domainDoc.name}'`
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
      const createdResv = people.reservations[people.reservations.length - 1];

      return ok({
        result: createdResv,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created workforce reservation in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:create-reservation",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a workforce reservation",
    mutationDefinition: createReservationMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, createReservationMutation as any),
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
      if (!p.reservation || typeof p.reservation !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservation is required"
          })
        );
      }
      return ok(payload as CreateReservationPayload);
    },
    permissionValidator: requireGmPermission
  });

  // 4. people:release-reservation
  const releaseReservationMutation: MutationDefinition<
    ReleaseReservationPayload,
    { releasedReservationId: string },
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
      const { reservationId } = ctx.command.payload;

      const resvIndex = currentPeople.reservations.findIndex((r) => r.id === reservationId);
      if (resvIndex === -1) {
        return err(
          createPublicError({
            code: "DM_RESERVATION_NOT_FOUND",
            category: "not-found",
            message: `Reservation '${reservationId}' not found in domain '${domainDoc.name}'`
          })
        );
      }

      // Release reservation removes it, freeing reserved workforce
      const updatedReservations = currentPeople.reservations.filter((r) => r.id !== reservationId);
      const updatedPeople: DomainPeopleData = {
        ...currentPeople,
        reservations: Object.freeze(updatedReservations)
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
        summary: `Release reservation '${reservationId}' in domain '${domainDoc.name}'`
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
        result: { releasedReservationId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Released reservation in domain '${targetDoc.name}'`
      });
    }
  };

  registry.register({
    type: "people:release-reservation",
    visibility: "public",
    transactional: true,
    description: "Authoritatively releases a reservation and frees reserved workforce",
    mutationDefinition: releaseReservationMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, releaseReservationMutation as any),
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
      if (!isOpaqueId(p.reservationId, "resv")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid reservationId (resv_*) is required"
          })
        );
      }
      return ok(payload as ReleaseReservationPayload);
    },
    permissionValidator: requireGmPermission
  });
}
