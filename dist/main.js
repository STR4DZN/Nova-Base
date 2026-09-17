// src/authority/primary-authority-election.ts
function compareUserIds(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function isEligible(user) {
  return user.isGM && user.active && user.id.trim().length > 0;
}
function resolvePrimaryAuthorityUserId(users, preferredUserId) {
  const eligibleIds = /* @__PURE__ */ new Set();
  for (const user of users) {
    if (isEligible(user)) eligibleIds.add(user.id);
  }
  if (preferredUserId !== null && eligibleIds.has(preferredUserId)) {
    return preferredUserId;
  }
  if (eligibleIds.size === 0) return null;
  return [...eligibleIds].sort(compareUserIds)[0] ?? null;
}

// src/authority/primary-authority-service.ts
function assertValidEpoch(epoch) {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError("authorityEpoch must be a non-negative safe integer");
  }
}
function assertValidState(state) {
  assertValidEpoch(state.authorityEpoch);
  if (state.authorityUserId !== null && (typeof state.authorityUserId !== "string" || state.authorityUserId.trim().length === 0)) {
    throw new TypeError("authorityUserId must be null or a non-blank string");
  }
  if (!state.initialized && (state.authorityUserId !== null || state.authorityEpoch !== 0)) {
    throw new TypeError("uninitialized authority state must use null authority and epoch 0");
  }
}
function nextEpoch(current) {
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("authorityEpoch cannot exceed Number.MAX_SAFE_INTEGER");
  }
  return current + 1;
}
var PrimaryAuthorityService = class {
  #environment;
  #callbacks = /* @__PURE__ */ new Set();
  #authorityUserId;
  #authorityEpoch;
  #initialized;
  constructor(environment, initialState = {
    authorityUserId: null,
    authorityEpoch: 0,
    initialized: false
  }) {
    assertValidState(initialState);
    this.#environment = environment;
    this.#authorityUserId = initialState.authorityUserId;
    this.#authorityEpoch = initialState.authorityEpoch;
    this.#initialized = initialState.initialized;
  }
  getCurrent() {
    if (this.#authorityUserId === null) return null;
    for (const user of this.#environment.getUsers()) {
      if (user.id === this.#authorityUserId && user.isGM && user.active && user.id.trim().length > 0) {
        return user;
      }
    }
    return null;
  }
  getEpoch() {
    return this.#authorityEpoch;
  }
  getStatus() {
    return Object.freeze({
      authorityUserId: this.#authorityUserId,
      authorityEpoch: this.#authorityEpoch,
      available: this.getCurrent() !== null
    });
  }
  isCurrentUser() {
    const localUserId = this.#environment.getCurrentUserId();
    return localUserId !== null && localUserId === this.#authorityUserId && this.getCurrent() !== null;
  }
  resolve() {
    const users = this.#environment.getUsers();
    const nextAuthorityUserId = resolvePrimaryAuthorityUserId(
      users,
      this.#environment.getPreferredUserId()
    );
    if (!this.#initialized) {
      this.#authorityUserId = nextAuthorityUserId;
      this.#initialized = true;
      return this.getCurrent();
    }
    if (nextAuthorityUserId === null) {
      return null;
    }
    if (nextAuthorityUserId === this.#authorityUserId) {
      return this.getCurrent();
    }
    if (this.#authorityUserId === null) {
      this.#authorityUserId = nextAuthorityUserId;
      for (const callback of [...this.#callbacks]) callback();
      return this.getCurrent();
    }
    const incrementedEpoch = nextEpoch(this.#authorityEpoch);
    this.#authorityUserId = nextAuthorityUserId;
    this.#authorityEpoch = incrementedEpoch;
    for (const callback of [...this.#callbacks]) callback();
    return this.getCurrent();
  }
  /**
   * Synchronize a persisted state received from the Foundry world setting.
   * Higher epochs win. At the same epoch, a previously unknown local identity
   * may adopt the persisted identity; conflicting known identities fail closed.
   */
  synchronizeState(state) {
    assertValidState(state);
    if (!state.initialized) return false;
    if (state.authorityEpoch < this.#authorityEpoch) return false;
    if (state.authorityEpoch === this.#authorityEpoch) {
      if (state.authorityUserId === this.#authorityUserId) {
        if (state.initialized && !this.#initialized) {
          this.#initialized = true;
          return true;
        }
        return false;
      }
      if (this.#authorityUserId !== null) {
        throw new Error("Conflicting authority identities share the same authorityEpoch");
      }
      this.#authorityUserId = state.authorityUserId;
      this.#initialized = true;
      return true;
    }
    this.#authorityUserId = state.authorityUserId;
    this.#authorityEpoch = state.authorityEpoch;
    this.#initialized = true;
    return true;
  }
  onChanged(callback) {
    this.#callbacks.add(callback);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#callbacks.delete(callback);
    };
  }
  snapshotState() {
    return Object.freeze({
      authorityUserId: this.#authorityUserId,
      authorityEpoch: this.#authorityEpoch,
      initialized: this.#initialized
    });
  }
};

// src/authority/foundry-primary-authority-adapter.ts
var PRIMARY_AUTHORITY_SETTING_NAMESPACE = "domain-manager";
var PREFERRED_AUTHORITY_USER_SETTING = "preferredAuthorityUserId";
var AUTHORITY_STATE_SETTING = "primaryAuthorityState";
var DEFAULT_PERSISTED_AUTHORITY_STATE = JSON.stringify({
  authorityUserId: null,
  authorityEpoch: 0,
  initialized: false
});
function settingsFromGlobals() {
  const globals = globalThis;
  const settings = globals.game?.settings;
  if (settings === void 0) {
    throw new Error("Foundry settings runtime is not available");
  }
  return settings;
}
function runtimeFromGlobals() {
  const globals = globalThis;
  const runtime2 = globals.game;
  if (runtime2?.users === void 0 || runtime2.settings === void 0 || !("user" in runtime2)) {
    throw new Error("Foundry authority runtime is not available");
  }
  return runtime2;
}
function normalizePreferredUserId(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function parsePersistedAuthorityState(value) {
  if (typeof value !== "string") {
    throw new TypeError("Persisted Primary Authority state must be a JSON string");
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Persisted Primary Authority state is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Persisted Primary Authority state must be an object");
  }
  const candidate = parsed;
  const authorityUserId = candidate.authorityUserId;
  const authorityEpoch = candidate.authorityEpoch;
  const initialized = candidate.initialized;
  if (authorityUserId !== null && (typeof authorityUserId !== "string" || authorityUserId.trim().length === 0)) {
    throw new TypeError("Persisted authorityUserId must be null or a non-blank string");
  }
  if (typeof authorityEpoch !== "number" || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
    throw new RangeError("Persisted authorityEpoch must be a non-negative safe integer");
  }
  if (typeof initialized !== "boolean") {
    throw new TypeError("Persisted authority initialized flag must be boolean");
  }
  if (!initialized && (authorityUserId !== null || authorityEpoch !== 0)) {
    throw new TypeError("Uninitialized persisted authority state must use null authority and epoch 0");
  }
  return Object.freeze({ authorityUserId, authorityEpoch, initialized });
}
function serializeAuthorityState(state) {
  return JSON.stringify({
    authorityUserId: state.authorityUserId,
    authorityEpoch: state.authorityEpoch,
    initialized: state.initialized
  });
}
function statesEqual(left, right) {
  return left.authorityUserId === right.authorityUserId && left.authorityEpoch === right.authorityEpoch && left.initialized === right.initialized;
}
function registerFoundryPrimaryAuthoritySettings(callbacks = {}, settings = settingsFromGlobals()) {
  settings.register(PRIMARY_AUTHORITY_SETTING_NAMESPACE, PREFERRED_AUTHORITY_USER_SETTING, {
    name: "Domain Manager: Preferred Primary Authority",
    hint: "Optional preferred GM user id used by the technical authority election.",
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => callbacks.onPreferredChanged?.()
  });
  settings.register(PRIMARY_AUTHORITY_SETTING_NAMESPACE, AUTHORITY_STATE_SETTING, {
    name: "Domain Manager: Primary Authority State",
    hint: "Internal persisted authority identity and monotonic epoch.",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_PERSISTED_AUTHORITY_STATE,
    onChange: (value) => callbacks.onAuthorityStateChanged?.(value)
  });
}
var FoundryPrimaryAuthorityEnvironment = class {
  constructor(runtime2) {
    this.runtime = runtime2;
  }
  getUsers() {
    return this.runtime.users.contents;
  }
  getPreferredUserId() {
    return normalizePreferredUserId(
      this.runtime.settings.get(PRIMARY_AUTHORITY_SETTING_NAMESPACE, PREFERRED_AUTHORITY_USER_SETTING)
    );
  }
  getCurrentUserId() {
    return this.runtime.user?.id ?? null;
  }
};
var FoundryPrimaryAuthorityAdapter = class {
  constructor(runtime2 = runtimeFromGlobals()) {
    this.runtime = runtime2;
    const persistedState = parsePersistedAuthorityState(
      runtime2.settings.get(PRIMARY_AUTHORITY_SETTING_NAMESPACE, AUTHORITY_STATE_SETTING)
    );
    this.service = new PrimaryAuthorityService(
      new FoundryPrimaryAuthorityEnvironment(runtime2),
      persistedState
    );
  }
  service;
  async reconcile() {
    const previousState = this.service.snapshotState();
    const authority = this.service.resolve();
    const nextState = this.service.snapshotState();
    if (!statesEqual(previousState, nextState) && this.service.isCurrentUser()) {
      await this.runtime.settings.set(
        PRIMARY_AUTHORITY_SETTING_NAMESPACE,
        AUTHORITY_STATE_SETTING,
        serializeAuthorityState(nextState)
      );
    }
    return authority;
  }
  synchronizePersistedState(value) {
    return this.service.synchronizeState(parsePersistedAuthorityState(value));
  }
};

// src/core/contracts/result.ts
function ok(value, warnings) {
  return warnings === void 0 ? { ok: true, value } : { ok: true, value, warnings };
}
function err(error) {
  return { ok: false, error };
}

// src/core/contracts/public-error.ts
function createPublicError(error) {
  return Object.freeze({ ...error });
}

// src/core/identity/refs.ts
function isFoundryUuid(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return false;
  const segments = value.split(".");
  if (segments.some((segment) => segment.length === 0)) return false;
  if (segments[0] === "Compendium") return segments.length >= 6;
  return segments.length >= 2;
}
function isJournalEntryUuid(value) {
  if (!isFoundryUuid(value)) return false;
  const segments = value.split(".");
  if (segments[0] === "JournalEntry") return segments.length >= 2;
  if (segments[0] !== "Compendium") return false;
  return segments.includes("JournalEntry");
}

// src/domains/domain-validator.ts
function invalid(message) {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_SCHEMA",
    category: "validation",
    message
  }));
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function hasCaseInsensitiveDuplicates(values) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
function validateDomainRecord(value) {
  if (!isRecord(value)) return invalid("Domain must be an object");
  const schemaVersion = value.schemaVersion;
  const revision = value.revision;
  const definition = value.definition;
  const state = value.state;
  const metadata = value.metadata;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) return invalid("Invalid schemaVersion");
  if (!Number.isSafeInteger(revision) || revision < 0) return invalid("Invalid revision");
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
  return ok(void 0);
}

// src/storage/codecs/domain-codec.ts
var DOMAIN_FLAG_NAMESPACE = "domain-manager";
function normalizeTechnicalId(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
function normalizeTag(value) {
  return normalizeTechnicalId(value).normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9._:-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function uniqueBy(values, key) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(value);
  }
  return output;
}
function normalizeDomainRecord(record, primaryName) {
  const nameKey = primaryName?.trim().toLocaleLowerCase();
  const aliases = uniqueBy(
    record.definition.identity.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0).filter((alias) => nameKey === void 0 || alias.toLocaleLowerCase() !== nameKey),
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
  const config = {};
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
function encodeDomainRecord(record) {
  return JSON.parse(JSON.stringify(normalizeDomainRecord(record)));
}
function decodeDomainRecord(payload) {
  const validation = validateDomainRecord(payload);
  if (!validation.ok) {
    return err(createPublicError({
      code: "DM_INVALID_DOMAIN_PAYLOAD",
      category: "integrity",
      message: "Domain flag payload failed schema validation",
      details: validation.error
    }));
  }
  return ok(payload);
}

// src/storage/adapters/foundry-domain-document-store.ts
function runtimeFromGlobals2() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (journal === void 0 || JournalEntry === void 0 || typeof JournalEntry.create !== "function") {
    throw new Error("Foundry JournalEntry runtime is not available");
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
function isDomainDocument(document) {
  return document !== void 0 && Object.prototype.hasOwnProperty.call(document.flags ?? {}, DOMAIN_FLAG_NAMESPACE);
}
var FoundryDomainDocumentStore = class {
  runtime;
  constructor(runtime2 = runtimeFromGlobals2()) {
    this.runtime = runtime2;
  }
  get(id) {
    const document = this.runtime.journal.get(id);
    return isDomainDocument(document) ? document : void 0;
  }
  list() {
    return this.runtime.journal.contents.filter(isDomainDocument);
  }
  async create(data) {
    const created = await this.runtime.createJournalEntry(data);
    if (created === null || created === void 0) {
      throw new Error("Foundry did not return the created JournalEntry");
    }
    return created;
  }
};

// src/domains/domain-capabilities.ts
var CapabilityRegistry = class {
  definitions = /* @__PURE__ */ new Map();
  frozen = false;
  register(definition) {
    if (this.frozen) throw new Error("Capability registry is frozen");
    if (!isNamespacedCapabilityId(definition.id)) throw new Error(`Invalid capability ID: ${definition.id}`);
    if (this.definitions.has(definition.id)) throw new Error(`Capability already registered: ${definition.id}`);
    this.definitions.set(definition.id, definition);
  }
  get(id) {
    return this.definitions.get(id);
  }
  freeze() {
    this.frozen = true;
  }
};
function isNamespacedCapabilityId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value);
}
function invalid2(message) {
  return err(createPublicError({
    code: "DM_INVALID_CAPABILITY_CONFIG",
    category: "validation",
    message
  }));
}
function warningForUnavailable(id) {
  return {
    code: "DM_CAPABILITY_UNAVAILABLE",
    message: `Capability is preserved but unavailable: ${id}`,
    details: { capabilityId: id }
  };
}
function sourceFor(id) {
  return [{
    capabilityId: id,
    source: { type: "explicit", ref: "definition.capabilities.enabled" }
  }];
}
function validateShape(capabilities) {
  const seen = /* @__PURE__ */ new Set();
  for (const id of capabilities.enabled) {
    if (!isNamespacedCapabilityId(id)) return invalid2(`Invalid namespaced capability ID: ${id}`);
    if (seen.has(id)) return invalid2(`Duplicate enabled capability: ${id}`);
    seen.add(id);
  }
  return ok(void 0);
}
function resolveEffectiveCapabilities(capabilities, registry) {
  const shape = validateShape(capabilities);
  if (!shape.ok) return shape;
  const effective = [];
  const warnings = [];
  for (const id of capabilities.enabled) {
    const definition = registry.get(id);
    const sources = sourceFor(id);
    if (definition === void 0) {
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
    if (configResult !== void 0 && !configResult.ok) {
      const warning = {
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
function validateDomainCapabilities(capabilities, registry) {
  const shape = validateShape(capabilities);
  if (!shape.ok) return shape;
  for (const id of capabilities.enabled) {
    const definition = registry.get(id);
    if (definition === void 0) continue;
    const configResult = definition.validateConfig?.(capabilities.config[id]);
    if (configResult !== void 0 && !configResult.ok) {
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
function createDefaultCapabilityRegistry() {
  const registry = new CapabilityRegistry();
  registry.register({ id: "domain-manager:core", label: "Core technical shell", functional: false });
  registry.register({ id: "domain-manager:domain", label: "Domain management", functional: true });
  return registry;
}
var domainCapabilityRegistry = createDefaultCapabilityRegistry();

// src/domains/domain-hierarchy-validator.ts
function invalid3(message) {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_HIERARCHY",
    category: "validation",
    message
  }));
}
function cycle(nodeUuid) {
  return err(createPublicError({
    code: "DM_DOMAIN_HIERARCHY_CYCLE",
    category: "integrity",
    message: `Domain hierarchy contains a cycle involving ${nodeUuid}`
  }));
}
function missingNode(nodeUuid) {
  return err(createPublicError({
    code: "DM_DOMAIN_HIERARCHY_NODE_NOT_FOUND",
    category: "not-found",
    message: `Domain hierarchy node was not found: ${nodeUuid}`
  }));
}
function missingParent(parentUuid) {
  return err(createPublicError({
    code: "DM_DOMAIN_PARENT_NOT_FOUND",
    category: "not-found",
    message: `Domain parent was not found: ${parentUuid}`
  }));
}
function validateNodeShape(node) {
  if (!isJournalEntryUuid(node.uuid)) return invalid3("Domain hierarchy node uuid must be a full JournalEntry UUID");
  if (node.parentDomainUuid !== null && !isJournalEntryUuid(node.parentDomainUuid)) {
    return invalid3("Domain parentDomainUuid must be null or a full JournalEntry UUID");
  }
  return ok(void 0);
}
function orphanWarning(nodeUuid, parentUuid) {
  return {
    code: "DM_DOMAIN_ORPHAN_PARENT",
    message: `Domain ${nodeUuid} references a missing parent ${parentUuid}`,
    details: { nodeUuid, parentUuid }
  };
}
function validateDomainHierarchy(nodes) {
  const byUuid = /* @__PURE__ */ new Map();
  const warnings = [];
  for (const node of nodes) {
    const shape = validateNodeShape(node);
    if (!shape.ok) return shape;
    if (byUuid.has(node.uuid)) return invalid3(`Duplicate Domain hierarchy UUID: ${node.uuid}`);
    byUuid.set(node.uuid, node);
  }
  for (const node of nodes) {
    if (node.parentDomainUuid !== null && !byUuid.has(node.parentDomainUuid)) {
      warnings.push(orphanWarning(node.uuid, node.parentDomainUuid));
    }
  }
  for (const node of nodes) {
    const visited = /* @__PURE__ */ new Set();
    let current = node.uuid;
    while (current !== null) {
      if (visited.has(current)) return cycle(current);
      visited.add(current);
      const currentNode = byUuid.get(current);
      if (currentNode === void 0) break;
      current = currentNode.parentDomainUuid;
    }
  }
  return ok(void 0, warnings);
}
function validateDomainReparent(nodes, nodeUuid, parentDomainUuid) {
  if (!isJournalEntryUuid(nodeUuid)) return invalid3("Domain uuid must be a full JournalEntry UUID");
  if (parentDomainUuid !== null && !isJournalEntryUuid(parentDomainUuid)) {
    return invalid3("Domain parentDomainUuid must be null or a full JournalEntry UUID");
  }
  const current = nodes.find((node) => node.uuid === nodeUuid);
  if (current === void 0) return missingNode(nodeUuid);
  if (parentDomainUuid !== null && !nodes.some((node) => node.uuid === parentDomainUuid)) return missingParent(parentDomainUuid);
  if (parentDomainUuid === nodeUuid) return cycle(nodeUuid);
  const proposed = nodes.map((node) => node.uuid === nodeUuid ? { ...node, parentDomainUuid } : node);
  return validateDomainHierarchy(proposed);
}

// src/storage/adapters/domain-journal-entry-adapter.ts
var DomainJournalEntryAdapter = class {
  constructor(document) {
    this.document = document;
  }
  read() {
    const payload = this.document.flags?.[DOMAIN_FLAG_NAMESPACE];
    const decoded = decodeDomainRecord(payload);
    if (!decoded.ok) return decoded;
    return ok({ name: this.document.name, record: decoded.value });
  }
  async write(name, record) {
    if (name.trim().length === 0) {
      return err(createPublicError({
        code: "DM_INVALID_DOMAIN_NAME",
        category: "validation",
        message: "Domain name cannot be empty"
      }));
    }
    await this.document.update({
      name,
      [`flags.${DOMAIN_FLAG_NAMESPACE}`]: encodeDomainRecord(record)
    });
    return ok(void 0);
  }
};

// src/storage/indexes/domain-index.ts
function invalid4(message) {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_INDEX_ENTRY",
    category: "integrity",
    message
  }));
}
function keyForParent(parentDomainUuid) {
  return parentDomainUuid === null ? "<root>" : parentDomainUuid;
}
function addToIndex(index, key, id) {
  const ids = index.get(key) ?? /* @__PURE__ */ new Set();
  ids.add(id);
  index.set(key, ids);
}
function removeFromIndex(index, key, id) {
  const ids = index.get(key);
  if (ids === void 0) return;
  ids.delete(id);
  if (ids.size === 0) index.delete(key);
}
function toEntry(document) {
  if (typeof document.id !== "string" || document.id.trim().length === 0) return invalid4("Domain index entry id cannot be empty");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return invalid4("Domain index entry name cannot be empty");
  const validation = validateDomainRecord(document.record);
  if (!validation.ok) return invalid4("Domain index entry record failed schema validation");
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
var DomainIndex = class _DomainIndex {
  entries = /* @__PURE__ */ new Map();
  byUuid = /* @__PURE__ */ new Map();
  byName = /* @__PURE__ */ new Map();
  byAlias = /* @__PURE__ */ new Map();
  byKind = /* @__PURE__ */ new Map();
  byScale = /* @__PURE__ */ new Map();
  byParent = /* @__PURE__ */ new Map();
  byTag = /* @__PURE__ */ new Map();
  byCapability = /* @__PURE__ */ new Map();
  byLifecycle = /* @__PURE__ */ new Map();
  add(entry) {
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
  removeEntry(entry) {
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
  upsert(document) {
    const entry = toEntry(document);
    if (!entry.ok) return entry;
    const previous = this.entries.get(entry.value.id);
    if (previous !== void 0) this.removeEntry(previous);
    this.add(entry.value);
    return ok(void 0);
  }
  rebuild(documents) {
    const rebuilt = new _DomainIndex();
    const seen = /* @__PURE__ */ new Set();
    for (const document of documents) {
      if (seen.has(document.id)) return invalid4(`Duplicate Domain index entry id: ${document.id}`);
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
    return ok(void 0);
  }
  remove(id) {
    const entry = this.entries.get(id);
    if (entry === void 0) return false;
    this.removeEntry(entry);
    return true;
  }
  get(id) {
    return this.entries.get(id);
  }
  list() {
    return [...this.entries.values()];
  }
  query(query = {}) {
    const sets = [
      query.uuid === void 0 ? void 0 : this.byUuid.get(query.uuid) ?? /* @__PURE__ */ new Set(),
      query.name === void 0 ? void 0 : this.byName.get(query.name) ?? /* @__PURE__ */ new Set(),
      query.alias === void 0 ? void 0 : this.byAlias.get(query.alias) ?? /* @__PURE__ */ new Set(),
      query.kind === void 0 ? void 0 : this.byKind.get(query.kind) ?? /* @__PURE__ */ new Set(),
      query.scale === void 0 ? void 0 : this.byScale.get(query.scale) ?? /* @__PURE__ */ new Set(),
      query.parentDomainUuid === void 0 ? void 0 : this.byParent.get(keyForParent(query.parentDomainUuid)) ?? /* @__PURE__ */ new Set(),
      query.tag === void 0 ? void 0 : this.byTag.get(query.tag) ?? /* @__PURE__ */ new Set(),
      query.capabilityId === void 0 ? void 0 : this.byCapability.get(query.capabilityId) ?? /* @__PURE__ */ new Set(),
      query.lifecycle === void 0 ? void 0 : this.byLifecycle.get(query.lifecycle) ?? /* @__PURE__ */ new Set()
    ];
    const constrained = sets.filter((set) => set !== void 0);
    if (constrained.some((set) => set.size === 0)) return [];
    const candidateIds = constrained.length === 0 ? void 0 : new Set([...constrained[0]].filter((id) => constrained.every((set) => set.has(id))));
    return [...this.entries.values()].filter((entry) => candidateIds === void 0 || candidateIds.has(entry.id));
  }
};

// src/domains/domain-schema.ts
var DOMAIN_SCHEMA_VERSION = 1;

// src/storage/integrity/domain-integrity-checker.ts
function issue(code, severity, message, domainId, details) {
  return { code, severity, message, domainId, details };
}
function createDomainIntegrityReport(checked, issues) {
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return Object.freeze({
    checked,
    healthy: errorCount === 0,
    errorCount,
    warningCount,
    issues: Object.freeze([...issues])
  });
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function addRecoverableShapeDiagnostics(value, domainId, expectedSchemaVersion, issues) {
  if (!isRecord2(value)) return;
  if (typeof value.schemaVersion === "number" && value.schemaVersion !== expectedSchemaVersion) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain schemaVersion is not the expected canonical version",
      domainId,
      { expected: expectedSchemaVersion, actual: value.schemaVersion }
    ));
  }
  if (typeof value.revision === "number" && (!Number.isSafeInteger(value.revision) || value.revision < 0)) {
    issues.push(issue(
      "DM_DOMAIN_REVISION_INVALID",
      "error",
      "Domain revision is not a safe non-negative integer",
      domainId,
      { revision: value.revision }
    ));
  }
  if (isRecord2(value.state) && isRecord2(value.metadata)) {
    const lifecycle = value.state.lifecycle;
    const archivedAt = value.metadata.archivedAt;
    if (lifecycle === "active" || lifecycle === "inactive" || lifecycle === "archived") {
      const archived = lifecycle === "archived";
      if (archived && archivedAt === null || !archived && archivedAt !== null) {
        issues.push(issue(
          "DM_DOMAIN_LIFECYCLE_INCONSISTENT",
          "error",
          "Domain lifecycle and archivedAt are inconsistent",
          domainId,
          { lifecycle, archivedAt }
        ));
      }
    }
  }
}
function lifecycleIsValid(value) {
  return value === "active" || value === "inactive" || value === "archived";
}
function addLifecycleIssues(record, domainId, issues) {
  const lifecycle = record.state?.lifecycle;
  if (!lifecycleIsValid(lifecycle)) {
    issues.push(issue(
      "DM_DOMAIN_LIFECYCLE_INVALID",
      "error",
      "Domain lifecycle is not a supported value",
      domainId,
      { lifecycle }
    ));
    return;
  }
  const archivedAt = record.metadata?.archivedAt;
  const isArchived = lifecycle === "archived";
  if (isArchived && archivedAt === null || !isArchived && archivedAt !== null) {
    issues.push(issue(
      "DM_DOMAIN_LIFECYCLE_INCONSISTENT",
      "error",
      "Domain lifecycle and archivedAt are inconsistent",
      domainId,
      { lifecycle, archivedAt }
    ));
  }
}
function addCapabilityIssues(record, domainId, registry, issues) {
  const capabilities = record.definition?.capabilities;
  if (capabilities === void 0) return;
  const resolved = resolveEffectiveCapabilities(capabilities, registry);
  if (!resolved.ok) {
    issues.push(issue(
      resolved.error.code,
      "error",
      resolved.error.message,
      domainId,
      resolved.error.details
    ));
    return;
  }
  for (const warning of resolved.warnings ?? []) {
    issues.push(issue(
      warning.code,
      warning.code === "DM_CAPABILITY_CONFIG_INVALID" ? "error" : "warning",
      warning.message,
      domainId,
      warning.details
    ));
  }
  if (!resolved.value.some((capability) => capability.enabled && capability.functional)) {
    issues.push(issue(
      "DM_NO_FUNCTIONAL_CAPABILITY",
      "error",
      "Domain has no enabled functional capability",
      domainId
    ));
  }
}
function addSchemaIssues(document, expectedSchemaVersion, capabilityRegistry, issues, hierarchyNodes) {
  if (document.decodeError !== void 0) {
    issues.push(issue(
      "DM_DOMAIN_PAYLOAD_INVALID",
      "error",
      "Domain payload could not be decoded",
      document.id,
      { sourceCode: document.decodeError.code }
    ));
    return;
  }
  let validation;
  try {
    validation = validateDomainRecord(document.record);
  } catch {
    validation = { ok: false, error: createPublicError({
      code: "DM_DOMAIN_SCHEMA_MISMATCH",
      category: "integrity",
      message: "Domain schema validation threw unexpectedly"
    }) };
  }
  if (!validation.ok) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain record failed schema validation",
      document.id,
      { sourceCode: validation.error.code }
    ));
    addRecoverableShapeDiagnostics(document.record, document.id, expectedSchemaVersion, issues);
    return;
  }
  const record = document.record;
  if (record.schemaVersion !== expectedSchemaVersion) {
    issues.push(issue(
      "DM_DOMAIN_SCHEMA_MISMATCH",
      "error",
      "Domain schemaVersion is not the expected canonical version",
      document.id,
      { expected: expectedSchemaVersion, actual: record.schemaVersion }
    ));
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    issues.push(issue(
      "DM_DOMAIN_REVISION_INVALID",
      "error",
      "Domain revision is not a safe non-negative integer",
      document.id,
      { revision: record.revision }
    ));
  }
  addLifecycleIssues(record, document.id, issues);
  addCapabilityIssues(record, document.id, capabilityRegistry, issues);
  hierarchyNodes.push({
    uuid: document.uuid,
    parentDomainUuid: record.definition.hierarchy.parentDomainUuid
  });
}
var DomainIntegrityChecker = class {
  expectedSchemaVersion;
  capabilityRegistry;
  constructor(options) {
    this.expectedSchemaVersion = options.expectedSchemaVersion ?? DOMAIN_SCHEMA_VERSION;
    this.capabilityRegistry = options.capabilityRegistry;
  }
  check(documents) {
    const issues = [];
    const hierarchyNodes = [];
    const seenIds = /* @__PURE__ */ new Set();
    const seenUuids = /* @__PURE__ */ new Set();
    for (const document of documents) {
      if (seenIds.has(document.id)) {
        issues.push(issue(
          "DM_DOMAIN_DUPLICATE_ID",
          "error",
          "Multiple Domain documents use the same ID",
          document.id
        ));
      }
      seenIds.add(document.id);
      if (seenUuids.has(document.uuid)) {
        issues.push(issue(
          "DM_DOMAIN_DUPLICATE_UUID",
          "error",
          "Multiple Domain documents use the same UUID",
          document.id,
          { uuid: document.uuid }
        ));
      }
      seenUuids.add(document.uuid);
      if (!isJournalEntryUuid(document.uuid)) {
        issues.push(issue(
          "DM_DOMAIN_UUID_INVALID",
          "error",
          "Domain UUID must be a full JournalEntry UUID",
          document.id,
          { uuid: document.uuid }
        ));
      }
      if (typeof document.id !== "string" || document.id.trim().length === 0) {
        issues.push(issue(
          "DM_DOMAIN_ID_INVALID",
          "error",
          "Domain ID cannot be empty",
          document.id
        ));
      }
      if (typeof document.name !== "string" || document.name.trim().length === 0) {
        issues.push(issue(
          "DM_DOMAIN_NAME_INVALID",
          "error",
          "Domain name cannot be empty",
          document.id
        ));
      }
      addSchemaIssues(document, this.expectedSchemaVersion, this.capabilityRegistry, issues, hierarchyNodes);
    }
    const hierarchy = validateDomainHierarchy(hierarchyNodes);
    if (!hierarchy.ok) {
      issues.push(issue(
        hierarchy.error.code,
        "error",
        hierarchy.error.message,
        void 0,
        hierarchy.error.details
      ));
    } else {
      for (const warning of hierarchy.warnings ?? []) {
        const details = warning.details;
        issues.push(issue(
          "DM_DOMAIN_BROKEN_PARENT",
          "warning",
          warning.message,
          void 0,
          { nodeUuid: details?.nodeUuid, parentUuid: details?.parentUuid }
        ));
      }
    }
    return createDomainIntegrityReport(documents.length, issues);
  }
};

// src/storage/repositories/domain-repository.ts
function invalid5(message) {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_REPOSITORY_INPUT",
    category: "validation",
    message
  }));
}
function notFound(id) {
  return err(createPublicError({
    code: "DM_DOMAIN_NOT_FOUND",
    category: "not-found",
    message: `Domain document was not found: ${id}`
  }));
}
function storageFailure(operation) {
  return err(createPublicError({
    code: "DM_DOMAIN_STORAGE_ERROR",
    category: "provider",
    message: `Domain storage failed during ${operation}`,
    retryable: true
  }));
}
function indexFailure() {
  return err(createPublicError({
    code: "DM_DOMAIN_INDEX_ERROR",
    category: "recovery",
    message: "Domain index could not be updated"
  }));
}
function validateDocument(document, capabilityRegistry) {
  if (typeof document.id !== "string" || document.id.trim().length === 0) return invalid5("Domain document id cannot be empty");
  if (!isJournalEntryUuid(document.uuid)) return invalid5("Domain document uuid must be a full JournalEntry UUID");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return invalid5("Domain name cannot be empty");
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
  return ok(void 0, capabilities.warnings);
}
function validateCreateInput(input, capabilityRegistry) {
  if (typeof input.name !== "string" || input.name.trim().length === 0) return invalid5("Domain name cannot be empty");
  if (input.record.revision !== 0) return invalid5("New Domain revision must start at 0");
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
  return ok(void 0, capabilities.warnings);
}
function validateMutationInput(document, options) {
  const expectedRevision = options.expectedRevision ?? document.record.revision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid5("expectedRevision must be a non-negative safe integer");
  if (document.record.revision !== expectedRevision) return invalid5("Domain record revision must match expectedRevision");
  return ok(expectedRevision);
}
function revisionConflict(expectedRevision, actualRevision) {
  return err(createPublicError({
    code: "DM_DOMAIN_REVISION_CONFLICT",
    category: "conflict",
    message: "Domain revision is stale",
    details: { expectedRevision, actualRevision },
    userActionRequired: true
  }));
}
function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key]));
}
function toDomainDocument(document) {
  if (!isJournalEntryUuid(document.uuid)) return invalid5("Stored Domain document has an invalid JournalEntry UUID");
  const decoded = new DomainJournalEntryAdapter(document).read();
  if (!decoded.ok) return decoded;
  return ok({ id: document.id, uuid: document.uuid, name: decoded.value.name, record: decoded.value.record });
}
var DomainRepository = class {
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.capabilityRegistry = options.capabilityRegistry ?? domainCapabilityRegistry;
    this.index = options.index ?? new DomainIndex();
    this.integrityChecker = new DomainIntegrityChecker({ capabilityRegistry: this.capabilityRegistry });
  }
  now;
  capabilityRegistry;
  index;
  integrityChecker;
  indexReady = false;
  indexWarnings = [];
  loadAllDocuments() {
    const documents = [];
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
  ensureIndex() {
    if (this.indexReady) return ok(void 0, this.indexWarnings);
    return this.rebuildIndex();
  }
  validateParentChange(current, parentDomainUuid) {
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
    return ok(void 0, hierarchy.warnings);
  }
  validateCreateParent(parentDomainUuid) {
    if (parentDomainUuid === null) return ok(void 0);
    const all = this.loadAllDocuments();
    if (!all.ok) return err(all.error);
    const parent = all.value.find((document) => document.uuid === parentDomainUuid);
    if (parent === void 0) {
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
    return ok(void 0, all.warnings);
  }
  async create(input) {
    const normalizedInput = {
      name: input.name.trim(),
      record: normalizeDomainRecord(input.record, input.name)
    };
    const validation = validateCreateInput(normalizedInput, this.capabilityRegistry);
    if (!validation.ok) return validation;
    const parentValidation = this.validateCreateParent(normalizedInput.record.definition.hierarchy.parentDomainUuid);
    if (!parentValidation.ok) return parentValidation;
    try {
      const created = await this.store.create({ name: normalizedInput.name, flags: { [DOMAIN_FLAG_NAMESPACE]: encodeDomainRecord(normalizedInput.record) } });
      if (typeof created.id !== "string" || created.id.trim().length === 0 || !isJournalEntryUuid(created.uuid)) return storageFailure("create");
      const createdDocument = toDomainDocument(created);
      if (!createdDocument.ok) return createdDocument;
      if (this.indexReady && !this.index.upsert(createdDocument.value).ok) return indexFailure();
      return ok(createdDocument.value, [...validation.warnings ?? [], ...parentValidation.warnings ?? []]);
    } catch {
      return storageFailure("create");
    }
  }
  read(id) {
    if (typeof id !== "string" || id.trim().length === 0) return invalid5("Domain document id cannot be empty");
    try {
      const document = this.store.get(id);
      if (document === void 0) return notFound(id);
      return toDomainDocument(document);
    } catch {
      return storageFailure("read");
    }
  }
  load(id) {
    return this.read(id);
  }
  query(query = {}) {
    const ready = this.ensureIndex();
    if (!ready.ok) return err(ready.error);
    const indexQuery = { ...query };
    const entries = this.index.query(indexQuery);
    const documents = [];
    for (const entry of entries) {
      const document = this.read(entry.id);
      if (!document.ok) return document;
      documents.push(document.value);
    }
    return ok(documents, ready.warnings);
  }
  getIndex() {
    return this.index;
  }
  rebuildIndex() {
    const documents = this.loadAllDocuments();
    if (!documents.ok) return err(documents.error);
    const rebuilt = this.index.rebuild(documents.value);
    if (!rebuilt.ok) return err(rebuilt.error);
    this.indexReady = true;
    this.indexWarnings = Object.freeze([...documents.warnings ?? []]);
    return ok(void 0, this.indexWarnings);
  }
  checkIntegrity() {
    let sourceDocuments;
    try {
      sourceDocuments = this.store.list();
    } catch {
      return createDomainIntegrityReport(0, [{ code: "DM_DOMAIN_STORAGE_ERROR", severity: "error", message: "Domain storage could not be enumerated" }]);
    }
    const documents = [];
    for (const document of sourceDocuments) {
      try {
        const decoded = new DomainJournalEntryAdapter(document).read();
        if (decoded.ok) {
          documents.push({ id: document.id, uuid: document.uuid, name: decoded.value.name, record: decoded.value.record });
        } else {
          documents.push({ id: document.id, uuid: document.uuid, name: document.name, record: void 0, decodeError: decoded.error });
        }
      } catch {
        documents.push({
          id: document.id,
          uuid: document.uuid,
          name: document.name,
          record: void 0,
          decodeError: createPublicError({ code: "DM_DOMAIN_PAYLOAD_INVALID", category: "integrity", message: "Domain payload could not be inspected" })
        });
      }
    }
    return this.integrityChecker.check(documents);
  }
  async save(document, options = {}) {
    const normalizedDocument = {
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
      if (target === void 0) return notFound(normalizedDocument.id);
      if (target.uuid !== normalizedDocument.uuid) return invalid5("Domain document UUID cannot be changed during save");
      const current = toDomainDocument(target);
      if (!current.ok) return current;
      if (current.value.record.revision !== expectedRevision) return revisionConflict(expectedRevision, current.value.record.revision);
      const parentChanged = current.value.record.definition.hierarchy.parentDomainUuid !== normalizedDocument.record.definition.hierarchy.parentDomainUuid;
      let hierarchyWarnings = [];
      if (parentChanged) {
        const hierarchy = this.validateParentChange(current.value, normalizedDocument.record.definition.hierarchy.parentDomainUuid);
        if (!hierarchy.ok) return hierarchy;
        hierarchyWarnings = hierarchy.warnings ?? [];
      }
      if (current.value.name === normalizedDocument.name && valuesEqual(current.value.record, normalizedDocument.record)) {
        if (this.indexReady && !this.index.upsert(current.value).ok) return indexFailure();
        return ok({ status: "no-op", revision: current.value.record.revision }, [...validation.warnings ?? [], ...hierarchyWarnings]);
      }
      const nextRecord = { ...normalizedDocument.record, revision: current.value.record.revision + 1 };
      const write = await new DomainJournalEntryAdapter(target).write(normalizedDocument.name, nextRecord);
      if (!write.ok) return err(write.error);
      const updatedDocument = { id: target.id, uuid: target.uuid, name: normalizedDocument.name, record: nextRecord };
      if (this.indexReady && !this.index.upsert(updatedDocument).ok) return indexFailure();
      return ok({ status: "updated", revision: nextRecord.revision }, [...validation.warnings ?? [], ...hierarchyWarnings]);
    } catch {
      return storageFailure("save");
    }
  }
  async update(document, options = {}) {
    return this.save(document, options);
  }
  async reparent(id, parentDomainUuid, options = {}) {
    const current = this.read(id);
    if (!current.ok) return err(current.error);
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid5("expectedRevision must be a non-negative safe integer");
    if (expectedRevision !== current.value.record.revision) return revisionConflict(expectedRevision, current.value.record.revision);
    return this.save({
      ...current.value,
      record: {
        ...current.value.record,
        definition: { ...current.value.record.definition, hierarchy: { parentDomainUuid } }
      }
    }, { expectedRevision });
  }
  async archive(id, archivedAt = this.now(), options = {}) {
    if (!Number.isFinite(archivedAt) || archivedAt < 0) return invalid5("archivedAt must be a finite non-negative number");
    const current = this.read(id);
    if (!current.ok) return current;
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid5("expectedRevision must be a non-negative safe integer");
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
  async restore(id, options = {}) {
    const current = this.read(id);
    if (!current.ok) return current;
    if (current.value.record.state.lifecycle !== "archived") {
      return err(createPublicError({ code: "DM_DOMAIN_NOT_ARCHIVED", category: "conflict", message: "Only an archived Domain can be restored" }));
    }
    const expectedRevision = options.expectedRevision ?? current.value.record.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return invalid5("expectedRevision must be a non-negative safe integer");
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
};

// src/core/identity/ids.ts
function isOpaqueId(value, prefix) {
  if (typeof value !== "string") return false;
  const pattern = prefix === void 0 ? /^(cmd|tx|prj|rel|rep|led|resv|req|role)_[0-9a-f-]{36}$/ : new RegExp(`^${prefix}_[0-9a-f-]{36}$`);
  return pattern.test(value);
}

// src/commands/command-envelope.ts
var COMMAND_CONTRACT_VERSION_V1 = 1;
function isCommandId(value) {
  return isOpaqueId(value, "cmd");
}
function isCommandType(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) return false;
  return /^[a-z0-9-]+:[a-z0-9-]+$/.test(value);
}
var MAX_COMMAND_PAYLOAD_BYTES = 65536;
var MAX_COMMAND_PAYLOAD_DEPTH = 16;
var MAX_COMMAND_PAYLOAD_KEYS = 500;
var MAX_COMMAND_PAYLOAD_ARRAY_ITEMS = 1e3;
function checkPayloadJsonSafe(value, depth = 0, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === void 0) {
    return { ok: false, reason: "not_json_safe" };
  }
  if (value === null) {
    return { ok: true };
  }
  const type = typeof value;
  if (type === "number") {
    return Number.isFinite(value) ? { ok: true } : { ok: false, reason: "not_json_safe" };
  }
  if (type === "string" || type === "boolean") {
    return { ok: true };
  }
  if (type === "function" || type === "symbol" || type === "bigint") {
    return { ok: false, reason: "not_json_safe" };
  }
  if (typeof value === "object") {
    if (depth > MAX_COMMAND_PAYLOAD_DEPTH) {
      return { ok: false, reason: "too_deep" };
    }
    if (seen.has(value)) {
      return { ok: false, reason: "not_json_safe" };
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > MAX_COMMAND_PAYLOAD_ARRAY_ITEMS) {
        return { ok: false, reason: "too_large" };
      }
      for (const item of value) {
        const res = checkPayloadJsonSafe(item, depth + 1, seen);
        if (!res.ok) return res;
      }
      return { ok: true };
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return { ok: false, reason: "not_json_safe" };
    }
    const keys = Object.keys(value);
    if (keys.length > MAX_COMMAND_PAYLOAD_KEYS) {
      return { ok: false, reason: "too_large" };
    }
    for (const key of keys) {
      const child = value[key];
      const res = checkPayloadJsonSafe(child, depth + 1, seen);
      if (!res.ok) return res;
    }
    return { ok: true };
  }
  return { ok: false, reason: "not_json_safe" };
}
function validateCommandEnvelope(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ENVELOPE_INVALID",
        category: "validation",
        message: "Command envelope must be a non-null object"
      })
    );
  }
  try {
    const rawLength = JSON.stringify(input).length;
    if (rawLength > MAX_COMMAND_PAYLOAD_BYTES) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_LARGE",
          category: "validation",
          message: `Command envelope size (${rawLength} bytes) exceeds maximum allowable limit of ${MAX_COMMAND_PAYLOAD_BYTES} bytes`
        })
      );
    }
  } catch {
  }
  const candidate = input;
  const contractVersion = candidate.contractVersion;
  if (typeof contractVersion !== "number" || !Number.isSafeInteger(contractVersion) || contractVersion <= 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_CONTRACT_VERSION_INVALID",
        category: "validation",
        message: "contractVersion must be a positive safe integer"
      })
    );
  }
  if (contractVersion !== COMMAND_CONTRACT_VERSION_V1) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_CONTRACT_VERSION_UNSUPPORTED",
        category: "validation",
        message: `Unsupported command contract version: ${contractVersion}. Expected: ${COMMAND_CONTRACT_VERSION_V1}`
      })
    );
  }
  const commandId = candidate.commandId;
  if (!isCommandId(commandId)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ID_INVALID",
        category: "validation",
        message: "commandId must be a valid opaque ID with 'cmd' prefix and UUID format"
      })
    );
  }
  const type = candidate.type;
  if (!isCommandType(type)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_TYPE_INVALID",
        category: "validation",
        message: "type must be a non-empty namespaced string (<namespace>:<action>)"
      })
    );
  }
  const payload = candidate.payload;
  if (payload === void 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_REQUIRED",
        category: "validation",
        message: "Command payload is required"
      })
    );
  }
  const safeCheck = checkPayloadJsonSafe(payload);
  if (!safeCheck.ok) {
    if (safeCheck.reason === "too_deep") {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_DEEP",
          category: "validation",
          message: `Command payload exceeds maximum nesting depth of ${MAX_COMMAND_PAYLOAD_DEPTH}`
        })
      );
    }
    if (safeCheck.reason === "too_large") {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_PAYLOAD_TOO_LARGE",
          category: "validation",
          message: "Command payload exceeds maximum allowable keys or array items limit"
        })
      );
    }
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_PAYLOAD_NOT_JSON_SAFE",
        category: "validation",
        message: "Command payload must be strictly JSON-safe without undefined, functions, symbols, or circular references"
      })
    );
  }
  const issuedAtReal = candidate.issuedAtReal;
  if (typeof issuedAtReal !== "number" || !Number.isSafeInteger(issuedAtReal) || issuedAtReal <= 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_ISSUED_AT_INVALID",
        category: "validation",
        message: "issuedAtReal must be a positive safe integer timestamp"
      })
    );
  }
  const expectedRevision = candidate.expectedRevision;
  if (expectedRevision !== void 0 && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_EXPECTED_REVISION_INVALID",
        category: "validation",
        message: "expectedRevision must be a non-negative safe integer when provided"
      })
    );
  }
  const expectedRevisions = candidate.expectedRevisions;
  if (expectedRevisions !== void 0) {
    if (typeof expectedRevisions !== "object" || expectedRevisions === null || Array.isArray(expectedRevisions)) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID",
          category: "validation",
          message: "expectedRevisions must be an object map of target to non-negative revision integer"
        })
      );
    }
    for (const [key, rev] of Object.entries(expectedRevisions)) {
      if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 0 || key.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_VALIDATION_COMMAND_EXPECTED_REVISIONS_INVALID",
            category: "validation",
            message: `expectedRevisions contains invalid entry for '${key}': revision must be a non-negative safe integer`
          })
        );
      }
    }
  }
  const targetRefs = candidate.targetRefs;
  if (targetRefs !== void 0) {
    if (!Array.isArray(targetRefs) || targetRefs.some((r) => typeof r !== "string" || r.trim().length === 0)) {
      return err(
        createPublicError({
          code: "DM_VALIDATION_COMMAND_TARGET_REFS_INVALID",
          category: "validation",
          message: "targetRefs must be an array of non-empty strings when provided"
        })
      );
    }
  }
  const authorityEpoch = candidate.authorityEpoch;
  if (authorityEpoch !== void 0 && (typeof authorityEpoch !== "number" || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0)) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_AUTHORITY_EPOCH_INVALID",
        category: "validation",
        message: "authorityEpoch must be a non-negative safe integer when provided"
      })
    );
  }
  const reason = candidate.reason;
  if (reason !== void 0 && typeof reason !== "string") {
    return err(
      createPublicError({
        code: "DM_VALIDATION_COMMAND_REASON_INVALID",
        category: "validation",
        message: "reason must be a string when provided"
      })
    );
  }
  const validated = Object.freeze({
    contractVersion,
    commandId,
    type,
    payload,
    issuedAtReal,
    ...expectedRevision !== void 0 ? { expectedRevision } : {},
    ...expectedRevisions !== void 0 ? { expectedRevisions: Object.freeze({ ...expectedRevisions }) } : {},
    ...targetRefs !== void 0 ? { targetRefs: Object.freeze([...targetRefs]) } : {},
    ...authorityEpoch !== void 0 ? { authorityEpoch } : {},
    ...reason !== void 0 ? { reason } : {}
  });
  return ok(validated);
}

