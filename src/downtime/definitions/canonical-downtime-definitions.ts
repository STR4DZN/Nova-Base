import type { DowntimeDefinition } from "../types/downtime-types.js";

/**
 * Built-in canonical Downtime activity templates (Master Spec §17, DEC-2751 §4.1).
 */
export const CANONICAL_DOWNTIME_DEFINITIONS: readonly DowntimeDefinition[] = Object.freeze([
  {
    id: "domain-manager:crafting",
    version: 1,
    label: "Crafting & Fabrication",
    description: "Fabricating items, equipment, or supplies using domain facilities and raw materials.",
    category: "production",
    tags: Object.freeze(["crafting", "supplies", "materials"]),
    scope: "individual",
    defaultDurationTicks: 10,
    minParticipants: 1,
    maxParticipants: 3,
    allowedParticipantRoles: Object.freeze(["owner", "assistant"]),
    costs: Object.freeze([
      { resourceId: "domain-manager:materials", amount: 10 }
    ]),
    outcomeDefinitions: Object.freeze([
      {
        id: "crafting-completion",
        type: "economy:grant-resource",
        label: "Fabricate Finished Supplies",
        parameters: Object.freeze({ resourceId: "domain-manager:supplies", amount: 15 }),
        visibility: "public" as const
      }
    ])
  },
  {
    id: "domain-manager:rest-and-recuperation",
    version: 1,
    label: "Rest & Recuperation",
    description: "Spending time in safety and comfort to recover stamina, treat fatigue, and heal wounds.",
    category: "recovery",
    tags: Object.freeze(["rest", "recovery", "health"]),
    scope: "individual",
    defaultDurationTicks: 5,
    minParticipants: 1,
    maxParticipants: 10,
    allowedParticipantRoles: Object.freeze(["participant"]),
    outcomeDefinitions: Object.freeze([
      {
        id: "recuperation-benefit",
        type: "narrative:event",
        label: "Full Rest Recovery",
        parameters: Object.freeze({ message: "Participant fully recovered from exhaustion and minor fatigue." }),
        visibility: "public" as const
      }
    ])
  },
  {
    id: "domain-manager:patrol-and-recon",
    version: 1,
    label: "Patrol & Reconnaissance",
    description: "Scouting domain perimeters, maintaining vigilance, and surveying surrounding territories.",
    category: "security",
    tags: Object.freeze(["security", "patrol", "recon"]),
    scope: "group",
    defaultDurationTicks: 8,
    minParticipants: 2,
    maxParticipants: 10,
    allowedParticipantRoles: Object.freeze(["supervisor", "participant"]),
    outcomeDefinitions: Object.freeze([
      {
        id: "patrol-intelligence",
        type: "narrative:event",
        label: "Security Recon Report",
        parameters: Object.freeze({ message: "Perimeters secured and local reconnaissance updated." }),
        visibility: "public" as const
      }
    ])
  },
  {
    id: "domain-manager:training",
    version: 1,
    label: "Physical & Tactical Training",
    description: "Rigorous physical exercise, weapons drills, and tactical doctrine training.",
    category: "development",
    tags: Object.freeze(["training", "skill", "tactics"]),
    scope: "individual",
    defaultDurationTicks: 12,
    minParticipants: 1,
    maxParticipants: 4,
    allowedParticipantRoles: Object.freeze(["supervisor", "trainee"]),
    outcomeDefinitions: Object.freeze([
      {
        id: "training-advancement",
        type: "narrative:event",
        label: "Tactical Discipline Acquired",
        parameters: Object.freeze({ message: "Trainees achieved improved discipline and tactical readiness." }),
        visibility: "public" as const
      }
    ])
  }
]);
