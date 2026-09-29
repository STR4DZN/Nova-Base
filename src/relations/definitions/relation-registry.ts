import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import type { RelationDefinition } from "../types/relation-types.js";
import { validateRelationDefinition } from "../types/relation-validation.js";

/** Exact version lookup keeps content registration from rewriting existing relations. */
export class RelationDefinitionRegistry {
  readonly #definitions = new Map<string, Map<number, RelationDefinition>>();
  #frozen = false;

  register(raw: RelationDefinition): Result<void> {
    if (this.#frozen) return err(createPublicError({ code: "DM_REGISTRY_FROZEN", category: "conflict", message: "Relation registry is frozen" }));
    const definition = validateRelationDefinition(raw);
    if (!definition.ok) return definition;
    const versions = this.#definitions.get(definition.value.id) ?? new Map<number, RelationDefinition>();
    if (versions.has(definition.value.version)) return err(createPublicError({ code: "DM_RELATION_DEFINITION_ALREADY_EXISTS",
      category: "conflict", message: "Relation definition version already registered" }));
    versions.set(definition.value.version, definition.value);
    this.#definitions.set(definition.value.id, versions);
    return ok(undefined);
  }

  get(id: string, version: number): RelationDefinition | undefined { return this.#definitions.get(id)?.get(version); }
  list(): readonly RelationDefinition[] { return Object.freeze([...this.#definitions.values()].flatMap(versions => [...versions.values()])); }
  freeze(): void { this.#frozen = true; }
  get isFrozen(): boolean { return this.#frozen; }
}
