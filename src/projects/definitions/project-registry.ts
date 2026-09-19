import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { ProjectDefinition } from "../types/project-types.js";
import { validateProjectDefinition } from "../types/project-types.js";
import { CANONICAL_PROJECT_DEFINITIONS } from "./canonical-project-definitions.js";

/**
 * Registry of available ProjectDefinitions (Master Spec §15.2, DEC-084, Anexo 07 §1.1).
 * Serves as the catalog from which ProjectInstances are created.
 */
export class ProjectDefinitionRegistry {
  readonly #definitions = new Map<string, ProjectDefinition>();
  #frozen = false;

  /**
   * Registers a project definition. Validates the definition before accepting.
   * Rejects duplicate IDs with DM_PROJECT_DEFINITION_ALREADY_EXISTS.
   */
  register(definition: unknown): Result<ProjectDefinition, PublicError> {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_PROJECT_REGISTRY_FROZEN",
          category: "conflict",
          message: "ProjectDefinitionRegistry is frozen against new registrations"
        })
      );
    }

    const validatedRes = validateProjectDefinition(definition);
    if (!validatedRes.ok) {
      return validatedRes;
    }

    const validated = validatedRes.value;
    if (this.#definitions.has(validated.id)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_DEFINITION_ALREADY_EXISTS",
          category: "conflict",
          message: `Project definition '${validated.id}' is already registered`
        })
      );
    }

    this.#definitions.set(validated.id, validated);
    return ok(validated);
  }

  /**
   * Retrieves a project definition by its namespaced ID.
   */
  get(id: string): ProjectDefinition | undefined {
    return this.#definitions.get(id);
  }

  /**
   * Checks if a definition exists in the registry.
   */
  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  /**
   * Lists registered project definitions with optional filtering by category or tag.
   */
  list(filter?: { readonly category?: string; readonly tag?: string }): readonly ProjectDefinition[] {
    let result = Array.from(this.#definitions.values());
    if (filter?.category) {
      result = result.filter((d) => d.category === filter.category);
    }
    if (filter?.tag) {
      result = result.filter((d) => d.tags.includes(filter.tag!));
    }
    return Object.freeze(result);
  }

  /**
   * Unregisters a project definition by ID. Cannot unregister if frozen.
   */
  unregister(id: string): boolean {
    if (this.#frozen) {
      throw new Error("Cannot unregister from a frozen ProjectDefinitionRegistry");
    }
    return this.#definitions.delete(id);
  }

  /**
   * Freezes the registry against modifications.
   */
  freeze(): void {
    this.#frozen = true;
  }

  get isFrozen(): boolean {
    return this.#frozen;
  }
}

/**
 * Creates a project registry populated with the canonical definitions.
 */
export function createDefaultProjectRegistry(): ProjectDefinitionRegistry {
  const registry = new ProjectDefinitionRegistry();
  for (const def of CANONICAL_PROJECT_DEFINITIONS) {
    const res = registry.register(def);
    if (!res.ok) {
      throw new Error(`Failed to register canonical project definition ${def.id}: ${res.error.message}`);
    }
  }
  return registry;
}
