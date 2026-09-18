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
import {
  getDomainPeopleData,
  withDomainPeopleData,
  type DomainPeopleData
} from "../people-data.js";
import type { DomainRole } from "../roles/role-types.js";
import type { OperationalGroup } from "../operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";

interface DomainFreshState extends FreshStateWithRevision {
  readonly state: DomainDocument;
}

function resolveDomainId(domainUuid: string): string {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}

export type PeopleRepairAction =
  | { readonly type: "relink-notable"; readonly oldNotableId: string; readonly newNotableId: string }
  | { readonly type: "purge-dangling-occupants" }
  | { readonly type: "repair-explicit-group-sizes" }
  | { readonly type: "prune-expired-reservations"; readonly nowReal?: number; readonly nowWorld?: number }
  | { readonly type: "prune-ended-assignments"; readonly nowWorld: number };

export interface PeopleRepairPayload {
  readonly domainUuid: string;
  readonly operation: PeopleRepairAction;
  readonly expectedRevision?: number;
}

export interface PeopleRepairReceiptResult {
  readonly domainUuid: string;
  readonly repaired: boolean;
  readonly summary: string;
  readonly changes: readonly string[];
}

function requireGmOnlyPermission(ctx: AuthenticatedCommandContext): Result<boolean, PublicError> {
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }
  const gameUser = (globalThis as any).game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }
  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: "Only Game Master or Primary Authority can execute domain repair operations"
    })
  );
}