// src/commands/command-registry.ts
var CommandRegistryCollisionError = class extends Error {
  constructor(commandType) {
    super(`Command handler for '${commandType}' is already registered`);
    this.commandType = commandType;
    this.name = "CommandRegistryCollisionError";
  }
  code = "DM_COMMAND_REGISTRY_COLLISION";
};
var CommandRegistryFrozenError = class extends Error {
  code = "DM_COMMAND_REGISTRY_FROZEN";
  constructor() {
    super("CommandRegistry is frozen and cannot accept new command handlers");
    this.name = "CommandRegistryFrozenError";
  }
};
var CommandRegistry = class {
  #handlers = /* @__PURE__ */ new Map();
  #isFrozen = false;
  register(registration) {
    if (this.#isFrozen) {
      throw new CommandRegistryFrozenError();
    }
    if (!isCommandType(registration.type)) {
      throw new TypeError(
        `Command type '${registration.type}' must be a valid namespace:action identifier`
      );
    }
    if (this.#handlers.has(registration.type)) {
      throw new CommandRegistryCollisionError(registration.type);
    }
    if (typeof registration.handler !== "function") {
      throw new TypeError(`Handler for '${registration.type}' must be a function`);
    }
    if (registration.transactional && !registration.mutationDefinition && !registration.handler?.__isTransactionalWrapped) {
      throw new TypeError(
        `Transactional command '${registration.type}' must provide a MutationDefinition or be created with createTransactionalHandler`
      );
    }
    this.#handlers.set(
      registration.type,
      Object.freeze({ ...registration })
    );
  }
  get(type) {
    return this.#handlers.get(type);
  }
  has(type) {
    return this.#handlers.has(type);
  }
  freeze() {
    this.#isFrozen = true;
  }
  get isFrozen() {
    return this.#isFrozen;
  }
  listRegisteredTypes() {
    return Object.freeze(Array.from(this.#handlers.keys()));
  }
};

// src/commands/authenticated-command-context.ts
function detectClaimedUserDivergence(payload, authenticatedSenderUserId) {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload;
  const claimed = candidate.userId ?? candidate.claimedUserId ?? candidate.senderUserId ?? candidate.senderId;
  if (typeof claimed === "string" && claimed.trim().length > 0) {
    if (claimed !== authenticatedSenderUserId) {
      return claimed;
    }
  }
  if (typeof candidate.user === "object" && candidate.user !== null) {
    const nestedUser = candidate.user;
    if (typeof nestedUser.id === "string" && nestedUser.id.trim().length > 0) {
      if (nestedUser.id !== authenticatedSenderUserId) {
        return nestedUser.id;
      }
    }
  }
  return null;
}
function createAuthenticatedCommandContext(params) {
  const { command, transportContext, authorityUserId, authorityEpoch } = params;
  if (typeof authorityUserId !== "string" || authorityUserId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_AUTHORITY_IDENTITY_INVALID",
        category: "validation",
        message: "authorityUserId must be a non-empty string"
      })
    );
  }
  if (!Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_AUTHORITY_EPOCH_INVALID",
        category: "validation",
        message: "authorityEpoch must be a non-negative safe integer"
      })
    );
  }
  const authenticatedSenderUserId = transportContext.senderUserId;
  const divergentClaimedUser = detectClaimedUserDivergence(command.payload, authenticatedSenderUserId);
  if (divergentClaimedUser !== null) {
    return err(
      createPublicError({
        code: "DM_SECURITY_SENDER_SPOOFED",
        category: "permission",
        message: `Claimed user '${divergentClaimedUser}' in payload does not match authenticated transport sender '${authenticatedSenderUserId ?? "none"}'`,
        details: {
          claimedUserId: divergentClaimedUser,
          authenticatedSenderUserId
        }
      })
    );
  }
  const receivedAtReal = params.receivedAtReal ?? transportContext.receivedAtReal ?? Date.now();
  if (!Number.isSafeInteger(receivedAtReal) || receivedAtReal <= 0) {
    return err(
      createPublicError({
        code: "DM_VALIDATION_RECEIVED_AT_INVALID",
        category: "validation",
        message: "receivedAtReal must be a positive safe integer timestamp"
      })
    );
  }
  const source = params.source ?? {
    type: authenticatedSenderUserId !== null ? "user" : "tick"
  };
  const context = Object.freeze({
    command,
    senderUserId: authenticatedSenderUserId,
    authorityUserId,
    authorityEpoch,
    receivedAtReal,
    source: Object.freeze({ ...source })
  });
  return ok(context);
}

