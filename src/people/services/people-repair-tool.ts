import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { DomainDocument, DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { MutationCoordinator } from "../../mutations/mutation-coordinator.js";
import { getDomainPeopleData, withDomainPeopleData, type DomainPeopleData } from "../people-data.js";
import type { DomainRole } from "../roles/role-types.js";
import type { OperationalGroup } from "../operational-groups/operational-group-types.js";
import type { Assignment, Reservation } from "../assignments/assignment-types.js";

export interface PeopleRepairResult {
  readonly domainUuid: string;
  readonly repaired: boolean;
  readonly summary: string;
  readonly changes: readonly string[];
}

export class PeopleRepairTool {
  readonly #domains: DomainRepositoryContract;
  readonly #coordinator: MutationCoordinator;

  constructor(domains: DomainRepositoryContract, coordinator: MutationCoordinator) {
    this.#domains = domains;
    this.#coordinator = coordinator;
  }

  async relinkNotable(
    domainUuid: string,
    oldNotableId: string,
    newNotableId: string
  ): Promise<Result<PeopleRepairResult>> {
    return this.#executeRepair(domainUuid, (people, changes) => {
      let changed = false;

      // 1. Roles
      const updatedRoles: DomainRole[] = people.roles.map((r) => {
        if (r.occupants.includes(oldNotableId)) {
          changed = true;
          const newOccupants = r.occupants.map((occ) => (occ === oldNotableId ? newNotableId : occ));
          // Deduplicate if newNotableId was already an occupant
          const uniqueOccupants = Object.freeze([...new Set(newOccupants)]);
          changes.push(`Role '${r.id}': relinked occupant '${oldNotableId}' -> '${newNotableId}'`);
          return { ...r, occupants: uniqueOccupants };
        }
        return r;
      });

      // 2. Operational Groups
      const updatedGroups: OperationalGroup[] = people.operationalGroups.map((g) => {
        if (g.members.includes(oldNotableId)) {
          changed = true;
          const newMembers = g.members.map((m) => (m === oldNotableId ? newNotableId : m));
          const uniqueMembers = Object.freeze([...new Set(newMembers)]);
          changes.push(`Operational Group '${g.id}': relinked member '${oldNotableId}' -> '${newNotableId}'`);
          return { ...g, members: uniqueMembers };
        }
        return g;
      });

      if (!changed) {
        return null;
      }

      return {
        ...people,
        roles: Object.freeze(updatedRoles),
        operationalGroups: Object.freeze(updatedGroups)
      };
    }, `Relink notable '${oldNotableId}' -> '${newNotableId}'`);
  }

  async purgeDanglingOccupants(domainUuid: string): Promise<Result<PeopleRepairResult>> {
    return this.#executeRepair(domainUuid, (people, changes) => {
      const validNotableIds = new Set(people.notables.map((n) => n.id));
      let changed = false;

      // 1. Roles
      const updatedRoles: DomainRole[] = people.roles.map((r) => {
        const validOccupants = r.occupants.filter((occId) => validNotableIds.has(occId));
        if (validOccupants.length !== r.occupants.length) {
          changed = true;
          const purgedCount = r.occupants.length - validOccupants.length;
          changes.push(`Role '${r.id}': purged ${purgedCount} dangling occupant(s)`);
          return { ...r, occupants: Object.freeze(validOccupants) };
        }
        return r;
      });

      // 2. Operational Groups
      const updatedGroups: OperationalGroup[] = people.operationalGroups.map((g) => {
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

      if (!changed) {
        return null;
      }

      return {
        ...people,
        roles: Object.freeze(updatedRoles),
        operationalGroups: Object.freeze(updatedGroups)
      };
    }, "Purge dangling role occupants and group members");
  }

  async repairExplicitGroupSizes(domainUuid: string): Promise<Result<PeopleRepairResult>> {
    return this.#executeRepair(domainUuid, (people, changes) => {
      let changed = false;

      const updatedGroups: OperationalGroup[] = people.operationalGroups.map((g) => {
        if (g.membershipMode === "explicit" && g.size !== g.members.length) {
          changed = true;
          changes.push(`Operational Group '${g.id}' (${g.name}): aligned size from ${g.size} to ${g.members.length}`);
          return { ...g, size: g.members.length };
        }
        return g;
      });

      if (!changed) {
        return null;
      }

      return {
        ...people,
        operationalGroups: Object.freeze(updatedGroups)
      };
    }, "Repair explicit operational group sizes to match member counts");
  }

  async pruneExpiredReservations(
    domainUuid: string,
    nowReal: number = Date.now(),
    nowWorld?: number
  ): Promise<Result<PeopleRepairResult>> {
    return this.#executeRepair(domainUuid, (people, changes) => {
      let changed = false;

      const activeReservations: Reservation[] = (people.reservations ?? []).filter((r) => {
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

      if (!changed) {
        return null;
      }

      return {
        ...people,
        reservations: Object.freeze(activeReservations)
      };
    }, "Prune expired reservations");
  }

  async pruneEndedAssignments(
    domainUuid: string,
    nowWorld: number
  ): Promise<Result<PeopleRepairResult>> {
    return this.#executeRepair(domainUuid, (people, changes) => {
      let changed = false;

      const updatedAssignments: Assignment[] = (people.assignments ?? []).map((a) => {
        if (a.status === "active" && a.endsAtWorld !== undefined && a.endsAtWorld <= nowWorld) {
          changed = true;
          changes.push(`Marked assignment '${a.id}' as ended (expired at world time ${a.endsAtWorld})`);
          return { ...a, status: "ended" as const, endedReason: "expired" };
        }
        return a;
      });

      if (!changed) {
        return null;
      }

      return {
        ...people,
        assignments: Object.freeze(updatedAssignments)
      };
    }, "Prune ended assignments past world time");
  }

  async #executeRepair(
    domainUuid: string,
    repairFn: (people: DomainPeopleData, changes: string[]) => DomainPeopleData | null,
    operationName: string
  ): Promise<Result<PeopleRepairResult>> {
    const id = domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
    const readRes = await this.#domains.read(id);
    if (!readRes.ok) return readRes;

    const domainDoc = readRes.value;
    const currentPeople = getDomainPeopleData(domainDoc.record);
    const changes: string[] = [];

    const repairedPeople = repairFn(currentPeople, changes);
    if (!repairedPeople) {
      return ok({
        domainUuid,
        repaired: false,
        summary: `No inconsistencies found for operation: ${operationName}`,
        changes: Object.freeze([])
      });
    }

    const updatedRecord = withDomainPeopleData(domainDoc.record, repairedPeople);
    const updatedDoc: DomainDocument = {
      ...domainDoc,
      record: updatedRecord
    };

    const updateRes = await this.#domains.update(updatedDoc);
    if (!updateRes.ok) return err(updateRes.error);

    return ok({
      domainUuid,
      repaired: true,
      summary: `Successfully executed: ${operationName}`,
      changes: Object.freeze(changes)
    });
  }
}