export function registerRepairCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  const repairMutation: MutationDefinition<PeopleRepairPayload, PeopleRepairReceiptResult, DomainFreshState> = {
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
      const { operation } = ctx.command.payload;
      const changes: string[] = [];

      let repairedPeople: DomainPeopleData | null = null;
      let summary = "";

      switch (operation.type) {
        case "relink-notable": {
          const { oldNotableId, newNotableId } = operation;
          let changed = false;

          const updatedRoles: DomainRole[] = currentPeople.roles.map((r) => {
            if (r.occupants.includes(oldNotableId)) {
              changed = true;
              const newOccupants = r.occupants.map((occ) => (occ === oldNotableId ? newNotableId : occ));
              const uniqueOccupants = Object.freeze([...new Set(newOccupants)]);
              changes.push(`Role '${r.id}': relinked occupant '${oldNotableId}' -> '${newNotableId}'`);
              return { ...r, occupants: uniqueOccupants };
            }
            return r;
          });

          const updatedGroups: OperationalGroup[] = currentPeople.operationalGroups.map((g) => {
            if (g.members.includes(oldNotableId)) {
              changed = true;
              const newMembers = g.members.map((m) => (m === oldNotableId ? newNotableId : m));
              const uniqueMembers = Object.freeze([...new Set(newMembers)]);
              changes.push(`Operational Group '${g.id}': relinked member '${oldNotableId}' -> '${newNotableId}'`);
              return { ...g, members: uniqueMembers };
            }
            return g;
          });

          summary = `Relink notable '${oldNotableId}' -> '${newNotableId}'`;
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              roles: Object.freeze(updatedRoles),
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }

        case "purge-dangling-occupants": {
          const validNotableIds = new Set(currentPeople.notables.map((n) => n.id));
          let changed = false;

          const updatedRoles: DomainRole[] = currentPeople.roles.map((r) => {
            const validOccupants = r.occupants.filter((occId) => validNotableIds.has(occId));
            if (validOccupants.length !== r.occupants.length) {
              changed = true;
              const purgedCount = r.occupants.length - validOccupants.length;
              changes.push(`Role '${r.id}': purged ${purgedCount} dangling occupant(s)`);
              return { ...r, occupants: Object.freeze(validOccupants) };
            }
            return r;
          });

          const updatedGroups: OperationalGroup[] = currentPeople.operationalGroups.map((g) => {
            const validMembers = g.members.filter((mId) => validNotableIds.has(mId));
            if (validMembers.length !== g.members.length) {
              changed = true;
              const purgedCount = g.members.length - validMembers.length;
              changes.push(`Operational Group '${g.id}': purged ${purgedCount} dangling member(s)`);
              const newSize = g.membershipMode === "explicit" ? validMembers.length : g.size;
              return { ...g, members: Object.freeze(validMembers), size: newSize };
            }
            return g;
          });

          summary = "Purge dangling role occupants and group members";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              roles: Object.freeze(updatedRoles),
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }

        case "repair-explicit-group-sizes": {
          let changed = false;
          const updatedGroups: OperationalGroup[] = currentPeople.operationalGroups.map((g) => {
            if (g.membershipMode === "explicit" && g.size !== g.members.length) {
              changed = true;
              changes.push(`Operational Group '${g.id}' (${g.name}): aligned size from ${g.size} to ${g.members.length}`);
              return { ...g, size: g.members.length };
            }
            return g;
          });

          summary = "Repair explicit operational group sizes to match member counts";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }

        case "prune-expired-reservations": {
          const nowReal = operation.nowReal ?? Date.now();
          const nowWorld = operation.nowWorld;
          let changed = false;

          const activeReservations: Reservation[] = (currentPeople.reservations ?? []).filter((r) => {
            if (r.status !== "active") return true;

            const realExpired = r.expiresAtReal !== undefined && r.expiresAtReal < nowReal;
            const worldExpired = nowWorld !== undefined && r.expiresAtWorld !== undefined && r.expiresAtWorld <= nowWorld;

            if (realExpired || worldExpired) {
              changed = true;
              changes.push(`Pruned expired reservation '${r.id}' (${r.workforceTypeId}: ${r.amount})`);
              return false;
            }
            return true;
          });

          summary = "Prune expired reservations";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              reservations: Object.freeze(activeReservations)
            };
          }
          break;
        }

        case "prune-ended-assignments": {
          const { nowWorld } = operation;
          let changed = false;

          const updatedAssignments: Assignment[] = (currentPeople.assignments ?? []).map((a) => {
            if (a.status === "active" && a.endsAtWorld !== undefined && a.endsAtWorld <= nowWorld) {
              changed = true;
              changes.push(`Marked assignment '${a.id}' as ended (expired at world time ${a.endsAtWorld})`);
              return { ...a, status: "ended" as const, endedReason: "expired" };
            }
            return a;
          });

          summary = "Prune ended assignments past world time";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              assignments: Object.freeze(updatedAssignments)
            };
          }
          break;
        }
      }

      if (!repairedPeople) {
        // No inconsistencies found, return no-op plan
        const plan = createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${domainDoc.uuid}`],
          writeSet: [],
          summary: `No inconsistencies found for operation: ${summary}`
        });
        return ok(plan);
      }

      const updatedRecord = withDomainPeopleData(domainDoc.record, repairedPeople);
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
        summary: `Execute repair: ${summary} in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const summary = plan.summary ?? "Repair operation";
      const targetDoc = plan.writeSet[0]?.payload as DomainDocument | undefined;
      if (!targetDoc) {
        return ok({
          result: {
            domainUuid: plan.lockKeys[0]?.replace("domain:", "") ?? "",
            repaired: false,
            summary,
            changes: Object.freeze([])
          },
          resultingRevisions: {},
          changed: false,
          summary
        });
      }

      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);

      return ok({
        result: {
          domainUuid: targetDoc.uuid,
          repaired: true,
          summary,
          changes: Object.freeze(
            summary.includes("Relink") ||
            summary.includes("Purge") ||
            summary.includes("Repair") ||
            summary.includes("Prune")
              ? [summary]
              : []
          )
        },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary
      });
    }
  };

  registry.register({
    type: "people:repair",
    visibility: "public",
    transactional: true,
    description: "Authoritatively executes domain repair operations via transactional mutation pipeline",
    mutationDefinition: repairMutation as unknown as MutationDefinition<unknown, unknown>,
    handler: createTransactionalHandler(coordinator, repairMutation as any),
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
      if (!p.operation || typeof p.operation !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "operation is required"
          })
        );
      }
      return ok(payload as PeopleRepairPayload);
    },
    permissionValidator: requireGmOnlyPermission
  });
}
