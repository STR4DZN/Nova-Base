import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { DowntimeDefinition, DowntimeScope } from "../types/downtime-types.js";
import { CANONICAL_DOWNTIME_DEFINITIONS } from "./canonical-downtime-definitions.js";

export class DowntimeDefinitionRegistry {
  private readonly definitions = new Map<string, DowntimeDefinition>();
  private frozen = false;

  get isFrozen(): boolean {
    return this.frozen;
  }

  register(definition: DowntimeDefinition): Result<void, PublicError> {
    if (this.frozen) {
      return err(
        createPublicError({
          code: "DM_REGISTRY_FROZEN",
          category: "conflict",
          message: "Cannot register downtime definition into a frozen registry"
        })
      );
    }

    if (this.definitions.has(definition.id)) {
      return err(
        createPublicError({
          code: "DM_DOWNTIME_ALREADY_EXISTS",
          category: "conflict",
          message: `DowntimeDefinition '${definition.id}' is already registered`
        })
      );
    }

    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    return ok(undefined);
  }

  get(id: string): DowntimeDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(filter?: {
    readonly category?: string;
    readonly scope?: DowntimeScope;
    readonly tag?: string;
  }): readonly DowntimeDefinition[] {
    let result = Array.from(this.definitions.values());

    if (filter) {
      if (filter.category) {
        result = result.filter((d) => d.category === filter.category);
      }
      if (filter.scope) {
        result = result.filter((d) => d.scope === filter.scope);
      }
      if (filter.tag) {
        result = result.filter((d) => d.tags.includes(filter.tag!));
      }
    }

    return Object.freeze(result);
  }

  freeze(): void {
    this.frozen = true;
  }
}

/**
 * Factory for default DowntimeDefinitionRegistry pre-loaded with canonical definitions and frozen.
 */
export function createDefaultDowntimeRegistry(): DowntimeDefinitionRegistry {
  const registry = new DowntimeDefinitionRegistry();
  for (const def of CANONICAL_DOWNTIME_DEFINITIONS) {
    const res = registry.register(def);
    if (!res.ok) {
      throw new Error(`Failed to load canonical downtime definition '${def.id}': ${res.error.message}`);
    }
  }
  registry.freeze();
  return registry;
}
