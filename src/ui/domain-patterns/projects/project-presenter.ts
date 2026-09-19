import type { DomainRecord } from "../../../domains/domain-schema.js";
import type { DomainDocument } from "../../../storage/repositories/domain-repository.js";
import { getDomainProjectsData, type DomainProjectsData } from "../../../projects/project-data.js";
import {
  calculateProjectProgress,
  type ProjectDefinition,
  type ProjectInstance,
  type ProjectLifecycle
} from "../../../projects/types/project-types.js";
import type { ProjectDefinitionRegistry } from "../../../projects/definitions/project-registry.js";
import type { ViewerIdentity } from "../../../projection/viewer-identity.js";

export interface ProjectsPresenterOptions {
  readonly viewerIsGm?: boolean;
  readonly viewer?: Partial<ViewerIdentity>;
  readonly projectRegistry?: ProjectDefinitionRegistry;
  readonly filterLifecycle?: ProjectLifecycle | "all";
  readonly searchTerm?: string;
}

export interface ProjectBlockerViewModel {
  readonly id: string;
  readonly category: string;
  readonly message: string;
  readonly isSecret: boolean;
}

export interface ProjectWorkforceSummaryViewModel {
  readonly typeId: string;
  readonly required: number;
  readonly allocated: number;
  readonly satisfied: boolean;
}

export interface ProjectRequirementSummaryViewModel {
  readonly targetRef: string;
  readonly kind: string;
  readonly status: "satisfied" | "unsatisfied" | "unavailable" | "error";
  readonly isSecret: boolean;
}

export interface ProjectViewModel {
  readonly id: string;
  readonly definitionId: string;
  readonly label: string;
  readonly description: string;
  readonly lifecycle: ProjectLifecycle;
  readonly statusBadgeClass: string;
  readonly revision: number;
  readonly workRequired: number;
  readonly workCompleted: number;
  readonly progressPercent: number; // Derived integer 0..100 per Master Spec §15.2
  readonly targetRef: string;
  readonly category: string;
  readonly blockers: readonly ProjectBlockerViewModel[];
  readonly workforce: readonly ProjectWorkforceSummaryViewModel[];
  readonly requirements: readonly ProjectRequirementSummaryViewModel[];
  readonly entriesCount: number;
  readonly lastUpdatedFormatted: string;
  readonly completedAtFormatted?: string;
  readonly isSecret: boolean;
  readonly canAdvance: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canBlock: boolean;
  readonly canCancel: boolean;
}

export interface ProjectsSubsystemViewModel {
  readonly domainUuid: string;
  readonly viewerIsGm: boolean;
  readonly totalCount: number;
  readonly activeCount: number;
  readonly pausedCount: number;
  readonly blockedCount: number;
  readonly completedCount: number;
  readonly projects: readonly ProjectViewModel[];
  readonly filterLifecycle: string;
  readonly searchTerm: string;
}

function resolveStatusBadgeClass(lifecycle: ProjectLifecycle): string {
  switch (lifecycle) {
    case "active":
      return "dm-badge-active";
    case "paused":
      return "dm-badge-paused";
    case "blocked":
      return "dm-badge-blocked";
    case "completed":
      return "dm-badge-completed";
    case "cancelled":
      return "dm-badge-canceled";
    case "failed":
      return "dm-badge-failed";
    case "draft":
    case "planned":
      return "dm-badge-planned";
    case "initializing":
      return "dm-badge-initializing";
    case "approved":
      return "dm-badge-approved";
    case "archived":
      return "dm-badge-archived";
    default:
      return "dm-badge-default";
  }
}

