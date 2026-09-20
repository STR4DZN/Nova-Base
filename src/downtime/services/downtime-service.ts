import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DowntimeDefinitionRegistry } from "../definitions/downtime-registry.js";
import { createDefaultDowntimeRegistry } from "../definitions/downtime-registry.js";
import type {
  DowntimeDefinition,
  DowntimeInstance,
  DowntimeLifecycle,
  DowntimeParticipant,
  DowntimeScope
} from "../types/downtime-types.js";
import {
  getDomainDowntimeData,
  DOWNTIME_CAPABILITY_ID,
  withDomainDowntimeData
} from "../downtime-data.js";
import type { EconomyService } from "../../economy/services/economy-service.js";
import type { FacilitiesService } from "../../facilities/services/facilities-service.js";
import { getDomainFacilitiesData } from "../../facilities/facility-data.js";
import type { ChildReceipt } from "../../projects/plans/project-plan-types.js";

export interface DowntimeServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
}

export interface StartActivityParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly label?: string;
  readonly scope?: DowntimeScope;
  readonly durationTicks?: number | null;
  readonly participantRef?: string;
  readonly participants?: readonly DowntimeParticipant[];
  readonly userId?: string | null;
}

export interface AdvanceActivityParams {
  readonly domainUuid: string;
  readonly activityId: string;
  readonly ticks: number;
  readonly notes?: string;
  readonly userId?: string | null;
}

export interface CompleteActivityParams {
  readonly domainUuid: string;
  readonly activityId: string;
  readonly outcomeKey?: string;
  readonly notes?: string;
  readonly userId?: string | null;
}

export class DowntimeService {
  readonly #domains: DomainRepositoryContract;
  readonly #downtimeRegistry: DowntimeDefinitionRegistry;
  readonly #economyService?: EconomyService;
  readonly #facilitiesService?: FacilitiesService;

  constructor(options: DowntimeServiceOptions) {
    this.#domains = options.domains;
    this.#downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();
    this.#economyService = options.economyService;
    this.#facilitiesService = options.facilitiesService;
  }

