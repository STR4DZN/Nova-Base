import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError, type Warning } from "../../core/contracts/public-error.js";
import { isJournalEntryUuid } from "../../core/identity/refs.js";
import {
  domainCapabilityRegistry,
  validateDomainCapabilities,
  type CapabilityRegistry
} from "../../domains/domain-capabilities.js";
import { validateDomainHierarchy, validateDomainReparent } from "../../domains/domain-hierarchy-validator.js";
import type { DomainLifecycle, DomainRecord } from "../../domains/domain-schema.js";
import { validateDomainRecord } from "../../domains/domain-validator.js";
import {
  DomainJournalEntryAdapter,
  type JournalEntryDocumentLike
} from "../adapters/domain-journal-entry-adapter.js";
import { DOMAIN_FLAG_NAMESPACE, encodeDomainRecord, normalizeDomainRecord } from "../codecs/domain-codec.js";
import { DomainIndex, type DomainIndexQuery } from "../indexes/domain-index.js";
import {
  createDomainIntegrityReport,
  DomainIntegrityChecker,
  type DomainIntegrityDocument,
  type DomainIntegrityReport
} from "../integrity/domain-integrity-checker.js";

export interface IdentifiedJournalEntryDocumentLike extends JournalEntryDocumentLike {
  readonly id: string;
  readonly uuid: string;
}

export interface DomainDocumentStore {
  get(id: string): IdentifiedJournalEntryDocumentLike | undefined;
  list(): readonly IdentifiedJournalEntryDocumentLike[];
  create(data: {
    readonly name: string;
    readonly flags: Readonly<Record<string, unknown>>;
    readonly ownership?: Readonly<Record<string, number | string>>;
  }): Promise<IdentifiedJournalEntryDocumentLike>;
}

export interface DomainDocument {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly record: DomainRecord;
  readonly ownership?: Readonly<Record<string, number | string>>;
}

export interface DomainQuery {
  readonly uuid?: string;
  readonly name?: string;
  readonly alias?: string;
  readonly lifecycle?: DomainLifecycle;
  readonly kind?: string;
  readonly scale?: string;
  readonly tag?: string;
  readonly capabilityId?: string;
  readonly parentDomainUuid?: string | null;
}

export interface DomainCreateInput {
  readonly name: string;
  readonly record: DomainRecord;
  readonly ownership?: Readonly<Record<string, number | string>>;
}

export interface DomainRepositoryOptions {
  readonly now?: () => number;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly index?: DomainIndex;
}

export interface DomainMutationOptions {
  readonly expectedRevision?: number;
}

export type DomainMutationStatus = "updated" | "no-op";

export interface DomainMutationResult {
  readonly status: DomainMutationStatus;
  readonly revision: number;
}

export interface DomainReadRepository {
  read(id: string): Result<DomainDocument>;
  load(id: string): Result<DomainDocument>;
  query(query?: DomainQuery): Result<readonly DomainDocument[]>;
  getIndex(): DomainIndex;
  checkIntegrity(): DomainIntegrityReport;
}

export interface DomainRepositoryContract extends DomainReadRepository {
  create(input: DomainCreateInput): Promise<Result<DomainDocument>>;
  save(document: DomainDocument, options?: DomainMutationOptions): Promise<Result<DomainMutationResult>>;
  update(document: DomainDocument, options?: DomainMutationOptions): Promise<Result<DomainMutationResult>>;
  reparent(id: string, parentDomainUuid: string | null, options?: DomainMutationOptions): Promise<Result<DomainMutationResult>>;
  archive(id: string, archivedAt?: number, options?: DomainMutationOptions): Promise<Result<DomainMutationResult>>;
  restore(id: string, options?: DomainMutationOptions): Promise<Result<DomainMutationResult>>;
  rebuildIndex(): Result<void>;
}

function invalid(message: string): Result<never> {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_REPOSITORY_INPUT",
    category: "validation",
    message
  }));
}

function notFound(id: string): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_NOT_FOUND",
    category: "not-found",
    message: `Domain document was not found: ${id}`
  }));
}

function storageFailure(operation: string): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_STORAGE_ERROR",
    category: "provider",
    message: `Domain storage failed during ${operation}`,
    retryable: true
  }));
}

function indexFailure(): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_INDEX_ERROR",
    category: "recovery",
    message: "Domain index could not be updated"
  }));
}

