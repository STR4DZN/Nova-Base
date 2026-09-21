import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { createCommandId, type CommandId } from "../../commands/command-envelope.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DowntimeDefinitionRegistry } from "../definitions/downtime-registry.js";
import {
  type DowntimeDefinition,
  type DowntimeInstance,
  type DowntimeParticipant,
  type DowntimeScope,
  validateDowntimeParticipant
} from "../types/downtime-types.js";
import {
  getDomainDowntimeData,
  DOWNTIME_CAPABILITY_ID,
  withDomainDowntimeData
} from "../downtime-data.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainFacilitiesData } from "../../facilities/facility-data.js";
import { tryGetDomainPeopleData } from "../../people/people-data.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import { createTransactionRecord } from "../../mutations/transaction-record.js";

export interface DowntimeStartPlanParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly label?: string;
  readonly scope?: DowntimeScope;
  readonly durationTicks?: number | null;
  readonly participantRef?: string;
  readonly participants?: readonly (
    | DowntimeParticipant
    | { ref: string; role?: string; name?: string; participantRef?: string; participantType?: any }
  )[];
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface DowntimeStartPlanContext {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry: DowntimeDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly transactionStore?: TransactionStore;
}

/**
 * DowntimeStartPlan — Coordinated domain operation plan for starting a Downtime Activity.
 * (Master Spec §17, DEC-2751, G5-REVAL3-001, G5-REVAL3-002)
 *
 * Enforces:
 * 1. Preconditions check: capability, definition, participants (min/max, roles, people existence, busy state),
 *    required domain capabilities, required operational facilities.
 * 2. TransactionRecord prepared in TransactionStore before external modifications.
 * 3. Step-by-step upfront cost debiting with automatic compensation (refund) on ANY failure.
 * 4. Safe recovery on domain document save failure (all debited costs refunded).
 */
