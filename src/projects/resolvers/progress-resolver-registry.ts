import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isNamespacedProjectId } from "../types/project-types.js";
import type { ProgressResolver } from "./progress-resolver-types.js";
import { StandardProgressResolver } from "./standard-progress-resolver.js";

/**
 * Registry of extensible ProgressResolvers (Master Spec §15.3, Anexo 07 §2.1).
 */
export class ProgressResolverRegistry {
  readonly #resolvers = new Map<string, ProgressResolver>();
  #frozen = false;

  /**
   * Registers a progress resolver. Rejects duplicates by default.
   */
  register(resolver: ProgressResolver): Result<void, PublicError> {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_PROJECT_REGISTRY_FROZEN",
          category: "conflict",
          message: "ProgressResolverRegistry is frozen against new registrations"
        })
      );
    }

    if (!resolver || typeof resolver !== "object") {
      return err(
        createPublicError({
          code: "DM_PROJECT_RESOLVER_INVALID",
          category: "validation",
          message: "Resolver must be an object"
        })
      );
    }

    if (!isNamespacedProjectId(resolver.id)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_RESOLVER_INVALID",
          category: "validation",
          message: `Resolver ID must be namespaced: received '${String(resolver?.id)}'`
        })
      );
    }

    if (this.#resolvers.has(resolver.id)) {
      return err(
        createPublicError({
          code: "DM_PROJECT_RESOLVER_ALREADY_EXISTS",
          category: "conflict",
          message: `ProgressResolver '${resolver.id}' is already registered`
        })
      );
    }

    this.#resolvers.set(resolver.id, resolver);
    return ok(undefined);
  }

  get(id: string): ProgressResolver | undefined {
    return this.#resolvers.get(id);
  }

  has(id: string): boolean {
    return this.#resolvers.has(id);
  }

  list(): readonly ProgressResolver[] {
    return Object.freeze(Array.from(this.#resolvers.values()));
  }

  unregister(id: string): boolean {
    if (this.#frozen) {
      throw new Error("Cannot unregister from a frozen ProgressResolverRegistry");
    }
    return this.#resolvers.delete(id);
  }

  freeze(): void {
    this.#frozen = true;
  }

  get isFrozen(): boolean {
    return this.#frozen;
  }
}

/**
 * Creates a ProgressResolverRegistry pre-populated with the canonical standard resolver.
 */
export function createDefaultProgressResolverRegistry(): ProgressResolverRegistry {
  const registry = new ProgressResolverRegistry();
  const standard = new StandardProgressResolver();
  const res = registry.register(standard);
  if (!res.ok) {
    throw new Error(`Failed to register standard progress resolver: ${res.error.message}`);
  }
  return registry;
}