function validateDocument(document: DomainDocument, capabilityRegistry: CapabilityRegistry): Result<void> {
  if (typeof document.id !== "string" || document.id.trim().length === 0) return invalid("Domain document id cannot be empty");
  if (!isJournalEntryUuid(document.uuid)) return invalid("Domain document uuid must be a full JournalEntry UUID");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return invalid("Domain name cannot be empty");

  const validation = validateDomainRecord(document.record);
  if (!validation.ok) {
    return err(createPublicError({
      code: "DM_INVALID_DOMAIN_REPOSITORY_RECORD",
      category: "validation",
      message: "Domain repository record failed schema validation",
      details: validation.error
    }));
  }
  const capabilities = validateDomainCapabilities(document.record.definition.capabilities, capabilityRegistry);
  if (!capabilities.ok) return err(capabilities.error);
  return ok(undefined, capabilities.warnings);
}

function validateCreateInput(input: DomainCreateInput, capabilityRegistry: CapabilityRegistry): Result<void> {
  if (typeof input.name !== "string" || input.name.trim().length === 0) return invalid("Domain name cannot be empty");
  if (input.record.revision !== 0) return invalid("New Domain revision must start at 0");

  const validation = validateDomainRecord(input.record);
  if (!validation.ok) {
    return err(createPublicError({
      code: "DM_INVALID_DOMAIN_REPOSITORY_RECORD",
      category: "validation",
      message: "Domain repository record failed schema validation",
      details: validation.error
    }));
  }
  const capabilities = validateDomainCapabilities(input.record.definition.capabilities, capabilityRegistry);
  if (!capabilities.ok) return err(capabilities.error);
  return ok(undefined, capabilities.warnings);
}

function validateMutationInput(document: DomainDocument, options: DomainMutationOptions): Result<number> {
  const expectedRevision = options.expectedRevision ?? document.record.revision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid("expectedRevision must be a non-negative safe integer");
  if (document.record.revision !== expectedRevision) return invalid("Domain record revision must match expectedRevision");
  return ok(expectedRevision);
}

function revisionConflict(expectedRevision: number, actualRevision: number): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_REVISION_CONFLICT",
    category: "conflict",
    message: "Domain revision is stale",
    details: { expectedRevision, actualRevision },
    userActionRequired: true
  }));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(right, key) &&
    valuesEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
  ));
}

function toDomainDocument(document: IdentifiedJournalEntryDocumentLike): Result<DomainDocument> {
  if (!isJournalEntryUuid(document.uuid)) return invalid("Stored Domain document has an invalid JournalEntry UUID");
  const decoded = new DomainJournalEntryAdapter(document).read();
  if (!decoded.ok) return decoded;
  const ownership = decoded.value.ownership ?? document.ownership;
  return ok({
    id: document.id,
    uuid: document.uuid,
    name: decoded.value.name,
    record: decoded.value.record,
    ...(ownership !== undefined ? { ownership } : {})
  });
}

export class DomainRepository implements DomainRepositoryContract {
  private readonly now: () => number;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly index: DomainIndex;
  private readonly integrityChecker: DomainIntegrityChecker;
  private indexReady = false;
  private indexWarnings: readonly Warning[] = [];

  constructor(private readonly store: DomainDocumentStore, options: DomainRepositoryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.capabilityRegistry = options.capabilityRegistry ?? domainCapabilityRegistry;
    this.index = options.index ?? new DomainIndex();
    this.integrityChecker = new DomainIntegrityChecker({ capabilityRegistry: this.capabilityRegistry });
  }

  private loadAllDocuments(): Result<readonly DomainDocument[]> {
    const documents: DomainDocument[] = [];
    try {
      for (const source of this.store.list()) {
        const decoded = toDomainDocument(source);
        if (!decoded.ok) return decoded;
        documents.push(decoded.value);
      }
    } catch {
      return storageFailure("list");
    }

    const hierarchy = validateDomainHierarchy(documents.map((document) => ({
      uuid: document.uuid,
      parentDomainUuid: document.record.definition.hierarchy.parentDomainUuid
    })));
    if (!hierarchy.ok) return err(hierarchy.error);
    return ok(documents, hierarchy.warnings);
  }

  private ensureIndex(): Result<void> {
    if (this.indexReady) return ok(undefined, this.indexWarnings);
    return this.rebuildIndex();
  }

  private validateParentChange(current: DomainDocument, parentDomainUuid: string | null): Result<void> {
    const all = this.loadAllDocuments();
    if (!all.ok) return err(all.error);
    const hierarchy = validateDomainReparent(
      all.value.map((document) => ({ uuid: document.uuid, parentDomainUuid: document.record.definition.hierarchy.parentDomainUuid })),
      current.uuid,
      parentDomainUuid
    );
    if (!hierarchy.ok) return err(hierarchy.error);

    if (parentDomainUuid !== null) {
      const parent = all.value.find((document) => document.uuid === parentDomainUuid);
      if (parent?.record.state.lifecycle === "archived") {
        return err(createPublicError({
          code: "DM_DOMAIN_PARENT_ARCHIVED",
          category: "conflict",
          message: "An archived Domain cannot be a new parent without a GM override"
        }));
      }
    }
    return ok(undefined, hierarchy.warnings);
  }