export async function executeDowntimeStartPlan(
  context: DowntimeStartPlanContext,
  params: DowntimeStartPlanParams
): Promise<Result<{ readonly activity: DowntimeInstance }, PublicError>> {
  const cleanDomainUuid = normalizeJournalEntryId(params.domainUuid);
  const docRes = await context.domains.read(cleanDomainUuid);
  if (!docRes.ok) return docRes;

  const record = docRes.value.record;
  if (!record.definition.capabilities.enabled.includes(DOWNTIME_CAPABILITY_ID)) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_CAPABILITY_DISABLED",
        category: "conflict",
        message: `Downtime capability '${DOWNTIME_CAPABILITY_ID}' is not enabled on domain ${params.domainUuid}`
      })
    );
  }

  const definition = context.downtimeRegistry.get(params.definitionId);
  if (!definition) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_DEFINITION_NOT_FOUND",
        category: "not-found",
        message: `Downtime definition '${params.definitionId}' not found`
      })
    );
  }

  // 1. Participant verification
  const participants: DowntimeParticipant[] = [];
  if (params.participants && params.participants.length > 0) {
    for (const p of params.participants) {
      const participantRef = (p as any).participantRef ?? (p as any).ref;
      const participantType =
        (p as any).participantType ?? (participantRef?.startsWith("group:") ? "group" : "notable");
      const role = (p as any).role ?? definition.allowedParticipantRoles?.[0] ?? "lead";
      const candidate: DowntimeParticipant = {
        participantRef,
        participantType,
        role,
        name: (p as any).name,
        capacityConsumed: (p as any).capacityConsumed ?? 1
      };
      const valRes = validateDowntimeParticipant(candidate);
      if (!valRes.ok) return valRes;
      participants.push(valRes.value);
    }
  } else if (params.participantRef) {
    const candidate: DowntimeParticipant = {
      participantRef: params.participantRef,
      participantType: params.participantRef.startsWith("group:") ? "group" : "notable",
      role: definition.allowedParticipantRoles?.[0] ?? "lead",
      capacityConsumed: 1
    };
    const valRes = validateDowntimeParticipant(candidate);
    if (!valRes.ok) return valRes;
    participants.push(valRes.value);
  }

  if (definition.minParticipants !== undefined && participants.length < definition.minParticipants) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_REQUIRED",
        category: "conflict",
        message: `Activity '${definition.label}' requires at least ${definition.minParticipants} participant(s)`
      })
    );
  }

  if (definition.maxParticipants !== undefined && participants.length > definition.maxParticipants) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_TOO_MANY_PARTICIPANTS",
        category: "conflict",
        message: `Activity '${definition.label}' allows at most ${definition.maxParticipants} participant(s)`
      })
    );
  }

  if (definition.allowedParticipantRoles && definition.allowedParticipantRoles.length > 0) {
    for (const p of participants) {
      if (!definition.allowedParticipantRoles.includes(p.role)) {
        return err(
          createPublicError({
            code: "DM_DOWNTIME_INVALID_PARTICIPANT_ROLE",
            category: "conflict",
            message: `Participant role '${p.role}' is not allowed for activity '${definition.label}'. Allowed roles: ${definition.allowedParticipantRoles.join(", ")}`
          })
        );
      }
    }
  }

  // 2. Required domain capabilities verification
  if (definition.requiredCapabilities && definition.requiredCapabilities.length > 0) {
    for (const reqCap of definition.requiredCapabilities) {
      if (!record.definition.capabilities.enabled.includes(reqCap)) {
        return err(
          createPublicError({
            code: "DM_DOWNTIME_REQUIRED_CAPABILITY_DISABLED",
            category: "conflict",
            message: `Activity '${definition.label}' requires capability '${reqCap}' to be enabled on domain`
          })
        );
      }
    }
  }

  // 3. Required facility operational readiness verification
  if (definition.requiredFacilityDefinitions && definition.requiredFacilityDefinitions.length > 0) {
    const facData = getDomainFacilitiesData(record);
    for (const reqFac of definition.requiredFacilityDefinitions) {
      const hasFac = facData.facilities.some(
        (f) =>
          f.definitionId === reqFac &&
          f.lifecycle === "operational" &&
          f.readiness !== "unavailable" &&
          (f as any).status !== "blocked"
      );
      if (!hasFac) {
        return err(
          createPublicError({
            code: "DM_DOWNTIME_REQUIRED_FACILITY_MISSING",
            category: "conflict",
            message: `Activity '${definition.label}' requires operational facility '${reqFac}', but none is available`
          })
        );
      }
    }
  }

  // 4. Participant existence verification against domain people data
  const peopleDataRes = tryGetDomainPeopleData(record);
  if (peopleDataRes.ok) {
    const people = peopleDataRes.value;
    for (const p of participants) {
      const rawRef = p.participantRef;
      const cleanRef = rawRef.startsWith("notable:")
        ? rawRef.slice(8)
        : rawRef.startsWith("group:")
          ? rawRef.slice(6)
          : rawRef;
      if (p.participantType === "notable" && people.notables.length > 0) {
        const exists = people.notables.some(
          (n) => n.id === cleanRef || n.id === rawRef || `notable:${n.id}` === rawRef
        );
        if (!exists) {
          return err(
            createPublicError({
              code: "DM_DOWNTIME_PARTICIPANT_NOT_FOUND",
              category: "not-found",
              message: `Notable participant '${rawRef}' not found in domain people data`
            })
          );
        }
      } else if (
        p.participantType === "group" &&
        (people.operationalGroups.length > 0 || people.populationGroups.length > 0)
      ) {
        const exists =
          people.operationalGroups.some(
            (g) => g.id === cleanRef || g.id === rawRef || `group:${g.id}` === rawRef
          ) ||
          people.populationGroups.some(
            (g) => g.id === cleanRef || g.id === rawRef || `group:${g.id}` === rawRef
          );
        if (!exists) {
          return err(
            createPublicError({
              code: "DM_DOWNTIME_PARTICIPANT_NOT_FOUND",
              category: "not-found",
              message: `Group participant '${rawRef}' not found in domain people data`
            })
          );
        }
      }
    }
  }

  // 5. Participant availability check: busy check against inProgress activities
  const currentDowntimeData = getDomainDowntimeData(record);
  const inProgressActivities = currentDowntimeData.activities.filter(
    (a) => a.lifecycle === "inProgress"
  );
  for (const p of participants) {
    const busyActivity = inProgressActivities.find((a) =>
      a.participants.some((ap) => ap.participantRef === p.participantRef)
    );
    if (busyActivity) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_PARTICIPANT_BUSY",
          category: "conflict",
          message: `Participant '${p.participantRef}' is already active in downtime activity '${busyActivity.id}' (${busyActivity.name})`
        })
      );
    }
  }

  // 6. Transaction preparation BEFORE child effects (G5-REVAL3-002, G5-REVAL4-001, G5-REVAL4-002)
  const txId = createOpaqueId("tx");
  const cmdId: CommandId = params.commandId
    ? params.commandId.startsWith("cmd_")
      ? (params.commandId as CommandId)
      : (`cmd_${params.commandId}` as CommandId)
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  if (context.transactionStore) {
    const tx = createTransactionRecord({
      transactionId: txId,
      commandId: cmdId,
      authorityEpoch: epoch,
      lockKeys: [`domain:${cleanDomainUuid}`],
      safeAutoRecovery: false,
      recoveryData: {
        type: "downtime:start",
        domainUuid: cleanDomainUuid,
        definitionId: params.definitionId,
        correlationId: params.correlationId,
        causationId: params.causationId,
        status: "prepared"
      }
    });
    context.transactionStore.save(tx);
    const claimRes = context.transactionStore.transition(txId, "claimed", epoch);
    if (!claimRes.ok) return claimRes;
    const prepRes = context.transactionStore.transition(txId, "prepared", epoch);
    if (!prepRes.ok) return prepRes;

    // G5-REVAL4-002: Flush transaction to durable storage BEFORE executing child writes
    try {
      await context.transactionStore.flush();
    } catch (flushErr) {
      context.transactionStore.transition(txId, "failed", epoch, "Persistence flush failed");
      return err(
        createPublicError({
          code: "DM_DOMAIN_STORAGE_ERROR",
          category: "internal",
          message: `Failed to flush transaction preparation to storage: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
          details: flushErr
        })
      );
    }
  }

  // Track debited upfront costs for explicit compensation on failure
  const debitedCosts: { resourceId: string; amount: number }[] = [];
  let compensationFailed = false;

  const compensateDebits = async (reason: string) => {
    if (!context.economyService || debitedCosts.length === 0) return;
    for (const cost of debitedCosts) {
      const refundRes = await context.economyService.commitAdjust({
        domainUuid: cleanDomainUuid,
        resourceId: cost.resourceId,
        deltaMinor: cost.amount,
        reason: `Compensation: ${reason}`,
        lockOwner: params.commandId
      });
      if (!refundRes.ok) {
        compensationFailed = true;
      }
    }
  };

  // 7. Debit upfront costs via EconomyService with fail-closed compensation
  if (context.economyService && definition.costs && definition.costs.length > 0) {
    for (const cost of definition.costs) {
      const debitRes = await context.economyService.commitAdjust({
        domainUuid: cleanDomainUuid,
        resourceId: cost.resourceId,
        deltaMinor: -cost.amount,
        reason: `Cost for starting downtime activity '${params.label ?? definition.label}'`,
        lockOwner: params.commandId
      });
      if (!debitRes.ok) {
        await compensateDebits(`rollback failed start for activity '${definition.label}'`);
        if (context.transactionStore) {
          const targetState = compensationFailed ? "needs-recovery" : "failed";
          context.transactionStore.transition(txId, targetState, epoch, debitRes.error.message);
        }
        return debitRes;
      }
      debitedCosts.push({ resourceId: cost.resourceId, amount: cost.amount });
    }
  }

  const activityId = `dt-${createOpaqueId("prj").slice(4)}`;
  const now = Date.now();

  const newActivity: DowntimeInstance = {
    id: activityId,
    domainUuid: cleanDomainUuid,
    definitionId: params.definitionId,
    name: params.label ?? definition.label,
    schemaVersion: 1,
    revision: 0,
    scope: params.scope ?? definition.scope ?? "domain",
    lifecycle: "inProgress",
    elapsedTicks: 0,
    durationTicks: params.durationTicks ?? definition.defaultDurationTicks ?? 10,
    participants: Object.freeze(participants),
    tags: Object.freeze([...(definition.tags ?? [])]),
    createdAt: now,
    updatedAt: now
  };

  // 8. Re-read fresh domain document after upfront costs to avoid revision conflict
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    await compensateDebits("domain read failed after upfront debits");
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, freshDocRes.error.message);
    }
    return freshDocRes;
  }

  const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);
  const updatedActivities = Object.freeze([...freshDowntimeData.activities, newActivity]);
  const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
    ...freshDowntimeData,
    activities: updatedActivities
  });

  if (context.transactionStore) {
    const committingRes = context.transactionStore.transition(txId, "committing", epoch);
    if (!committingRes.ok) {
      await compensateDebits(`transition to committing failed: ${committingRes.error.message}`);
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, committingRes.error.message);
      return committingRes;
    }
  }

  const saveRes = await context.domains.save({
    ...freshDocRes.value,
    record: updatedRecord
  });

  if (!saveRes.ok) {
    await compensateDebits(`domain save failed for activity '${activityId}': ${saveRes.error.message}`);
    if (context.transactionStore) {
      const targetState = compensationFailed ? "needs-recovery" : "failed";
      context.transactionStore.transition(txId, targetState, epoch, saveRes.error.message);
    }
    return saveRes;
  }

  if (context.transactionStore) {
    const committedRes = context.transactionStore.transition(txId, "committed", epoch);
    if (!committedRes.ok) return committedRes;
    try {
      await context.transactionStore.flush();
    } catch {
      // already committed
    }
  }

  return ok({ activity: newActivity });
}
