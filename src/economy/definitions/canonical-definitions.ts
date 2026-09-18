import type { ResourceDefinition } from "./resource-definition-types.js";

/**
 * Built-in canonical treasury currency (e.g. Gold Pieces, Credits, Coins).
 * Precision 2 corresponds to 100 minor units per major unit (e.g. 1.00 = 100 cents).
 */
export const CANONICAL_RESOURCE_TREASURY: ResourceDefinition = Object.freeze({
  id: "domain-manager:treasury",
  version: 1,
  label: "Treasury",
  description: "Standard sovereign treasury and fungible monetary currency.",
  icon: "fas fa-coins",
  categoryId: "currency",
  tags: Object.freeze(["currency", "monetary", "core"]),
  precision: 2,
  displayUnit: Object.freeze({
    singular: "credit",
    plural: "credits",
    abbreviation: "cr"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});

/**
 * Built-in canonical supplies (e.g. rations, tools, maintenance goods).
 * Precision 0 corresponds to whole integer units.
 */
export const CANONICAL_RESOURCE_SUPPLIES: ResourceDefinition = Object.freeze({
  id: "domain-manager:supplies",
  version: 1,
  label: "Supplies",
  description: "General subsistence, provisions, rations and maintenance supplies.",
  icon: "fas fa-boxes",
  categoryId: "logistics",
  tags: Object.freeze(["logistics", "upkeep", "core"]),
  precision: 0,
  displayUnit: Object.freeze({
    singular: "crate",
    plural: "crates",
    abbreviation: "bx"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});

/**
 * Built-in canonical raw materials (e.g. stone, timber, metal, alloys).
 * Precision 0 corresponds to whole integer units.
 */
export const CANONICAL_RESOURCE_MATERIALS: ResourceDefinition = Object.freeze({
  id: "domain-manager:materials",
  version: 1,
  label: "Materials",
  description: "Raw and processed materials for construction, expansion and manufacturing.",
  icon: "fas fa-cubes",
  categoryId: "production",
  tags: Object.freeze(["production", "construction", "core"]),
  precision: 0,
  displayUnit: Object.freeze({
    singular: "unit",
    plural: "units",
    abbreviation: "mat"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});

export const DEFAULT_CANONICAL_RESOURCES: readonly ResourceDefinition[] = Object.freeze([
  CANONICAL_RESOURCE_TREASURY,
  CANONICAL_RESOURCE_SUPPLIES,
  CANONICAL_RESOURCE_MATERIALS
]);