  private validateCreateParent(parentDomainUuid: string | null): Result<void> {
    if (parentDomainUuid === null) return ok(undefined);
    const all = this.loadAllDocuments();
    if (!all.ok) return err(all.error);
    const parent = all.value.find((document) => document.uuid === parentDomainUuid);
    if (parent === undefined) {
      return err(createPublicError({
        code: "DM_DOMAIN_PARENT_NOT_FOUND",
        category: "not-found",
        message: `Domain parent was not found: ${parentDomainUuid}`
      }));
    }
    if (parent.record.state.lifecycle === "archived") {
      return err(createPublicError({
        code: "DM_DOMAIN_PARENT_ARCHIVED",
        category: "conflict",
        message: "An archived Domain cannot be a new parent without a GM override"
      }));
    }
    return ok(undefined, all.warnings);
  }

  async create(input: DomainCreateInput): Promise<Result<DomainDocument>> {
    const normalizedInput: DomainCreateInput = {
      name: input.name.trim(),
      record: normalizeDomainRecord(input.record, input.name)
    };
    const validation = validateCreateInput(normalizedInput, this.capabilityRegistry);
    if (!validation.ok) return validation;
    const parentValidation = this.validateCreateParent(normalizedInput.record.definition.hierarchy.parentDomainUuid);
    if (!parentValidation.ok) return parentValidation;

    try {
      const created = await this.store.create({
        name: normalizedInput.name,
        flags: { [DOMAIN_FLAG_NAMESPACE]: encodeDomainRecord(normalizedInput.record) },
        ...(input.ownership !== undefined ? { ownership: input.ownership } : {})
      });
      if (typeof created.id !== "string" || created.id.trim().length === 0 || !isJournalEntryUuid(created.uuid)) return storageFailure("create");
      const createdDocument = toDomainDocument(created);
      if (!createdDocument.ok) return createdDocument;
      if (this.indexReady && !this.index.upsert(createdDocument.value).ok) return indexFailure();
      return ok(createdDocument.value, [...(validation.warnings ?? []), ...(parentValidation.warnings ?? [])]);
    } catch {
      return storageFailure("create");
    }
  }

  read(id: string): Result<DomainDocument> {
    if (typeof id !== "string" || id.trim().length === 0) return invalid("Domain document id cannot be empty");
    try {
      const document = this.store.get(id);
      if (document === undefined) return notFound(id);
      return toDomainDocument(document);
    } catch {
      return storageFailure("read");
    }
  }

  load(id: string): Result<DomainDocument> {
    return this.read(id);
  }

  query(query: DomainQuery = {}): Result<readonly DomainDocument[]> {
    const ready = this.ensureIndex();
    if (!ready.ok) return err(ready.error);
    const indexQuery: DomainIndexQuery = { ...query };
    const entries = this.index.query(indexQuery);
    const documents: DomainDocument[] = [];
    for (const entry of entries) {
      const document = this.read(entry.id);
      if (!document.ok) return document;
      documents.push(document.value);
    }
    return ok(documents, ready.warnings);
  }

  getIndex(): DomainIndex {
    return this.index;
  }

  rebuildIndex(): Result<void> {
    const documents = this.loadAllDocuments();
    if (!documents.ok) return err(documents.error);
    const rebuilt = this.index.rebuild(documents.value);
    if (!rebuilt.ok) return err(rebuilt.error);
    this.indexReady = true;
    this.indexWarnings = Object.freeze([...(documents.warnings ?? [])]);
    return ok(undefined, this.indexWarnings);
  }

  checkIntegrity(): DomainIntegrityReport {
    let sourceDocuments: readonly IdentifiedJournalEntryDocumentLike[];
    try {
      sourceDocuments = this.store.list();
    } catch {
      return createDomainIntegrityReport(0, [{ code: "DM_DOMAIN_STORAGE_ERROR", severity: "error", message: "Domain storage could not be enumerated" }]);
    }

    const documents: DomainIntegrityDocument[] = [];
    for (const document of sourceDocuments) {
      try {
        const decoded = new DomainJournalEntryAdapter(document).read();
        if (decoded.ok) {
          documents.push({ id: document.id, uuid: document.uuid, name: decoded.value.name, record: decoded.value.record });
        } else {
          documents.push({ id: document.id, uuid: document.uuid, name: document.name, record: undefined, decodeError: decoded.error });
        }
      } catch {
        documents.push({
          id: document.id, uuid: document.uuid, name: document.name, record: undefined,
          decodeError: createPublicError({ code: "DM_DOMAIN_PAYLOAD_INVALID", category: "integrity", message: "Domain payload could not be inspected" })
        });
      }
    }
    return this.integrityChecker.check(documents);
  }

