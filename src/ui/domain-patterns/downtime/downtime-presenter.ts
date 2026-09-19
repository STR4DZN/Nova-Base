import type { DomainRecord } from "../../../domains/domain-schema.js";
import type { DomainDocument } from "../../../storage/repositories/domain-repository.js";
import { getDomainDowntimeData, type DomainDowntimeData } from "../../../downtime/downtime-data.js";
import {
  isDowntimeComplete,
  type DowntimeInstance,
  type DowntimeLifecycle,
  type DowntimeScope,
  type DowntimeParticipant
} from "../../../downtime/types/downtime-types.js";
import type { DowntimeDefinitionRegistry } from "../../../downtime/definitions/downtime-registry.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";

export interface DowntimePresenterOptions {
  readonly viewerIsGm?: boolean;
  readonly viewer?: Partial<ViewerIdentity>;
  readonly downtimeRegistry?: DowntimeDefinitionRegistry;
  readonly filterLifecycle?: DowntimeLifecycle | "all";
  readonly filterScope?: DowntimeScope | "all";
  readonly searchTerm?: string;
  readonly participantResolver?: (ref: string, type: string) => string;
}

export interface DowntimeParticipantViewModel {
  readonly participantRef: string;
  readonly participantType: "notable" | "group" | "actor" | "narrative";
  readonly displayName: string; // Domain entity name, participant != Foundry User per Master Spec §17
  readonly role: string;
  readonly capacityConsumed: number;
}

export interface DowntimeOutcomeViewModel {
  readonly id: string;
  readonly type: string;
  readonly targetRef: string;
  readonly description: string;
  readonly received: boolean;
}

export interface DowntimeViewModel {
  readonly id: string;
  readonly definitionId: string;
  readonly label: string;
  readonly description: string;
  readonly scope: DowntimeScope;
  readonly scopeBadgeClass: string;
  readonly lifecycle: DowntimeLifecycle;
  readonly lifecycleBadgeClass: string;
  readonly progressTicks: number;
  readonly durationTicks: number | null;
  readonly durationFormatted: string;
  readonly progressPercent: number | null; // null if indefinite; derived integer 0..100 if finite
  readonly isIndefinite: boolean;
  readonly isCompleted: boolean;
  readonly participants: readonly DowntimeParticipantViewModel[];
  readonly outcomes: readonly DowntimeOutcomeViewModel[];
  readonly startedAtFormatted: string;
  readonly completedAtFormatted?: string;
  readonly isSecret: boolean;
  readonly canAdvance: boolean;
  readonly canComplete: boolean;
  readonly canCancel: boolean;
}

export interface DowntimeSubsystemViewModel {
  readonly domainUuid: string;
  readonly viewerIsGm: boolean;
  readonly totalCount: number;
  readonly activeCount: number;
  readonly completedCount: number;
  readonly activities: readonly DowntimeViewModel[];
  readonly filterLifecycle: string;
  readonly filterScope: string;
  readonly searchTerm: string;
}

function resolveScopeBadgeClass(scope: DowntimeScope): string {
  switch (scope) {
    case "individual":
      return "dm-badge-individual";
    case "group":
      return "dm-badge-group";
    case "domain":
      return "dm-badge-domain";
    case "flexible":
      return "dm-badge-flexible";
    default:
      return "dm-badge-default";
  }
}

function resolveLifecycleBadgeClass(lifecycle: DowntimeLifecycle): string {
  switch (lifecycle) {
    case "inProgress":
      return "dm-badge-active";
    case "ready":
      return "dm-badge-ready";
    case "completed":
      return "dm-badge-completed";
    case "paused":
      return "dm-badge-paused";
    case "planned":
      return "dm-badge-planned";
    case "draft":
      return "dm-badge-draft";
    case "blocked":
      return "dm-badge-blocked";
    case "cancelled":
      return "dm-badge-canceled";
    case "failed":
      return "dm-badge-danger";
    default:
      return "dm-badge-default";
  }
}

