import { createPublicError, type PublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import {
  type BaseResourceProvider,
  type ProviderDataFamily,
  isNamespacedProviderId
} from "./provider-types.js";

export class ProviderRegistry {
  readonly #providers = new Map<string, BaseResourceProvider>();
  #frozen = false;

  register(provider: BaseResourceProvider): Result<void, PublicError> {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_REGISTRY_FROZEN",
          category: "conflict",
          message: "ProviderRegistry is frozen and cannot accept new registrations"
        })
      );
    }

    if (!isNamespacedProviderId(provider.providerId)) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_INVALID_ID",
          category: "validation",
          message: `Provider ID must be namespaced (e.g. 'pf2e:currency' or 'vault:inventory'): received '${String(provider.providerId)}'`
        })
      );
    }

    if (this.#providers.has(provider.providerId)) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_ALREADY_EXISTS",
          category: "conflict",
          message: `Provider '${provider.providerId}' is already registered`
        })
      );
    }

    if (!Number.isSafeInteger(provider.contractVersion) || provider.contractVersion < 1) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_INCOMPATIBLE",
          category: "validation",
          message: `Provider '${provider.providerId}' has invalid contract version: ${provider.contractVersion}`
        })
      );
    }

    this.#providers.set(provider.providerId, provider);
    return ok(undefined);
  }

  get<T extends BaseResourceProvider = BaseResourceProvider>(
    providerId: string
  ): T | undefined {
    return this.#providers.get(providerId) as T | undefined;
  }

  has(providerId: string): boolean {
    return this.#providers.has(providerId);
  }

  getByFamily(family: ProviderDataFamily): readonly BaseResourceProvider[] {
    const matched: BaseResourceProvider[] = [];
    for (const p of this.#providers.values()) {
      if (p.family === family) {
        matched.push(p);
      }
    }
    return Object.freeze(matched);
  }

  list(): readonly BaseResourceProvider[] {
    return Object.freeze(Array.from(this.#providers.values()));
  }

  freeze(): void {
    this.#frozen = true;
  }

  isFrozen(): boolean {
    return this.#frozen;
  }
}
