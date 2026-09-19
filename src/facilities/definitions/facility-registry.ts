import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { CANONICAL_FACILITY_DEFINITIONS } from "./canonical-facility-definitions.js";
import {
  type FacilityDefinition,
  validateFacilityDefinition
} from "../types/facility-types.js";

export interface FacilityDefinitionFilter {
  readonly category?: string;
  readonly tag?: string;
}

/**
 * Registry holding extensible, namespaced FacilityDefinitions (Master Spec §16, DEC-2601-2750 §3.1).
 */
export class FacilityDefinitionRegistry {
  readonly #definitions = new Map<string, FacilityDefinition>();
  #frozen = false;

  register(definition: FacilityDefinition): Result<void, PublicError> {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_REGISTRY_FROZEN",
          category: "conflict",
          message: "Cannot register facility definition in a frozen registry"
        })
      );
    }

    const validRes = validateFacilityDefinition(definition);
    if (!validRes.ok) {
      return validRes;
    }

    if (this.#definitions.has(validRes.value.id)) {
      return err(
        createPublicError({
          code: "DM_FACILITY_ALREADY_EXISTS",
          category: "conflict",
          message: `FacilityDefinition '${validRes.value.id}' is already registered`
        })
      );
    }

    this.#definitions.set(validRes.value.id, validRes.value);
    return ok(undefined);
  }

  get(id: string): FacilityDefinition | undefined {
    return this.#definitions.get(id);
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  list(filter?: FacilityDefinitionFilter): readonly FacilityDefinition[] {
    const all = Array.from(this.#definitions.values());
    if (!filter) {
      return Object.freeze(all);
    }

    return Object.freeze(
      all.filter((def) => {
        if (filter.category && def.category !== filter.category) {
          return false;
        }
        if (filter.tag && !def.tags.includes(filter.tag)) {
          return false;
        }
        return true;
      })
    );
  }

  freeze(): void {
    this.#frozen = true;
  }

  get isFrozen(): boolean {
    return this.#frozen;
  }
}

/**
 * Creates and populates the default FacilityDefinitionRegistry with canonical definitions.
 */
export function createDefaultFacilityRegistry(): FacilityDefinitionRegistry {
  const registry = new FacilityDefinitionRegistry();
  for (const def of CANONICAL_FACILITY_DEFINITIONS) {
    registry.register(def);
  }
  return registry;
}
