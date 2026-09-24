import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { createOpaqueId } from "../../core/identity/ids.js";
import { normalizeJournalEntryId } from "../../core/identity/refs.js";
import type { DomainRepositoryContract } from "../../storage/repositories/domain-repository.js";
import type { DowntimeDefinitionRegistry } from "../definitions/downtime-registry.js";
import { createDefaultDowntimeRegistry } from "../definitions/downtime-registry.js";
import {
  type DowntimeDefinition,
  type DowntimeInstance,
  type DowntimeLifecycle,
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
import type { ChildReceipt } from "../../projects/plans/project-plan-types.js";
import { tryGetDomainPeopleData } from "../../people/people-data.js";
import type { TransactionStore } from "../../mutations/transaction-store.js";
import type { RecoveryService } from "../../mutations/recovery-service.js";
import { executeDowntimeStartPlan } from "../plans/downtime-start-plan.js";
import { executeDowntimeResolutionPlan } from "../plans/downtime-resolution-plan.js";

export type DowntimeOutcomeHandler = (outcome: any) => Promise<ChildReceipt> | ChildReceipt;

export interface DowntimeServiceOptions {
  readonly domains: DomainRepositoryContract;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly economyService?: EconomyService;
  readonly facilitiesService?: FacilitiesService;
  readonly transactionStore?: TransactionStore;
  readonly recoveryService?: RecoveryService;
  readonly outcomeHandlers?: Record<string, DowntimeOutcomeHandler>;
}

export interface StartActivityParams {
  readonly domainUuid: string;
  readonly definitionId: string;
  readonly label?: string;
  readonly scope?: DowntimeScope;
  readonly durationTicks?: number | null;
  readonly participantRef?: string;
  readonly participants?: readonly (DowntimeParticipant | { ref: string; role?: string; name?: string; participantRef?: string; participantType?: any })[];
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface AdvanceActivityParams {
  readonly domainUuid: string;
  readonly activityId: string;
  readonly ticks: number;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export interface CompleteActivityParams {
  readonly domainUuid: string;
  readonly activityId: string;
  readonly outcomeKey?: string;
  readonly notes?: string;
  readonly userId?: string | null;
  readonly outcomeHandlers?: Record<string, DowntimeOutcomeHandler>;
  readonly commandId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly authorityEpoch?: number;
}

export class DowntimeService {
  readonly #domains: DomainRepositoryContract;
  readonly #downtimeRegistry: DowntimeDefinitionRegistry;
  readonly #economyService?: EconomyService;
  readonly #facilitiesService?: FacilitiesService;
  readonly #transactionStore?: TransactionStore;
  readonly #recoveryService?: RecoveryService;
  readonly #outcomeHandlers?: Record<string, DowntimeOutcomeHandler>;

  constructor(options: DowntimeServiceOptions) {
    this.#domains = options.domains;
    this.#downtimeRegistry = options.downtimeRegistry ?? createDefaultDowntimeRegistry();
    this.#economyService = options.economyService;
    this.#facilitiesService = options.facilitiesService;
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    this.#outcomeHandlers = options.outcomeHandlers;
    if (this.#recoveryService) {
      this.registerRecoveryCompensators(this.#recoveryService);
    }
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
    const res = await executeDowntimeStartPlan(
      {
        domains: this.#domains,
        downtimeRegistry: this.#downtimeRegistry,
        economyService: this.#economyService,
        facilitiesService: this.#facilitiesService,
        transactionStore: this.#transactionStore
      },
      params
    );
    if (!res.ok) return res;
    return ok({ activity: res.value.activity, activityId: res.value.activity.id });
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
        userId: params.userId,
        commandId: params.commandId,
        correlationId: params.correlationId,
        causationId: params.causationId,
        authorityEpoch: params.authorityEpoch
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
    return executeDowntimeResolutionPlan(
      {
        domains: this.#domains,
        downtimeRegistry: this.#downtimeRegistry,
        economyService: this.#economyService,
        facilitiesService: this.#facilitiesService,
        transactionStore: this.#transactionStore,
        defaultOutcomeHandlers: this.#outcomeHandlers
      },
      params
    );
  }

  async pauseActivity(params: {
    readonly domainUuid: string;
    readonly activityId: string;
    readonly reason?: string;
    readonly userId?: string | null;
    readonly commandId?: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly authorityEpoch?: number;
  }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(this.#cleanId(params.domainUuid), params.activityId, "paused");
  }

  async resumeActivity(params: {
    readonly domainUuid: string;
    readonly activityId: string;
    readonly reason?: string;
    readonly userId?: string | null;
    readonly commandId?: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly authorityEpoch?: number;
  }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
    return this.#mutateLifecycle(this.#cleanId(params.domainUuid), params.activityId, "inProgress");
  }

  async cancelActivity(params: {
    readonly domainUuid: string;
    readonly activityId: string;
    readonly reason?: string;
    readonly userId?: string | null;
    readonly commandId?: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly authorityEpoch?: number;
  }): Promise<Result<{ readonly activity: DowntimeInstance }>> {
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

  registerRecoveryCompensators(recoveryService?: RecoveryService): void {
    const recovery = recoveryService ?? this.#recoveryService;
    if (!recovery) return;

    recovery.registerCompensator("downtime:start", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "downtime:start") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.debitedCosts && Array.isArray(data.debitedCosts)) {
        for (const cost of data.debitedCosts) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cost.resourceId,
            deltaMinor: cost.amount,
            reason: `Recovery: refund upfront cost for downtime activity ${data.definitionId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }
      return ok(undefined);
    });

    recovery.registerCompensator("downtime:resolution", async (record) => {
      const data = record.recoveryData as Record<string, any> | undefined;
      if (!data || data.type !== "downtime:resolution") {
        return ok(undefined);
      }
      const recoveryLockOwner = `recovery_${record.transactionId}`;
      if (this.#economyService && data.creditedResources && Array.isArray(data.creditedResources)) {
        for (const cred of data.creditedResources) {
          const refRes = await this.#economyService.commitAdjust({
            domainUuid: data.domainUuid,
            resourceId: cred.resourceId,
            deltaMinor: -cred.amount,
            reason: `Recovery: reverse outcome credit for downtime activity ${data.activityId}`,
            lockOwner: recoveryLockOwner
          });
          if (!refRes.ok) return refRes;
        }
      }
      return ok(undefined);
    });
  }
}
