import type { ProjectDefinition } from "../types/project-types.js";

/**
 * Canonical built-in project definitions (Master Spec §15.2, DEC-084, Anexo 07 §1.1).
 */
export const CANONICAL_PROJECT_DEFINITIONS: readonly ProjectDefinition[] = Object.freeze([
  Object.freeze({
    id: "domain-manager:survey",
    version: 1,
    label: "Survey & Reconnaissance",
    description: "Systematic mapping and environmental survey of the domain territory.",
    category: "exploration",
    tags: Object.freeze(["survey", "exploration", "scouting"]),
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 100,
    requirements: Object.freeze([]),
    costs: Object.freeze([]),
    rewards: Object.freeze([]),
    autoComplete: false
  }),
  Object.freeze({
    id: "domain-manager:basic-construction",
    version: 1,
    label: "Basic Construction",
    description: "Standard structural construction work for domain facilities or infrastructure.",
    category: "construction",
    tags: Object.freeze(["construction", "infrastructure", "facility"]),
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 200,
    requirements: Object.freeze([]),
    costs: Object.freeze([]),
    rewards: Object.freeze([]),
    autoComplete: false
  }),
  Object.freeze({
    id: "domain-manager:facility-maintenance",
    version: 1,
    label: "Facility Maintenance & Overhaul",
    description: "Periodic preventative maintenance or overhaul of operational facilities.",
    category: "maintenance",
    tags: Object.freeze(["maintenance", "facility", "repair"]),
    progressResolverId: "domain-manager:standard",
    defaultWorkRequired: 50,
    requirements: Object.freeze([]),
    costs: Object.freeze([]),
    rewards: Object.freeze([]),
    autoComplete: true
  })
]);