// src/diagnostics/sanitize.ts
var SENSITIVE_KEY = /(secret|token|password|api[-_]?key|credential|authorization)/i;
function sanitizeDiagnosticsValue(value, ancestors = /* @__PURE__ */ new WeakSet()) {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    const result = value.map((item) => sanitizeDiagnosticsValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...value.stack ? { stack: value.stack } : {}
    };
  }
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeDiagnosticsValue(child, ancestors);
  }
  ancestors.delete(value);
  return sanitized;
}

// src/commands/command-transport.ts
function sanitizeTransportReceiptForPublic(receipt) {
  const sanitizedError = receipt.error ? Object.freeze({
    code: receipt.error.code,
    category: receipt.error.category,
    message: receipt.error.message,
    details: receipt.error.details !== void 0 ? sanitizeDiagnosticsValue(receipt.error.details) : void 0,
    retryable: receipt.error.retryable,
    userActionRequired: receipt.error.userActionRequired,
    correlationId: receipt.error.correlationId
  }) : void 0;
  return Object.freeze({
    commandId: receipt.commandId,
    status: receipt.status,
    correlationId: receipt.correlationId,
    result: receipt.result !== void 0 ? sanitizeDiagnosticsValue(receipt.result) : void 0,
    error: sanitizedError,
    transportTimestamp: receipt.transportTimestamp
  });
}