  async save(document: DomainDocument, options: DomainMutationOptions = {}): Promise<Result<DomainMutationResult>> {
    const normalizedDocument: DomainDocument = {
      ...document,
      name: document.name.trim(),
      record: normalizeDomainRecord(document.record, document.name)
    };
    const validation = validateDocument(normalizedDocument, this.capabilityRegistry);
    if (!validation.ok) return validation;
    const mutationInput = validateMutationInput(normalizedDocument, options);
    if (!mutationInput.ok) return mutationInput;
    const expectedRevision = mutationInput.value;

    try {
      const target = this.store.get(normalizedDocument.id);
      if (target === undefined) return notFound(normalizedDocument.id);
      if (target.uuid !== normalizedDocument.uuid) return invalid("Domain document UUID cannot be changed during save");
      const current = toDomainDocument(target);
      if (!current.ok) return current;
      if (current.value.record.revision !== expectedRevision) return revisionConflict(expectedRevision, current.value.record.revision);

      const parentChanged = current.value.record.definition.hierarchy.parentDomainUuid !== normalizedDocument.record.definition.hierarchy.parentDomainUuid;
      let hierarchyWarnings: readonly Warning[] = [];
      if (parentChanged) {
        const hierarchy = this.validateParentChange(current.value, normalizedDocument.record.definition.hierarchy.parentDomainUuid);
        if (!hierarchy.ok) return hierarchy;
        hierarchyWarnings = hierarchy.warnings ?? [];
      }

      if (current.value.name === normalizedDocument.name && valuesEqual(current.value.record, normalizedDocument.record)) {
        if (this.indexReady && !this.index.upsert(current.value).ok) return indexFailure();
        return ok({ status: "no-op", revision: current.value.record.revision }, [...(validation.warnings ?? []), ...hierarchyWarnings]);
      }

      const nextRecord: DomainRecord = { ...normalizedDocument.record, revision: current.value.record.revision + 1 };
      const write = await new DomainJournalEntryAdapter(target).write(normalizedDocument.name, nextRecord);
      if (!write.ok) return err(write.error);
      const updatedDocument: DomainDocument = { id: target.id, uuid: target.uuid, name: normalizedDocument.name, record: nextRecord };
      if (this.indexReady && !this.index.upsert(updatedDocument).ok) return indexFailure();
      return ok({ status: "updated", revision: nextRecord.revision }, [...(validation.warnings ?? []), ...hierarchyWarnings]);
    } catch {
      return storageFailure("save");
    }
  }

  async update(document: DomainDocument, options: DomainMutationOptions = {}): Promise<Result<DomainMutationResult>> {
    return this.save(document, options);
  }

  async reparent(id: string, parentDomainUuid: string | null, options: DomainMutationOptions = {}): Promise<Result<DomainMutationResult>> {
    const current = this.read(id);
    if (!current.ok) return err(current.error);
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid("expectedRevision must be a non-negative safe integer");
    if (expectedRevision !== current.value.record.revision) return revisionConflict(expectedRevision, current.value.record.revision);

    return this.save({
      ...current.value,
      record: {
        ...current.value.record,
        definition: { ...current.value.record.definition, hierarchy: { parentDomainUuid } }
      }
    }, { expectedRevision });
  }

  async archive(id: string, archivedAt = this.now(), options: DomainMutationOptions = {}): Promise<Result<DomainMutationResult>> {
    if (!Number.isFinite(archivedAt) || archivedAt < 0) return invalid("archivedAt must be a finite non-negative number");
    const current = this.read(id);
    if (!current.ok) return current;
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid("expectedRevision must be a non-negative safe integer");
    if (expectedRevision !== current.value.record.revision) return revisionConflict(expectedRevision, current.value.record.revision);

    return this.save({
      ...current.value,
      record: {
        ...current.value.record,
        state: { lifecycle: "archived" },
        metadata: { ...current.value.record.metadata, archivedAt }
      }
    }, { expectedRevision });
  }

  async restore(id: string, options: DomainMutationOptions = {}): Promise<Result<DomainMutationResult>> {
    const current = this.read(id);
    if (!current.ok) return current;
    if (current.value.record.state.lifecycle !== "archived") {
      return err(createPublicError({ code: "DM_DOMAIN_NOT_ARCHIVED", category: "conflict", message: "Only an archived Domain can be restored" }));
    }
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid("expectedRevision must be a non-negative safe integer");
    if (expectedRevision !== current.value.record.revision) return revisionConflict(expectedRevision, current.value.record.revision);

    return this.save({
      ...current.value,
      record: {
        ...current.value.record,
        state: { lifecycle: "active" },
        metadata: { ...current.value.record.metadata, archivedAt: null }
      }
    }, { expectedRevision });
  }
}
