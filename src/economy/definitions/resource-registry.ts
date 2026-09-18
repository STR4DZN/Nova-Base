import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import {
  type ResourceDefinition,
  type ResourceLifecycle,
  validateResourceDefinition
} from "./resource-definition-types.js";
import { DEFAULT_CANONICAL_RESOURCES } from "./canonical-definitions.js";

export interface ResourceListFilter {
  readonly lifecycle?: ResourceLifecycle;
  readonly categoryId?: string;
  readonly tag?: string;
}

export class ResourceDefinitionRegistry {
  readonly #definitions = new Map<string, ResourceDefinition>();
  #frozen = false;

  register(definition: ResourceDefinition): Result<void, PublicError> {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_ECON_REGISTRY_FROZEN",
          category: "validation",
          message: "ResourceDefinitionRegistry is frozen and cannot accept new registrations"
        })
      );
    }

    const valRes = validateResourceDefinition(definition);
    if (!valRes.ok) {
      return valRes;
    }

    const validated = valRes.value;
    if (this.#definitions.has(validated.id)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_ALREADY_EXISTS",
          category: "validation",
          message: `ResourceDefinition already registered with ID '${validated.id}'`
        })
      );
    }

    this.#definitions.set(validated.id, validated);
    return ok(undefined);
  }

  get(id: string): ResourceDefinition | undefined {
    return this.#definitions.get(id);
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  unregister(id: string): boolean {
    if (this.#frozen) {
      return false;
    }
    return this.#definitions.delete(id);
  }

  list(filter?: ResourceListFilter): readonly ResourceDefinition[] {
    const all = Array.from(this.#definitions.values());
    if (!filter) {
      return Object.freeze(all);
    }

    const filtered = all.filter((d) => {
      if (filter.lifecycle !== undefined && d.lifecycle !== filter.lifecycle) {
        return false;
      }
      if (filter.categoryId !== undefined && d.categoryId !== filter.categoryId) {
        return false;
      }
      if (filter.tag !== undefined && !d.tags.includes(filter.tag)) {
        return false;
      }
      return true;
    });

    return Object.freeze(filtered);
  }

  freeze(): void {
    this.#frozen = true;
  }

  isFrozen(): boolean {
    return this.#frozen;
  }
}

export function createDefaultResourceRegistry(): ResourceDefinitionRegistry {
  const registry = new ResourceDefinitionRegistry();
  for (const def of DEFAULT_CANONICAL_RESOURCES) {
    const res = registry.register(def);
    if (!res.ok) {
      throw new Error(`Failed to register canonical resource '${def.id}': ${res.error.message}`);
    }
  }
  return registry;
}
