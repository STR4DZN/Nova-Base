import type { DomainRecord } from "../domains/domain-schema.js";
import type { DomainDocument } from "../storage/repositories/domain-repository.js";
import { getDomainPeopleData } from "../people/people-data.js";
import {
  DEFAULT_ROLE_DEFINITIONS,
  type RoleDefinition
} from "../people/roles/role-types.js";
import {
  DEFAULT_OPERATIONAL_GROUP_DEFINITIONS,
  type OperationalGroupDefinition
} from "../people/operational-groups/operational-group-types.js";

export interface CapabilityGrantProvenance {
  readonly capabilityId: string;
  readonly sourceType: "domain-explicit" | "role" | "operational-group";
  readonly sourceId: string;
  readonly sourceLabel: string;
}

export interface EffectiveCapability {
  readonly capabilityId: string;
  readonly isExplicit: boolean;
  readonly sources: readonly CapabilityGrantProvenance[];
}

export interface DomainEffectiveCapabilitiesReport {
  readonly domainUuid: string;
  readonly effectiveCapabilities: readonly EffectiveCapability[];
  readonly enabledCapabilityIds: readonly string[];
  readonly grantsByCapability: Readonly<Record<string, readonly CapabilityGrantProvenance[]>>;
}

import { createDefaultCapabilityResolver } from "./capability-resolver.js";

export function resolvePeopleEffectiveCapabilities(
  domainInput: DomainDocument | DomainRecord,
  roleDefinitions: readonly RoleDefinition[] = DEFAULT_ROLE_DEFINITIONS,
  operationalGroupDefinitions: readonly OperationalGroupDefinition[] = DEFAULT_OPERATIONAL_GROUP_DEFINITIONS
): DomainEffectiveCapabilitiesReport {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";

  const resolver = createDefaultCapabilityResolver();
  return resolver.resolveEffectiveCapabilities({
    domainUuid,
    domainRecord: record,
    roleDefinitions,
    operationalGroupDefinitions
  });
}
