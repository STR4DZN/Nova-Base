import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError } from "../core/contracts/public-error.js";
import { isJournalEntryUuid } from "../core/identity/refs.js";

function invalid(message: string): Result<void> {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_SCHEMA",
    category: "validation",
    message
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasCaseInsensitiveDuplicates(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function validateDomainRecord(value: unknown): Result<void> {
  if (!isRecord(value)) return invalid("Domain must be an object");

  const schemaVersion = value.schemaVersion;
  const revision = value.revision;
  const definition = value.definition;
  const state = value.state;
  const metadata = value.metadata;

  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) return invalid("Invalid schemaVersion");
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return invalid("Invalid revision");
  if (!isRecord(definition) || !isRecord(state) || !isRecord(metadata)) return invalid("Missing Domain sections");

  const identity = definition.identity;
  const classification = definition.classification;
  const hierarchy = definition.hierarchy;
  const capabilities = definition.capabilities;
  if (!isRecord(identity) || !isRecord(classification) || !isRecord(hierarchy) || !isRecord(capabilities)) {
    return invalid("Missing definition sections");
  }

  if (!stringArray(identity.aliases)) return invalid("Invalid aliases");
  if (identity.aliases.length > 20) return invalid("Domain cannot have more than 20 aliases");
  if (identity.aliases.some((item) => item.trim().length === 0 || item !== item.trim())) return invalid("Aliases must be non-empty and trimmed");
  if (hasCaseInsensitiveDuplicates(identity.aliases)) return invalid("Aliases must be unique case-insensitively");
  if (typeof identity.summary !== "string" || identity.summary.length > 500 || identity.summary !== identity.summary.trim() || typeof identity.description !== "string") {
    return invalid("Invalid identity");
  }

  const technicalId = /^[a-z0-9][a-z0-9._:-]*$/;
  if (typeof classification.kind !== "string" || !technicalId.test(classification.kind)) return invalid("Invalid kind");
  if (typeof classification.scale !== "string" || !technicalId.test(classification.scale)) return invalid("Invalid scale");
  if (!stringArray(classification.tags)) return invalid("Invalid tags");
  if (classification.tags.length > 50) return invalid("Domain cannot have more than 50 tags");
  if (classification.tags.some((item) => !technicalId.test(item))) return invalid("Tags must use canonical technical IDs");
  if (hasCaseInsensitiveDuplicates(classification.tags)) return invalid("Tags must be unique");

  const parentDomainUuid = hierarchy.parentDomainUuid;
  if (parentDomainUuid !== null && !isJournalEntryUuid(parentDomainUuid)) return invalid("Invalid parentDomainUuid");

  if (!stringArray(capabilities.enabled)) return invalid("Invalid capabilities");
  if (!isRecord(capabilities.config)) return invalid("Invalid capability config");

  const lifecycle = state.lifecycle;
  if (lifecycle !== "active" && lifecycle !== "inactive" && lifecycle !== "archived") return invalid("Invalid lifecycle");

  if (metadata.createdByUserId !== null && typeof metadata.createdByUserId !== "string") return invalid("Invalid createdByUserId");
  if (metadata.archivedAt !== null && (typeof metadata.archivedAt !== "number" || !Number.isFinite(metadata.archivedAt) || metadata.archivedAt < 0)) {
    return invalid("Invalid archivedAt");
  }
  if (!isRecord(metadata.source)) return invalid("Invalid source");
  if (metadata.source.type !== "manual" && metadata.source.type !== "template" && metadata.source.type !== "import" && metadata.source.type !== "migration") {
    return invalid("Invalid source type");
  }
  if (metadata.source.ref !== null && typeof metadata.source.ref !== "string") return invalid("Invalid source ref");

  return ok(undefined);
}
