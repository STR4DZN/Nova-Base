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

export function resolvePeopleEffectiveCapabilities(
  domainInput: DomainDocument | DomainRecord,
  roleDefinitions: readonly RoleDefinition[] = DEFAULT_ROLE_DEFINITIONS,
  operationalGroupDefinitions: readonly OperationalGroupDefinition[] = DEFAULT_OPERATIONAL_GROUP_DEFINITIONS
): DomainEffectiveCapabilitiesReport {
  const record: DomainRecord = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";

  const people = getDomainPeopleData(record);
  const grantsMap = new Map<string, CapabilityGrantProvenance[]>();

  function addGrant(provenance: CapabilityGrantProvenance) {
    let list = grantsMap.get(provenance.capabilityId);
    if (!list) {
      list = [];
      grantsMap.set(provenance.capabilityId, list);
    }
    list.push(provenance);
  }

  // 1. Explicit domain capabilities (from record.definition.capabilities.enabled)
  const explicitSet = new Set(record.definition?.capabilities?.enabled ?? []);
  for (const capId of explicitSet) {
    addGrant({
      capabilityId: capId,
      sourceType: "domain-explicit",
      sourceId: domainUuid,
      sourceLabel: "Domain Configuration"
    });
  }

  // 2. Role derived grants (DEC-1027, DEC-1028: only filled roles grant capabilities)
  for (const role of people.roles ?? []) {
    if (role.occupants.length === 0) {
      // Vacant roles do not grant capabilities (DEC-1028)
      continue;
    }

    const def = roleDefinitions.find((d) => d.id === role.definitionId);
    if (def && Array.isArray(def.grants)) {
      for (const capId of def.grants) {
        addGrant({
          capabilityId: capId,
          sourceType: "role",
          sourceId: role.id,
          sourceLabel: role.customLabel ?? def.label
        });
      }
    }
  }

  // 3. OperationalGroup derived grants (DEC-1089, DEC-1090: active groups only)
  for (const group of people.operationalGroups ?? []) {
    if (group.lifecycle !== "active") {
      // Inactive or disbanded groups do not grant capabilities (DEC-1090)
      continue;
    }

    const def = operationalGroupDefinitions.find((d) => d.id === group.definitionId);
    if (def && Array.isArray(def.grants)) {
      for (const capId of def.grants) {
        addGrant({
          capabilityId: capId,
          sourceType: "operational-group",
          sourceId: group.id,
          sourceLabel: group.name
        });
      }
    }
  }

  // 4. Compile effective capabilities and provenance
  const effectiveCapabilities: EffectiveCapability[] = [];
  const grantsByCapability: Record<string, readonly CapabilityGrantProvenance[]> = {};
  const enabledCapabilityIds: string[] = [];

  for (const [capId, sources] of grantsMap.entries()) {
    const isExplicit = explicitSet.has(capId);
    const frozenSources = Object.freeze([...sources]);

    effectiveCapabilities.push({
      capabilityId: capId,
      isExplicit,
      sources: frozenSources
    });

    grantsByCapability[capId] = frozenSources;
    enabledCapabilityIds.push(capId);
  }

  return {
    domainUuid,
    effectiveCapabilities: Object.freeze(effectiveCapabilities),
    enabledCapabilityIds: Object.freeze(enabledCapabilityIds),
    grantsByCapability: Object.freeze(grantsByCapability)
  };
}