export function buildDowntimeViewModel(
  domainInput: DomainDocument | DomainRecord,
  options: DowntimePresenterOptions = {}
): DowntimeSubsystemViewModel {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const viewerIsGm = options.viewerIsGm ?? options.viewer?.isGm ?? false;
  const filterLifecycle = options.filterLifecycle ?? "all";
  const filterScope = options.filterScope ?? "all";
  const searchTerm = (options.searchTerm ?? "").toLowerCase().trim();

  const data: DomainDowntimeData = getDomainDowntimeData(record);
  const defRegistry = options.downtimeRegistry;

  const activityVMs: DowntimeViewModel[] = [];

  for (const activity of data.activities) {
    const isSecret = Boolean((activity as any).visibility === "secret" || activity.tags?.includes("secret"));
    if (isSecret && !viewerIsGm) {
      continue; // Filter out secret downtime for non-GMs
    }

    if (filterLifecycle !== "all" && activity.lifecycle !== filterLifecycle) {
      continue;
    }

    if (filterScope !== "all" && activity.scope !== filterScope) {
      continue;
    }

    const def = defRegistry?.get(activity.definitionId);
    const label = activity.name || def?.label || activity.id;
    const description = activity.description || def?.description || "";

    if (searchTerm) {
      const matchLabel = label.toLowerCase().includes(searchTerm);
      const matchDef = activity.definitionId.toLowerCase().includes(searchTerm);
      if (!matchLabel && !matchDef) {
        continue;
      }
    }

    // Duration & progress: indefinite downtime does NOT auto-complete
    const isIndefinite = activity.durationTicks === null || activity.durationTicks === undefined;
    let progressPercent: number | null = null;
    let durationFormatted: string;

    if (isIndefinite) {
      durationFormatted = `Indefinite (${activity.elapsedTicks} ticks elapsed)`;
      progressPercent = null;
    } else {
      const total = activity.durationTicks as number;
      durationFormatted = `${activity.elapsedTicks} / ${total} ticks`;
      progressPercent = total > 0
        ? Math.min(100, Math.max(0, Math.floor((activity.elapsedTicks / total) * 100)))
        : 100;
    }

    const completed = isDowntimeComplete(activity);

    // Participants: participant != Foundry User per Master Spec §17
    const participants: DowntimeParticipantViewModel[] = activity.participants.map((p: DowntimeParticipant) => {
      let displayName = p.participantRef;
      if (options.participantResolver) {
        displayName = options.participantResolver(p.participantRef, p.participantType);
      }
      return {
        participantRef: p.participantRef,
        participantType: p.participantType,
        displayName,
        role: p.role,
        capacityConsumed: p.capacityConsumed ?? 1
      };
    });

    // Outcomes
    const rawOutcomes = (activity as any).outcomes ?? def?.outcomeDefinitions ?? [];
    const outcomeReceipts = activity.outcomesApplied ?? [];
    const outcomeVMs: DowntimeOutcomeViewModel[] = rawOutcomes.map((o: any, idx: number) => {
      const received = outcomeReceipts.some((r) => r.outcomeId === o.id);
      return {
        id: o.id ?? `outcome-${idx}`,
        type: o.type ?? "resource",
        targetRef: o.targetRef ?? domainUuid,
        description: o.label ?? o.description ?? o.type ?? "Outcome",
        received
      };
    });

    const startedAtFormatted = activity.createdAt
      ? new Date(activity.createdAt).toLocaleDateString()
      : "—";
    const completedAtFormatted = activity.completedAt
      ? new Date(activity.completedAt).toLocaleDateString()
      : undefined;

    const canAdvance = activity.lifecycle === "inProgress";
    const canComplete = activity.lifecycle === "inProgress" || activity.lifecycle === "ready";
    const canCancel = activity.lifecycle !== "completed" && activity.lifecycle !== "cancelled" && activity.lifecycle !== "failed";

    activityVMs.push({
      id: activity.id,
      definitionId: activity.definitionId,
      label,
      description,
      scope: activity.scope,
      scopeBadgeClass: resolveScopeBadgeClass(activity.scope),
      lifecycle: activity.lifecycle,
      lifecycleBadgeClass: resolveLifecycleBadgeClass(activity.lifecycle),
      progressTicks: activity.elapsedTicks,
      durationTicks: activity.durationTicks ?? null,
      durationFormatted,
      progressPercent,
      isIndefinite,
      isCompleted: completed,
      participants: Object.freeze(participants),
      outcomes: Object.freeze(outcomeVMs),
      startedAtFormatted,
      completedAtFormatted,
      isSecret,
      canAdvance,
      canComplete,
      canCancel
    });
  }

  // Summary counts
  const allVisible = data.activities.filter((a) => {
    const isSecret = Boolean((a as any).visibility === "secret" || a.tags?.includes("secret"));
    return !isSecret || viewerIsGm;
  });

  const totalCount = allVisible.length;
  const activeCount = allVisible.filter((a) => a.lifecycle === "inProgress").length;
  const completedCount = allVisible.filter((a) => a.lifecycle === "completed").length;

  return {
    domainUuid,
    viewerIsGm,
    totalCount,
    activeCount,
    completedCount,
    activities: Object.freeze(activityVMs),
    filterLifecycle,
    filterScope,
    searchTerm
  };
}
