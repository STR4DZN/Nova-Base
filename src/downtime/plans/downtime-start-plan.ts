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
import { compensateDowntimeStart } from "../services/downtime-recovery-compensators.js";
import { lockKey } from "../../mutations/lock-keys.js";
import {
  CompositeMutationSession,
  type TransactionExecutionContext
} from "../../mutations/composite-mutation-session.js";

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
  readonly lockKeys?: readonly string[];
  readonly transactionContext?: TransactionExecutionContext;
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
 * (Master Remediation §22.5, INV-01 to INV-11)
 *
 * Enforces:
 * 1. Preconditions check: capability, definition, participants (min/max, roles, people existence, busy state),
 *    required domain capabilities, required operational facilities.
 * 2. TransactionRecord prepared in TransactionStore via CompositeMutationSession BEFORE child writes.
 * 3. Canonical lock set: domain only.
 * 4. Step-by-step upfront cost debiting with automatic compensation (refund) on ANY failure.
 * 5. Safe recovery on domain document save failure (all debited costs refunded).
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
        (p as any).participantType ??
        (participantRef?.startsWith("notable:") ? "notable" : "group");
      const normalized: DowntimeParticipant = {
        participantRef,
        participantType,
        name: p.name ?? participantRef,
        role: p.role ?? "lead"
      };
      const v = validateDowntimeParticipant(normalized);
      if (!v.ok) return v;
      participants.push(normalized);
    }
  } else if (params.participantRef) {
    const rawRef = params.participantRef;
    const participantType = rawRef.startsWith("notable:") ? "notable" : "group";
    const normalized: DowntimeParticipant = {
      participantRef: rawRef,
      participantType,
      name: rawRef,
      role: "lead"
    };
    const v = validateDowntimeParticipant(normalized);
    if (!v.ok) return v;
    participants.push(normalized);
  }

  const minP = definition.minParticipants ?? 1;
  const maxP = definition.maxParticipants ?? 10;
  if (participants.length < minP) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_PARTICIPANT_REQUIRED",
        category: "validation",
        message: `Downtime activity '${definition.label}' requires at least ${minP} participant(s), received ${participants.length}`
      })
    );
  }
  if (participants.length > maxP) {
    return err(
      createPublicError({
        code: "DM_DOWNTIME_INVALID_PARTICIPANTS",
        category: "validation",
        message: `Downtime activity '${definition.label}' accepts at most ${maxP} participant(s), received ${participants.length}`
      })
    );
  }

  const allowedRoles = definition.allowedParticipantRoles ?? (definition as any).allowedRoles;
  if (allowedRoles && allowedRoles.length > 0) {
    for (const p of participants) {
      if (p.role && !allowedRoles.includes(p.role)) {
        return err(
          createPublicError({
            code: "DM_DOWNTIME_INVALID_PARTICIPANT_ROLE",
            category: "validation",
            message: `Participant '${p.participantRef}' has role '${p.role}' which is not allowed. Allowed roles: ${allowedRoles.join(", ")}`
          })
        );
      }
    }
  }

  // 2. Validate required domain capabilities
  if (definition.requiredCapabilities && definition.requiredCapabilities.length > 0) {
    const enabledCaps = record.definition.capabilities.enabled;
    const missingCap = definition.requiredCapabilities.find((c) => !enabledCaps.includes(c));
    if (missingCap) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_REQUIRED_CAPABILITY_DISABLED",
          category: "conflict",
          message: `Downtime activity '${definition.label}' requires capability '${missingCap}', which is not enabled on this domain`
        })
      );
    }
  }

  // 3. Validate required facilities are operational
  const reqFacilities = definition.requiredFacilityDefinitions ?? (definition as any).requiredFacilities;
  if (reqFacilities && reqFacilities.length > 0) {
    const facilitiesData = getDomainFacilitiesData(record);
    for (const reqFac of reqFacilities) {
      const operational = facilitiesData.facilities.some(
        (f) =>
          (f.definitionId === reqFac || f.id === reqFac) &&
          f.lifecycle === "operational" &&
          f.readiness !== "unavailable" &&
          (!f.integrity || f.integrity.current > 0)
      );
      if (!operational) {
        return err(
          createPublicError({
            code: "DM_DOWNTIME_REQUIRED_FACILITY_MISSING",
            category: "conflict",
            message: `Downtime activity '${definition.label}' requires an operational facility of type '${reqFac}', but none is operational on this domain`
          })
        );
      }
    }
  }

  // 4. Validate participants exist in domain people data
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

  const activityId = `dt-${createOpaqueId("prj").slice(4)}`;
  const now = Date.now();

  const cmdId: CommandId = params.commandId
    ? params.commandId.startsWith("cmd_")
      ? (params.commandId as CommandId)
      : (`cmd_${params.commandId}` as CommandId)
    : createCommandId();
  const epoch = params.authorityEpoch ?? 1;

  const canonicalLock = lockKey.domain(cleanDomainUuid);
  const sessionLockKeys = params.transactionContext?.lockKeys ?? params.lockKeys ?? [canonicalLock];

  const sessionRes = await CompositeMutationSession.prepare({
    transactionContext: params.transactionContext,
    transactionStore: context.transactionStore,
    commandId: cmdId,
    authorityEpoch: epoch,
    lockKeys: sessionLockKeys,
    planLockKeys: params.transactionContext?.lockKeys ?? params.lockKeys ?? [canonicalLock],
    recoveryType: "downtime:start",
    parentRef: `domain:${cleanDomainUuid}`,
    initialRecoveryData: {
      type: "downtime:start",
      domainUuid: cleanDomainUuid,
      activityId,
      definitionId: params.definitionId,
      correlationId: params.correlationId,
      causationId: params.causationId,
      status: "prepared"
    }
  });

  if (!sessionRes.ok) {
    return sessionRes;
  }

  const session = sessionRes.value;
  const debitedCosts: { resourceId: string; amount: number }[] = [];

  const runCompensator = async (s: CompositeMutationSession, _error: PublicError) => {
    const effectiveDebited = [...debitedCosts];
    for (const step of s.steps) {
      if (step.subsystem === "economy" && step.operation === "adjust" && (step.state === "applied" || step.state === "unknown")) {
        const intent = step.intent as { resourceId: string; deltaMinor: number };
        if (intent && intent.deltaMinor < 0) {
          const amt = Math.abs(intent.deltaMinor);
          if (!effectiveDebited.some((d) => d.resourceId === intent.resourceId && d.amount === amt)) {
            effectiveDebited.push({ resourceId: intent.resourceId, amount: amt });
          }
        }
      }
    }

    const currentTx = context.transactionStore?.get(s.transactionId);
    const existingRecData = (currentTx?.recoveryData as Record<string, unknown>) ?? {};
    const updatedRecData = {
      ...existingRecData,
      type: "downtime:start",
      activityId,
      definitionId: params.definitionId,
      domainUuid: cleanDomainUuid,
      debitedCosts: Object.freeze([...effectiveDebited]),
      status: "needs-recovery"
    };

    const tx = currentTx
      ? { ...currentTx, recoveryData: updatedRecData }
      : createTransactionRecord({
          transactionId: s.transactionId,
          commandId: cmdId,
          authorityEpoch: epoch,
          lockKeys: sessionLockKeys,
          safeAutoRecovery: false,
          recoveryData: updatedRecData
        });

    if (context.transactionStore) {
      context.transactionStore.save(tx);
    }

    return compensateDowntimeStart(
      tx,
      {
        domains: context.domains,
        economyService: context.economyService,
        transactionStore: context.transactionStore
      },
      { lockOwner: params.commandId, skipReconciliation: true }
    );
  };

  // 6. Debit upfront costs via EconomyService with fail-closed compensation
  if (context.economyService && definition.costs && definition.costs.length > 0) {
    let costIdx = 0;
    for (const cost of definition.costs) {
      const stepId = `downtime-start:upfront:${cost.resourceId}:${costIdx++}`;
      const stepRes = await session.runChildStep({
        stepId,
        subsystem: "economy",
        operation: "adjust",
        targetRef: cleanDomainUuid,
        idempotencyKey: `${session.transactionId}:${stepId}`,
        intent: { resourceId: cost.resourceId, deltaMinor: -cost.amount },
        execute: async () => {
          return context.economyService!.commitAdjust({
            domainUuid: cleanDomainUuid,
            resourceId: cost.resourceId,
            deltaMinor: -cost.amount,
            reason: `Cost for starting downtime activity '${params.label ?? definition.label}'`,
            lockOwner: params.commandId,
            idempotencyKey: `${session.transactionId}:${stepId}`
          });
        }
      });

      if (!stepRes.ok) {
        return session.failAndCompensate(stepRes.error, runCompensator);
      }

      debitedCosts.push({ resourceId: cost.resourceId, amount: cost.amount });
      const checkRes = await session.checkpointRecoveryData({
        debitedCosts: Object.freeze([...debitedCosts]),
        status: "executing"
      });
      if (!checkRes.ok) {
        return session.failAndCompensate(checkRes.error, runCompensator);
      }
    }
  }

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

  // 7. Re-read fresh domain document after upfront costs to avoid revision conflict
  const freshDocRes = await context.domains.read(cleanDomainUuid);
  if (!freshDocRes.ok) {
    return session.failAndCompensate(freshDocRes.error, runCompensator);
  }

  const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);
  const updatedActivities = Object.freeze([...freshDowntimeData.activities, newActivity]);
  const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
    ...freshDowntimeData,
    activities: updatedActivities
  });

  const committingRes = await session.enterCommitting({
    activityId,
    definitionId: params.definitionId,
    expectedRevision: (freshDocRes.value.record.revision ?? 0) + 1
  });
  if (!committingRes.ok) {
    return session.failAndCompensate(committingRes.error, runCompensator);
  }

  const saveRes = await session.commitParent(async () => {
    return context.domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
  });

  if (!saveRes.ok) {
    return session.failAndCompensate(saveRes.error, runCompensator);
  }

  const commitDurableRes = await session.commitDurably({ activity: newActivity });
  if (!commitDurableRes.ok) {
    return commitDurableRes;
  }

  return ok({ activity: newActivity });
}