  #cleanId(idOrUuid: string): string {
    return normalizeJournalEntryId(idOrUuid);
  }

  get registry(): DowntimeDefinitionRegistry {
    return this.#downtimeRegistry;
  }

  async getActivities(domainUuid: string): Promise<Result<readonly DowntimeInstance[]>> {
    const docRes = await this.#domains.read(this.#cleanId(domainUuid));
    if (!docRes.ok) return docRes;
    const data = getDomainDowntimeData(docRes.value.record);
    return ok(data.activities);
  }

  async getActivity(domainUuid: string, activityId: string): Promise<Result<DowntimeInstance>> {
    const docRes = await this.#domains.read(this.#cleanId(domainUuid));
    if (!docRes.ok) return docRes;
    const data = getDomainDowntimeData(docRes.value.record);
    const a = data.activities.find((item) => item.id === activityId);
    if (!a) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_NOT_FOUND",
          category: "not-found",
          message: `Downtime activity ${activityId} not found in domain ${domainUuid}`
        })
      );
    }
    return ok(a);
  }

  async startActivity(params: StartActivityParams): Promise<Result<{ readonly activity: DowntimeInstance; readonly activityId: string }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
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

    const definition = this.#downtimeRegistry.get(params.definitionId);
    if (!definition) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_DEFINITION_NOT_FOUND",
          category: "not-found",
          message: `Downtime definition '${params.definitionId}' not found`
        })
      );
    }

    // Participant verification (G5-REVAL-007)
    const participants: DowntimeParticipant[] = [];
    if (params.participants && params.participants.length > 0) {
      for (const p of params.participants) {
        const participantRef = p.participantRef ?? (p as any).ref;
        const participantType = p.participantType ?? (participantRef?.startsWith("group:") ? "group" : "notable");
        participants.push({
          participantRef,
          participantType,
          role: p.role,
          name: p.name,
          capacityConsumed: p.capacityConsumed ?? 1
        });
      }
    } else if (params.participantRef) {
      participants.push({
        participantRef: params.participantRef,
        participantType: params.participantRef.startsWith("group:") ? "group" : "notable",
        role: definition.allowedParticipantRoles?.[0] ?? "lead",
        capacityConsumed: 1
      });
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

    if (definition.requiredFacilityDefinitions && definition.requiredFacilityDefinitions.length > 0) {
      const facData = getDomainFacilitiesData(record);
      for (const reqFac of definition.requiredFacilityDefinitions) {
        const hasFac = facData.facilities.some(
          (f) => f.definitionId === reqFac && (f.lifecycle === "operational" || f.lifecycle === "degraded")
        );
        if (!hasFac) {
          return err(
            createPublicError({
              code: "DM_DOWNTIME_REQUIRED_FACILITY_MISSING",
              category: "conflict",
              message: `Activity '${definition.label}' requires facility '${reqFac}', but none is available`
            })
          );
        }
      }
    }

    // Debit upfront costs via economy service if configured (G5-REVAL-007)
    if (this.#economyService && definition.costs && definition.costs.length > 0) {
      for (const cost of definition.costs) {
        const debitRes = await this.#economyService.commitAdjust({
          domainUuid: cleanDomainUuid,
          resourceId: cost.resourceId,
          deltaMinor: -cost.amount,
          reason: `Cost for starting downtime activity '${params.label ?? definition.label}'`
        });
        if (!debitRes.ok) {
          return debitRes;
        }
      }
    }

    const currentDowntimeData = getDomainDowntimeData(record);
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

    // Re-read fresh domain document after upfront costs to avoid revision conflict
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) return freshDocRes;
    const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);

    const updatedActivities = Object.freeze([...freshDowntimeData.activities, newActivity]);
    const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
      ...freshDowntimeData,
      activities: updatedActivities
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ activity: newActivity, activityId });
  }

  async advanceActivity(params: AdvanceActivityParams): Promise<Result<{ readonly activity: DowntimeInstance; readonly completed: boolean }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === params.activityId);
    if (!activity) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_NOT_FOUND",
          category: "not-found",
          message: `Downtime activity ${params.activityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    if (activity.lifecycle !== "inProgress") {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_INVALID_STATE",
          category: "validation",
          message: `Cannot advance downtime activity in lifecycle '${activity.lifecycle}'. Must be 'inProgress'`
        })
      );
    }

    const newTicks = activity.elapsedTicks + Math.max(0, params.ticks);
    const duration = activity.durationTicks;
    const shouldComplete = duration !== null && duration !== undefined && newTicks >= duration;

    if (shouldComplete) {
      const compRes = await this.completeActivity({
        domainUuid: cleanDomainUuid,
        activityId: params.activityId,
        notes: params.notes,
        userId: params.userId
      });
      if (!compRes.ok) return compRes;
      return ok({ activity: compRes.value.activity, completed: true });
    }

    const updatedActivity: DowntimeInstance = {
      ...activity,
      elapsedTicks: newTicks,
      revision: activity.revision + 1,
      updatedAt: Date.now()
    };

    const updatedActivities = currentDowntimeData.activities.map((a) =>
      a.id === params.activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: Object.freeze(updatedActivities)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ activity: updatedActivity, completed: false });
  }

  async completeActivity(params: CompleteActivityParams): Promise<Result<{ readonly activity: DowntimeInstance; readonly outcomes: readonly unknown[]; readonly outcomesApplied: readonly ChildReceipt[] }>> {
    const cleanDomainUuid = this.#cleanId(params.domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === params.activityId);
    if (!activity) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_NOT_FOUND",
          category: "not-found",
          message: `Downtime activity ${params.activityId} not found in domain ${params.domainUuid}`
        })
      );
    }

    if (activity.lifecycle === "completed") {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_ALREADY_COMPLETED",
          category: "conflict",
          message: `Downtime activity ${params.activityId} is already completed`
        })
      );
    }

    const def = this.#downtimeRegistry.get(activity.definitionId);
    const outcomes: unknown[] = [];
    const outcomesApplied: ChildReceipt[] = [];

    if (def?.outcomeDefinitions && def.outcomeDefinitions.length > 0) {
      for (const outcome of def.outcomeDefinitions) {
        outcomes.push(outcome);
        if (outcome.type === "economy:grant-resource") {
          const resourceId = outcome.parameters.resourceId as string;
          const amount = Number(outcome.parameters.amount ?? outcome.parameters.deltaMinor ?? 0);
          if (this.#economyService && resourceId && amount > 0) {
            const creditRes = await this.#economyService.commitAdjust({
              domainUuid: cleanDomainUuid,
              resourceId,
              deltaMinor: amount,
              reason: `Downtime completion reward: ${outcome.label}`
            });
            outcomesApplied.push({
              childReceiptId: createOpaqueId("rep"),
              subsystem: "economy",
              action: "grant_resource",
              targetRef: resourceId,
              payload: { resourceId, amount },
              success: creditRes.ok,
              error: creditRes.ok ? undefined : creditRes.error.message,
              appliedAt: Date.now()
            });
          } else {
            outcomesApplied.push({
              childReceiptId: createOpaqueId("rep"),
              subsystem: "economy",
              action: "grant_resource",
              targetRef: resourceId,
              payload: { resourceId, amount },
              success: true,
              appliedAt: Date.now()
            });
          }
        } else {
          outcomesApplied.push({
            childReceiptId: createOpaqueId("rep"),
            subsystem: "custom",
            action: outcome.type,
            targetRef: outcome.id,
            payload: outcome.parameters,
            success: true,
            appliedAt: Date.now()
          });
        }
      }
    }

    const now = Date.now();
    const updatedActivity: DowntimeInstance = {
      ...activity,
      lifecycle: "completed",
      completedAt: now,
      revision: activity.revision + 1,
      updatedAt: now
    };

    // Re-read fresh domain document after outcomes execution to avoid revision conflict
    const freshDocRes = await this.#domains.read(cleanDomainUuid);
    if (!freshDocRes.ok) return freshDocRes;
    const freshDowntimeData = getDomainDowntimeData(freshDocRes.value.record);

    const updatedActivities = freshDowntimeData.activities.map((a) =>
      a.id === params.activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(freshDocRes.value.record, {
      ...freshDowntimeData,
      activities: Object.freeze(updatedActivities)
    });

    const saveRes = await this.#domains.save({
      ...freshDocRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ activity: updatedActivity, outcomes, outcomesApplied: Object.freeze(outcomesApplied) });
  }

  async pauseActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(this.#cleanId(params.domainUuid), params.activityId, "paused");
  }

  async resumeActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(this.#cleanId(params.domainUuid), params.activityId, "inProgress");
  }

  async cancelActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(this.#cleanId(params.domainUuid), params.activityId, "cancelled");
  }

  async #mutateLifecycle(domainUuid: string, activityId: string, targetLifecycle: DowntimeLifecycle): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    const cleanDomainUuid = this.#cleanId(domainUuid);
    const docRes = await this.#domains.read(cleanDomainUuid);
    if (!docRes.ok) return docRes;

    const record = docRes.value.record;
    const currentDowntimeData = getDomainDowntimeData(record);
    const activity = currentDowntimeData.activities.find((a) => a.id === activityId);
    if (!activity) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_NOT_FOUND",
          category: "not-found",
          message: `Downtime activity ${activityId} not found in domain ${domainUuid}`
        })
      );
    }

    const updatedActivity: DowntimeInstance = {
      ...activity,
      lifecycle: targetLifecycle,
      revision: activity.revision + 1,
      updatedAt: Date.now()
    };

    const updatedActivities = currentDowntimeData.activities.map((a) =>
      a.id === activityId ? updatedActivity : a
    );

    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: Object.freeze(updatedActivities)
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ activity: updatedActivity });
  }
}