// src/commands/rate-limiter.ts
var RateLimiter = class {
  #defaultRule;
  #preValidationRule;
  #commandRules;
  #systemMaxPerSecond;
  #buckets = /* @__PURE__ */ new Map();
  #abuseRecords = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#defaultRule = options?.defaultRule ?? {
      windowMs: 1e3,
      maxRequests: 50
    };
    this.#preValidationRule = options?.preValidationRule ?? {
      windowMs: 1e3,
      maxRequests: 50
    };
    this.#commandRules = /* @__PURE__ */ new Map();
    if (options?.commandRules) {
      for (const [type, rule] of Object.entries(options.commandRules)) {
        this.#commandRules.set(type, rule);
      }
    }
    this.#systemMaxPerSecond = options?.systemMaxRequestsPerSecond ?? 1e3;
  }
  /**
   * Fast pre-validation rate check for authenticated callers before running
   * expensive envelope parsing, JSON validation, or handler lookups (G2-AUD-028).
   */
  checkPreValidationLimit(userId, now = Date.now()) {
    const key = userId ? `${userId}:__pre_validation__` : `__system__:__pre_validation__`;
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.#buckets.set(key, bucket);
    }
    const cutoff = now - this.#preValidationRule.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length >= this.#preValidationRule.maxRequests) {
      return err(
        createPublicError({
          code: "DM_RATE_LIMIT_EXCEEDED",
          category: "busy",
          message: `Pre-validation request rate limit exceeded for ${userId ? `user '${userId}'` : "system"}. Maximum ${this.#preValidationRule.maxRequests} requests per ${this.#preValidationRule.windowMs}ms.`
        })
      );
    }
    bucket.timestamps.push(now);
    return ok(true);
  }
  checkAndConsume(userId, commandType, now = Date.now()) {
    const key = userId ? `${userId}:${commandType}` : `__system__:${commandType}`;
    const rule = this.#commandRules.get(commandType) ?? (userId === null ? { windowMs: 1e3, maxRequests: this.#systemMaxPerSecond } : this.#defaultRule);
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.#buckets.set(key, bucket);
    }
    const cutoff = now - rule.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length >= rule.maxRequests) {
      return err(
        createPublicError({
          code: "DM_RATE_LIMIT_EXCEEDED",
          category: "busy",
          message: `Rate limit exceeded for ${userId ? `user '${userId}'` : "system"} on command '${commandType}'. Maximum ${rule.maxRequests} requests per ${rule.windowMs}ms.`
        })
      );
    }
    bucket.timestamps.push(now);
    if (this.#buckets.size > 500) {
      for (const [bKey, b] of this.#buckets) {
        if (b.timestamps.length === 0 || (b.timestamps[b.timestamps.length - 1] ?? 0) <= cutoff) {
          this.#buckets.delete(bKey);
        }
      }
    }
    return ok(true);
  }
  recordAbuse(userId, reason, now = Date.now()) {
    const key = `${userId ?? "__system__"}:${reason}`;
    const existing = this.#abuseRecords.get(key);
    if (existing) {
      existing.count++;
      existing.lastOccurrenceAt = now;
    } else {
      this.#abuseRecords.set(key, {
        senderUserId: userId,
        reason,
        count: 1,
        lastOccurrenceAt: now
      });
    }
  }
  getAbuseRecords() {
    return Array.from(this.#abuseRecords.values());
  }
  reset() {
    this.#buckets.clear();
    this.#abuseRecords.clear();
  }
};

// src/commands/command-dedupe-store.ts
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  const obj = value;
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}
function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}
function computeFingerprint(value) {
  const json = canonicalJsonStringify(value);
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch >> 8, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `fp_${hex1}${hex2}`;
}
function computeCommandFingerprint(command) {
  return computeFingerprint({
    type: command.type,
    payload: command.payload,
    targetRefs: command.targetRefs ? [...command.targetRefs].sort() : null,
    expectedRevision: command.expectedRevision ?? null,
    expectedRevisions: command.expectedRevisions ?? null
  });
}
var CommandDedupeStore = class {
  #maxEntries;
  #ttlMs;
  #entries = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#maxEntries = options?.maxEntries ?? 5e3;
    this.#ttlMs = options?.ttlMs ?? 10 * 60 * 1e3;
  }
  get size() {
    return this.#entries.size;
  }
  get capacity() {
    return this.#maxEntries;
  }
  claim(commandId, fingerprint, now = Date.now()) {
    this.#evictExpired(now);
    const existing = this.#entries.get(commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return err(
          createPublicError({
            code: "DM_COMMAND_ID_REUSE_MISMATCH",
            category: "conflict",
            message: `Command ID '${commandId}' was previously registered with a different command payload or fingerprint`
          })
        );
      }
      this.#entries.delete(commandId);
      this.#entries.set(commandId, existing);
      if (existing.state === "completed" || existing.state === "rejected") {
        return ok({
          isReplay: true,
          receipt: existing.receipt
        });
      }
      return ok({
        isReplay: true,
        inFlightPromise: existing.inFlightPromise
      });
    }
    if (this.#entries.size >= this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey) {
        this.#entries.delete(oldestKey);
      }
    }
    let resolveInFlight;
    const inFlightPromise = new Promise((resolve) => {
      resolveInFlight = resolve;
    });
    const newEntry = {
      commandId,
      fingerprint,
      createdAt: now,
      state: "pending",
      inFlightPromise,
      resolveInFlight
    };
    this.#entries.set(commandId, newEntry);
    return ok({
      isReplay: false
    });
  }
  recordResult(commandId, receipt) {
    const entry = this.#entries.get(commandId);
    if (!entry) return;
    entry.state = receipt.status === "executed" || receipt.status === "acknowledged" || receipt.status === "delivered" ? "completed" : "rejected";
    entry.receipt = receipt;
    if (entry.resolveInFlight) {
      entry.resolveInFlight(receipt);
      entry.resolveInFlight = void 0;
      entry.inFlightPromise = void 0;
    }
  }
  get(commandId) {
    return this.#entries.get(commandId);
  }
  has(commandId) {
    return this.#entries.has(commandId);
  }
  getStatus(commandId) {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      return { commandId, state: "unknown" };
    }
    const state = entry.state === "pending" ? "processing" : entry.state === "completed" ? "completed" : "rejected";
    return {
      commandId,
      state,
      receipt: entry.receipt,
      createdAt: entry.createdAt
    };
  }
  clear() {
    this.#entries.clear();
  }
  #evictExpired(now) {
    const cutoff = now - this.#ttlMs;
    for (const [id, entry] of this.#entries) {
      if (entry.state !== "pending" && entry.createdAt < cutoff) {
        this.#entries.delete(id);
      }
    }
  }
};

