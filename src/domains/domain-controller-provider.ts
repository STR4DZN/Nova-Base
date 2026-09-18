import type { DomainRecord } from "./domain-schema.js";
import type { DomainDocument } from "../storage/repositories/domain-repository.js";

/**
 * Context provided when evaluating Domain Controller authorization.
 */
export interface DomainControllerEvaluationContext {
  readonly record?: DomainRecord;
  readonly document?: DomainDocument;
}

/**
 * Contract for resolving whether a user has Domain Controller authority over a domain.
 *
 * Implements Master Spec §5.5, §11.2, §13 (DEC-018):
 * - Domain controllers may remain OBSERVER on the JournalEntry in Foundry.
 * - Ownership is not the sole permission layer.
 * - Evaluates registered or persisted domain controller assignments without relying on createdByUserId
 *   and without polluting DomainPeopleData.
 */
export interface DomainControllerProvider {
  isDomainController(
    domainId: string,
    userId: string,
    context?: DomainControllerEvaluationContext
  ): boolean | Promise<boolean>;
  assignController?(domainId: string, userId: string): void;
  revokeController?(domainId: string, userId: string): void;
  getControllers?(domainId: string): readonly string[];
  clear?(): void;
}

/**
 * Default implementation of DomainControllerProvider.
 *
 * Checks:
 * 1. Explicitly assigned controllers in runtime memory (e.g. from session, permissions service, or runtime wiring).
 * 2. Persisted controllers in domain record definition capabilities config:
 *    - `record.definition.capabilities.config["domain-manager:domain"].controllers`
 *    - `record.definition.capabilities.config.controllers`
 */
export class DefaultDomainControllerProvider implements DomainControllerProvider {
  readonly #assignedControllers = new Map<string, Set<string>>();

  assignController(domainId: string, userId: string): void {
    const cleanId = domainId.startsWith("JournalEntry.")
      ? domainId.slice("JournalEntry.".length)
      : domainId;
    let set = this.#assignedControllers.get(cleanId);
    if (!set) {
      set = new Set<string>();
      this.#assignedControllers.set(cleanId, set);
    }
    set.add(userId);
  }

  revokeController(domainId: string, userId: string): void {
    const cleanId = domainId.startsWith("JournalEntry.")
      ? domainId.slice("JournalEntry.".length)
      : domainId;
    this.#assignedControllers.get(cleanId)?.delete(userId);
  }

  getControllers(domainId: string): readonly string[] {
    const cleanId = domainId.startsWith("JournalEntry.")
      ? domainId.slice("JournalEntry.".length)
      : domainId;
    const set = this.#assignedControllers.get(cleanId);
    return set ? Array.from(set) : [];
  }

  clear(): void {
    this.#assignedControllers.clear();
  }

  isDomainController(
    domainId: string,
    userId: string,
    context?: DomainControllerEvaluationContext
  ): boolean {
    const cleanId = domainId.startsWith("JournalEntry.")
      ? domainId.slice("JournalEntry.".length)
      : domainId;

    // 1. Check in-memory assignments
    const assigned = this.#assignedControllers.get(cleanId);
    if (assigned && assigned.has(userId)) {
      return true;
    }

    // 2. Check persisted domain capabilities configuration
    const record = context?.record ?? context?.document?.record;
    if (record?.definition?.capabilities?.config) {
      const config = record.definition.capabilities.config as Record<string, unknown>;

      // Check core domain capability controllers: ["domain-manager:domain"].controllers
      const domainCapConfig = config["domain-manager:domain"] as
        | { controllers?: readonly string[] }
        | undefined;
      if (
        domainCapConfig &&
        Array.isArray(domainCapConfig.controllers) &&
        domainCapConfig.controllers.includes(userId)
      ) {
        return true;
      }

      // Check root capability controllers: config.controllers
      const generalControllers = config.controllers;
      if (Array.isArray(generalControllers) && generalControllers.includes(userId)) {
        return true;
      }
    }

    return false;
  }
}
