import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
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

export interface DowntimeServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
}

export interface StartActivityParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly label?: string;
  readonly scope?: DowntimeScope;
  readonly durationTicks?: number | null;
  readonly participantRef?: string;
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

  constructor(options: DowntimeServiceOptions) {
    this.#domains = options.domains;
    this.#downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();
  }

  get registry(): DowntimeDefinitionRegistry {
    return this.#downtimeRegistry;
  }

  async getActivities(domainUuid: string): Promise<Result<readonly DowntimeInstance[]>> {
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;
    const data = getDomainDowntimeData(docRes.value.record);
    return ok(data.activities);
  }

  async getActivity(domainUuid: string, activityId: string): Promise<Result<DowntimeInstance>> {
    const docRes = await this.#domains.read(domainUuid);
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
    const docRes = await this.#domains.read(params.domainUuid);
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

    // Participant verification
    const participants: DowntimeParticipant[] = [];
    if (params.participantRef) {
      participants.push({
        participantRef: params.participantRef,
        participantType: "notable",
        role: "lead",
        capacityConsumed: 1
      });
    } else if (definition.minParticipants && definition.minParticipants > 0) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_PARTICIPANT_REQUIRED",
          category: "conflict",
          message: `Activity '${definition.label}' requires at least ${definition.minParticipants} participant(s)`
        })
      );
    }

    const currentDowntimeData = getDomainDowntimeData(record);
    const activityId = `dt-${createOpaqueId("prj").slice(4)}`;
    const now = Date.now();

    const newActivity: DowntimeInstance = {
      id: activityId,
      domainUuid: params.domainUuid,
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

    const updatedActivities = Object.freeze([...currentDowntimeData.activities, newActivity]);
    const updatedRecord = withDomainDowntimeData(record, {
      ...currentDowntimeData,
      activities: updatedActivities
    });

    const saveRes = await this.#domains.save({
      ...docRes.value,
      record: updatedRecord
    });
    if (!saveRes.ok) return saveRes;

    return ok({ activity: newActivity, activityId });
  }

  async advanceActivity(params: AdvanceActivityParams): Promise<Result<{ readonly activity: DowntimeInstance; readonly completed: boolean }>> {
    const docRes = await this.#domains.read(params.domainUuid);
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
        domainUuid: params.domainUuid,
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

  async completeActivity(params: CompleteActivityParams): Promise<Result<{ readonly activity: DowntimeInstance; readonly outcomes: readonly unknown[] }>> {
    const docRes = await this.#domains.read(params.domainUuid);
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
    if (def?.outcomeDefinitions && def.outcomeDefinitions.length > 0) {
      for (const outcome of def.outcomeDefinitions) {
        outcomes.push(outcome);
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

    return ok({ activity: updatedActivity, outcomes });
  }

  async pauseActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.activityId, "paused");
  }

  async resumeActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.activityId, "inProgress");
  }

  async cancelActivity(params: { domainUuid: string; activityId: string; reason?: string; userId?: string | null }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(params.domainUuid, params.activityId, "cancelled");
  }

  async #mutateLifecycle(domainUuid: string, activityId: string, targetLifecycle: DowntimeLifecycle): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    const docRes = await this.#domains.read(domainUuid);
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