// src/commands/command-queue.ts
var DEFAULT_COMMAND_QUEUE_CONCURRENCY = 10;
var CommandQueue = class {
  #entries = /* @__PURE__ */ new Map();
  #waitingQueue = [];
  #maxConcurrency;
  #runningCount = 0;
  #cancelledCount = 0;
  #completedCount = 0;
  #failedCount = 0;
  constructor(options) {
    this.#maxConcurrency = options?.maxConcurrency ?? DEFAULT_COMMAND_QUEUE_CONCURRENCY;
  }
  enqueue(command, senderUserId, options) {
    const existing = this.#entries.get(command.commandId);
    if (existing) {
      return existing;
    }
    const priority = options?.priority ?? 0;
    const entry = {
      commandId: command.commandId,
      type: command.type,
      senderUserId,
      enqueuedAt: Date.now(),
      priority,
      status: "queued",
      abortController: new AbortController()
    };
    this.#entries.set(command.commandId, entry);
    return entry;
  }
  /**
   * Waits for scheduler permit before executing the command handler.
   *
   * Enforces FIFO within the same priority level, and processes higher priority
   * commands first. Unblocks immediately if concurrency slot is free.
   */
  async acquirePermit(commandId) {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      throw createPublicError({
        code: "DM_COMMAND_NOT_FOUND",
        category: "not-found",
        message: `Command '${commandId}' was not enqueued`
      });
    }
    if (entry.status === "cancelled") {
      throw createPublicError({
        code: "DM_COMMAND_CANCELLED",
        category: "busy",
        message: `Command was cancelled in queue: ${entry.cancelReason ?? "Unknown reason"}`
      });
    }
    if (this.#runningCount < this.#maxConcurrency) {
      this.#runningCount++;
      this.markRunning(commandId);
      return;
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        commandId,
        priority: entry.priority,
        enqueuedAt: entry.enqueuedAt,
        resolve: () => {
          this.markRunning(commandId);
          resolve();
        },
        reject
      };
      this.#insertWaiter(waiter);
    });
  }
  /**
   * Releases an execution permit after command finishes or fails, unblocking
   * the next waiting command in the queue.
   */
  releasePermit(commandId) {
    const entry = this.#entries.get(commandId);
    if (entry && (entry.status === "running" || entry.status === "committing")) {
      this.markFinished(commandId, false);
    }
    this.#runningCount = Math.max(0, this.#runningCount - 1);
    this.#processQueue();
  }
  #insertWaiter(waiter) {
    let idx = this.#waitingQueue.length;
    for (let i = 0; i < this.#waitingQueue.length; i++) {
      const other = this.#waitingQueue[i];
      if (waiter.priority > other.priority || waiter.priority === other.priority && waiter.enqueuedAt < other.enqueuedAt) {
        idx = i;
        break;
      }
    }
    this.#waitingQueue.splice(idx, 0, waiter);
  }
  #processQueue() {
    while (this.#runningCount < this.#maxConcurrency && this.#waitingQueue.length > 0) {
      const waiter = this.#waitingQueue.shift();
      const entry = this.#entries.get(waiter.commandId);
      if (entry && entry.status === "cancelled") {
        waiter.reject(
          createPublicError({
            code: "DM_COMMAND_CANCELLED",
            category: "busy",
            message: `Command was cancelled: ${entry.cancelReason ?? "Cancelled in queue"}`
          })
        );
        continue;
      }
      this.#runningCount++;
      waiter.resolve();
    }
  }
  get(commandId) {
    return this.#entries.get(commandId);
  }
  markRunning(commandId) {
    const entry = this.#entries.get(commandId);
    if (!entry) return false;
    if (entry.status === "cancelled") return false;
    entry.status = "running";
    entry.startedAt = Date.now();
    return true;
  }
  markCommitting(commandId) {
    const entry = this.#entries.get(commandId);
    if (!entry) return false;
    if (entry.status === "cancelled") return false;
    entry.status = "committing";
    return true;
  }
  markFinished(commandId, success) {
    const entry = this.#entries.get(commandId);
    if (!entry) return;
    if (entry.status === "cancelled" || entry.status === "completed" || entry.status === "failed") return;
    entry.finishedAt = Date.now();
    if (success) {
      entry.status = "completed";
      this.#completedCount++;
    } else {
      entry.status = "failed";
      this.#failedCount++;
    }
  }
  cancel(commandId, requesterUserId, isGM, reason = "Command cancelled by user") {
    const entry = this.#entries.get(commandId);
    if (!entry) {
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Cannot cancel: command '${commandId}' was not found in queue`
        })
      );
    }
    if (entry.status === "completed" || entry.status === "failed") {
      return err(
        createPublicError({
          code: "DM_COMMAND_ALREADY_FINISHED",
          category: "conflict",
          message: `Cannot cancel: command '${commandId}' has already finished with status '${entry.status}'`
        })
      );
    }
    if (entry.status === "committing") {
      return err(
        createPublicError({
          code: "DM_COMMAND_COMMITTING_NON_CANCELLABLE",
          category: "conflict",
          message: `Cannot cancel: command '${commandId}' is already past the commit boundary`
        })
      );
    }
    if (entry.status === "cancelled") {
      return ok(void 0);
    }
    if (!isGM && entry.senderUserId !== requesterUserId) {
      return err(
        createPublicError({
          code: "DM_PERMISSION_CANCEL_DENIED",
          category: "permission",
          message: `User '${requesterUserId}' is not authorized to cancel command owned by '${entry.senderUserId}'`
        })
      );
    }
    entry.status = "cancelled";
    entry.cancelReason = reason;
    entry.finishedAt = Date.now();
    this.#cancelledCount++;
    entry.abortController.abort();
    const waiterIdx = this.#waitingQueue.findIndex((w) => w.commandId === commandId);
    if (waiterIdx !== -1) {
      const waiter = this.#waitingQueue.splice(waiterIdx, 1)[0];
      waiter.reject(
        createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: reason
        })
      );
      this.#processQueue();
    }
    return ok(void 0);
  }
  getDiagnostics() {
    let queuedCount = 0;
    let runningCount = 0;
    const activeEntries = [];
    for (const entry of this.#entries.values()) {
      if (entry.status === "queued") queuedCount++;
      if (entry.status === "running" || entry.status === "committing") runningCount++;
      if (entry.status === "queued" || entry.status === "running" || entry.status === "committing") {
        activeEntries.push({
          commandId: entry.commandId,
          type: entry.type,
          senderUserId: entry.senderUserId,
          status: entry.status,
          enqueuedAt: entry.enqueuedAt
        });
      }
    }
    return Object.freeze({
      queuedCount,
      runningCount,
      cancelledCount: this.#cancelledCount,
      completedCount: this.#completedCount,
      failedCount: this.#failedCount,
      activeEntries: Object.freeze(activeEntries)
    });
  }
  clear() {
    for (const entry of this.#entries.values()) {
      if (entry.status === "queued" || entry.status === "running") {
        entry.abortController.abort();
      }
    }
    this.#entries.clear();
  }
};

// src/commands/command-bus.ts
var CommandBus = class {
  #registry;
  #authorityService;
  #coordinator;
  #rateLimiter;
  #dedupeStore;
  #commandQueue;
  #transportCleanups = /* @__PURE__ */ new Set();
  #transport = null;
  constructor(options) {
    this.#registry = options.registry;
    this.#authorityService = options.authorityService;
    this.#coordinator = options.coordinator ?? null;
    this.#rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.#dedupeStore = options.dedupeStore ?? new CommandDedupeStore();
    this.#commandQueue = options.commandQueue ?? new CommandQueue();
    if (options.transport) {
      this.attachTransport(options.transport);
    }
  }
  attachTransport(transport) {
    this.#transport = transport;
    let unregisterStatus;
    if ("registerStatusQueryHandler" in transport && typeof transport.registerStatusQueryHandler === "function") {
      unregisterStatus = transport.registerStatusQueryHandler(
        (id) => this.queryCommandStatus(id)
      );
    }
    const unregister = transport.registerInboundHandler(this.dispatchInbound.bind(this));
    let unregistered = false;
    const cleanup = () => {
      if (!unregistered) {
        unregistered = true;
        if (this.#transport === transport) {
          this.#transport = null;
        }
        unregisterStatus?.();
        unregister();
      }
    };
    this.#transportCleanups.add(cleanup);
    return () => {
      cleanup();
      this.#transportCleanups.delete(cleanup);
    };
  }
  destroy() {
    for (const cleanup of this.#transportCleanups) {
      cleanup();
    }
    this.#transportCleanups.clear();
    this.#transport = null;
    this.#commandQueue.clear();
  }
  getCommandStatus(commandId) {
    return this.#dedupeStore.getStatus(commandId);
  }
  /**
   * Queries authoritative command execution status across local and remote boundaries (G2-AUD-014).
   *
   * If local host is the Primary Authority, reads directly from local DedupeStore.
   * If running on remote client, delegates to transport.getStatus(commandId).
   */
  async queryCommandStatus(commandId) {
    if (this.#authorityService.isCurrentUser()) {
      const report = this.#dedupeStore.getStatus(commandId);
      if (report.receipt) {
        return ok(report.receipt);
      }
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Command '${commandId}' was not found or is currently ${report.state}`
        })
      );
    }
    if (this.#transport?.getStatus) {
      return this.#transport.getStatus(commandId);
    }
    return err(
      createPublicError({
        code: "DM_TRANSPORT_NOT_CONFIGURED",
        category: "internal",
        message: "Remote transport does not support status query"
      })
    );
  }
  cancelCommand(commandId, requesterUserId, isGM, reason) {
    return this.#commandQueue.cancel(commandId, requesterUserId, isGM, reason);
  }
  getQueueDiagnostics() {
    return this.#commandQueue.getDiagnostics();
  }
  /**
   * Dispatches an inbound command message received via transport.
   */
  async dispatchInbound(message) {
    const now = Date.now();
    const preRateLimit = this.#rateLimiter.checkPreValidationLimit(
      message.transportContext.senderUserId,
      now
    );
    if (!preRateLimit.ok) {
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "pre_validation_limit_exceeded",
        now
      );
      const rawId = typeof message.rawEnvelope === "object" && message.rawEnvelope !== null && typeof message.rawEnvelope.commandId === "string" ? message.rawEnvelope.commandId : "cmd_" + "0".repeat(32);
      return ok({
        commandId: rawId,
        status: "rejected",
        error: preRateLimit.error,
        transportTimestamp: now
      });
    }
    const envelopeResult = validateCommandEnvelope(message.rawEnvelope);
    if (!envelopeResult.ok) {
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "malformed_envelope",
        now
      );
      const dummyId = "cmd_" + "0".repeat(32);
      return ok({
        commandId: dummyId,
        status: "rejected",
        error: envelopeResult.error,
        transportTimestamp: now
      });
    }
    const command = envelopeResult.value;
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is currently elected or available"
        }),
        transportTimestamp: now
      });
    }
    if (!this.#authorityService.isCurrentUser()) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Current client host is not the active primary authority"
        }),
        transportTimestamp: now
      });
    }
    const source = message.transportContext.transportName === "local" ? message.transportContext.operationSource ?? { type: "system" } : { type: "user" };
    const authContextResult = createAuthenticatedCommandContext({
      command,
      transportContext: message.transportContext,
      authorityUserId: authorityStatus.authorityUserId,
      authorityEpoch: authorityStatus.authorityEpoch,
      source
    });
    if (!authContextResult.ok) {
      this.#rateLimiter.recordAbuse(
        message.transportContext.senderUserId,
        "auth_context_failed",
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: authContextResult.error,
        transportTimestamp: now
      });
    }
    const context = authContextResult.value;
    const registration = this.#registry.get(command.type);
    if (!registration) {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `unknown_command_type:${command.type}`,
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_HANDLER_NOT_FOUND",
          category: "not-found",
          message: `No handler registered for command type '${command.type}'`
        }),
        transportTimestamp: now
      });
    }
    if (registration.visibility === "internal" && message.transportContext.transportName !== "local") {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `internal_command_attempt:${command.type}`,
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_INTERNAL_ONLY_COMMAND",
          category: "permission",
          message: `Command '${command.type}' is internal-only and cannot be called via remote transport`
        }),
        transportTimestamp: now
      });
    }
    const rateLimitResult = this.#rateLimiter.checkAndConsume(
      context.senderUserId,
      command.type,
      now
    );
    if (!rateLimitResult.ok) {
      this.#rateLimiter.recordAbuse(
        context.senderUserId,
        `command_rate_limit_exceeded:${command.type}`,
        now
      );
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: rateLimitResult.error,
        transportTimestamp: now
      });
    }
    if (registration.schemaValidator) {
      const schemaResult = registration.schemaValidator(command.payload);
      if (!schemaResult.ok) {
        this.#rateLimiter.recordAbuse(
          context.senderUserId,
          `invalid_payload_schema:${command.type}`,
          now
        );
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: schemaResult.error,
          transportTimestamp: now
        });
      }
    }
    if (registration.permissionValidator) {
      const permResult = registration.permissionValidator(context);
      if (!permResult.ok) {
        this.#rateLimiter.recordAbuse(
          context.senderUserId,
          `permission_denied:${command.type}`,
          now
        );
        return ok({
          commandId: command.commandId,
          status: "rejected",
          error: permResult.error,
          transportTimestamp: now
        });
      }
    }
    const fingerprint = computeCommandFingerprint(command);
    const claimResult = this.#dedupeStore.claim(
      command.commandId,
      fingerprint,
      now
    );
    if (!claimResult.ok) {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: claimResult.error,
        transportTimestamp: now
      });
    }
    if (claimResult.value.isReplay) {
      if (claimResult.value.receipt) {
        const replayReceipt = message.transportContext.transportName !== "local" ? sanitizeTransportReceiptForPublic(claimResult.value.receipt) : claimResult.value.receipt;
        return ok(replayReceipt);
      }
      if (claimResult.value.inFlightPromise) {
        const awaitedReceipt = await claimResult.value.inFlightPromise;
        const sanitizedAwaited = message.transportContext.transportName !== "local" ? sanitizeTransportReceiptForPublic(awaitedReceipt) : awaitedReceipt;
        return ok(sanitizedAwaited);
      }
    }
    const internalPriority = source.type === "system" ? 10 : 0;
    const queueEntry = this.#commandQueue.enqueue(
      command,
      message.transportContext.senderUserId,
      { priority: internalPriority }
    );
    if (queueEntry.status === "cancelled") {
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: `Command was cancelled: ${queueEntry.cancelReason ?? "Unknown reason"}`
        }),
        transportTimestamp: now
      });
    }
    try {
      await this.#commandQueue.acquirePermit(command.commandId);
    } catch (queueErr) {
      if (queueEntry.status !== "cancelled") {
        this.#commandQueue.markFinished(command.commandId, false);
      }
      return ok({
        commandId: command.commandId,
        status: "rejected",
        error: queueErr,
        transportTimestamp: Date.now()
      });
    }
    let finalReceipt = void 0;
    try {
      if (queueEntry.abortController.signal.aborted) {
        finalReceipt = {
          commandId: command.commandId,
          status: "rejected",
          error: createPublicError({
            code: "DM_COMMAND_CANCELLED",
            category: "busy",
            message: `Command was cancelled in queue: ${queueEntry.cancelReason ?? "Unknown reason"}`
          }),
          transportTimestamp: now
        };
      } else if (registration.transactional && registration.mutationDefinition) {
        if (!this.#coordinator) {
          finalReceipt = {
            commandId: command.commandId,
            status: "rejected",
            error: createPublicError({
              code: "DM_TRANSACTIONAL_COORDINATOR_REQUIRED",
              category: "integrity",
              message: `Transactional command '${command.type}' requires MutationCoordinator, but none is configured`
            }),
            transportTimestamp: now
          };
        } else {
          this.#commandQueue.markCommitting(command.commandId);
          const coordRes = await this.#coordinator.execute(
            context,
            registration.mutationDefinition,
            { signal: queueEntry.abortController.signal }
          );
          if (!coordRes.ok) {
            finalReceipt = {
              commandId: command.commandId,
              status: "rejected",
              error: coordRes.error,
              transportTimestamp: now
            };
          } else {
            const receipt = coordRes.value;
            finalReceipt = {
              commandId: command.commandId,
              status: receipt.status === "executed" ? "executed" : "rejected",
              result: receipt.result,
              error: receipt.error,
              transportTimestamp: now
            };
          }
        }
      } else {
        const handlerResult = await registration.handler(context);
        if (!handlerResult.ok) {
          finalReceipt = {
            commandId: command.commandId,
            status: "rejected",
            error: handlerResult.error,
            transportTimestamp: now
          };
        } else {
          finalReceipt = {
            commandId: command.commandId,
            status: "executed",
            result: handlerResult.value,
            transportTimestamp: now
          };
        }
      }
    } catch (err2) {
      finalReceipt = {
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: err2 instanceof Error ? err2.message : "Unexpected command execution error"
        }),
        transportTimestamp: now
      };
    } finally {
      if (queueEntry.status !== "cancelled") {
        const isSuccess = finalReceipt !== void 0 && finalReceipt.status === "executed";
        this.#commandQueue.markFinished(command.commandId, isSuccess);
      }
      this.#commandQueue.releasePermit(command.commandId);
    }
    const resolvedReceipt = finalReceipt ?? {
      commandId: command.commandId,
      status: "rejected",
      error: createPublicError({
        code: "DM_COMMAND_EXECUTION_FAILED",
        category: "internal",
        message: "Command execution ended without a valid receipt"
      }),
      transportTimestamp: now
    };
    this.#dedupeStore.recordResult(command.commandId, resolvedReceipt);
    const receiptToReturn = message.transportContext.transportName !== "local" ? sanitizeTransportReceiptForPublic(resolvedReceipt) : resolvedReceipt;
    return ok(receiptToReturn);
  }
  /**
   * Executes a command within the local authority host context (e.g. ticks, internal orchestration).
   *
   * Enforces G2-AUD-005 (authority host guard) and G2-AUD-006 (trusted provenance preservation).
   */
  async executeLocal(command, source = { type: "system" }) {
    if (!this.#authorityService.isCurrentUser()) {
      const commandId = typeof command === "object" && command !== null && "commandId" in command ? command.commandId : "cmd_" + "0".repeat(32);
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Local command execution requires current client to be the primary authority"
        }),
        transportTimestamp: Date.now()
      });
    }
    const inboundContext = {
      senderUserId: null,
      transportName: "local",
      receivedAtReal: Date.now(),
      operationSource: source
    };
    const message = {
      rawEnvelope: command,
      transportContext: inboundContext
    };
    return this.dispatchInbound(message);
  }
};

