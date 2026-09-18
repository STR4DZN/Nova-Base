import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError, type Warning } from "../core/contracts/public-error.js";
import type { DomainCapabilities } from "./domain-schema.js";
import { validateDomainPeopleData } from "../people/people-data.js";

export type CapabilityConfigValidator = (config: unknown) => Result<void>;

export interface CapabilityDefinition {
  readonly id: string;
  readonly label: string;
  readonly functional: boolean;
  readonly validateConfig?: CapabilityConfigValidator;
}

export class CapabilityRegistry {
  private readonly definitions = new Map<string, CapabilityDefinition>();
  private frozen = false;

  register(definition: CapabilityDefinition): void {
    if (this.frozen) throw new Error("Capability registry is frozen");
    if (!isNamespacedCapabilityId(definition.id)) throw new Error(`Invalid capability ID: ${definition.id}`);
    if (this.definitions.has(definition.id)) throw new Error(`Capability already registered: ${definition.id}`);
    this.definitions.set(definition.id, definition);
  }

  get(id: string): CapabilityDefinition | undefined {
    return this.definitions.get(id);
  }

  freeze(): void {
    this.frozen = true;
  }
}

export function isNamespacedCapabilityId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value);
}

export interface CapabilityGrantSource {
  readonly type: "explicit";
  readonly ref: "definition.capabilities.enabled";
}

export interface CapabilityGrant {
  readonly capabilityId: string;
  readonly source: CapabilityGrantSource;
}

export interface EffectiveCapability {
  readonly capabilityId: string;
  readonly enabled: boolean;
  readonly functional: boolean;
  readonly sources: readonly CapabilityGrant[];
  readonly warnings?: readonly string[];
  readonly degraded?: boolean;
}

export interface DomainCapabilityResolution {
  readonly effective: readonly EffectiveCapability[];
}

function invalid(message: string): Result<never> {
  return err(createPublicError({
    code: "DM_INVALID_CAPABILITY_CONFIG",
    category: "validation",
    message
  }));
}

function warningForUnavailable(id: string): Warning {
  return {
    code: "DM_CAPABILITY_UNAVAILABLE",
    message: `Capability is preserved but unavailable: ${id}`,
    details: { capabilityId: id }
  };
}

function sourceFor(id: string): CapabilityGrant[] {
  return [{
    capabilityId: id,
    source: { type: "explicit", ref: "definition.capabilities.enabled" }
  }];
}

function validateShape(capabilities: DomainCapabilities): Result<void> {
  const seen = new Set<string>();
  for (const id of capabilities.enabled) {
    if (!isNamespacedCapabilityId(id)) return invalid(`Invalid namespaced capability ID: ${id}`);
    if (seen.has(id)) return invalid(`Duplicate enabled capability: ${id}`);
    seen.add(id);
  }
  return ok(undefined);
}

export function resolveEffectiveCapabilities(
  capabilities: DomainCapabilities,
  registry: CapabilityRegistry
): Result<readonly EffectiveCapability[]> {
  const shape = validateShape(capabilities);
  if (!shape.ok) return shape;

  const effective: EffectiveCapability[] = [];
  const warnings: Warning[] = [];
  for (const id of capabilities.enabled) {
    const definition = registry.get(id);
    const sources = sourceFor(id);
    if (definition === undefined) {
      const warning = warningForUnavailable(id);
      warnings.push(warning);
      effective.push({
        capabilityId: id,
        enabled: false,
        functional: false,
        sources,
        warnings: [warning.message],
        degraded: true
      });
      continue;
    }

    const config = capabilities.config[id];
    const configResult = definition.validateConfig?.(config);
    if (configResult !== undefined && !configResult.ok) {
      const warning: Warning = {
        code: "DM_CAPABILITY_CONFIG_INVALID",
        message: `Capability config is invalid: ${id}`,
        details: configResult.error
      };
      warnings.push(warning);
      effective.push({
        capabilityId: id,
        enabled: false,
        functional: definition.functional,
        sources,
        warnings: [warning.message],
        degraded: true
      });
      continue;
    }

    effective.push({
      capabilityId: id,
      enabled: true,
      functional: definition.functional,
      sources
    });
  }

  return ok(effective, warnings);
}

export function validateDomainCapabilities(
  capabilities: DomainCapabilities,
  registry: CapabilityRegistry
): Result<DomainCapabilityResolution> {
  const shape = validateShape(capabilities);
  if (!shape.ok) return shape;

  for (const id of capabilities.enabled) {
    const definition = registry.get(id);
    if (definition === undefined) continue;
    const configResult = definition.validateConfig?.(capabilities.config[id]);
    if (configResult !== undefined && !configResult.ok) {
      return err(createPublicError({
        code: "DM_INVALID_CAPABILITY_CONFIG",
        category: "validation",
        message: `Capability config is invalid: ${id}`,
        details: configResult.error
      }));
    }
  }

  const resolved = resolveEffectiveCapabilities(capabilities, registry);
  if (!resolved.ok) return resolved;
  if (!resolved.value.some((capability) => capability.enabled && capability.functional)) {
    return err(createPublicError({
      code: "DM_NO_FUNCTIONAL_CAPABILITY",
      category: "validation",
      message: "Domain must have at least one enabled functional capability"
    }));
  }
  return ok({ effective: resolved.value }, resolved.warnings);
}

export function createDefaultCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register({ id: "domain-manager:core", label: "Core technical shell", functional: false });
  registry.register({ id: "domain-manager:domain", label: "Domain management", functional: true });
  registry.register({
    id: "domain-manager:people",
    label: "People & Population management",
    functional: true,
    validateConfig: (config) => {
      if (config === undefined || config === null) return ok(undefined);
      const res = validateDomainPeopleData(config);
      return res.ok ? ok(undefined) : err(res.error);
    }
  });
  return registry;
}

export const domainCapabilityRegistry = createDefaultCapabilityRegistry();
