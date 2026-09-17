import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";
import type { DomainDocument } from "../repositories/domain-repository.js";

export interface DomainIndexEntry {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly kind: string;
  readonly scale: string;
  readonly parentDomainUuid: string | null;
  readonly tags: readonly string[];
  readonly capabilities: readonly string[];
  readonly lifecycle: DomainDocument["record"]["state"]["lifecycle"];
}

export interface DomainIndexQuery {
  readonly uuid?: string;
  readonly name?: string;
  readonly alias?: string;
  readonly kind?: string;
  readonly scale?: string;
  readonly parentDomainUuid?: string | null;
  readonly tag?: string;
  readonly capabilityId?: string;
  readonly lifecycle?: DomainIndexEntry["lifecycle"];
}

function invalid(message: string): Result<never> {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_INDEX_ENTRY",
    category: "integrity",
    message
  }));
}

function keyForParent(parentDomainUuid: string | null): string {
  return parentDomainUuid === null ? "<root>" : parentDomainUuid;
}

function addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key);
  if (ids === undefined) return;
  ids.delete(id);
  if (ids.size === 0) index.delete(key);
}

function toEntry(document: DomainDocument): Result<DomainIndexEntry> {
  if (typeof document.id !== "string" || document.id.trim().length === 0) return invalid("Domain index entry id cannot be empty");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return invalid("Domain index entry name cannot be empty");
  const validation = validateDomainRecord(document.record);
  if (!validation.ok) return invalid("Domain index entry record failed schema validation");

  return ok(Object.freeze({
    id: document.id,
    uuid: document.uuid,
    name: document.name,
    aliases: Object.freeze([...document.record.definition.identity.aliases]),
    kind: document.record.definition.classification.kind,
    scale: document.record.definition.classification.scale,
    parentDomainUuid: document.record.definition.hierarchy.parentDomainUuid,
    tags: Object.freeze([...document.record.definition.classification.tags]),
    capabilities: Object.freeze([...document.record.definition.capabilities.enabled]),
    lifecycle: document.record.state.lifecycle
  }));
}

export class DomainIndex {
  private entries = new Map<string, DomainIndexEntry>();
  private byUuid = new Map<string, Set<string>>();
  private byName = new Map<string, Set<string>>();
  private byAlias = new Map<string, Set<string>>();
  private byKind = new Map<string, Set<string>>();
  private byScale = new Map<string, Set<string>>();
  private byParent = new Map<string, Set<string>>();
  private byTag = new Map<string, Set<string>>();
  private byCapability = new Map<string, Set<string>>();
  private byLifecycle = new Map<string, Set<string>>();

  private add(entry: DomainIndexEntry): void {
    this.entries.set(entry.id, entry);
    addToIndex(this.byUuid, entry.uuid, entry.id);
    addToIndex(this.byName, entry.name, entry.id);
    for (const alias of entry.aliases) addToIndex(this.byAlias, alias, entry.id);
    addToIndex(this.byKind, entry.kind, entry.id);
    addToIndex(this.byScale, entry.scale, entry.id);
    addToIndex(this.byParent, keyForParent(entry.parentDomainUuid), entry.id);
    for (const tag of entry.tags) addToIndex(this.byTag, tag, entry.id);
    for (const capability of entry.capabilities) addToIndex(this.byCapability, capability, entry.id);
    addToIndex(this.byLifecycle, entry.lifecycle, entry.id);
  }

  private removeEntry(entry: DomainIndexEntry): void {
    this.entries.delete(entry.id);
    removeFromIndex(this.byUuid, entry.uuid, entry.id);
    removeFromIndex(this.byName, entry.name, entry.id);
    for (const alias of entry.aliases) removeFromIndex(this.byAlias, alias, entry.id);
    removeFromIndex(this.byKind, entry.kind, entry.id);
    removeFromIndex(this.byScale, entry.scale, entry.id);
    removeFromIndex(this.byParent, keyForParent(entry.parentDomainUuid), entry.id);
    for (const tag of entry.tags) removeFromIndex(this.byTag, tag, entry.id);
    for (const capability of entry.capabilities) removeFromIndex(this.byCapability, capability, entry.id);
    removeFromIndex(this.byLifecycle, entry.lifecycle, entry.id);
  }

  upsert(document: DomainDocument): Result<void> {
    const entry = toEntry(document);
    if (!entry.ok) return entry;
    const previous = this.entries.get(entry.value.id);
    if (previous !== undefined) this.removeEntry(previous);
    this.add(entry.value);
    return ok(undefined);
  }

  rebuild(documents: readonly DomainDocument[]): Result<void> {
    const rebuilt = new DomainIndex();
    const seen = new Set<string>();
    for (const document of documents) {
      if (seen.has(document.id)) return invalid(`Duplicate Domain index entry id: ${document.id}`);
      seen.add(document.id);
      const result = rebuilt.upsert(document);
      if (!result.ok) return result;
    }

    this.entries = rebuilt.entries;
    this.byUuid = rebuilt.byUuid;
    this.byName = rebuilt.byName;
    this.byAlias = rebuilt.byAlias;
    this.byKind = rebuilt.byKind;
    this.byScale = rebuilt.byScale;
    this.byParent = rebuilt.byParent;
    this.byTag = rebuilt.byTag;
    this.byCapability = rebuilt.byCapability;
    this.byLifecycle = rebuilt.byLifecycle;
    return ok(undefined);
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.removeEntry(entry);
    return true;
  }

  get(id: string): DomainIndexEntry | undefined {
    return this.entries.get(id);
  }

  list(): readonly DomainIndexEntry[] {
    return [...this.entries.values()];
  }

  query(query: DomainIndexQuery = {}): readonly DomainIndexEntry[] {
    const sets: readonly (Set<string> | undefined)[] = [
      query.uuid === undefined ? undefined : this.byUuid.get(query.uuid) ?? new Set<string>(),
      query.name === undefined ? undefined : this.byName.get(query.name) ?? new Set<string>(),
      query.alias === undefined ? undefined : this.byAlias.get(query.alias) ?? new Set<string>(),
      query.kind === undefined ? undefined : this.byKind.get(query.kind) ?? new Set<string>(),
      query.scale === undefined ? undefined : this.byScale.get(query.scale) ?? new Set<string>(),
      query.parentDomainUuid === undefined ? undefined : this.byParent.get(keyForParent(query.parentDomainUuid)) ?? new Set<string>(),
      query.tag === undefined ? undefined : this.byTag.get(query.tag) ?? new Set<string>(),
      query.capabilityId === undefined ? undefined : this.byCapability.get(query.capabilityId) ?? new Set<string>(),
      query.lifecycle === undefined ? undefined : this.byLifecycle.get(query.lifecycle) ?? new Set<string>()
    ];
    const constrained = sets.filter((set): set is Set<string> => set !== undefined);
    if (constrained.some((set) => set.size === 0)) return [];

    const candidateIds = constrained.length === 0
      ? undefined
      : new Set([...constrained[0]].filter((id) => constrained.every((set) => set.has(id))));
    return [...this.entries.values()].filter((entry) => candidateIds === undefined || candidateIds.has(entry.id));
  }
}