// src/commands/foundry-command-transport-adapter.ts
var DOMAIN_MANAGER_SOCKET_CHANNEL = "module.domain-manager";
function isSocketRequestPacket(packet) {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet;
  const sender = p.declaredSenderUserId ?? p.senderUserId;
  return p.protocol === "dm-command-v1" && p.kind === "DM_CMD_REQUEST" && typeof p.correlationId === "string" && p.correlationId.trim().length > 0 && typeof sender === "string" && sender.trim().length > 0 && typeof p.command === "object" && p.command !== null;
}
function isSocketResponsePacket(packet) {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet;
  return p.protocol === "dm-command-v1" && p.kind === "DM_CMD_RESPONSE" && typeof p.correlationId === "string" && typeof p.targetUserId === "string" && typeof p.authorityUserId === "string" && typeof p.authorityEpoch === "number" && typeof p.response === "object" && p.response !== null;
}
function isSocketStatusQueryPacket(packet) {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet;
  return p.protocol === "dm-command-v1" && p.kind === "DM_CMD_STATUS_QUERY" && typeof p.correlationId === "string" && p.correlationId.trim().length > 0 && typeof p.commandId === "string" && p.commandId.trim().length > 0 && typeof p.targetAuthorityUserId === "string" && typeof p.declaredSenderUserId === "string";
}
function isSocketStatusResponsePacket(packet) {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet;
  return p.protocol === "dm-command-v1" && p.kind === "DM_CMD_STATUS_RESPONSE" && typeof p.correlationId === "string" && typeof p.targetUserId === "string" && typeof p.authorityUserId === "string" && typeof p.authorityEpoch === "number" && typeof p.response === "object" && p.response !== null;
}
function resolveFoundryRuntime() {
  const globals = globalThis;
  return globals.game ?? {};
}
function resolveSocketlib() {
  const globals = globalThis;
  try {
    return globals.socketlib?.registerModule("domain-manager");
  } catch {
    return void 0;
  }
}
var FoundryCommandTransportAdapter = class {
  name = "foundry-socket";
  #runtime;
  #authorityService;
  #defaultTimeoutMs;
  #senderResolver;
  #socketlib;
  #inboundHandler = null;
  #statusQueryHandler = null;
  #socketListener = null;
  #pendingRequests = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#runtime = options.runtime ?? resolveFoundryRuntime();
    this.#authorityService = options.authorityService;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 1e4;
    this.#senderResolver = options.senderResolver;
    this.#socketlib = options.socketlib ?? resolveSocketlib() ?? null;
    this.#initSocketlib();
    this.#initSocketListener();
  }
  get isAvailable() {
    if (this.#authorityService.isCurrentUser()) {
      return true;
    }
    const hasTransport = Boolean(this.#socketlib) || Boolean(this.#runtime.socket);
    return hasTransport && this.#authorityService.getStatus().available;
  }
  get currentUserId() {
    return this.#runtime.user?.id ?? null;
  }
  registerInboundHandler(handler) {
    this.#inboundHandler = handler;
    return () => {
      if (this.#inboundHandler === handler) {
        this.#inboundHandler = null;
      }
    };
  }
  registerStatusQueryHandler(handler) {
    this.#statusQueryHandler = handler;
    return () => {
      if (this.#statusQueryHandler === handler) {
        this.#statusQueryHandler = null;
      }
    };
  }
  destroy() {
    if (this.#socketListener && this.#runtime.socket?.off) {
      this.#runtime.socket.off(DOMAIN_MANAGER_SOCKET_CHANNEL, this.#socketListener);
    }
    this.#socketListener = null;
    this.#inboundHandler = null;
    this.#statusQueryHandler = null;
    for (const [, pending] of this.#pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve(
        err(
          createPublicError({
            code: "DM_TRANSPORT_ABORTED",
            category: "busy",
            message: "Transport adapter destroyed while request was pending"
          })
        )
      );
    }
    this.#pendingRequests.clear();
  }
  async send(command, options) {
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is currently elected or available"
        })
      );
    }
    if (this.#authorityService.isCurrentUser()) {
      return this.#sendLocalLoopback(command);
    }
    if (this.#socketlib) {
      return this.#sendSocketlibRPC(command, options);
    }
    return this.#sendRemoteSocket(command, options);
  }
  /**
   * Queries authoritative command execution status across network boundaries (G2-AUD-014).
   */
  async getStatus(commandId) {
    if (this.#authorityService.isCurrentUser()) {
      if (this.#statusQueryHandler) {
        return this.#statusQueryHandler(commandId);
      }
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: `Command '${commandId}' status could not be queried locally`
        })
      );
    }
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for status query"
        })
      );
    }
    if (this.#socketlib) {
      try {
        const response = await this.#socketlib.executeAsUser(
          "queryCommandStatus",
          authorityStatus.authorityUserId,
          commandId
        );
        return response;
      } catch (error) {
        return err(
          createPublicError({
            code: "DM_TRANSPORT_QUERY_FAILED",
            category: "provider",
            message: error instanceof Error ? error.message : "Socketlib status query failed"
          })
        );
      }
    }
    return this.#sendStatusQuerySocket(commandId, authorityStatus);
  }
  async #sendLocalLoopback(command) {
    if (!this.#inboundHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "Primary authority local inbound handler is not registered"
        })
      );
    }
    const inboundContext = {
      senderUserId: this.currentUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };
    const inboundMessage = {
      rawEnvelope: command,
      transportContext: inboundContext
    };
    const result = await this.#inboundHandler(inboundMessage);
    return result;
  }
  async #sendSocketlibRPC(command, options) {
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for RPC transmission"
        })
      );
    }
    const senderUserId = this.currentUserId;
    if (!senderUserId) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Cannot send command without an active user session"
        })
      );
    }
    const correlationId = options?.correlationId ?? `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const requestPacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_REQUEST",
      correlationId,
      command,
      targetAuthorityUserId: authorityStatus.authorityUserId,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };
    try {
      const response = await this.#socketlib.executeAsUser(
        "executeCommand",
        authorityStatus.authorityUserId,
        requestPacket
      );
      return response;
    } catch (error) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_SEND_FAILED",
          category: "provider",
          message: error instanceof Error ? error.message : "Socketlib RPC execution failed"
        })
      );
    }
  }
  async #sendRemoteSocket(command, options) {
    const socket = this.#runtime.socket;
    if (!socket) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_UNAVAILABLE",
          category: "busy",
          message: "Foundry socket runtime is not available"
        })
      );
    }
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_UNAVAILABLE",
          category: "busy",
          message: "No primary authority is available for socket transmission"
        })
      );
    }
    const senderUserId = this.currentUserId;
    if (!senderUserId) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Cannot send command without an active user session"
        })
      );
    }
    const correlationId = options?.correlationId ?? `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    if (this.#pendingRequests.has(correlationId)) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_CORRELATION_COLLISION",
          category: "conflict",
          message: `Pending request with correlationId '${correlationId}' already exists`
        })
      );
    }
    const timeoutMs = options?.timeoutMs ?? this.#defaultTimeoutMs;
    const requestPacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_REQUEST",
      correlationId,
      command,
      targetAuthorityUserId: authorityStatus.authorityUserId,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };
    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.#pendingRequests.delete(correlationId);
          resolve(
            err(
              createPublicError({
                code: "DM_TRANSPORT_TIMEOUT",
                category: "timeout",
                message: `Command socket request timed out after ${timeoutMs}ms`
              })
            )
          );
        }, timeoutMs);
      }
      this.#pendingRequests.set(correlationId, {
        resolve: (res) => resolve(res),
        reject,
        timer
      });
      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, requestPacket, { userId: senderUserId });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.#pendingRequests.delete(correlationId);
        resolve(
          err(
            createPublicError({
              code: "DM_TRANSPORT_SEND_FAILED",
              category: "provider",
              message: error instanceof Error ? error.message : "Socket emit failed"
            })
          )
        );
      }
    });
  }
  async #sendStatusQuerySocket(commandId, authorityStatus) {
    const socket = this.#runtime.socket;
    if (!socket) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_UNAVAILABLE",
          category: "busy",
          message: "Foundry socket runtime is not available"
        })
      );
    }
    const senderUserId = this.currentUserId;
    if (!senderUserId) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Cannot query status without an active user session"
        })
      );
    }
    const correlationId = `status_corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const packet = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_STATUS_QUERY",
      correlationId,
      commandId,
      targetAuthorityUserId: authorityStatus.authorityUserId,
      targetAuthorityEpoch: authorityStatus.authorityEpoch,
      declaredSenderUserId: senderUserId
    };
    return new Promise((resolve, reject) => {
      let timer = null;
      if (this.#defaultTimeoutMs > 0) {
        timer = setTimeout(() => {
          this.#pendingRequests.delete(correlationId);
          resolve(
            err(
              createPublicError({
                code: "DM_TRANSPORT_TIMEOUT",
                category: "timeout",
                message: `Status query socket request timed out after ${this.#defaultTimeoutMs}ms`
              })
            )
          );
        }, this.#defaultTimeoutMs);
      }
      this.#pendingRequests.set(correlationId, {
        resolve: (res) => resolve(res),
        reject,
        timer
      });
      try {
        socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, packet, { userId: senderUserId });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.#pendingRequests.delete(correlationId);
        resolve(
          err(
            createPublicError({
              code: "DM_TRANSPORT_SEND_FAILED",
              category: "provider",
              message: error instanceof Error ? error.message : "Socket status query emit failed"
            })
          )
        );
      }
    });
  }
  #initSocketlib() {
    if (!this.#socketlib) return;
    const adapter = this;
    this.#socketlib.register(
      "executeCommand",
      async function(packet, ..._extraArgs) {
        const socketdataUserId = this && typeof this === "object" && "socketdata" in this && this.socketdata ? typeof this.socketdata.userId === "string" && this.socketdata.userId.trim().length > 0 ? this.socketdata.userId.trim() : null : null;
        if (isSocketRequestPacket(packet)) {
          return adapter.#processInboundRequest(packet, socketdataUserId);
        }
        return err(
          createPublicError({
            code: "DM_INVALID_ENVELOPE",
            category: "validation",
            message: "Invalid RPC request packet"
          })
        );
      }
    );
    this.#socketlib.register(
      "queryCommandStatus",
      async function(commandId, ..._extraArgs) {
        const socketdataUserId = this && typeof this === "object" && "socketdata" in this && this.socketdata ? typeof this.socketdata.userId === "string" && this.socketdata.userId.trim().length > 0 ? this.socketdata.userId.trim() : null : null;
        return adapter.#handleInboundStatusQuery(commandId, socketdataUserId);
      }
    );
  }
  #initSocketListener() {
    const socket = this.#runtime.socket;
    if (!socket) return;
    this.#socketListener = (packet, ...args) => {
      this.#handleSocketPacket(packet, ...args).catch((err2) => {
        console.error("[Domain Manager] Error processing socket packet:", err2);
      });
    };
    socket.on(DOMAIN_MANAGER_SOCKET_CHANNEL, this.#socketListener);
  }
  async #handleSocketPacket(packet, ...args) {
    if (isSocketResponsePacket(packet)) {
      this.#handleResponsePacket(packet, ...args);
      return;
    }
    if (isSocketStatusResponsePacket(packet)) {
      this.#handleResponsePacket(packet, ...args);
      return;
    }
    if (isSocketStatusQueryPacket(packet)) {
      await this.#handleStatusQueryPacket(packet, ...args);
      return;
    }
    if (isSocketRequestPacket(packet)) {
      await this.#handleRequestPacket(packet, ...args);
      return;
    }
  }
  #handleResponsePacket(packet, ...transportArgs) {
    const currentId = this.currentUserId;
    if (currentId && packet.targetUserId !== currentId) {
      return;
    }
    const pending = this.#pendingRequests.get(packet.correlationId);
    if (!pending) return;
    const authorityStatus = this.#authorityService.getStatus();
    if (!authorityStatus.available || !authorityStatus.authorityUserId || packet.authorityUserId !== authorityStatus.authorityUserId || packet.authorityEpoch !== authorityStatus.authorityEpoch) {
      return;
    }
    let responseSender = null;
    if (this.#senderResolver) {
      responseSender = this.#senderResolver(packet, ...transportArgs);
    } else if (transportArgs.length > 0) {
      const firstArg = transportArgs[0];
      if (typeof firstArg === "string" && firstArg.trim().length > 0) {
        responseSender = firstArg.trim();
      } else if (typeof firstArg === "object" && firstArg !== null) {
        const candidate = firstArg;
        if (typeof candidate.userId === "string" && candidate.userId.trim().length > 0) {
          responseSender = candidate.userId.trim();
        } else if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          responseSender = candidate.id.trim();
        }
      }
    }
    if (responseSender === null || responseSender !== authorityStatus.authorityUserId) {
      return;
    }
    this.#pendingRequests.delete(packet.correlationId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.resolve(packet.response);
  }
  async #handleStatusQueryPacket(packet, ...transportArgs) {
    if (!this.#authorityService.isCurrentUser() || packet.targetAuthorityUserId !== void 0 && packet.targetAuthorityUserId !== this.currentUserId) {
      return;
    }
    const socket = this.#runtime.socket;
    if (!socket) return;
    const authorityStatus = this.#authorityService.getStatus();
    const declaredSenderUserId = packet.declaredSenderUserId;
    let authenticatedSenderUserId = null;
    if (this.#senderResolver) {
      authenticatedSenderUserId = this.#senderResolver(packet, ...transportArgs);
    } else if (transportArgs.length > 0) {
      const firstArg = transportArgs[0];
      if (typeof firstArg === "string" && firstArg.trim().length > 0) {
        authenticatedSenderUserId = firstArg.trim();
      } else if (typeof firstArg === "object" && firstArg !== null) {
        const candidate = firstArg;
        if (typeof candidate.userId === "string" && candidate.userId.trim().length > 0) {
          authenticatedSenderUserId = candidate.userId.trim();
        } else if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          authenticatedSenderUserId = candidate.id.trim();
        }
      }
    }
    if (authenticatedSenderUserId === null || authenticatedSenderUserId !== declaredSenderUserId) {
      return;
    }
    const res = this.#statusQueryHandler ? await this.#statusQueryHandler(packet.commandId) : err(
      createPublicError({
        code: "DM_COMMAND_NOT_FOUND",
        category: "not-found",
        message: "Status query handler is not registered on authority"
      })
    );
    const sanitizedRes = res.ok ? ok(sanitizeTransportReceiptForPublic(res.value)) : res;
    const responsePacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_STATUS_RESPONSE",
      correlationId: packet.correlationId,
      targetUserId: authenticatedSenderUserId,
      authorityUserId: authorityStatus.authorityUserId,
      authorityEpoch: authorityStatus.authorityEpoch,
      response: sanitizedRes
    };
    try {
      socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket, { userId: authorityStatus.authorityUserId });
    } catch (err2) {
      console.error("[Domain Manager] Failed to emit status query response:", err2);
    }
  }
  async #handleInboundStatusQuery(commandId, trustedSenderUserId) {
    if (!this.#authorityService.isCurrentUser()) {
      return err(
        createPublicError({
          code: "DM_AUTHORITY_NOT_LOCAL",
          category: "permission",
          message: "Status query can only be answered by the active Primary Authority"
        })
      );
    }
    if (trustedSenderUserId === null) {
      return err(
        createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Status query requires authenticated transport session"
        })
      );
    }
    if (typeof commandId !== "string" || !commandId.startsWith("cmd_")) {
      return err(
        createPublicError({
          code: "DM_INVALID_COMMAND_ID",
          category: "validation",
          message: `Invalid commandId for status query: '${String(commandId)}'`
        })
      );
    }
    if (!this.#statusQueryHandler) {
      return err(
        createPublicError({
          code: "DM_COMMAND_NOT_FOUND",
          category: "not-found",
          message: "Status query handler is not registered on authority"
        })
      );
    }
    const res = await this.#statusQueryHandler(commandId);
    return res.ok ? ok(sanitizeTransportReceiptForPublic(res.value)) : res;
  }
  async #processInboundRequest(packet, trustedSenderUserId, ...transportArgs) {
    const declaredSenderUserId = (typeof packet.declaredSenderUserId === "string" && packet.declaredSenderUserId.trim().length > 0 ? packet.declaredSenderUserId.trim() : null) ?? (typeof packet.senderUserId === "string" && packet.senderUserId.trim().length > 0 ? packet.senderUserId.trim() : "");
    const commandId = typeof packet.command === "object" && packet.command !== null ? packet.command.commandId ?? "cmd_" + "0".repeat(32) : "cmd_" + "0".repeat(32);
    const authorityStatus = this.#authorityService.getStatus();
    if (packet.targetAuthorityEpoch !== void 0 && packet.targetAuthorityEpoch !== authorityStatus.authorityEpoch) {
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTHORITY_EPOCH_MISMATCH",
          category: "conflict",
          message: `Command targeted epoch ${packet.targetAuthorityEpoch}, but current authority epoch is ${authorityStatus.authorityEpoch}`
        }),
        transportTimestamp: Date.now()
      });
    }
    let authenticatedSenderUserId = null;
    if (trustedSenderUserId && typeof trustedSenderUserId === "string" && trustedSenderUserId.trim().length > 0) {
      authenticatedSenderUserId = trustedSenderUserId.trim();
    } else if (this.#senderResolver) {
      authenticatedSenderUserId = this.#senderResolver(packet, ...transportArgs);
    } else if (transportArgs.length > 0) {
      const firstArg = transportArgs[0];
      if (typeof firstArg === "string" && firstArg.trim().length > 0) {
        authenticatedSenderUserId = firstArg.trim();
      } else if (typeof firstArg === "object" && firstArg !== null) {
        const candidate = firstArg;
        if (typeof candidate.userId === "string" && candidate.userId.trim().length > 0) {
          authenticatedSenderUserId = candidate.userId.trim();
        } else if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          authenticatedSenderUserId = candidate.id.trim();
        }
      }
    }
    const localUserId = this.currentUserId;
    if (localUserId !== null && declaredSenderUserId === localUserId || authorityStatus.authorityUserId !== null && declaredSenderUserId === authorityStatus.authorityUserId) {
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Remote socket packet cannot claim identity of the local Primary Authority '${declaredSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }
    if (authenticatedSenderUserId === null) {
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_AUTH_UNAUTHENTICATED",
          category: "permission",
          message: "Remote socket request has no verified transport sender identity"
        }),
        transportTimestamp: Date.now()
      });
    }
    if (localUserId !== null && authenticatedSenderUserId === localUserId || authorityStatus.authorityUserId !== null && authenticatedSenderUserId === authorityStatus.authorityUserId) {
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Remote socket packet cannot claim identity of the local Primary Authority '${declaredSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }
    if (authenticatedSenderUserId !== declaredSenderUserId) {
      return ok({
        commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_SECURITY_SENDER_SPOOFED",
          category: "permission",
          message: `Declared sender '${declaredSenderUserId}' does not match transport authenticated sender '${authenticatedSenderUserId}'`
        }),
        transportTimestamp: Date.now()
      });
    }
    if (this.#runtime.users) {
      const senderUser = this.#runtime.users.get(authenticatedSenderUserId);
      if (!senderUser || senderUser.active === false) {
        return ok({
          commandId,
          status: "rejected",
          error: createPublicError({
            code: "DM_SECURITY_SENDER_UNKNOWN",
            category: "permission",
            message: `Remote socket sender '${authenticatedSenderUserId}' is not an active connected user`
          }),
          transportTimestamp: Date.now()
        });
      }
    }
    if (!this.#inboundHandler) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NO_RECEIVER",
          category: "provider",
          message: "Primary authority local inbound handler is not registered"
        })
      );
    }
    const transportContext = {
      senderUserId: authenticatedSenderUserId,
      transportName: this.name,
      receivedAtReal: Date.now()
    };
    const inboundMessage = {
      rawEnvelope: packet.command,
      transportContext
    };
    const response = await this.#inboundHandler(inboundMessage);
    return response.ok ? ok(sanitizeTransportReceiptForPublic(response.value)) : response;
  }
  async #handleRequestPacket(packet, ...transportArgs) {
    if (!this.#authorityService.isCurrentUser() || packet.targetAuthorityUserId !== void 0 && packet.targetAuthorityUserId !== this.currentUserId) {
      return;
    }
    const socket = this.#runtime.socket;
    if (!socket) {
      return;
    }
    const authorityStatus = this.#authorityService.getStatus();
    const declaredSenderUserId = (typeof packet.declaredSenderUserId === "string" && packet.declaredSenderUserId.trim().length > 0 ? packet.declaredSenderUserId.trim() : null) ?? (typeof packet.senderUserId === "string" && packet.senderUserId.trim().length > 0 ? packet.senderUserId.trim() : "");
    const response = await this.#processInboundRequest(packet, void 0, ...transportArgs);
    const responsePacket = {
      protocol: "dm-command-v1",
      kind: "DM_CMD_RESPONSE",
      correlationId: packet.correlationId,
      targetUserId: declaredSenderUserId,
      authorityUserId: authorityStatus.authorityUserId,
      authorityEpoch: authorityStatus.authorityEpoch,
      response
    };
    try {
      socket.emit(DOMAIN_MANAGER_SOCKET_CHANNEL, responsePacket, { userId: authorityStatus.authorityUserId });
    } catch (error) {
      console.error("[Domain Manager] Failed to emit command response:", error);
    }
  }
};