export function buildProjectsViewModel(
  domainInput: DomainDocument | DomainRecord,
  options: ProjectsPresenterOptions = {}
): ProjectsSubsystemViewModel {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const viewerIsGm = options.viewerIsGm ?? options.viewer?.isGm ?? false;
  const filterLifecycle = options.filterLifecycle ?? "all";
  const searchTerm = (options.searchTerm ?? "").toLowerCase().trim();

  const data: DomainProjectsData = getDomainProjectsData(record);
  const defRegistry = options.projectRegistry;

  const projectVMs: ProjectViewModel[] = [];

  for (const project of data.projects) {
    const isSecret = Boolean((project as any).visibility === "secret" || project.tags?.includes("secret"));
    if (isSecret && !viewerIsGm) {
      continue; // Filter out secret projects for non-GMs
    }

    // Lifecycle filter
    if (filterLifecycle !== "all" && project.lifecycle !== filterLifecycle) {
      continue;
    }

    const def = defRegistry?.get(project.definitionId);
    const label = project.name || def?.label || project.id;
    const description = project.description ?? def?.description ?? "";
    const category = def?.category ?? "general";
    const targetRef = (project as any).targetRef ?? domainUuid;

    // Search filter
    if (searchTerm) {
      const matchName = label.toLowerCase().includes(searchTerm);
      const matchDef = project.definitionId.toLowerCase().includes(searchTerm);
      const matchTarget = targetRef.toLowerCase().includes(searchTerm);
      if (!matchName && !matchDef && !matchTarget) {
        continue;
      }
    }

    // Derived progress percentage (strictly integer 0..100)
    const progressPercent = project.workRequired > 0
      ? Math.min(100, Math.max(0, Math.floor((project.workCompleted / project.workRequired) * 100)))
      : 100;

    // Blockers (sanitized for non-GMs)
    const blockers: ProjectBlockerViewModel[] = [];
    if (project.lifecycle === "blocked") {
      const bMsg = project.blockedReason || "Project execution is currently blocked.";
      blockers.push({
        id: "blocker-main",
        category: "lifecycle",
        message: bMsg,
        isSecret: false
      });
    }

    // Workforce summaries
    const rawWorkforce = (project as any).workforceAllocations ?? [];
    const workforce: ProjectWorkforceSummaryViewModel[] = rawWorkforce.map((w: any) => ({
      typeId: w.typeId ?? "general",
      required: w.required ?? 0,
      allocated: w.allocated ?? 0,
      satisfied: (w.allocated ?? 0) >= (w.required ?? 0)
    }));

    // Requirements summaries
    const rawRequirements = (project as any).requirements ?? [];
    const requirements: ProjectRequirementSummaryViewModel[] = rawRequirements.map((r: any) => ({
      targetRef: r.targetRef ?? "",
      kind: r.kind ?? "generic",
      status: r.status ?? "satisfied",
      isSecret: Boolean(r.isSecret)
    }));

    const entriesCount = project.entries?.length ?? 0;
    const lastUpdatedFormatted = project.updatedAt
      ? new Date(project.updatedAt).toLocaleDateString()
      : "—";
    const completedAtFormatted = project.completedAt
      ? new Date(project.completedAt).toLocaleDateString()
      : undefined;

    const canAdvance = project.lifecycle === "active";
    const canPause = project.lifecycle === "active";
    const canResume = project.lifecycle === "paused";
    const canBlock = project.lifecycle === "active" || project.lifecycle === "paused";
    const canCancel = project.lifecycle !== "completed" && project.lifecycle !== "cancelled" && project.lifecycle !== "failed" && project.lifecycle !== "archived";

    projectVMs.push({
      id: project.id,
      definitionId: project.definitionId,
      label,
      description,
      lifecycle: project.lifecycle,
      statusBadgeClass: resolveStatusBadgeClass(project.lifecycle),
      revision: project.revision,
      workRequired: project.workRequired,
      workCompleted: project.workCompleted,
      progressPercent,
      targetRef,
      category,
      blockers: Object.freeze(blockers),
      workforce: Object.freeze(workforce),
      requirements: Object.freeze(requirements),
      entriesCount,
      lastUpdatedFormatted,
      completedAtFormatted,
      isSecret,
      canAdvance,
      canPause,
      canResume,
      canBlock,
      canCancel
    });
  }

  // Summary counts across all visible projects
  const allVisible = data.projects.filter((p) => {
    const isSecret = Boolean((p as any).visibility === "secret" || p.tags?.includes("secret"));
    return !isSecret || viewerIsGm;
  });

  const totalCount = allVisible.length;
  const activeCount = allVisible.filter((p) => p.lifecycle === "active").length;
  const pausedCount = allVisible.filter((p) => p.lifecycle === "paused").length;
  const blockedCount = allVisible.filter((p) => p.lifecycle === "blocked").length;
  const completedCount = allVisible.filter((p) => p.lifecycle === "completed").length;

  return {
    domainUuid,
    viewerIsGm,
    totalCount,
    activeCount,
    pausedCount,
    blockedCount,
    completedCount,
    projects: Object.freeze(projectVMs),
    filterLifecycle,
    searchTerm
  };
}
