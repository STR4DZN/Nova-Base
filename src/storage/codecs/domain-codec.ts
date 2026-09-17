import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";

export const DOMAIN_FLAG_NAMESPACE = "domain-manager";

export type DomainFlagPayload = Omit<DomainRecord, never>;

function normalizeTechnicalId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeTag(value: string): string {
  return normalizeTechnicalId(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(value);
  }
  return output;
}

/** Canonicalize persistence-facing fields without inventing business data. */
export function normalizeDomainRecord(record: DomainRecord, primaryName?: string): DomainRecord {
  const nameKey = primaryName?.trim().toLocaleLowerCase();
  const aliases = uniqueBy(
    record.definition.identity.aliases
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0)
      .filter((alias) => nameKey === undefined || alias.toLocaleLowerCase() !== nameKey),
    (alias) => alias.toLocaleLowerCase()
  );

  const tags = uniqueBy(
    record.definition.classification.tags.map(normalizeTag).filter((tag) => tag.length > 0),
    (tag) => tag
  );

  const enabled = uniqueBy(
    record.definition.capabilities.enabled.map(normalizeTechnicalId).filter((id) => id.length > 0),
    (id) => id
  );
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.definition.capabilities.config)) {
    config[normalizeTechnicalId(key)] = value;
  }

  return {
    ...record,
    definition: {
      ...record.definition,
      identity: {
        ...record.definition.identity,
        aliases,
        summary: record.definition.identity.summary.trim()
      },
      classification: {
        ...record.definition.classification,
        kind: normalizeTechnicalId(record.definition.classification.kind),
        scale: normalizeTechnicalId(record.definition.classification.scale),
        tags
      },
      capabilities: { enabled, config }
    }
  };
}

export function encodeDomainRecord(record: DomainRecord): DomainFlagPayload {
  return JSON.parse(JSON.stringify(normalizeDomainRecord(record))) as DomainFlagPayload;
}

export function decodeDomainRecord(payload: unknown): Result<DomainRecord> {
  const validation = validateDomainRecord(payload);
  if (!validation.ok) {
    return err(createPublicError({
      code: "DM_INVALID_DOMAIN_PAYLOAD",
      category: "integrity",
      message: "Domain flag payload failed schema validation",
      details: validation.error
    }));
  }
  return ok(payload as DomainRecord);
}