// src/mutations/lock-manager.ts
function canonicalizeLockKeys(keys) {
  const unique = /* @__PURE__ */ new Set();
  for (const key of keys) {
    if (typeof key === "string") {
      const trimmed = key.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
  }
  return Object.freeze(Array.from(unique).sort());
}
var LockManager = class {
  #locks = /* @__PURE__ */ new Map();
  #defaultTimeoutMs;
  #nextHandleSeq = 1;
  constructor(options) {
    this.#defaultTimeoutMs = options?.defaultTimeoutMs ?? 1e4;
  }
  /**
   * Acquires all specified keys in deterministic order.
   */
  async acquireLocks(options) {
    const ownerId = options.ownerId;
    if (!ownerId || ownerId.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_LOCK_INVALID_OWNER",
          category: "validation",
          message: "ownerId must be a non-empty identifier"
        })
      );
    }
    const orderedKeys = canonicalizeLockKeys(options.keys);
    if (orderedKeys.length === 0) {
      return ok({
        handleId: `handle_noop_${this.#nextHandleSeq++}`,
        ownerId,
        keys: Object.freeze([]),
        acquiredAt: Date.now(),
        release: () => {
        }
      });
    }
    if (options.signal?.aborted) {
      return err(
        createPublicError({
          code: "DM_COMMAND_CANCELLED",
          category: "busy",
          message: "Lock acquisition was aborted before start"
        })
      );
    }
    const handleId = `lock_h_${this.#nextHandleSeq++}_${Date.now()}`;
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
    if (this.#canAcquireAllImmediately(ownerId, orderedKeys)) {
      this.#grantKeys(ownerId, orderedKeys);
      return ok(this.#createHandle(handleId, ownerId, orderedKeys));
    }
    return new Promise((resolve) => {
      let request;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.#removeFromQueues(request);
          resolve(
            err(
              createPublicError({
                code: "DM_LOCK_TIMEOUT",
                category: "busy",
                message: `Timed out waiting for locks on keys: [${orderedKeys.join(", ")}] after ${timeoutMs}ms`
              })
            )
          );
        }, timeoutMs);
      }
      let cleanupAbortListener;
      if (options.signal) {
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          this.#removeFromQueues(request);
          resolve(
            err(
              createPublicError({
                code: "DM_COMMAND_CANCELLED",
                category: "busy",
                message: `Lock acquisition on [${orderedKeys.join(", ")}] was cancelled while waiting in queue`
              })
            )
          );
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        cleanupAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
      }
      request = {
        handleId,
        ownerId,
        keys: orderedKeys,
        resolve: (handle) => {
          if (timer) clearTimeout(timer);
          if (cleanupAbortListener) cleanupAbortListener();
          resolve(ok(handle));
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          if (cleanupAbortListener) cleanupAbortListener();
          resolve(err(error));
        },
        timer,
        cleanupAbortListener
      };
      this.#enqueue(request);
    });
  }
  isLocked(key) {
    const state = this.#locks.get(key);
    return state !== void 0 && state.currentOwnerId !== null;
  }
  getLockOwner(key) {
    return this.#locks.get(key)?.currentOwnerId ?? null;
  }
  getDiagnostics() {
    const info = [];
    for (const [key, state] of this.#locks) {
      info.push({
        key,
        currentOwnerId: state.currentOwnerId,
        reentrantDepth: state.reentrantDepth,
        waitingCount: state.queue.length,
        heldSince: state.acquiredAt
      });
    }
    return Object.freeze(info);
  }
  #getOrCreateLockState(key) {
    let state = this.#locks.get(key);
    if (!state) {
      state = {
        currentOwnerId: null,
        reentrantDepth: 0,
        queue: []
      };
      this.#locks.set(key, state);
    }
    return state;
  }
  #canAcquireAllImmediately(ownerId, keys) {
    for (const key of keys) {
      const state = this.#locks.get(key);
      if (state && state.currentOwnerId !== null && state.currentOwnerId !== ownerId) {
        return false;
      }
      if (state && state.queue.length > 0) {
        return false;
      }
    }
    return true;
  }
  #grantKeys(ownerId, keys) {
    const now = Date.now();
    for (const key of keys) {
      const state = this.#getOrCreateLockState(key);
      if (state.currentOwnerId === ownerId) {
        state.reentrantDepth++;
      } else {
        state.currentOwnerId = ownerId;
        state.reentrantDepth = 1;
        state.acquiredAt = now;
      }
    }
  }
  #releaseKeys(ownerId, keys) {
    for (const key of keys) {
      const state = this.#locks.get(key);
      if (!state || state.currentOwnerId !== ownerId) {
        continue;
      }
      state.reentrantDepth--;
      if (state.reentrantDepth <= 0) {
        state.currentOwnerId = null;
        state.reentrantDepth = 0;
        state.acquiredAt = void 0;
      }
    }
    this.#processQueues();
  }
  #enqueue(request) {
    for (const key of request.keys) {
      const state = this.#getOrCreateLockState(key);
      state.queue.push(request);
    }
    this.#processQueues();
  }
  #processingQueues = false;
  #removeFromQueues(request) {
    for (const key of request.keys) {
      const state = this.#locks.get(key);
      if (state) {
        const idx = state.queue.indexOf(request);
        if (idx !== -1) {
          state.queue.splice(idx, 1);
        }
      }
    }
    this.#processQueues();
  }
  #processQueues() {
    if (this.#processingQueues) return;
    this.#processingQueues = true;
    try {
      let madeProgress = true;
      while (madeProgress) {
        madeProgress = false;
        const candidateRequests = /* @__PURE__ */ new Set();
        for (const state of this.#locks.values()) {
          if (state.queue.length > 0) {
            candidateRequests.add(state.queue[0]);
          }
        }
        for (const request of candidateRequests) {
          if (this.#canAcquireRequest(request)) {
            for (const key of request.keys) {
              const state = this.#locks.get(key);
              if (state) {
                const idx = state.queue.indexOf(request);
                if (idx !== -1) {
                  state.queue.splice(idx, 1);
                }
              }
            }
            this.#grantKeys(request.ownerId, request.keys);
            request.resolve(this.#createHandle(request.handleId, request.ownerId, request.keys));
            madeProgress = true;
            break;
          }
        }
      }
    } finally {
      this.#processingQueues = false;
    }
  }
  #canAcquireRequest(request) {
    for (const key of request.keys) {
      const state = this.#locks.get(key);
      if (!state) continue;
      if (state.currentOwnerId !== null && state.currentOwnerId !== request.ownerId) {
        return false;
      }
      if (state.queue.length > 0 && state.queue[0] !== request) {
        return false;
      }
    }
    return true;
  }
  #createHandle(handleId, ownerId, keys) {
    let released = false;
    return Object.freeze({
      handleId,
      ownerId,
      keys,
      acquiredAt: Date.now(),
      release: () => {
        if (!released) {
          released = true;
          this.#releaseKeys(ownerId, keys);
        }
      }
    });
  }
};

// src/mutations/receipt-contract.ts
function createMutationReceipt(params) {
  const executedAt = params.executedAt ?? Date.now();
  const receiptId = params.receiptId ?? `rcpt_${params.commandId}_${executedAt}`;
  return Object.freeze({
    receiptId,
    commandId: params.commandId,
    transactionId: params.transactionId,
    correlationId: params.correlationId,
    status: params.status,
    changed: params.changed,
    resultingRevisions: Object.freeze({ ...params.resultingRevisions }),
    warnings: Object.freeze(params.warnings ? [...params.warnings] : []),
    summary: params.summary,
    result: params.result,
    error: params.error,
    executedAt,
    childReceipts: params.childReceipts ? Object.freeze([...params.childReceipts]) : void 0
  });
}

// src/mutations/mutation-coordinator.ts
var MutationCoordinator = class {
  #lockManager;
  #defaultLockTimeoutMs;
  constructor(options) {
    this.#lockManager = options.lockManager;
    this.#defaultLockTimeoutMs = options.defaultLockTimeoutMs ?? 1e4;
  }
  async execute(context, definition, options) {
    const command = context.command;
    const now = Date.now();
    const lockKeys = definition.getLockKeys(context);
    const lockResult = await this.#lockManager.acquireLocks({
      ownerId: command.commandId,
      keys: lockKeys,
      timeoutMs: options?.timeoutMs ?? this.#defaultLockTimeoutMs,
      signal: options?.signal
    });
    if (!lockResult.ok) {
      return ok(
        createMutationReceipt({
          commandId: command.commandId,
          status: "rejected",
          changed: false,
          error: lockResult.error,
          executedAt: now
        })
      );
    }
    const lockHandle = lockResult.value;
    try {
      const freshReadResult = await definition.freshRead(context);
      if (!freshReadResult.ok) {
        return ok(
          createMutationReceipt({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: freshReadResult.error,
            executedAt: now
          })
        );
      }
      const freshState = freshReadResult.value;
      if (command.expectedRevision !== void 0) {
        if (freshState.revision !== command.expectedRevision) {
          return ok(
            createMutationReceipt({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              resultingRevisions: freshState.revision !== void 0 && freshState.revision !== null ? { current: freshState.revision } : {},
              error: createPublicError({
                code: "DM_REVISION_CONFLICT",
                category: "conflict",
                message: `Revision conflict on command '${command.commandId}'. Expected revision: ${command.expectedRevision}, current repository revision: ${freshState.revision !== void 0 && freshState.revision !== null ? freshState.revision : "missing"}`,
                details: {
                  expectedRevision: command.expectedRevision,
                  currentRevision: freshState.revision !== void 0 && freshState.revision !== null ? freshState.revision : null
                }
              }),
              executedAt: now
            })
          );
        }
      }
      if (command.expectedRevisions) {
        const entityRevisions = freshState.entityRevisions ?? {};
        for (const [ref, expected] of Object.entries(command.expectedRevisions)) {
          const current = entityRevisions[ref];
          if (current !== expected) {
            return ok(
              createMutationReceipt({
                commandId: command.commandId,
                status: "rejected",
                changed: false,
                resultingRevisions: { ...entityRevisions },
                error: createPublicError({
                  code: "DM_REVISION_CONFLICT",
                  category: "conflict",
                  message: `Revision conflict on entity '${ref}'. Expected: ${expected}, Current: ${current !== void 0 && current !== null ? current : "missing"}`,
                  details: {
                    targetRef: ref,
                    expectedRevision: expected,
                    currentRevision: current !== void 0 && current !== null ? current : null
                  }
                }),
                executedAt: now
              })
            );
          }
        }
      }
      let plan;
      try {
        const planResult = await definition.buildPlan(context, freshState);
        if (!planResult.ok) {
          return ok(
            createMutationReceipt({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              error: planResult.error,
              executedAt: now
            })
          );
        }
        plan = planResult.value;
      } catch (buildErr) {
        return ok(
          createMutationReceipt({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: buildErr instanceof Error ? buildErr.message : "buildPlan threw an unexpected exception"
            }),
            executedAt: now
          })
        );
      }
      if (!plan.isExecutable || plan.blockers.length > 0) {
        return ok(
          createMutationReceipt({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            warnings: plan.warnings,
            error: createPublicError({
              code: "DM_PLAN_BLOCKED",
              category: "validation",
              message: `Mutation plan is blocked: ${plan.blockers.join("; ")}`
            }),
            executedAt: now
          })
        );
      }
      let commitResult;
      try {
        commitResult = await definition.commit(plan, freshState);
      } catch (commitErr) {
        const isUnknownOutcome = typeof commitErr === "object" && commitErr !== null && (commitErr.outcome === "unknown" || commitErr.details?.outcome === "unknown");
        commitResult = err(
          createPublicError({
            code: "DM_COMMIT_FAILED",
            category: "internal",
            message: commitErr instanceof Error ? commitErr.message : "Unexpected exception during commit",
            details: isUnknownOutcome ? { outcome: "unknown" } : void 0
          })
        );
      }
      if (!commitResult.ok) {
        const errorDetails = typeof commitResult.error.details === "object" && commitResult.error.details !== null ? commitResult.error.details : {};
        const outcome = errorDetails.outcome;
        if (outcome === "unknown") {
          return ok(
            createMutationReceipt({
              commandId: command.commandId,
              status: "rejected",
              changed: false,
              error: createPublicError({
                code: "DM_RECOVERY_UNKNOWN_OUTCOME",
                category: "recovery",
                message: `Commit outcome is unknown; automatic compensation withheld to prevent corrupting state: ${commitResult.error.message}`,
                details: {
                  originalError: commitResult.error,
                  needsRecovery: true,
                  userActionRequired: true
                },
                userActionRequired: true,
                retryable: false
              }),
              executedAt: now
            })
          );
        }
        if (definition.compensate) {
          try {
            const compRes = await definition.compensate(plan, freshState, commitResult.error);
            if (!compRes.ok) {
              return ok(
                createMutationReceipt({
                  commandId: command.commandId,
                  status: "rejected",
                  changed: false,
                  error: createPublicError({
                    code: "DM_COMPENSATION_FAILED",
                    category: "recovery",
                    message: `Commit failed and compensation failed: ${compRes.error.message}`
                  }),
                  executedAt: now
                })
              );
            }
          } catch (compErr) {
            return ok(
              createMutationReceipt({
                commandId: command.commandId,
                status: "rejected",
                changed: false,
                error: createPublicError({
                  code: "DM_COMPENSATION_FAILED",
                  category: "recovery",
                  message: `Commit failed and compensation threw exception: ${compErr instanceof Error ? compErr.message : "Unknown error"}`
                }),
                executedAt: now
              })
            );
          }
        }
        return ok(
          createMutationReceipt({
            commandId: command.commandId,
            status: "rejected",
            changed: false,
            error: commitResult.error,
            executedAt: now
          })
        );
      }
      const committed = commitResult.value;
      return ok(
        createMutationReceipt({
          commandId: command.commandId,
          status: committed.changed ? "executed" : "no_op",
          changed: committed.changed,
          resultingRevisions: committed.resultingRevisions,
          summary: committed.summary ?? plan.summary,
          result: committed.result,
          executedAt: now
        })
      );
    } finally {
      lockHandle.release();
    }
  }
};

// src/mutations/transaction-record.ts
var FINAL_TRANSACTION_STATES = /* @__PURE__ */ new Set([
  "committed",
  "compensated",
  "failed"
]);
var VALID_TRANSITIONS = {
  planned: /* @__PURE__ */ new Set(["claimed", "failed"]),
  claimed: /* @__PURE__ */ new Set(["prepared", "failed", "needs-recovery"]),
  prepared: /* @__PURE__ */ new Set(["committing", "compensating", "failed", "needs-recovery"]),
  committing: /* @__PURE__ */ new Set(["committed", "needs-recovery", "compensating", "failed"]),
  committed: /* @__PURE__ */ new Set([]),
  // Final
  "needs-recovery": /* @__PURE__ */ new Set(["compensating", "committing", "compensated", "failed"]),
  compensating: /* @__PURE__ */ new Set(["compensated", "needs-recovery", "failed"]),
  compensated: /* @__PURE__ */ new Set([]),
  // Final
  failed: /* @__PURE__ */ new Set([])
  // Final
};
function isFinalTransactionState(state) {
  return FINAL_TRANSACTION_STATES.has(state);
}
function isValidTransactionTransition(from, to) {
  return VALID_TRANSITIONS[from]?.has(to) ?? false;
}
function transitionTransactionState(record, toState, authorityEpoch, reason, now = Date.now()) {
  if (!isValidTransactionTransition(record.state, toState)) {
    return err(
      createPublicError({
        code: "DM_TRANSACTION_INVALID_TRANSITION",
        category: "internal",
        message: `Invalid transaction transition from '${record.state}' to '${toState}' for transaction '${record.transactionId}'`
      })
    );
  }
  const transition = {
    fromState: record.state,
    toState,
    timestamp: now,
    authorityEpoch,
    reason
  };
  const updated = Object.freeze({
    ...record,
    authorityEpoch,
    state: toState,
    updatedAt: now,
    history: Object.freeze([...record.history, transition])
  });
  return ok(updated);
}

// src/mutations/transaction-store.ts
var TransactionStore = class {
  #records = /* @__PURE__ */ new Map();
  #byCommandId = /* @__PURE__ */ new Map();
  save(record) {
    this.#records.set(record.transactionId, record);
    this.#byCommandId.set(record.commandId, record.transactionId);
  }
  get(transactionId) {
    return this.#records.get(transactionId);
  }
  getByCommandId(commandId) {
    const txId = this.#byCommandId.get(commandId);
    return txId ? this.#records.get(txId) : void 0;
  }
  listUnresolved() {
    const unresolved = [];
    for (const record of this.#records.values()) {
      if (!isFinalTransactionState(record.state)) {
        unresolved.push(record);
      }
    }
    return Object.freeze(unresolved);
  }
  transition(transactionId, toState, authorityEpoch, reason, now = Date.now()) {
    const existing = this.#records.get(transactionId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_TRANSACTION_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' not found in TransactionStore`
        })
      );
    }
    const transitionRes = transitionTransactionState(
      existing,
      toState,
      authorityEpoch,
      reason,
      now
    );
    if (!transitionRes.ok) {
      return transitionRes;
    }
    this.save(transitionRes.value);
    return transitionRes;
  }
  clear() {
    this.#records.clear();
    this.#byCommandId.clear();
  }
};

