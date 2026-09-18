import type { DomainRecord } from "../domains/domain-schema.js";
import type { DomainDocument } from "../storage/repositories/domain-repository.js";
import { getDomainPeopleData, type DomainPeopleData } from "../people/people-data.js";
import {
  DEFAULT_ROLE_DEFINITIONS,
  evaluateRole,
  type RoleDefinition
} from "../people/roles/role-types.js";
import {
  DEFAULT_OPERATIONAL_GROUP_DEFINITIONS,
  type OperationalGroupDefinition
} from "../people/operational-groups/operational-group-types.js";
import type {
  CapabilityGrantProvenance,
  DomainEffectiveCapabilitiesReport,
  EffectiveCapability
} from "./people-grants.js";

export interface CapabilityResolutionContext {
  readonly domainUuid: string;
  readonly domainDoc?: DomainDocument;
  readonly domainRecord?: DomainRecord;
  readonly peopleData?: DomainPeopleData;
  readonly roleDefinitions?: readonly RoleDefinition[];
  readonly operationalGroupDefinitions?: readonly OperationalGroupDefinition[];
}

export interface CapabilityGrantProvider {
  readonly id: string;
  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[];
}

export class ExplicitDomainCapabilityProvider implements CapabilityGrantProvider {
  readonly id = "domain-explicit";

  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[] {
    const record = context.domainRecord ?? context.domainDoc?.record;
    if (!record) return [];

    const explicitEnabled = record.definition?.capabilities?.enabled ?? [];
    return explicitEnabled.map((capId) => ({
      capabilityId: capId,
      sourceType: "domain-explicit" as const,
      sourceId: context.domainUuid,
      sourceLabel: "Domain Configuration"
    }));
  }
}

export class PeopleRoleCapabilityProvider implements CapabilityGrantProvider {
  readonly id = "people-role";

  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[] {
    const record = context.domainRecord ?? context.domainDoc?.record;
    const people = context.peopleData ?? (record ? getDomainPeopleData(record) : undefined);
    if (!people) return [];

    const roleDefs = context.roleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
    const grants: CapabilityGrantProvenance[] = [];

    for (const role of people.roles ?? []) {
      const def = roleDefs.find((d) => d.id === role.definitionId);
      if (!def || !Array.isArray(def.grants) || def.grants.length === 0) {
        continue;
      }

      // Group role validation: if scope is operational-group, check parent group lifecycle
      if (role.scope === "operational-group" && role.operationalGroupId) {
        const group = (people.operationalGroups ?? []).find((g) => g.id === role.operationalGroupId);
        if (!group || group.lifecycle === "disbanded") {
          continue; // Group role of nonexistent or disbanded group grants nothing
        }
      }

      const policy = def.grantPolicy ?? "occupied";
      let isGranted = false;

      switch (policy) {
        case "exists":
          isGranted = true;
          break;
        case "occupied":
          isGranted = role.occupants.length > 0;
          break;
        case "requirementsSatisfied": {
          const evalResult = evaluateRole(role, roleDefs, people.operationalGroups);
          isGranted = evalResult.isRequirementSatisfied && evalResult.isValidGroupRole !== false;
          break;
        }
      }

      if (isGranted) {
        for (const capId of def.grants) {
          grants.push({
            capabilityId: capId,
            sourceType: "role",
            sourceId: role.id,
            sourceLabel: role.customLabel ?? def.label
          });
        }
      }
    }

    return grants;
  }
}

export class PeopleOperationalGroupCapabilityProvider implements CapabilityGrantProvider {
  readonly id = "people-operational-group";

  resolveGrants(context: CapabilityResolutionContext): readonly CapabilityGrantProvenance[] {
    const record = context.domainRecord ?? context.domainDoc?.record;
    const people = context.peopleData ?? (record ? getDomainPeopleData(record) : undefined);
    if (!people) return [];

    const groupDefs = context.operationalGroupDefinitions ?? DEFAULT_OPERATIONAL_GROUP_DEFINITIONS;
    const grants: CapabilityGrantProvenance[] = [];

    for (const group of people.operationalGroups ?? []) {
      if (group.lifecycle === "disbanded") {
        continue;
      }

      const def = groupDefs.find((d) => d.id === group.definitionId);
      if (!def || !Array.isArray(def.grants) || def.grants.length === 0) {
        continue;
      }

      if (group.lifecycle === "inactive" && !def.keepGrantWhenInactive) {
        continue;
      }

      for (const capId of def.grants) {
        grants.push({
          capabilityId: capId,
          sourceType: "operational-group",
          sourceId: group.id,
          sourceLabel: group.name
        });
      }
    }

    return grants;
  }
}

export class CapabilityResolver {
  readonly #providers: CapabilityGrantProvider[] = [];

  constructor(providers?: readonly CapabilityGrantProvider[]) {
    if (providers) {
      for (const p of providers) {
        this.registerProvider(p);
      }
    }
  }

  registerProvider(provider: CapabilityGrantProvider): void {
    if (this.#providers.some((p) => p.id === provider.id)) {
      throw new Error(`Duplicate capability grant provider '${provider.id}'`);
    }
    this.#providers.push(provider);
  }

  resolveEffectiveCapabilities(context: CapabilityResolutionContext): DomainEffectiveCapabilitiesReport {
    const grantsMap = new Map<string, CapabilityGrantProvenance[]>();
    const explicitSet = new Set<string>();

    const record = context.domainRecord ?? context.domainDoc?.record;
    if (record?.definition?.capabilities?.enabled) {
      for (const cap of record.definition.capabilities.enabled) {
        explicitSet.add(cap);
      }
    }

    for (const provider of this.#providers) {
      const providerGrants = provider.resolveGrants(context);
      for (const grant of providerGrants) {
        let list = grantsMap.get(grant.capabilityId);
        if (!list) {
          list = [];
          grantsMap.set(grant.capabilityId, list);
        }
        list.push(grant);
      }
    }

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
      domainUuid: context.domainUuid,
      effectiveCapabilities: Object.freeze(effectiveCapabilities),
      enabledCapabilityIds: Object.freeze(enabledCapabilityIds),
      grantsByCapability: Object.freeze(grantsByCapability)
    };
  }
}

export const CapabilityGrantResolver = CapabilityResolver;
export type CapabilityGrantResolver = CapabilityResolver;

export function createDefaultCapabilityResolver(): CapabilityResolver {
  return new CapabilityResolver([
    new ExplicitDomainCapabilityProvider(),
    new PeopleRoleCapabilityProvider(),
    new PeopleOperationalGroupCapabilityProvider()
  ]);
}
