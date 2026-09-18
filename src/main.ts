import {
  registerFoundryPrimaryAuthoritySettings
} from "./authority/foundry-primary-authority-adapter.js";
import { composeDomainManagerRuntime, type DomainManagerRuntime } from "./bootstrap/domain-manager-runtime.js";
import { BUILD_METADATA } from "./core/versioning/build-metadata.js";
import { getBuildDiagnostics } from "./diagnostics/build-diagnostics.js";
import { Logger } from "./diagnostics/logger.js";

/**
 * Domain Manager composition entrypoint.
 *
 * Settings are registered during `init`. Runtime services that depend on
 * Foundry world collections are composed and authority is first resolved at
 * `ready`, matching the approved authority lifecycle.
 */

const logger = new Logger("Domain Manager");
let runtime: DomainManagerRuntime | null = null;

function reconcileAuthority(): void {
  const authority = runtime?.authority;
  if (authority === undefined) return;

  void authority.reconcile().catch((error: unknown) => {
    logger.error("Primary Authority reconciliation failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

Hooks.once("init", () => {
  registerFoundryPrimaryAuthoritySettings({
    onPreferredChanged: reconcileAuthority,
    onAuthorityStateChanged: (value) => {
      try {
        runtime?.authority.synchronizePersistedState(value);
      } catch (error) {
        logger.error("Primary Authority state synchronization failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  logger.info("init");
});

Hooks.once("ready", async () => {
  runtime = composeDomainManagerRuntime();
  await runtime.initialize();
  const module = (globalThis as any).game?.modules?.get?.("domain-manager");
  if (module) {
    module.api = runtime.publicApi;
  }
  reconcileAuthority();

  // If this host is the elected Primary Authority at startup, run recovery scan and recover
  if (runtime.authority.service.isCurrentUser()) {
    const currentEpoch = runtime.authority.service.getStatus().authorityEpoch;
    void runtime.recovery
      .recoverAll(currentEpoch)
      .then((results) => {
        if (results.length > 0) {
          logger.info(
            `Startup recovery processed ${results.length} transactions`,
            { processedCount: results.length }
          );
        }
      })
      .catch((error: unknown) => {
        logger.error("Startup recovery scan failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  Hooks.on("userConnected", () => {
    reconcileAuthority();
  });

  logger.info("ready", BUILD_METADATA);
  logger.info("build diagnostics", getBuildDiagnostics());
  logger.info("runtime composed", {
    domains: runtime.domains.constructor.name,
    authority: runtime.authority.service.getStatus(),
    g2Diagnostics: runtime.diagnostics.getSnapshot()
  });
});

export { composeDomainManagerRuntime, type DomainManagerRuntime } from "./bootstrap/domain-manager-runtime.js";
export { PeopleApplication, PeopleApplicationController } from "./ui/domain-patterns/people/people-app.js";
export { PeopleRepairTool } from "./people/services/people-repair-tool.js";
export { PeopleService, type PublicPeopleApi } from "./people/services/people-service.js";
export {
  type DomainControllerPolicy,
  registerDomainControllerPolicy,
  clearDomainControllerPolicies
} from "./people/commands/people-permissions.js";
export {
  DefaultDomainControllerProvider,
  type DomainControllerProvider,
  type DomainControllerEvaluationContext
} from "./domains/domain-controller-provider.js";
export {
  ResourceDefinitionRegistry,
  createDefaultResourceRegistry
} from "./economy/definitions/resource-registry.js";
export {
  DefaultPublicEconomyApi,
  type PublicEconomyApi
} from "./economy/services/public-economy-api.js";
export {
  ProviderRegistry,
  createDefaultProviderRegistry
} from "./economy/providers/provider-registry.js";
export { ThresholdService } from "./economy/thresholds/threshold-service.js";
export { EconomyApplication, EconomyApplicationController } from "./ui/domain-patterns/economy/economy-app.js";
export type { PublicModuleApi } from "./bootstrap/domain-manager-runtime.js";