// src/mutations/recovery-service.ts
var RecoveryService = class {
  #transactionStore;
  #lockManager;
  #heldRecoveryLocks = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#transactionStore = options.transactionStore;
    this.#lockManager = options.lockManager;
  }
  /**
   * Scans for unresolved transactions at startup or after authority failover.
   */
  async scanOnStartup(currentEpoch) {
    const unresolved = this.#transactionStore.listUnresolved();
    for (const record of unresolved) {
      if (record.state === "committing") {
        this.#transactionStore.transition(
          record.transactionId,
          "needs-recovery",
          currentEpoch,
          "Startup recovery scan: transition uncommitted transaction to needs-recovery"
        );
      }
      if (record.lockKeys.length > 0 && !this.#heldRecoveryLocks.has(record.transactionId)) {
        const lockRes = await this.#lockManager.acquireLocks({
          ownerId: `recovery_${record.transactionId}`,
          keys: record.lockKeys,
          timeoutMs: 0
          // acquire if free or queue
        });
        if (lockRes.ok) {
          this.#heldRecoveryLocks.set(record.transactionId, lockRes.value);
        }
      }
    }
    return this.#transactionStore.listUnresolved();
  }
  /**
   * Idempotently recovers an unresolved transaction.
   */
  async recoverTransaction(transactionId, currentEpoch, compensator) {
    const record = this.#transactionStore.get(transactionId);
    if (!record) {
      return err(
        createPublicError({
          code: "DM_RECOVERY_TX_NOT_FOUND",
          category: "not-found",
          message: `Transaction '${transactionId}' does not exist`
        })
      );
    }
    if (isFinalTransactionState(record.state)) {
      this.#releaseRecoveryLock(transactionId);
      return ok(record);
    }
    const compTransition = this.#transactionStore.transition(
      transactionId,
      "compensating",
      currentEpoch,
      "Starting compensation attempt"
    );
    if (!compTransition.ok) {
      return compTransition;
    }
    if (!compensator) {
      this.#transactionStore.transition(
        transactionId,
        "needs-recovery",
        currentEpoch,
        "Recovery halted: No compensator provided for unresolved transaction"
      );
      return err(
        createPublicError({
          code: "DM_RECOVERY_COMPENSATION_UNAVAILABLE",
          category: "recovery",
          message: `Cannot compensate transaction '${transactionId}' without a verified compensator`,
          userActionRequired: true,
          retryable: false
        })
      );
    }
    try {
      const compRes = await compensator(compTransition.value);
      if (!compRes.ok) {
        this.#transactionStore.transition(
          transactionId,
          "needs-recovery",
          currentEpoch,
          `Compensation failed: ${compRes.error.message}`
        );
        return err(
          createPublicError({
            code: "DM_RECOVERY_COMPENSATION_FAILED",
            category: "recovery",
            message: `Compensation failed during recovery: ${compRes.error.message}`
          })
        );
      }
    } catch (error) {
      this.#transactionStore.transition(
        transactionId,
        "needs-recovery",
        currentEpoch,
        `Compensation threw exception: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return err(
        createPublicError({
          code: "DM_RECOVERY_COMPENSATION_FAILED",
          category: "recovery",
          message: `Compensation threw exception: ${error instanceof Error ? error.message : "Unknown error"}`
        })
      );
    }
    const finalTransition = this.#transactionStore.transition(
      transactionId,
      "compensated",
      currentEpoch,
      "Transaction successfully compensated during recovery"
    );
    this.#releaseRecoveryLock(transactionId);
    return finalTransition;
  }
  #releaseRecoveryLock(transactionId) {
    const handle = this.#heldRecoveryLocks.get(transactionId);
    if (handle) {
      handle.release();
      this.#heldRecoveryLocks.delete(transactionId);
    }
  }
  clear() {
    for (const handle of this.#heldRecoveryLocks.values()) {
      handle.release();
    }
    this.#heldRecoveryLocks.clear();
  }
};

// src/mutations/plans/plan-contract.ts
function deepCloneAndFreeze(val) {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    const arr = val.map((item) => deepCloneAndFreeze(item));
    return Object.freeze(arr);
  }
  const cloned = {};
  for (const [k, v] of Object.entries(val)) {
    cloned[k] = deepCloneAndFreeze(v);
  }
  return Object.freeze(cloned);
}
function createMutationPlan(params) {
  const now = params.now ?? Date.now();
  const blockers = Object.freeze(params.blockers ? [...params.blockers] : []);
  const warnings = Object.freeze(params.warnings ? [...params.warnings] : []);
  const writeSet = Object.freeze(
    params.writeSet.map(
      (op) => Object.freeze({
        targetRef: op.targetRef,
        operationType: op.operationType,
        expectedRevision: op.expectedRevision,
        payload: deepCloneAndFreeze(op.payload)
      })
    )
  );
  const lockKeys = Object.freeze([...params.lockKeys]);
  const expectedRevisions = Object.freeze({ ...params.expectedRevisions });
  const readSetRevisions = params.readSetRevisions ? Object.freeze({ ...params.readSetRevisions }) : void 0;
  const planId = params.planId ?? `plan_${params.commandId}_${now}`;
  const fingerprint = computeFingerprint({
    commandId: params.commandId,
    writeSet,
    expectedRevisions,
    blockers,
    warnings
  });
  return Object.freeze({
    commandId: params.commandId,
    planId,
    fingerprint,
    lockKeys,
    writeSet,
    expectedRevisions,
    readSetRevisions,
    warnings,
    blockers,
    isExecutable: blockers.length === 0,
    summary: params.summary,
    customData: deepCloneAndFreeze(params.customData),
    createdAt: now
  });
}

// src/domains/domain-command-handlers.ts
function registerDomainCommandHandlers(registry, coordinator, domains) {
  const createMutation = {
    getLockKeys: (ctx) => {
      const parentUuid = ctx.command.payload?.record?.definition?.hierarchy?.parentDomainUuid;
      return parentUuid ? ["domain:root", `domain:${parentUuid}`] : ["domain:root"];
    },
    freshRead: async () => {
      return ok({ revision: 0 });
    },
    buildPlan: async (ctx) => {
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: ctx.command.payload?.record?.definition?.hierarchy?.parentDomainUuid ? ["domain:root", `domain:${ctx.command.payload.record.definition.hierarchy.parentDomainUuid}`] : ["domain:root"],
        writeSet: [
          {
            targetRef: "domain:new",
            operationType: "create",
            payload: ctx.command.payload
          }
        ],
        summary: `Create domain '${ctx.command.payload?.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload;
      if (!payload) {
        return err(
          createPublicError({
            code: "DM_INVALID_DOMAIN_REPOSITORY_INPUT",
            category: "validation",
            message: "Missing create payload in mutation plan"
          })
        );
      }
      const createRes = await domains.create(payload);
      if (!createRes.ok) return err(createRes.error);
      return ok({
        result: createRes.value,
        resultingRevisions: { [createRes.value.id]: createRes.value.record.revision },
        changed: true,
        summary: `Created domain '${createRes.value.name}' (${createRes.value.id})`
      });
    }
  };
  registry.register({
    type: "domain:create",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a new Domain in the world repository",
    mutationDefinition: createMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, createMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ?? createPublicError({
            code: "DM_COMMAND_EXECUTION_FAILED",
            category: "internal",
            message: "domain:create failed"
          })
        );
      }
      return ok(receipt.result);
    }
  });
  const updateMutation = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "update",
              payload: ctx.command.payload,
              expectedRevision: fresh.revision
            }
          ],
          summary: `Update domain '${ctx.command.payload.name}'`
        })
      );
    },
    commit: async (plan) => {
      const doc = plan.writeSet[0]?.payload;
      const saveRes = await domains.save(doc);
      if (!saveRes.ok) return err(saveRes.error);
      return ok({
        result: doc,
        resultingRevisions: { [doc.id]: saveRes.value.revision },
        changed: saveRes.value.status === "updated",
        summary: `Updated domain '${doc.name}' (${doc.id})`
      });
    }
  };
  registry.register({
    type: "domain:update",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates an existing Domain document",
    mutationDefinition: updateMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, updateMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ?? createPublicError({
            code: "DM_COMMAND_EXECUTION_FAILED",
            category: "internal",
            message: "domain:update failed"
          })
        );
      }
      return ok(receipt.result);
    }
  });
  const archiveMutation = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "archive",
              payload: ctx.command.payload
            }
          ],
          summary: `Archive domain '${id}'`
        })
      );
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload;
      const res = await domains.archive(payload.id, payload.archivedAt);
      if (!res.ok) return err(res.error);
      return ok({
        result: res.value,
        resultingRevisions: { [payload.id]: res.value.revision },
        changed: true,
        summary: `Archived domain '${payload.id}'`
      });
    }
  };
  registry.register({
    type: "domain:archive",
    visibility: "public",
    transactional: true,
    description: "Authoritatively transitions a Domain to archived state",
    mutationDefinition: archiveMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, archiveMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ?? createPublicError({
            code: "DM_COMMAND_EXECUTION_FAILED",
            category: "internal",
            message: "domain:archive failed"
          })
        );
      }
      return ok(receipt.result);
    }
  });
  const restoreMutation = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "restore",
              payload: ctx.command.payload
            }
          ],
          summary: `Restore domain '${id}'`
        })
      );
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload;
      const res = await domains.restore(payload.id);
      if (!res.ok) return err(res.error);
      return ok({
        result: res.value,
        resultingRevisions: { [payload.id]: res.value.revision },
        changed: true,
        summary: `Restored domain '${payload.id}'`
      });
    }
  };
  registry.register({
    type: "domain:restore",
    visibility: "public",
    transactional: true,
    description: "Authoritatively restores an archived Domain to active state",
    mutationDefinition: restoreMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, restoreMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ?? createPublicError({
            code: "DM_COMMAND_EXECUTION_FAILED",
            category: "internal",
            message: "domain:restore failed"
          })
        );
      }
      return ok(receipt.result);
    }
  });
}

// src/diagnostics/g2-diagnostics-provider.ts
var G2DiagnosticsProvider = class {
  #authorityService;
  #lockManager;
  #commandQueue;
  #transactionStore;
  #registry;
  #transport;
  #rateLimiter;
  constructor(options) {
    this.#authorityService = options.authorityService;
    this.#lockManager = options.lockManager;
    this.#commandQueue = options.commandQueue;
    this.#transactionStore = options.transactionStore;
    this.#registry = options.registry;
    this.#transport = options.transport;
    this.#rateLimiter = options.rateLimiter ?? null;
  }
  getSnapshot() {
    const authStatus = this.#authorityService.getStatus();
    const lockDiags = this.#lockManager.getDiagnostics();
    const activeLockCount = lockDiags.filter((d) => d.currentOwnerId !== null).length;
    const waitingLockCount = lockDiags.reduce((acc, d) => acc + d.waitingCount, 0);
    const queueDiags = this.#commandQueue.getDiagnostics();
    const unresolvedTxs = this.#transactionStore.listUnresolved();
    const abuseRecords = this.#rateLimiter?.getAbuseRecords() ?? [];
    const totalAbuseIncidents = abuseRecords.reduce((acc, r) => acc + r.count, 0);
    return Object.freeze({
      authority: Object.freeze({
        available: authStatus.available,
        authorityUserId: authStatus.authorityUserId,
        authorityEpoch: authStatus.authorityEpoch,
        isCurrentClientAuthority: this.#authorityService.isCurrentUser()
      }),
      transport: Object.freeze({
        name: this.#transport.name,
        isAvailable: this.#transport.isAvailable
      }),
      registry: Object.freeze({
        totalCommands: this.#registry.listRegisteredTypes().length,
        isFrozen: this.#registry.isFrozen,
        registeredTypes: this.#registry.listRegisteredTypes()
      }),
      locks: Object.freeze({
        activeCount: activeLockCount,
        waitingCount: waitingLockCount,
        items: lockDiags
      }),
      queue: queueDiags,
      recovery: Object.freeze({
        unresolvedCount: unresolvedTxs.length,
        unresolvedTransactions: Object.freeze(
          unresolvedTxs.map(
            (tx) => Object.freeze({
              transactionId: tx.transactionId,
              commandId: tx.commandId,
              state: tx.state,
              authorityEpoch: tx.authorityEpoch,
              lockKeys: tx.lockKeys
            })
          )
        )
      }),
      abuse: Object.freeze({
        totalIncidents: totalAbuseIncidents,
        records: Object.freeze(abuseRecords.map((r) => Object.freeze({ ...r })))
      }),
      collectedAtReal: Date.now()
    });
  }
};

// src/bootstrap/domain-manager-runtime.ts
function composeDomainManagerRuntime(options = {}) {
  const domainStore = options.domainStore ?? new FoundryDomainDocumentStore();
  const mutableDomainRepo = new DomainRepository(domainStore);
  const authority = options.authority ?? new FoundryPrimaryAuthorityAdapter();
  const lockManager = options.lockManager ?? new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const transactionStore = options.transactionStore ?? new TransactionStore();
  const recovery = new RecoveryService({ transactionStore, lockManager });
  const registry = new CommandRegistry();
  registerDomainCommandHandlers(registry, coordinator, mutableDomainRepo);
  registry.freeze();
  const commandQueue = options.commandQueue ?? new CommandQueue({ maxConcurrency: 10 });
  const dedupeStore = options.dedupeStore ?? new CommandDedupeStore();
  const rateLimiter = options.rateLimiter ?? new RateLimiter();
  const transport = options.transport ?? new FoundryCommandTransportAdapter({
    authorityService: authority.service
  });
  const commandBus = new CommandBus({
    registry,
    authorityService: authority.service,
    coordinator,
    transport,
    rateLimiter,
    dedupeStore,
    commandQueue
  });
  const diagnostics = new G2DiagnosticsProvider({
    authorityService: authority.service,
    lockManager,
    commandQueue,
    transactionStore,
    registry,
    transport,
    rateLimiter
  });
  const readOnlyDomains = Object.freeze({
    read: (id) => mutableDomainRepo.read(id),
    load: (id) => mutableDomainRepo.load(id),
    query: (query) => mutableDomainRepo.query(query),
    checkIntegrity: () => mutableDomainRepo.checkIntegrity(),
    getIndex: () => {
      const liveIndex = mutableDomainRepo.getIndex();
      return Object.freeze({
        get: (id) => liveIndex.get(id),
        list: () => liveIndex.list(),
        query: (q) => liveIndex.query(q)
      });
    }
  });
  return Object.freeze({
    // G2-AUD-008: Read-only facade exposed publicly
    domains: readOnlyDomains,
    authority,
    commandBus,
    registry,
    transport,
    lockManager,
    coordinator,
    recovery,
    transactionStore,
    diagnostics,
    destroy: () => {
      commandBus.destroy();
      if ("destroy" in transport && typeof transport.destroy === "function") {
        transport.destroy();
      }
      recovery.clear();
    }
  });
}

// src/core/versioning/build-metadata.ts
var BUILD_METADATA = Object.freeze({
  moduleVersion: "0.0.2",
  buildChannel: "dev",
  target: "foundry-vtt"
});

// src/diagnostics/build-diagnostics.ts
function getBuildDiagnostics() {
  return {
    ...BUILD_METADATA
  };
}

// src/diagnostics/logger.ts
var Logger = class {
  constructor(scope) {
    this.scope = scope;
  }
  debug(message, context) {
    return this.write("debug", message, context);
  }
  info(message, context) {
    return this.write("info", message, context);
  }
  warn(message, context) {
    return this.write("warn", message, context);
  }
  error(message, context) {
    return this.write("error", message, context);
  }
  write(level, message, context) {
    const safeContext = context === void 0 ? void 0 : sanitizeDiagnosticsValue(context);
    const entry = safeContext === void 0 ? { level, message } : { level, message, context: safeContext };
    const output = `[${this.scope}] ${message}`;
    if (level === "error") console.error(output, safeContext ?? "");
    else if (level === "warn") console.warn(output, safeContext ?? "");
    else console.info(output, safeContext ?? "");
    return entry;
  }
};

// src/main.ts
var logger = new Logger("Domain Manager");
var runtime = null;
function reconcileAuthority() {
  const authority = runtime?.authority;
  if (authority === void 0) return;
  void authority.reconcile().catch((error) => {
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
Hooks.once("ready", () => {
  runtime = composeDomainManagerRuntime();
  reconcileAuthority();
  if (runtime.authority.service.isCurrentUser()) {
    const currentEpoch = runtime.authority.service.getStatus().authorityEpoch;
    void runtime.recovery.scanOnStartup(currentEpoch).then((unresolved) => {
      if (unresolved.length > 0) {
        logger.warn(
          `Startup recovery scan discovered ${unresolved.length} unresolved transactions`,
          { unresolvedCount: unresolved.length }
        );
      }
    }).catch((error) => {
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
//# sourceMappingURL=main.js.map
