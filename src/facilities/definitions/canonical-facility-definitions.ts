import type { FacilityDefinition } from "../types/facility-types.js";

/**
 * Canonical Facility Definitions provided out of the box (Master Spec §16, DEC-2601-2750 §3.1).
 */
export const CANONICAL_FACILITY_DEFINITIONS: readonly FacilityDefinition[] = Object.freeze([
  Object.freeze<FacilityDefinition>({
    id: "domain-manager:storehouse",
    version: 1,
    label: "Storehouse",
    description: "Central repository for stockpiling domain resources and trade goods.",
    category: "logistics",
    tags: Object.freeze(["storage", "resources", "logistics"]),
    scale: "building",
    maxLevel: 3,
    capabilitiesGranted: Object.freeze(["domain-manager:storage"]),
    defaultReadiness: "ready"
  }),
  Object.freeze<FacilityDefinition>({
    id: "domain-manager:basic-workshop",
    version: 1,
    label: "Basic Workshop",
    description: "Equipped workspace providing crafting, repairs, and fabrication capabilities.",
    category: "production",
    tags: Object.freeze(["crafting", "workshop", "production"]),
    scale: "building",
    maxLevel: 3,
    capabilitiesGranted: Object.freeze(["domain-manager:workshop"]),
    defaultReadiness: "ready"
  }),
  Object.freeze<FacilityDefinition>({
    id: "domain-manager:guard-post",
    version: 1,
    label: "Guard Post",
    description: "Fortified station garrisoning domain militia and maintaining public order.",
    category: "security",
    tags: Object.freeze(["military", "security", "defense"]),
    scale: "building",
    maxLevel: 3,
    capabilitiesGranted: Object.freeze(["domain-manager:security"]),
    defaultReadiness: "ready"
  })
]);
