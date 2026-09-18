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
function isActorUuid(value) {
  if (!isFoundryUuid(value)) return false;
  const segments = value.split(".");
  if (segments[0] === "Actor") return segments.length >= 2;
  if (segments[0] !== "Compendium") return false;
  return segments.includes("Actor");
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

// src/core/identity/ids.ts
function createOpaqueId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function isOpaqueId(value, prefix) {
  if (typeof value !== "string") return false;
  const pattern = prefix === void 0 ? /^(cmd|tx|prj|rel|rep|led|resv|req|role|pop|not|opg|asg)_[0-9a-f-]{36}$/ : new RegExp(`^${prefix}_[0-9a-f-]{36}$`);
  return pattern.test(value);
}

// src/people/workforce/workforce-types.ts
var DEFAULT_WORKFORCE_TYPES = Object.freeze([
  {
    id: "general",
    label: "General Labor",
    description: "Unspecialized physical, maintenance, and civil labor"
  },
  {
    id: "military",
    label: "Military Forces",
    description: "Trained garrison guards, levies, and defense personnel"
  },
  {
    id: "craftsmen",
    label: "Craftsmen & Builders",
    description: "Skilled artisans, construction workers, and technicians"
  },
  {
    id: "scholars",
    label: "Scholars & Administrators",
    description: "Clerks, researchers, scribes, and administrative staff"
  }
]);
function validateWorkforceContribution(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_CONTRIBUTION",
        category: "validation",
        message: "WorkforceContribution must be an object"
      })
    );
  }
  const raw = candidate;
  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_TYPE",
        category: "validation",
        message: "workforceTypeId must be a non-empty string"
      })
    );
  }
  if (typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount) || raw.amount < 0) {
    return err(
      createPublicError({
        code: "DM_WORKFORCE_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a non-negative safe integer"
      })
    );
  }
  return ok({
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount
  });
}

// src/people/population/population-types.ts
var POPULATION_MODES = ["manual", "sumGroups", "hybrid"];
var POPULATION_PRECISIONS = ["exact", "estimated", "unknown"];
function isPopulationMode(value) {
  return typeof value === "string" && POPULATION_MODES.includes(value);
}
function isPopulationPrecision(value) {
  return typeof value === "string" && POPULATION_PRECISIONS.includes(value);
}
function validatePopulationState(state) {
  if (!state || typeof state !== "object") {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_STATE",
        category: "validation",
        message: "PopulationState must be an object"
      })
    );
  }
  const candidate = state;
  if (!isPopulationMode(candidate.mode)) {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_MODE",
        category: "validation",
        message: `Invalid population mode: '${String(candidate.mode)}'. Must be one of: ${POPULATION_MODES.join(", ")}`
      })
    );
  }
  if (!isPopulationPrecision(candidate.precision)) {
    return err(
      createPublicError({
        code: "DM_POPULATION_INVALID_PRECISION",
        category: "validation",
        message: `Invalid population precision: '${String(candidate.precision)}'. Must be one of: ${POPULATION_PRECISIONS.join(", ")}`
      })
    );
  }
  if (candidate.total !== null && candidate.total !== void 0) {
    if (typeof candidate.total !== "number" || !Number.isSafeInteger(candidate.total) || candidate.total < 0) {
      return err(
        createPublicError({
          code: "DM_POPULATION_INVALID_TOTAL",
          category: "validation",
          message: "Population total must be a non-negative safe integer or null"
        })
      );
    }
  }
  const total = candidate.total === void 0 ? null : candidate.total;
  let precision = candidate.precision;
  if (total === null && precision !== "unknown") {
    precision = "unknown";
  }
  if (candidate.visibility !== void 0 && candidate.visibility !== null) {
    if (candidate.visibility !== "public" && candidate.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_POPULATION_INVALID_VISIBILITY",
          category: "validation",
          message: "PopulationState visibility must be 'public' or 'secret'"
        })
      );
    }
  }
  return ok({
    mode: candidate.mode,
    total,
    precision,
    visibility: candidate.visibility === "secret" ? "secret" : "public"
  });
}
function validatePopulationGroup(group) {
  if (!group || typeof group !== "object") {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID",
        category: "validation",
        message: "PopulationGroup must be an object"
      })
    );
  }
  const candidate = group;
  if (!isOpaqueId(candidate.id, "pop")) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_ID",
        category: "validation",
        message: `PopulationGroup id must be an opaque ID with prefix 'pop_', received: '${String(candidate.id)}'`
      })
    );
  }
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_NAME",
        category: "validation",
        message: "PopulationGroup name must be a non-empty string"
      })
    );
  }
  if (candidate.count !== null && candidate.count !== void 0) {
    if (typeof candidate.count !== "number" || !Number.isSafeInteger(candidate.count) || candidate.count < 0) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_COUNT",
          category: "validation",
          message: "PopulationGroup count must be a non-negative safe integer or null"
        })
      );
    }
  }
  if (typeof candidate.includedInTotal !== "boolean") {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_INCLUDED",
        category: "validation",
        message: "PopulationGroup includedInTotal must be a boolean"
      })
    );
  }
  if (!Array.isArray(candidate.tags) || candidate.tags.some((t) => typeof t !== "string")) {
    return err(
      createPublicError({
        code: "DM_POPULATION_GROUP_INVALID_TAGS",
        category: "validation",
        message: "PopulationGroup tags must be an array of strings"
      })
    );
  }
  if (candidate.notes !== void 0 && candidate.notes !== null) {
    if (typeof candidate.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_NOTES",
          category: "validation",
          message: "PopulationGroup notes must be a string"
        })
      );
    }
    if (candidate.notes.length > 2e3) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_NOTES_TOO_LONG",
          category: "validation",
          message: "PopulationGroup notes must not exceed 2000 characters"
        })
      );
    }
  }
  if (candidate.precision !== void 0 && candidate.precision !== null) {
    if (!isPopulationPrecision(candidate.precision)) {
      return err(
        createPublicError({
          code: "DM_POPULATION_INVALID_PRECISION",
          category: "validation",
          message: `Invalid population group precision: '${String(candidate.precision)}'. Must be one of: ${POPULATION_PRECISIONS.join(", ")}`
        })
      );
    }
  }
  if (candidate.visibility !== void 0 && candidate.visibility !== null) {
    if (candidate.visibility !== "public" && candidate.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_VISIBILITY",
          category: "validation",
          message: "PopulationGroup visibility must be 'public' or 'secret'"
        })
      );
    }
  }
  let validatedContributions;
  if (candidate.workforceContributions !== void 0 && candidate.workforceContributions !== null) {
    if (!Array.isArray(candidate.workforceContributions)) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_INVALID_CONTRIBUTIONS",
          category: "validation",
          message: "PopulationGroup workforceContributions must be an array"
        })
      );
    }
    validatedContributions = [];
    for (const rawC of candidate.workforceContributions) {
      const cRes = validateWorkforceContribution(rawC);
      if (!cRes.ok) return cRes;
      validatedContributions.push(cRes.value);
    }
  }
  return ok({
    id: candidate.id,
    name: candidate.name.trim(),
    count: candidate.count === void 0 ? null : candidate.count,
    precision: candidate.precision === void 0 || candidate.precision === null ? void 0 : candidate.precision,
    includedInTotal: candidate.includedInTotal,
    visibility: candidate.visibility === "secret" ? "secret" : "public",
    workforceContributions: validatedContributions ? Object.freeze([...validatedContributions]) : void 0,
    tags: Object.freeze([...candidate.tags]),
    notes: candidate.notes === void 0 || candidate.notes === null ? void 0 : candidate.notes
  });
}

// src/people/notables/notable-types.ts
var NOTABLE_VISIBILITIES = Object.freeze([
  "public",
  "restricted",
  "secret"
]);
function isNotableVisibility(value) {
  return typeof value === "string" && NOTABLE_VISIBILITIES.includes(value);
}
function validateNotable(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID",
        category: "validation",
        message: "Notable must be an object"
      })
    );
  }
  const raw = candidate;
  if (!isOpaqueId(raw.id, "not")) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_ID",
        category: "validation",
        message: `Notable id must be an opaque ID with prefix 'not_', received: '${String(raw.id)}'`
      })
    );
  }
  const visibility = raw.visibility === void 0 ? "public" : raw.visibility;
  if (!isNotableVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid notable visibility: '${String(raw.visibility)}'. Must be one of: ${NOTABLE_VISIBILITIES.join(", ")}`
      })
    );
  }
  if (raw.tags !== void 0 && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_TAGS",
        category: "validation",
        message: "Notable tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);
  if (raw.description !== void 0 && raw.description !== null) {
    if (typeof raw.description !== "string") {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_DESCRIPTION",
          category: "validation",
          message: "Notable description must be a string"
        })
      );
    }
    if (raw.description.length > 2e3) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_DESCRIPTION_TOO_LONG",
          category: "validation",
          message: "Notable description must not exceed 2000 characters"
        })
      );
    }
  }
  const description = raw.description ? raw.description.trim() : void 0;
  if (raw.type === "inline") {
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_NAME",
          category: "validation",
          message: "Inline Notable requires a non-empty name"
        })
      );
    }
    if (raw.portrait !== void 0 && raw.portrait !== null && typeof raw.portrait !== "string") {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_PORTRAIT",
          category: "validation",
          message: "Notable portrait must be a string URL"
        })
      );
    }
    const portrait = raw.portrait ? raw.portrait.trim() : void 0;
    return ok({
      id: raw.id,
      type: "inline",
      name: raw.name.trim(),
      portrait,
      description,
      tags,
      visibility
    });
  }
  if (raw.type === "actor") {
    if (typeof raw.actorUuid !== "string" || !isActorUuid(raw.actorUuid)) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_ACTOR_REF",
          category: "validation",
          message: `Actor Notable requires a valid Actor UUID, received: '${String(raw.actorUuid)}'`
        })
      );
    }
    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : void 0;
    return ok({
      id: raw.id,
      type: "actor",
      actorUuid: raw.actorUuid,
      name,
      description,
      tags,
      visibility
    });
  }
  return err(
    createPublicError({
      code: "DM_NOTABLE_INVALID_TYPE",
      category: "validation",
      message: `Invalid notable type: '${String(raw.type)}'. Must be 'inline' or 'actor'`
    })
  );
}
function resolveNotableStatus(notable, actorResolver) {
  if (notable.type === "inline") {
    return {
      notable,
      isBrokenRef: false,
      resolvedName: notable.name,
      resolvedImg: notable.portrait
    };
  }
  const resolved = actorResolver ? actorResolver(notable.actorUuid) : null;
  if (!resolved) {
    return {
      notable,
      isBrokenRef: true,
      resolvedName: notable.name ?? "Unknown Actor (Missing Reference)",
      resolvedImg: void 0
    };
  }
  return {
    notable,
    isBrokenRef: false,
    resolvedName: resolved.name,
    resolvedImg: resolved.img
  };
}

// src/people/roles/role-types.ts
var ROLE_VISIBILITIES = Object.freeze([
  "public",
  "restricted",
  "secret"
]);
function isRoleVisibility(value) {
  return typeof value === "string" && ROLE_VISIBILITIES.includes(value);
}
var ROLE_SCOPES = Object.freeze(["domain", "operational-group"]);
function isRoleScope(value) {
  return typeof value === "string" && ROLE_SCOPES.includes(value);
}
var ROLE_GRANT_POLICIES = Object.freeze([
  "exists",
  "occupied",
  "requirementsSatisfied"
]);
var DEFAULT_ROLE_DEFINITIONS = Object.freeze([
  {
    id: "domain-manager:leader",
    version: 1,
    label: "Leader",
    description: "Primary leader or ruler of the domain",
    occupancy: { min: 1, max: 1 }
  },
  {
    id: "domain-manager:administrator",
    version: 1,
    label: "Administrator",
    description: "Manages day-to-day operations and civil affairs",
    occupancy: { min: 0, max: 2 }
  },
  {
    id: "domain-manager:commander",
    version: 1,
    label: "Military Commander",
    description: "Directs defenses and garrison forces",
    occupancy: { min: 0, max: 1 }
  },
  {
    id: "domain-manager:treasurer",
    version: 1,
    label: "Treasurer",
    description: "Oversees revenue, vaults, and fiscal planning",
    occupancy: { min: 0, max: 1 }
  },
  {
    id: "domain-manager:councilor",
    version: 1,
    label: "Councilor",
    description: "Advises leadership on policy and external relations",
    occupancy: { min: 0, max: null }
  }
]);
function validateDomainRole(candidate, definitions = DEFAULT_ROLE_DEFINITIONS) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID",
        category: "validation",
        message: "DomainRole must be an object"
      })
    );
  }
  const raw = candidate;
  if (!isOpaqueId(raw.id, "role")) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_ID",
        category: "validation",
        message: `DomainRole id must be an opaque ID with prefix 'role_', received: '${String(raw.id)}'`
      })
    );
  }
  if (typeof raw.definitionId !== "string" || raw.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_DEFINITION_ID",
        category: "validation",
        message: "DomainRole definitionId is required"
      })
    );
  }
  const definition = definitions.find((d) => d.id === raw.definitionId);
  if (raw.customLabel !== void 0 && raw.customLabel !== null) {
    if (typeof raw.customLabel !== "string" || raw.customLabel.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_LABEL",
          category: "validation",
          message: "DomainRole customLabel must be a non-empty string if provided"
        })
      );
    }
  }
  const customLabel = raw.customLabel ? raw.customLabel.trim() : void 0;
  if (!Array.isArray(raw.occupants) || raw.occupants.some((o) => !isOpaqueId(o, "not"))) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_OCCUPANTS",
        category: "validation",
        message: "DomainRole occupants must be an array of notable IDs (not_*)"
      })
    );
  }
  const occupantSet = new Set(raw.occupants);
  if (occupantSet.size !== raw.occupants.length) {
    return err(
      createPublicError({
        code: "DM_ROLE_DUPLICATE_OCCUPANT",
        category: "validation",
        message: "Duplicate notable occupant found in role"
      })
    );
  }
  if (definition && definition.occupancy.max !== null && raw.occupants.length > definition.occupancy.max) {
    return err(
      createPublicError({
        code: "DM_ROLE_OCCUPANCY_EXCEEDED",
        category: "validation",
        message: `Role occupants count (${raw.occupants.length}) exceeds maximum allowed (${definition.occupancy.max})`
      })
    );
  }
  const visibility = raw.visibility === void 0 ? "public" : raw.visibility;
  if (!isRoleVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid role visibility: '${String(raw.visibility)}'. Must be one of: ${ROLE_VISIBILITIES.join(", ")}`
      })
    );
  }
  const scope = raw.scope === void 0 ? "domain" : raw.scope;
  if (!isRoleScope(scope)) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_SCOPE",
        category: "validation",
        message: `Invalid role scope: '${String(raw.scope)}'. Must be one of: ${ROLE_SCOPES.join(", ")}`
      })
    );
  }
  let operationalGroupId;
  if (scope === "operational-group") {
    if (typeof raw.operationalGroupId !== "string" || !isOpaqueId(raw.operationalGroupId, "opg")) {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_OPERATIONAL_GROUP_ID",
          category: "validation",
          message: "Group role requires a valid operationalGroupId with prefix 'opg_'"
        })
      );
    }
    operationalGroupId = raw.operationalGroupId;
  } else if (raw.operationalGroupId !== void 0 && raw.operationalGroupId !== null) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_OPERATIONAL_GROUP_ID",
        category: "validation",
        message: "Domain-scoped role cannot have operationalGroupId"
      })
    );
  }
  if (definition && definition.allowedScopes && !definition.allowedScopes.includes(scope)) {
    return err(
      createPublicError({
        code: "DM_ROLE_SCOPE_NOT_ALLOWED",
        category: "validation",
        message: `Scope '${scope}' is not allowed for role definition '${definition.id}'. Allowed scopes: ${definition.allowedScopes.join(", ")}`
      })
    );
  }
  if (raw.notes !== void 0 && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_ROLE_INVALID_NOTES",
          category: "validation",
          message: "Role notes must be a string"
        })
      );
    }
    if (raw.notes.length > 2e3) {
      return err(
        createPublicError({
          code: "DM_ROLE_NOTES_TOO_LONG",
          category: "validation",
          message: "Role notes must not exceed 2000 characters"
        })
      );
    }
  }
  const notes = raw.notes ? raw.notes.trim() : void 0;
  if (raw.tags !== void 0 && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_ROLE_INVALID_TAGS",
        category: "validation",
        message: "Role tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);
  return ok({
    id: raw.id,
    definitionId: raw.definitionId.trim(),
    customLabel,
    occupants: Object.freeze([...raw.occupants]),
    visibility,
    scope,
    operationalGroupId,
    notes,
    tags
  });
}
function evaluateRole(role, definitions = DEFAULT_ROLE_DEFINITIONS, operationalGroups, enabledCapabilities) {
  const definition = definitions.find((d) => d.id === role.definitionId);
  const effectiveLabel = role.customLabel ?? definition?.label ?? role.definitionId;
  const occupantsCount = role.occupants.length;
  const isVacant = occupantsCount === 0;
  const isFilled = occupantsCount > 0;
  const minOccupancy = definition?.occupancy.min ?? 0;
  const isUnderstaffed = occupantsCount < minOccupancy;
  let isRequirementSatisfied = !isUnderstaffed;
  let isValidGroupRole = true;
  if (definition?.prerequisites && definition.prerequisites.length > 0) {
    if (!enabledCapabilities) {
      isRequirementSatisfied = false;
    } else {
      for (const prereq of definition.prerequisites) {
        if (!enabledCapabilities.includes(prereq)) {
          isRequirementSatisfied = false;
          break;
        }
      }
    }
  }
  if (role.scope === "operational-group") {
    if (operationalGroups) {
      const group = operationalGroups.find((g) => g.id === role.operationalGroupId);
      if (!group || group.lifecycle === "disbanded") {
        isValidGroupRole = false;
        isRequirementSatisfied = false;
      } else if (group.members && group.members.length > 0) {
        const nonMembers = role.occupants.filter((occ) => !group.members.includes(occ));
        if (nonMembers.length > 0) {
          isValidGroupRole = false;
          isRequirementSatisfied = false;
        }
      }
    }
  }
  const missingCount = Math.max(0, minOccupancy - occupantsCount);
  return {
    role,
    definition,
    effectiveLabel,
    isVacant,
    isFilled,
    isUnderstaffed,
    isRequirementSatisfied,
    missingCount,
    isValidGroupRole
  };
}

// src/people/operational-groups/operational-group-types.ts
var OPERATIONAL_GROUP_LIFECYCLES = Object.freeze([
  "active",
  "inactive",
  "disbanded"
]);
function isOperationalGroupLifecycle(value) {
  return typeof value === "string" && OPERATIONAL_GROUP_LIFECYCLES.includes(value);
}
var OPERATIONAL_GROUP_MEMBERSHIP_MODES = Object.freeze([
  "abstract",
  "partial",
  "explicit"
]);
function isOperationalGroupMembershipMode(value) {
  return typeof value === "string" && OPERATIONAL_GROUP_MEMBERSHIP_MODES.includes(value);
}
var OPERATIONAL_GROUP_VISIBILITIES = Object.freeze([
  "public",
  "restricted",
  "secret"
]);
function isOperationalGroupVisibility(value) {
  return typeof value === "string" && OPERATIONAL_GROUP_VISIBILITIES.includes(value);
}
var DEFAULT_OPERATIONAL_GROUP_DEFINITIONS = Object.freeze([
  {
    id: "domain-manager:militia",
    version: 1,
    label: "Local Militia",
    description: "Basic garrison and defensive force",
    defaultMembershipMode: "partial"
  },
  {
    id: "domain-manager:labor-squad",
    version: 1,
    label: "Labor Squad",
    description: "Organized civilian workforce for infrastructure and projects",
    defaultMembershipMode: "abstract"
  },
  {
    id: "domain-manager:scout-patrol",
    version: 1,
    label: "Scout Patrol",
    description: "Mobile reconnaissance unit operating on domain frontiers",
    defaultMembershipMode: "explicit"
  }
]);
function validateOperationalGroup(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID",
        category: "validation",
        message: "OperationalGroup must be an object"
      })
    );
  }
  const raw = candidate;
  if (!isOpaqueId(raw.id, "opg")) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_ID",
        category: "validation",
        message: `OperationalGroup id must be an opaque ID with prefix 'opg_', received: '${String(raw.id)}'`
      })
    );
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_NAME",
        category: "validation",
        message: "OperationalGroup name must be a non-empty string"
      })
    );
  }
  const name = raw.name.trim();
  if (typeof raw.definitionId !== "string" || raw.definitionId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_DEFINITION_ID",
        category: "validation",
        message: "OperationalGroup definitionId is required"
      })
    );
  }
  const definitionId = raw.definitionId.trim();
  const membershipMode = raw.membershipMode === void 0 ? "abstract" : raw.membershipMode;
  if (!isOperationalGroupMembershipMode(membershipMode)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_MEMBERSHIP_MODE",
        category: "validation",
        message: `Invalid membershipMode: '${String(raw.membershipMode)}'. Must be one of: ${OPERATIONAL_GROUP_MEMBERSHIP_MODES.join(", ")}`
      })
    );
  }
  const rawMembers = raw.members === void 0 ? [] : raw.members;
  if (!Array.isArray(rawMembers) || rawMembers.some((m) => !isOpaqueId(m, "not"))) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_MEMBERS",
        category: "validation",
        message: "OperationalGroup members must be an array of notable IDs (not_*)"
      })
    );
  }
  const memberSet = new Set(rawMembers);
  if (memberSet.size !== rawMembers.length) {
    return err(
      createPublicError({
        code: "DM_OPG_DUPLICATE_MEMBER",
        category: "validation",
        message: "Duplicate notable member found in OperationalGroup"
      })
    );
  }
  if (membershipMode === "abstract" && rawMembers.length > 0) {
    return err(
      createPublicError({
        code: "DM_OPG_ABSTRACT_CANNOT_HAVE_MEMBERS",
        category: "validation",
        message: "OperationalGroup in 'abstract' membership mode cannot have individual members in roster"
      })
    );
  }
  let size;
  if (membershipMode === "explicit") {
    size = typeof raw.size === "number" && Number.isSafeInteger(raw.size) && raw.size >= 0 ? raw.size : rawMembers.length;
  } else {
    if (typeof raw.size !== "number" || !Number.isSafeInteger(raw.size) || raw.size < 0) {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_SIZE",
          category: "validation",
          message: "OperationalGroup size must be a non-negative integer for abstract/partial modes"
        })
      );
    }
    size = raw.size;
    if (membershipMode === "partial" && rawMembers.length > size) {
      return err(
        createPublicError({
          code: "DM_OPG_PARTIAL_MEMBERS_EXCEED_SIZE",
          category: "validation",
          message: `OperationalGroup roster length (${rawMembers.length}) cannot exceed declared size (${size}) in partial mode`
        })
      );
    }
  }
  const lifecycle = raw.lifecycle === void 0 ? "active" : raw.lifecycle;
  if (!isOperationalGroupLifecycle(lifecycle)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_LIFECYCLE",
        category: "validation",
        message: `Invalid lifecycle: '${String(raw.lifecycle)}'. Must be one of: ${OPERATIONAL_GROUP_LIFECYCLES.join(", ")}`
      })
    );
  }
  const visibility = raw.visibility === void 0 ? "public" : raw.visibility;
  if (!isOperationalGroupVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid visibility: '${String(raw.visibility)}'. Must be one of: ${OPERATIONAL_GROUP_VISIBILITIES.join(", ")}`
      })
    );
  }
  let populationGroupId = void 0;
  if (raw.populationGroupId !== void 0 && raw.populationGroupId !== null) {
    if (!isOpaqueId(raw.populationGroupId, "pop")) {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_POPULATION_GROUP_ID",
          category: "validation",
          message: `populationGroupId must have prefix 'pop_', received: '${String(raw.populationGroupId)}'`
        })
      );
    }
    populationGroupId = raw.populationGroupId;
  }
  if (raw.notes !== void 0 && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_OPG_INVALID_NOTES",
          category: "validation",
          message: "OperationalGroup notes must be a string"
        })
      );
    }
    if (raw.notes.length > 2e3) {
      return err(
        createPublicError({
          code: "DM_OPG_NOTES_TOO_LONG",
          category: "validation",
          message: "OperationalGroup notes must not exceed 2000 characters"
        })
      );
    }
  }
  const notes = raw.notes ? raw.notes.trim() : void 0;
  if (raw.tags !== void 0 && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_OPG_INVALID_TAGS",
        category: "validation",
        message: "OperationalGroup tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);
  return ok({
    id: raw.id,
    name,
    definitionId,
    membershipMode,
    size,
    members: Object.freeze([...rawMembers]),
    lifecycle,
    visibility,
    populationGroupId,
    notes,
    tags
  });
}

// src/people/assignments/assignment-types.ts
var ASSIGNMENT_STATUSES = Object.freeze([
  "active",
  "ended",
  "completed",
  "cancelled"
]);
function isAssignmentStatus(value) {
  return typeof value === "string" && ASSIGNMENT_STATUSES.includes(value);
}
var AssignmentTargetRegistry = class {
  #allowedPrefixes = /* @__PURE__ */ new Set(["opg", "prj", "fac", "dom", "ext", "act", "loc", "djn", "tsk"]);
  #customValidators = /* @__PURE__ */ new Map();
  registerPrefix(prefix, validator) {
    this.#allowedPrefixes.add(prefix.toLowerCase());
    if (validator) {
      this.#customValidators.set(prefix.toLowerCase(), validator);
    }
  }
  isValidTarget(targetRef) {
    if (!targetRef || typeof targetRef !== "string") return false;
    const trimmed = targetRef.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.startsWith("JournalEntry.") || trimmed.startsWith("Scene.") || trimmed.startsWith("Actor.") || trimmed.startsWith("Item.")) {
      return true;
    }
    const parts = trimmed.split("_");
    if (parts.length >= 2) {
      const prefix = parts[0].toLowerCase();
      if (this.#customValidators.has(prefix)) {
        return this.#customValidators.get(prefix)(trimmed);
      }
      return this.#allowedPrefixes.has(prefix);
    }
    return false;
  }
};
var defaultAssignmentTargetRegistry = new AssignmentTargetRegistry();
var RESERVATION_STATUSES = Object.freeze([
  "active",
  "claimed",
  "expired",
  "released"
]);
function isReservationStatus(value) {
  return typeof value === "string" && RESERVATION_STATUSES.includes(value);
}
function validateAssignment(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID",
        category: "validation",
        message: "Assignment must be an object"
      })
    );
  }
  const raw = candidate;
  if (!isOpaqueId(raw.id, "asg")) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_ID",
        category: "validation",
        message: `Assignment id must be an opaque ID with prefix 'asg_', received: '${String(raw.id)}'`
      })
    );
  }
  if (typeof raw.sourceRef !== "string" || raw.sourceRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_SOURCE",
        category: "validation",
        message: "sourceRef is required"
      })
    );
  }
  if (typeof raw.targetRef !== "string" || raw.targetRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_TARGET",
        category: "validation",
        message: "targetRef is required"
      })
    );
  }
  if (options.validateTarget && !defaultAssignmentTargetRegistry.isValidTarget(raw.targetRef.trim())) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_TARGET",
        category: "validation",
        message: `Target '${raw.targetRef}' is not a recognized target reference`
      })
    );
  }
  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_WORKFORCE_TYPE",
        category: "validation",
        message: "workforceTypeId is required"
      })
    );
  }
  if (typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount) || raw.amount <= 0) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a positive safe integer"
      })
    );
  }
  const status = raw.status === void 0 ? "active" : raw.status;
  if (!isAssignmentStatus(status)) {
    return err(
      createPublicError({
        code: "DM_ASSIGNMENT_INVALID_STATUS",
        category: "validation",
        message: `Invalid assignment status: '${String(raw.status)}'`
      })
    );
  }
  let endedReason;
  if (raw.endedReason !== void 0 && raw.endedReason !== null) {
    if (typeof raw.endedReason !== "string") {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_ENDED_REASON",
          category: "validation",
          message: "endedReason must be a string"
        })
      );
    }
    endedReason = raw.endedReason.trim();
  }
  if (raw.visibility !== void 0 && raw.visibility !== null) {
    if (raw.visibility !== "public" && raw.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_VISIBILITY",
          category: "validation",
          message: "Assignment visibility must be 'public' or 'secret'"
        })
      );
    }
  }
  let startedAtWorld;
  if (raw.startedAtWorld !== void 0 && raw.startedAtWorld !== null) {
    if (typeof raw.startedAtWorld !== "number" || !Number.isFinite(raw.startedAtWorld)) {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_TIME",
          category: "validation",
          message: "startedAtWorld must be a finite number"
        })
      );
    }
    startedAtWorld = raw.startedAtWorld;
  }
  let endsAtWorld;
  if (raw.endsAtWorld !== void 0 && raw.endsAtWorld !== null) {
    if (typeof raw.endsAtWorld !== "number" || !Number.isFinite(raw.endsAtWorld)) {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_TIME",
          category: "validation",
          message: "endsAtWorld must be a finite number"
        })
      );
    }
    endsAtWorld = raw.endsAtWorld;
  }
  if (raw.notes !== void 0 && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_ASSIGNMENT_INVALID_NOTES",
          category: "validation",
          message: "notes must be a string"
        })
      );
    }
  }
  return ok({
    id: raw.id,
    sourceRef: raw.sourceRef.trim(),
    targetRef: raw.targetRef.trim(),
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount,
    status,
    endedReason,
    visibility: raw.visibility === "secret" ? "secret" : "public",
    startedAtWorld,
    endsAtWorld,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : void 0
  });
}
function validateReservation(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation must be an object"
      })
    );
  }
  const raw = candidate;
  if (!isOpaqueId(raw.id, "resv")) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_ID",
        category: "validation",
        message: `Reservation id must be an opaque ID with prefix 'resv_', received: '${String(raw.id)}'`
      })
    );
  }
  if (typeof raw.sourceRef !== "string" || raw.sourceRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_SOURCE",
        category: "validation",
        message: "sourceRef is required"
      })
    );
  }
  if (typeof raw.targetRef !== "string" || raw.targetRef.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_TARGET",
        category: "validation",
        message: "targetRef is required"
      })
    );
  }
  if (options.validateTarget && !defaultAssignmentTargetRegistry.isValidTarget(raw.targetRef.trim())) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_TARGET",
        category: "validation",
        message: `Target '${raw.targetRef}' is not a recognized target reference`
      })
    );
  }
  if (typeof raw.workforceTypeId !== "string" || raw.workforceTypeId.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_WORKFORCE_TYPE",
        category: "validation",
        message: "workforceTypeId is required"
      })
    );
  }
  if (typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount) || raw.amount <= 0) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_AMOUNT",
        category: "validation",
        message: "amount must be a positive safe integer"
      })
    );
  }
  const status = raw.status === void 0 ? "active" : raw.status;
  if (!isReservationStatus(status)) {
    return err(
      createPublicError({
        code: "DM_RESERVATION_INVALID_STATUS",
        category: "validation",
        message: `Invalid reservation status: '${String(raw.status)}'`
      })
    );
  }
  let expiresAtReal = void 0;
  if (raw.expiresAtReal !== void 0 && raw.expiresAtReal !== null) {
    if (typeof raw.expiresAtReal !== "number" || !Number.isFinite(raw.expiresAtReal)) {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_EXPIRY",
          category: "validation",
          message: "expiresAtReal must be a finite number"
        })
      );
    }
    expiresAtReal = raw.expiresAtReal;
  }
  let expiresAtWorld = void 0;
  if (raw.expiresAtWorld !== void 0 && raw.expiresAtWorld !== null) {
    if (typeof raw.expiresAtWorld !== "number" || !Number.isFinite(raw.expiresAtWorld)) {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_EXPIRY",
          category: "validation",
          message: "expiresAtWorld must be a finite number"
        })
      );
    }
    expiresAtWorld = raw.expiresAtWorld;
  }
  if (raw.visibility !== void 0 && raw.visibility !== null) {
    if (raw.visibility !== "public" && raw.visibility !== "secret") {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_VISIBILITY",
          category: "validation",
          message: "Reservation visibility must be 'public' or 'secret'"
        })
      );
    }
  }
  const correlationId = typeof raw.correlationId === "string" && raw.correlationId.trim().length > 0 ? raw.correlationId.trim() : void 0;
  if (raw.notes !== void 0 && raw.notes !== null) {
    if (typeof raw.notes !== "string") {
      return err(
        createPublicError({
          code: "DM_RESERVATION_INVALID_NOTES",
          category: "validation",
          message: "notes must be a string"
        })
      );
    }
  }
  return ok({
    id: raw.id,
    sourceRef: raw.sourceRef.trim(),
    targetRef: raw.targetRef.trim(),
    workforceTypeId: raw.workforceTypeId.trim(),
    amount: raw.amount,
    status,
    correlationId,
    visibility: raw.visibility === "secret" ? "secret" : "public",
    expiresAtReal,
    expiresAtWorld,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : void 0
  });
}

// src/people/people-data.ts
var PEOPLE_CAPABILITY_ID = "domain-manager:people";
var PEOPLE_SCHEMA_VERSION = 1;
function createDefaultDomainPeopleData() {
  return {
    schemaVersion: PEOPLE_SCHEMA_VERSION,
    population: {
      mode: "manual",
      total: null,
      precision: "unknown"
    },
    populationGroups: Object.freeze([]),
    notables: Object.freeze([]),
    roles: Object.freeze([]),
    operationalGroups: Object.freeze([]),
    assignments: Object.freeze([]),
    reservations: Object.freeze([])
  };
}
function validateDomainPeopleData(raw) {
  if (!raw || typeof raw !== "object") {
    return err(
      createPublicError({
        code: "DM_PEOPLE_DATA_INVALID",
        category: "validation",
        message: "People data must be an object"
      })
    );
  }
  const candidate = raw;
  if (candidate.schemaVersion !== PEOPLE_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid People schemaVersion: ${String(candidate.schemaVersion)}. Expected ${PEOPLE_SCHEMA_VERSION}`
      })
    );
  }
  const popResult = validatePopulationState(candidate.population);
  if (!popResult.ok) {
    return popResult;
  }
  if (!Array.isArray(candidate.populationGroups)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_GROUPS",
        category: "validation",
        message: "populationGroups must be an array"
      })
    );
  }
  const validatedGroups = [];
  const groupIds = /* @__PURE__ */ new Set();
  for (const g of candidate.populationGroups) {
    const groupResult = validatePopulationGroup(g);
    if (!groupResult.ok) {
      return groupResult;
    }
    if (groupIds.has(groupResult.value.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_GROUP_ID",
          category: "validation",
          message: `Duplicate population group ID found: ${groupResult.value.id}`
        })
      );
    }
    groupIds.add(groupResult.value.id);
    validatedGroups.push(groupResult.value);
  }
  if (candidate.notables !== void 0 && !Array.isArray(candidate.notables)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_NOTABLES",
        category: "validation",
        message: "notables must be an array"
      })
    );
  }
  const rawNotables = Array.isArray(candidate.notables) ? candidate.notables : [];
  const validatedNotables = [];
  const notableIds = /* @__PURE__ */ new Set();
  const notableActorUuids = /* @__PURE__ */ new Set();
  for (const n of rawNotables) {
    const notableResult = validateNotable(n);
    if (!notableResult.ok) {
      return notableResult;
    }
    const val = notableResult.value;
    if (notableIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_NOTABLE_ID",
          category: "validation",
          message: `Duplicate notable ID found: ${val.id}`
        })
      );
    }
    notableIds.add(val.id);
    if (val.type === "actor") {
      if (notableActorUuids.has(val.actorUuid)) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_DUPLICATE_ACTOR",
            category: "validation",
            message: `Actor '${val.actorUuid}' is already linked to a Notable in this domain`
          })
        );
      }
      notableActorUuids.add(val.actorUuid);
    }
    validatedNotables.push(val);
  }
  if (candidate.roles !== void 0 && !Array.isArray(candidate.roles)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_ROLES",
        category: "validation",
        message: "roles must be an array"
      })
    );
  }
  const rawRoles = Array.isArray(candidate.roles) ? candidate.roles : [];
  const validatedRoles = [];
  const roleIds = /* @__PURE__ */ new Set();
  for (const r of rawRoles) {
    const roleResult = validateDomainRole(r);
    if (!roleResult.ok) {
      return roleResult;
    }
    const val = roleResult.value;
    if (roleIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_ROLE_ID",
          category: "validation",
          message: `Duplicate role ID found: ${val.id}`
        })
      );
    }
    roleIds.add(val.id);
    validatedRoles.push(val);
  }
  if (candidate.operationalGroups !== void 0 && !Array.isArray(candidate.operationalGroups)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_OPERATIONAL_GROUPS",
        category: "validation",
        message: "operationalGroups must be an array"
      })
    );
  }
  const rawOperationalGroups = Array.isArray(candidate.operationalGroups) ? candidate.operationalGroups : [];
  const validatedOperationalGroups = [];
  const opgIds = /* @__PURE__ */ new Set();
  for (const o of rawOperationalGroups) {
    const opgResult = validateOperationalGroup(o);
    if (!opgResult.ok) {
      return opgResult;
    }
    const val = opgResult.value;
    if (opgIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_OPERATIONAL_GROUP_ID",
          category: "validation",
          message: `Duplicate operational group ID found: ${val.id}`
        })
      );
    }
    opgIds.add(val.id);
    validatedOperationalGroups.push(val);
  }
  if (candidate.assignments !== void 0 && !Array.isArray(candidate.assignments)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_ASSIGNMENTS",
        category: "validation",
        message: "assignments must be an array"
      })
    );
  }
  const rawAssignments = Array.isArray(candidate.assignments) ? candidate.assignments : [];
  const validatedAssignments = [];
  const asgIds = /* @__PURE__ */ new Set();
  for (const a of rawAssignments) {
    const asgRes = validateAssignment(a);
    if (!asgRes.ok) {
      return asgRes;
    }
    const val = asgRes.value;
    if (asgIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_ASSIGNMENT_ID",
          category: "validation",
          message: `Duplicate assignment ID found: ${val.id}`
        })
      );
    }
    asgIds.add(val.id);
    validatedAssignments.push(val);
  }
  if (candidate.reservations !== void 0 && !Array.isArray(candidate.reservations)) {
    return err(
      createPublicError({
        code: "DM_PEOPLE_INVALID_RESERVATIONS",
        category: "validation",
        message: "reservations must be an array"
      })
    );
  }
  const rawReservations = Array.isArray(candidate.reservations) ? candidate.reservations : [];
  const validatedReservations = [];
  const resvIds = /* @__PURE__ */ new Set();
  for (const r of rawReservations) {
    const resvRes = validateReservation(r);
    if (!resvRes.ok) {
      return resvRes;
    }
    const val = resvRes.value;
    if (resvIds.has(val.id)) {
      return err(
        createPublicError({
          code: "DM_PEOPLE_DUPLICATE_RESERVATION_ID",
          category: "validation",
          message: `Duplicate reservation ID found: ${val.id}`
        })
      );
    }
    resvIds.add(val.id);
    validatedReservations.push(val);
  }
  return ok({
    schemaVersion: PEOPLE_SCHEMA_VERSION,
    population: popResult.value,
    populationGroups: Object.freeze(validatedGroups),
    notables: Object.freeze(validatedNotables),
    roles: Object.freeze(validatedRoles),
    operationalGroups: Object.freeze(validatedOperationalGroups),
    assignments: Object.freeze(validatedAssignments),
    reservations: Object.freeze(validatedReservations)
  });
}
function tryGetDomainPeopleData(domain) {
  const record = "record" in domain ? domain.record : domain;
  const config = record?.definition?.capabilities?.config ?? {};
  const rawPeople = config[PEOPLE_CAPABILITY_ID];
  if (!rawPeople) {
    return ok(createDefaultDomainPeopleData());
  }
  return validateDomainPeopleData(rawPeople);
}
function getDomainPeopleData(domain) {
  const res = tryGetDomainPeopleData(domain);
  if (!res.ok) {
    throw new Error(`Domain people data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}
function withDomainPeopleData(domain, peopleData) {
  const currentEnabled = domain.definition.capabilities.enabled;
  const newEnabled = currentEnabled.includes(PEOPLE_CAPABILITY_ID) ? currentEnabled : Object.freeze([...currentEnabled, PEOPLE_CAPABILITY_ID]);
  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [PEOPLE_CAPABILITY_ID]: peopleData
  });
  return {
    ...domain,
    definition: {
      ...domain.definition,
      capabilities: {
        enabled: newEnabled,
        config: newConfig
      }
    }
  };
}

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
  registry.register({
    id: "domain-manager:people",
    label: "People & Population management",
    functional: true,
    validateConfig: (config) => {
      if (config === void 0 || config === null) return ok(void 0);
      const res = validateDomainPeopleData(config);
      return res.ok ? ok(void 0) : err(res.error);
    }
  });
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
    return ok({
      name: this.document.name,
      record: decoded.value,
      ...this.document.ownership !== void 0 ? { ownership: this.document.ownership } : {}
    });
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

// src/people/workforce/workforce-calculator.ts
function resolveOperationalGroupWorkforceType(definitionId) {
  switch (definitionId) {
    case "domain-manager:labor-squad":
      return "general";
    case "domain-manager:militia":
    case "domain-manager:scout-patrol":
      return "military";
    default:
      return "general";
  }
}
function calculateWorkforce(people, timeOrOptions, availableTypes = DEFAULT_WORKFORCE_TYPES) {
  const nowReal = typeof timeOrOptions === "number" ? timeOrOptions : timeOrOptions?.nowReal ?? Date.now();
  const nowWorld = typeof timeOrOptions === "object" ? timeOrOptions?.nowWorld : void 0;
  const typeMap = /* @__PURE__ */ new Map();
  for (const t of availableTypes) {
    typeMap.set(t.id, {
      capacity: 0,
      committed: 0,
      reserved: 0,
      contributions: []
    });
  }
  function ensureType(typeId) {
    let entry = typeMap.get(typeId);
    if (!entry) {
      entry = {
        capacity: 0,
        committed: 0,
        reserved: 0,
        contributions: []
      };
      typeMap.set(typeId, entry);
    }
    return entry;
  }
  const warnings = [];
  const populationGroupLinkedDeductions = /* @__PURE__ */ new Map();
  const opGroups = people.operationalGroups ?? [];
  for (const og of opGroups) {
    if (og.lifecycle !== "active") {
      continue;
    }
    const typeId = resolveOperationalGroupWorkforceType(og.definitionId);
    const entry = ensureType(typeId);
    entry.capacity += og.size;
    entry.contributions.push({
      sourceId: og.id,
      sourceType: "operational-group",
      sourceName: og.name,
      amount: og.size
    });
    if (og.populationGroupId) {
      const prev = populationGroupLinkedDeductions.get(og.populationGroupId) ?? 0;
      populationGroupLinkedDeductions.set(og.populationGroupId, prev + og.size);
    }
  }
  const popGroups = people.populationGroups ?? [];
  for (const pg of popGroups) {
    const contributions = pg.workforceContributions;
    if (contributions && Array.isArray(contributions)) {
      for (const c of contributions) {
        if (typeof c.workforceTypeId === "string" && typeof c.amount === "number" && c.amount > 0) {
          const entry = ensureType(c.workforceTypeId);
          const linkedDeduction = populationGroupLinkedDeductions.get(pg.id) ?? 0;
          const netContribution = Math.max(0, c.amount - linkedDeduction);
          if (netContribution < c.amount) {
            warnings.push(
              `PopulationGroup '${pg.name}' workforce contribution of ${c.amount} reduced to ${netContribution} to prevent double-counting linked operational groups.`
            );
          }
          if (netContribution > 0) {
            entry.capacity += netContribution;
            entry.contributions.push({
              sourceId: pg.id,
              sourceType: "population-group",
              sourceName: pg.name,
              amount: netContribution,
              deductedFromLinked: netContribution < c.amount
            });
          }
        }
      }
    }
  }
  const assignments = people.assignments ?? [];
  const notableMap = new Map((people.notables ?? []).map((n) => [n.id, n]));
  const notableContributedCapacity = /* @__PURE__ */ new Set();
  for (const asg of assignments) {
    if (asg.status === "active") {
      if (nowWorld !== void 0 && asg.endsAtWorld !== void 0 && asg.endsAtWorld <= nowWorld) {
        continue;
      }
      if (nowWorld !== void 0 && asg.startedAtWorld !== void 0 && asg.startedAtWorld > nowWorld) {
        continue;
      }
      if (isOpaqueId(asg.sourceRef, "not")) {
        const notable = notableMap.get(asg.sourceRef);
        if (notable && !notableContributedCapacity.has(asg.sourceRef)) {
          notableContributedCapacity.add(asg.sourceRef);
          const capEntry = ensureType(asg.workforceTypeId);
          capEntry.capacity += 1;
          capEntry.contributions.push({
            sourceId: notable.id,
            sourceType: "notable",
            sourceName: notable.name ?? notable.id,
            amount: 1
          });
        }
      }
      const entry = ensureType(asg.workforceTypeId);
      entry.committed += asg.amount;
    }
  }
  const reservations = people.reservations ?? [];
  for (const resv of reservations) {
    if (resv.status === "active") {
      if (resv.expiresAtReal !== void 0 && resv.expiresAtReal < nowReal) {
        continue;
      }
      if (nowWorld !== void 0 && resv.expiresAtWorld !== void 0 && resv.expiresAtWorld <= nowWorld) {
        continue;
      }
      if (isOpaqueId(resv.sourceRef, "not")) {
        const notable = notableMap.get(resv.sourceRef);
        if (notable && !notableContributedCapacity.has(resv.sourceRef)) {
          notableContributedCapacity.add(resv.sourceRef);
          const capEntry = ensureType(resv.workforceTypeId);
          capEntry.capacity += 1;
          capEntry.contributions.push({
            sourceId: notable.id,
            sourceType: "notable",
            sourceName: notable.name ?? notable.id,
            amount: 1
          });
        }
      }
      const entry = ensureType(resv.workforceTypeId);
      entry.reserved += resv.amount;
    }
  }
  const typesRecord = {};
  let totalCapacity = 0;
  let totalCommitted = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  let isAnyOvercommitted = false;
  for (const [typeId, data] of typeMap.entries()) {
    const available = data.capacity - data.committed - data.reserved;
    const isOvercommitted = available < 0;
    if (isOvercommitted) {
      isAnyOvercommitted = true;
      warnings.push(
        `Workforce type '${typeId}' is overcommitted: capacity=${data.capacity}, committed=${data.committed}, reserved=${data.reserved}, available=${available}`
      );
    }
    typesRecord[typeId] = {
      workforceTypeId: typeId,
      capacity: data.capacity,
      committed: data.committed,
      reserved: data.reserved,
      available,
      isOvercommitted,
      contributions: Object.freeze([...data.contributions])
    };
    totalCapacity += data.capacity;
    totalCommitted += data.committed;
    totalReserved += data.reserved;
    totalAvailable += available;
  }
  return {
    types: Object.freeze(typesRecord),
    totalCapacity,
    totalCommitted,
    totalReserved,
    totalAvailable,
    isAnyOvercommitted,
    warnings: Object.freeze(warnings)
  };
}

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
function addPeopleIntegrityIssues(record, domainId, issues) {
  const config = record.definition?.capabilities?.config;
  if (!config || typeof config !== "object") return;
  const rawPeople = config["domain-manager:people"];
  if (rawPeople === void 0 || rawPeople === null) return;
  const validation = validateDomainPeopleData(rawPeople);
  if (!validation.ok) {
    issues.push(issue(
      validation.error.code,
      "error",
      `People subsystem data corruption: ${validation.error.message}`,
      domainId,
      validation.error.details
    ));
    return;
  }
  const people = validation.value;
  const notableIds = new Set(people.notables.map((n) => n.id));
  const groupIds = new Set(people.operationalGroups.map((g) => g.id));
  const popGroupIds = new Set(people.populationGroups.map((pg) => pg.id));
  for (const n of people.notables) {
    if (n.type === "actor") {
      if (typeof n.actorUuid !== "string" || !n.actorUuid.startsWith("Actor.")) {
        issues.push(issue(
          "DM_PEOPLE_INVALID_ACTOR_REF",
          "error",
          `Notable '${n.id}' has invalid Actor reference '${n.actorUuid}'`,
          domainId,
          { notableId: n.id, actorUuid: n.actorUuid }
        ));
      }
    }
  }
  for (const r of people.roles) {
    for (const occupantId of r.occupants) {
      if (!notableIds.has(occupantId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_NOTABLE_REF",
          "error",
          `Role '${r.id}' references non-existent notable '${occupantId}'`,
          domainId,
          { roleId: r.id, notableId: occupantId }
        ));
      }
    }
    if (r.scope === "operational-group" && r.operationalGroupId) {
      if (!groupIds.has(r.operationalGroupId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_GROUP_REF",
          "error",
          `Group role '${r.id}' references non-existent operational group '${r.operationalGroupId}'`,
          domainId,
          { roleId: r.id, operationalGroupId: r.operationalGroupId }
        ));
      }
    }
  }
  for (const g of people.operationalGroups) {
    for (const memberId of g.members) {
      if (!notableIds.has(memberId)) {
        issues.push(issue(
          "DM_PEOPLE_DANGLING_NOTABLE_REF",
          "error",
          `Operational group '${g.id}' references non-existent notable '${memberId}'`,
          domainId,
          { groupId: g.id, notableId: memberId }
        ));
      }
    }
    if (g.populationGroupId && !popGroupIds.has(g.populationGroupId)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_POPULATION_GROUP_REF",
        "error",
        `Operational group '${g.id}' references non-existent population group '${g.populationGroupId}'`,
        domainId,
        { groupId: g.id, populationGroupId: g.populationGroupId }
      ));
    }
  }
  for (const a of people.assignments) {
    if (a.sourceRef.startsWith("opg_") && !groupIds.has(a.sourceRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Assignment '${a.id}' references non-existent operational group '${a.sourceRef}'`,
        domainId,
        { assignmentId: a.id, sourceRef: a.sourceRef }
      ));
    } else if (a.sourceRef.startsWith("pop_") && !popGroupIds.has(a.sourceRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Assignment '${a.id}' references non-existent population group '${a.sourceRef}'`,
        domainId,
        { assignmentId: a.id, sourceRef: a.sourceRef }
      ));
    }
  }
  for (const resv of people.reservations) {
    if (resv.sourceRef.startsWith("opg_") && !groupIds.has(resv.sourceRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Reservation '${resv.id}' references non-existent operational group '${resv.sourceRef}'`,
        domainId,
        { reservationId: resv.id, sourceRef: resv.sourceRef }
      ));
    } else if (resv.sourceRef.startsWith("pop_") && !popGroupIds.has(resv.sourceRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_SOURCE_REF",
        "warning",
        `Reservation '${resv.id}' references non-existent population group '${resv.sourceRef}'`,
        domainId,
        { reservationId: resv.id, sourceRef: resv.sourceRef }
      ));
    }
  }
  const knownRoleDefIds = new Set(DEFAULT_ROLE_DEFINITIONS.map((d) => d.id));
  for (const r of people.roles) {
    if (!knownRoleDefIds.has(r.definitionId) && !r.definitionId.startsWith("custom:")) {
      issues.push(issue(
        "DM_PEOPLE_UNKNOWN_ROLE_DEFINITION",
        "warning",
        `Role '${r.id}' uses unrecognized definition '${r.definitionId}'`,
        domainId,
        { roleId: r.id, definitionId: r.definitionId }
      ));
    }
  }
  const knownGroupDefIds = new Set(DEFAULT_OPERATIONAL_GROUP_DEFINITIONS.map((d) => d.id));
  for (const g of people.operationalGroups) {
    if (!knownGroupDefIds.has(g.definitionId) && !g.definitionId.startsWith("custom:")) {
      issues.push(issue(
        "DM_PEOPLE_UNKNOWN_GROUP_DEFINITION",
        "warning",
        `Operational group '${g.id}' uses unrecognized definition '${g.definitionId}'`,
        domainId,
        { groupId: g.id, definitionId: g.definitionId }
      ));
    }
  }
  for (const g of people.operationalGroups) {
    if (g.membershipMode === "explicit" && g.size !== g.members.length) {
      issues.push(issue(
        "DM_PEOPLE_EXPLICIT_MEMBERSHIP_MISMATCH",
        "warning",
        `Explicit operational group '${g.id}' (${g.name}) size (${g.size}) does not match member count (${g.members.length})`,
        domainId,
        { groupId: g.id, size: g.size, memberCount: g.members.length }
      ));
    }
  }
  for (const a of people.assignments) {
    if (!defaultAssignmentTargetRegistry.isValidTarget(a.targetRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_TARGET_REF",
        "warning",
        `Assignment '${a.id}' references unrecognized target '${a.targetRef}'`,
        domainId,
        { assignmentId: a.id, targetRef: a.targetRef }
      ));
    }
  }
  for (const resv of people.reservations) {
    if (!defaultAssignmentTargetRegistry.isValidTarget(resv.targetRef)) {
      issues.push(issue(
        "DM_PEOPLE_DANGLING_TARGET_REF",
        "warning",
        `Reservation '${resv.id}' references unrecognized target '${resv.targetRef}'`,
        domainId,
        { reservationId: resv.id, targetRef: resv.targetRef }
      ));
    }
  }
  if (people.population.mode === "sumGroups") {
    const hasIndeterminate = people.populationGroups.length === 0 || people.populationGroups.some(
      (pg) => pg.count === null || pg.precision === "unknown"
    );
    if (hasIndeterminate) {
      issues.push(issue(
        "DM_PEOPLE_INDETERMINATE_SUM_GROUPS",
        "warning",
        "Population sumGroups mode contains groups with indeterminate or unknown counts",
        domainId,
        { groupCount: people.populationGroups.length }
      ));
    }
  }
  const wfReport = calculateWorkforce(people);
  if (wfReport.isAnyOvercommitted) {
    issues.push(issue(
      "DM_PEOPLE_WORKFORCE_OVERCOMMIT",
      "warning",
      "One or more workforce types are overcommitted in the domain",
      domainId,
      { warnings: wfReport.warnings }
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
  addPeopleIntegrityIssues(record, document.id, issues);
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
  const ownership = decoded.value.ownership ?? document.ownership;
  return ok({
    id: document.id,
    uuid: document.uuid,
    name: decoded.value.name,
    record: decoded.value.record,
    ...ownership !== void 0 ? { ownership } : {}
  });
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
      const created = await this.store.create({
        name: normalizedInput.name,
        flags: { [DOMAIN_FLAG_NAMESPACE]: encodeDomainRecord(normalizedInput.record) },
        ...input.ownership !== void 0 ? { ownership: input.ownership } : {}
      });
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

// src/commands/command-envelope.ts
var COMMAND_CONTRACT_VERSION_V1 = 1;
function createCommandId() {
  return createOpaqueId("cmd");
}
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
function createTransactionalHandler(coordinator, definition) {
  const handler = async (context) => {
    const coordRes = await coordinator.execute(context, definition);
    if (!coordRes.ok) return err(coordRes.error);
    const receipt = coordRes.value;
    if (receipt.status === "rejected") {
      return err(
        receipt.error ?? {
          code: "DM_TRANSACTION_REJECTED",
          category: "internal",
          message: "Transaction execution rejected"
        }
      );
    }
    return ok(receipt.result);
  };
  handler.__isTransactionalWrapped = true;
  return handler;
}
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
      const permResult = await registration.permissionValidator(context);
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
              status: receipt.status === "rejected" ? "rejected" : "executed",
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
    } catch (err3) {
      finalReceipt = {
        commandId: command.commandId,
        status: "rejected",
        error: createPublicError({
          code: "DM_COMMAND_EXECUTION_FAILED",
          category: "internal",
          message: err3 instanceof Error ? err3.message : "Unexpected command execution error"
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
   * Universal command execution entrypoint for all clients and UI.
   *
   * If running on the Primary Authority host, executes directly via executeLocal.
   * If running on a remote client (e.g. Player), transmits to the Primary Authority via transport.send().
   */
  async execute(command, options) {
    if (this.#authorityService.isCurrentUser()) {
      return this.executeLocal(command, { type: "user" });
    }
    if (!this.#transport) {
      return err(
        createPublicError({
          code: "DM_TRANSPORT_NOT_CONFIGURED",
          category: "internal",
          message: "No transport configured to transmit command to Primary Authority"
        })
      );
    }
    return this.#transport.send(command, options);
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
    const authorityUserId = this.#authorityService.getStatus().authorityUserId ?? null;
    const inboundContext = {
      senderUserId: source.type === "user" ? authorityUserId : null,
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
function isSocketRequestPacket(packet) {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet;
  const sender = p.declaredSenderUserId ?? p.senderUserId;
  return p.protocol === "dm-command-v1" && p.kind === "DM_CMD_REQUEST" && typeof p.correlationId === "string" && p.correlationId.trim().length > 0 && typeof sender === "string" && sender.trim().length > 0 && typeof p.command === "object" && p.command !== null;
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
  constructor(options) {
    this.#runtime = options.runtime ?? resolveFoundryRuntime();
    this.#authorityService = options.authorityService;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 1e4;
    this.#senderResolver = options.senderResolver;
    this.#socketlib = options.socketlib ?? resolveSocketlib() ?? null;
    this.#initSocketlib();
  }
  get isAvailable() {
    if (this.#authorityService.isCurrentUser()) {
      return true;
    }
    return Boolean(this.#socketlib) && this.#authorityService.getStatus().available;
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
    this.#inboundHandler = null;
    this.#statusQueryHandler = null;
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
    return err(
      createPublicError({
        code: "DM_TRANSPORT_UNAVAILABLE",
        category: "busy",
        message: "Remote command execution requires Socketlib, which is not available"
      })
    );
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
    return err(
      createPublicError({
        code: "DM_TRANSPORT_UNAVAILABLE",
        category: "busy",
        message: "Remote status query requires Socketlib, which is not available"
      })
    );
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

// src/people/commands/people-permissions.ts
var activeControllerPolicies = /* @__PURE__ */ new Set();
function registerDomainControllerPolicy(policy) {
  activeControllerPolicies.add(policy);
  return () => {
    activeControllerPolicies.delete(policy);
  };
}
function clearDomainControllerPolicies() {
  activeControllerPolicies.clear();
}
async function validatePeopleCommandPermission(ctx, domains, domainUuidExtractor, options) {
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }
  const gameUser = globalThis.game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }
  const rawDomainUuid = (domainUuidExtractor ? domainUuidExtractor(ctx.command.payload) : void 0) ?? ctx.command.payload?.domainUuid ?? ctx.command.payload?.id;
  if (typeof rawDomainUuid !== "string" || rawDomainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: domain context required to verify authorization"
      })
    );
  }
  const cleanId = rawDomainUuid.startsWith("JournalEntry.") ? rawDomainUuid.slice("JournalEntry.".length) : rawDomainUuid;
  const docRes = await domains.read(cleanId);
  if (!docRes.ok) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: unable to resolve target domain authorization"
      })
    );
  }
  const doc = docRes.value;
  const record = doc.record;
  const docOwnership = doc.ownership ?? doc.doc?.ownership ?? doc.flags?.ownership ?? globalThis.game?.journal?.get?.(cleanId)?.ownership;
  if (docOwnership) {
    const userOwnership = docOwnership[ctx.senderUserId];
    if (userOwnership >= 3 || userOwnership === "owner" || userOwnership === 3) {
      return ok(true);
    }
  }
  const journalDoc = globalThis.game?.journal?.get?.(cleanId);
  if (journalDoc && typeof journalDoc.testUserPermission === "function") {
    const hasOwnerPermission = journalDoc.testUserPermission(
      gameUser ?? { id: ctx.senderUserId },
      3
    );
    if (hasOwnerPermission) {
      return ok(true);
    }
  }
  if (options?.controllerPolicy) {
    const policyResult = await options.controllerPolicy(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (policyResult) {
      return ok(true);
    }
  }
  for (const policy of activeControllerPolicies) {
    const policyResult = await policy(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (policyResult) {
      return ok(true);
    }
  }
  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: `User '${ctx.senderUserId}' is not authorized to manage people in domain '${cleanId}'`
    })
  );
}

// src/people/commands/population-commands.ts
function resolveDomainId(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function registerPopulationCommandHandlers(registry, coordinator, domains) {
  const setPopulationMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const popValidation = validatePopulationState(ctx.command.payload.population);
      if (!popValidation.ok) {
        return popValidation;
      }
      const updatedPeople = {
        ...currentPeople,
        population: popValidation.value
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Set population on domain '${domainDoc.name}' (${domainDoc.uuid}) to mode '${popValidation.value.mode}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: targetDoc,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated population for domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:set-population",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates population state for a domain",
    mutationDefinition: setPopulationMutation,
    handler: createTransactionalHandler(coordinator, setPopulationMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      const val = validatePopulationState(p.population);
      if (!val.ok) return val;
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const createGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const groupInput = ctx.command.payload.group;
      const newGroupId = createOpaqueId("pop");
      const groupCandidate = {
        id: newGroupId,
        name: groupInput.name,
        count: groupInput.count,
        precision: groupInput.precision,
        includedInTotal: groupInput.includedInTotal,
        visibility: groupInput.visibility,
        workforceContributions: groupInput.workforceContributions,
        tags: groupInput.tags ?? [],
        notes: groupInput.notes
      };
      const groupValidation = validatePopulationGroup(groupCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }
      const updatedGroups = Object.freeze([...currentPeople.populationGroups, groupValidation.value]);
      const updatedPeople = {
        ...currentPeople,
        populationGroups: updatedGroups
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Create population group '${groupValidation.value.name}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdGroup = people.populationGroups[people.populationGroups.length - 1];
      return ok({
        result: createdGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created population group '${createdGroup.name}' (${createdGroup.id})`
      });
    }
  };
  registry.register({
    type: "people:create-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a population group in a domain",
    mutationDefinition: createGroupMutation,
    handler: createTransactionalHandler(coordinator, createGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.group || typeof p.group !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "group is required"
          })
        );
      }
      const g = p.group;
      if (typeof g.name !== "string" || g.name.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "group.name must be a non-empty string"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const updateGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId, patch } = ctx.command.payload;
      const existingIndex = currentPeople.populationGroups.findIndex((g) => g.id === groupId);
      if (existingIndex === -1) {
        return err(
          createPublicError({
            code: "DM_POPULATION_GROUP_NOT_FOUND",
            category: "not-found",
            message: `PopulationGroup '${groupId}' not found`
          })
        );
      }
      const existing = currentPeople.populationGroups[existingIndex];
      const mergedCandidate = {
        id: existing.id,
        name: patch.name !== void 0 ? patch.name : existing.name,
        count: patch.count !== void 0 ? patch.count : existing.count,
        precision: patch.precision !== void 0 ? patch.precision : existing.precision,
        includedInTotal: patch.includedInTotal !== void 0 ? patch.includedInTotal : existing.includedInTotal,
        visibility: patch.visibility !== void 0 ? patch.visibility : existing.visibility,
        workforceContributions: patch.workforceContributions !== void 0 ? patch.workforceContributions : existing.workforceContributions,
        tags: patch.tags !== void 0 ? patch.tags : existing.tags,
        notes: patch.notes !== void 0 ? patch.notes : existing.notes
      };
      const groupValidation = validatePopulationGroup(mergedCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }
      const updatedGroups = [...currentPeople.populationGroups];
      updatedGroups[existingIndex] = groupValidation.value;
      const updatedPeople = {
        ...currentPeople,
        populationGroups: Object.freeze(updatedGroups)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { groupId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Update population group '${groupValidation.value.name}' (${groupId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const targetGroupId = plan.customData?.groupId;
      const updatedGroup = people.populationGroups.find((g) => g.id === targetGroupId) ?? people.populationGroups[0];
      return ok({
        result: updatedGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated population group in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:update-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates a population group in a domain",
    mutationDefinition: updateGroupMutation,
    handler: createTransactionalHandler(coordinator, updateGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "pop")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (pop_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const deleteGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId } = ctx.command.payload;
      const existing = currentPeople.populationGroups.find((g) => g.id === groupId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_POPULATION_GROUP_NOT_FOUND",
            category: "not-found",
            message: `PopulationGroup '${groupId}' not found`
          })
        );
      }
      const updatedGroups = currentPeople.populationGroups.filter((g) => g.id !== groupId);
      const updatedPeople = {
        ...currentPeople,
        populationGroups: Object.freeze(updatedGroups)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Delete population group '${existing.name}' (${groupId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { deletedGroupId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted population group in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:delete-population-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a population group in a domain",
    mutationDefinition: deleteGroupMutation,
    handler: createTransactionalHandler(coordinator, deleteGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "pop")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (pop_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

// src/people/commands/notable-commands.ts
function resolveDomainId2(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function registerNotableCommandHandlers(registry, coordinator, domains) {
  const createNotableMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId2(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId2(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const notableInput = ctx.command.payload.notable;
      const newNotableId = createOpaqueId("not");
      const candidate = {
        id: newNotableId,
        ...notableInput
      };
      const notableValidation = validateNotable(candidate);
      if (!notableValidation.ok) {
        return notableValidation;
      }
      const newNotable = notableValidation.value;
      if (newNotable.type === "actor") {
        const alreadyExists = currentPeople.notables.some(
          (n) => n.type === "actor" && n.actorUuid === newNotable.actorUuid
        );
        if (alreadyExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_DUPLICATE_ACTOR",
              category: "validation",
              message: `Actor '${newNotable.actorUuid}' is already linked to a Notable in domain '${domainDoc.name}'`
            })
          );
        }
      }
      const updatedNotables = Object.freeze([...currentPeople.notables, newNotable]);
      const updatedPeople = {
        ...currentPeople,
        notables: updatedNotables
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Create notable '${newNotable.type === "inline" ? newNotable.name : newNotable.name ?? newNotable.actorUuid}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdNotable = people.notables[people.notables.length - 1];
      return ok({
        result: createdNotable,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created notable in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:create-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a notable in a domain",
    mutationDefinition: createNotableMutation,
    handler: createTransactionalHandler(coordinator, createNotableMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.notable || typeof p.notable !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "notable is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const updateNotableMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId2(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId2(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { notableId, patch } = ctx.command.payload;
      const existingIndex = currentPeople.notables.findIndex((n) => n.id === notableId);
      if (existingIndex === -1) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const existing = currentPeople.notables[existingIndex];
      let candidate;
      if (patch.convertToActorUuid) {
        if (!isActorUuid(patch.convertToActorUuid)) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_INVALID_ACTOR",
              category: "validation",
              message: `Invalid Foundry Actor UUID: '${patch.convertToActorUuid}'`
            })
          );
        }
        const alreadyLinked = currentPeople.notables.some(
          (n) => n.id !== notableId && n.type === "actor" && n.actorUuid === patch.convertToActorUuid
        );
        if (alreadyLinked) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_DUPLICATE_ACTOR",
              category: "validation",
              message: `Actor '${patch.convertToActorUuid}' is already linked to another Notable in this domain`
            })
          );
        }
        candidate = {
          id: existing.id,
          type: "actor",
          actorUuid: patch.convertToActorUuid,
          name: patch.name !== void 0 ? patch.name : existing.name,
          description: patch.description !== void 0 ? patch.description : existing.description,
          tags: patch.tags !== void 0 ? patch.tags : existing.tags,
          visibility: patch.visibility !== void 0 ? patch.visibility : existing.visibility
        };
      } else if (existing.type === "actor") {
        candidate = {
          id: existing.id,
          type: "actor",
          actorUuid: existing.actorUuid,
          name: patch.name !== void 0 ? patch.name : existing.name,
          description: patch.description !== void 0 ? patch.description : existing.description,
          tags: patch.tags !== void 0 ? patch.tags : existing.tags,
          visibility: patch.visibility !== void 0 ? patch.visibility : existing.visibility
        };
      } else {
        candidate = {
          id: existing.id,
          type: "inline",
          name: patch.name !== void 0 ? patch.name : existing.name,
          portrait: patch.portrait !== void 0 ? patch.portrait : existing.portrait,
          description: patch.description !== void 0 ? patch.description : existing.description,
          tags: patch.tags !== void 0 ? patch.tags : existing.tags,
          visibility: patch.visibility !== void 0 ? patch.visibility : existing.visibility
        };
      }
      const notableValidation = validateNotable(candidate);
      if (!notableValidation.ok) {
        return notableValidation;
      }
      const updatedNotables = [...currentPeople.notables];
      updatedNotables[existingIndex] = notableValidation.value;
      const updatedPeople = {
        ...currentPeople,
        notables: Object.freeze(updatedNotables)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { notableId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Update notable '${notableId}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const targetNotableId = plan.customData?.notableId;
      const updatedNotable = people.notables.find((n) => n.id === targetNotableId) ?? people.notables[0];
      return ok({
        result: updatedNotable,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated notable in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:update-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates a notable in a domain",
    mutationDefinition: updateNotableMutation,
    handler: createTransactionalHandler(coordinator, updateNotableMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      if (!p.patch || typeof p.patch !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "patch is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const deleteNotableMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId2(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId2(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { notableId } = ctx.command.payload;
      const existing = currentPeople.notables.find((n) => n.id === notableId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const assignedRole = currentPeople.roles.find((r) => r.occupants.includes(notableId));
      if (assignedRole) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_ASSIGNED_TO_ROLE",
            category: "conflict",
            message: `Cannot delete notable '${notableId}': currently assigned to role '${assignedRole.customLabel ?? assignedRole.definitionId}' (${assignedRole.id})`
          })
        );
      }
      const updatedNotables = currentPeople.notables.filter((n) => n.id !== notableId);
      const updatedPeople = {
        ...currentPeople,
        notables: Object.freeze(updatedNotables)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Delete notable '${notableId}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { deletedNotableId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted notable in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:delete-notable",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a notable in a domain",
    mutationDefinition: deleteNotableMutation,
    handler: createTransactionalHandler(coordinator, deleteNotableMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

// src/people/commands/role-commands.ts
function resolveDomainId3(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function registerRoleCommandHandlers(registry, coordinator, domains) {
  const createRoleMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId3(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId3(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const roleInput = ctx.command.payload.role;
      const newRoleId = createOpaqueId("role");
      const candidate = {
        id: newRoleId,
        definitionId: roleInput.definitionId,
        customLabel: roleInput.customLabel,
        occupants: roleInput.occupants ?? [],
        visibility: roleInput.visibility ?? "public",
        scope: roleInput.scope,
        operationalGroupId: roleInput.operationalGroupId,
        notes: roleInput.notes,
        tags: roleInput.tags ?? []
      };
      const roleValidation = validateDomainRole(candidate, DEFAULT_ROLE_DEFINITIONS);
      if (!roleValidation.ok) {
        return roleValidation;
      }
      const newRole = roleValidation.value;
      if (newRole.scope === "operational-group" && newRole.operationalGroupId) {
        const opGroup = currentPeople.operationalGroups.find((g) => g.id === newRole.operationalGroupId);
        if (!opGroup) {
          return err(
            createPublicError({
              code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
              category: "not-found",
              message: `OperationalGroup '${newRole.operationalGroupId}' not found in domain '${domainDoc.name}'`
            })
          );
        }
        if (opGroup.lifecycle === "disbanded") {
          return err(
            createPublicError({
              code: "DM_ROLE_GROUP_DISBANDED",
              category: "validation",
              message: `Cannot create role for disbanded operational group '${opGroup.name}'`
            })
          );
        }
        if (opGroup.members && opGroup.members.length > 0) {
          for (const occupantId of newRole.occupants) {
            if (!opGroup.members.includes(occupantId)) {
              return err(
                createPublicError({
                  code: "DM_ROLE_GROUP_MEMBER_REQUIRED",
                  category: "validation",
                  message: `Occupant notable '${occupantId}' is not a member of operational group '${opGroup.name}'`
                })
              );
            }
          }
        }
      }
      for (const occupantId of newRole.occupants) {
        const notableExists = currentPeople.notables.some((n) => n.id === occupantId);
        if (!notableExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_NOT_FOUND",
              category: "not-found",
              message: `Occupant notable '${occupantId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }
      const updatedRoles = Object.freeze([...currentPeople.roles, newRole]);
      const updatedPeople = {
        ...currentPeople,
        roles: updatedRoles
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Create role '${newRole.customLabel ?? newRole.definitionId}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdRole = people.roles[people.roles.length - 1];
      return ok({
        result: createdRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created role in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:create-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a role in a domain",
    mutationDefinition: createRoleMutation,
    handler: createTransactionalHandler(coordinator, createRoleMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.role || typeof p.role !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "role is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const assignRoleMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId3(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId3(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { roleId, notableId } = ctx.command.payload;
      const roleIndex = currentPeople.roles.findIndex((r) => r.id === roleId);
      if (roleIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const notable = currentPeople.notables.find((n) => n.id === notableId);
      if (!notable) {
        return err(
          createPublicError({
            code: "DM_NOTABLE_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const currentRole = currentPeople.roles[roleIndex];
      if (currentRole.scope === "operational-group" && currentRole.operationalGroupId) {
        const opGroup = currentPeople.operationalGroups.find((g) => g.id === currentRole.operationalGroupId);
        if (opGroup) {
          if (opGroup.lifecycle === "disbanded") {
            return err(
              createPublicError({
                code: "DM_ROLE_GROUP_DISBANDED",
                category: "validation",
                message: `Cannot assign notable to role of disbanded operational group '${opGroup.name}'`
              })
            );
          }
          if (opGroup.members && opGroup.members.length > 0 && !opGroup.members.includes(notableId)) {
            return err(
              createPublicError({
                code: "DM_ROLE_GROUP_MEMBER_REQUIRED",
                category: "validation",
                message: `Notable '${notableId}' is not a member of operational group '${opGroup.name}'`
              })
            );
          }
        }
      }
      if (currentRole.occupants.includes(notableId)) {
        return err(
          createPublicError({
            code: "DM_ROLE_DUPLICATE_OCCUPANT",
            category: "validation",
            message: `Notable '${notableId}' is already assigned to role '${currentRole.id}'`
          })
        );
      }
      const definition = DEFAULT_ROLE_DEFINITIONS.find((d) => d.id === currentRole.definitionId);
      if (definition && definition.occupancy.max !== null && currentRole.occupants.length >= definition.occupancy.max) {
        return err(
          createPublicError({
            code: "DM_ROLE_OCCUPANCY_EXCEEDED",
            category: "validation",
            message: `Role '${currentRole.id}' is already at maximum capacity (${definition.occupancy.max})`
          })
        );
      }
      const updatedOccupants = Object.freeze([...currentRole.occupants, notableId]);
      const updatedRole = {
        ...currentRole,
        occupants: updatedOccupants
      };
      const updatedRoles = [...currentPeople.roles];
      updatedRoles[roleIndex] = updatedRole;
      const updatedPeople = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { roleId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Assign notable '${notableId}' to role '${currentRole.id}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const targetRoleId = plan.customData?.roleId;
      const updatedRole = people.roles.find((r) => r.id === targetRoleId) ?? people.roles[0];
      return ok({
        result: updatedRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Assigned occupant to role in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:assign-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively assigns a notable to a role in a domain",
    mutationDefinition: assignRoleMutation,
    handler: createTransactionalHandler(coordinator, assignRoleMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
          })
        );
      }
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const unassignRoleMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId3(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId3(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { roleId, notableId } = ctx.command.payload;
      const roleIndex = currentPeople.roles.findIndex((r) => r.id === roleId);
      if (roleIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const currentRole = currentPeople.roles[roleIndex];
      if (!currentRole.occupants.includes(notableId)) {
        return err(
          createPublicError({
            code: "DM_ROLE_OCCUPANT_NOT_FOUND",
            category: "not-found",
            message: `Notable '${notableId}' is not an occupant of role '${currentRole.id}'`
          })
        );
      }
      const updatedOccupants = Object.freeze(currentRole.occupants.filter((id) => id !== notableId));
      const updatedRole = {
        ...currentRole,
        occupants: updatedOccupants
      };
      const updatedRoles = [...currentPeople.roles];
      updatedRoles[roleIndex] = updatedRole;
      const updatedPeople = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { roleId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Unassign notable '${notableId}' from role '${currentRole.id}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const targetRoleId = plan.customData?.roleId;
      const updatedRole = people.roles.find((r) => r.id === targetRoleId) ?? people.roles[0];
      return ok({
        result: updatedRole,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Unassigned occupant from role in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:unassign-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively unassigns a notable from a role in a domain",
    mutationDefinition: unassignRoleMutation,
    handler: createTransactionalHandler(coordinator, unassignRoleMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
          })
        );
      }
      if (!isOpaqueId(p.notableId, "not")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid notableId (not_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const deleteRoleMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId3(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId3(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { roleId } = ctx.command.payload;
      const existing = currentPeople.roles.find((r) => r.id === roleId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_ROLE_NOT_FOUND",
            category: "not-found",
            message: `Role '${roleId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const updatedRoles = currentPeople.roles.filter((r) => r.id !== roleId);
      const updatedPeople = {
        ...currentPeople,
        roles: Object.freeze(updatedRoles)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Delete role '${existing.customLabel ?? existing.definitionId}' (${roleId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { deletedRoleId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted role in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:delete-role",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes a role in a domain",
    mutationDefinition: deleteRoleMutation,
    handler: createTransactionalHandler(coordinator, deleteRoleMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.roleId, "role")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid roleId (role_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

// src/people/commands/operational-group-commands.ts
function resolveDomainId4(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function registerOperationalGroupCommandHandlers(registry, coordinator, domains) {
  const createOperationalGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId4(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId4(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const groupInput = ctx.command.payload.group;
      const newGroupId = createOpaqueId("opg");
      const candidate = {
        id: newGroupId,
        name: groupInput.name,
        definitionId: groupInput.definitionId,
        membershipMode: groupInput.membershipMode,
        size: groupInput.size,
        members: groupInput.members,
        lifecycle: groupInput.lifecycle,
        visibility: groupInput.visibility,
        populationGroupId: groupInput.populationGroupId,
        notes: groupInput.notes,
        tags: groupInput.tags
      };
      const groupValidation = validateOperationalGroup(candidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }
      const newGroup = groupValidation.value;
      for (const memberId of newGroup.members) {
        const notableExists = currentPeople.notables.some((n) => n.id === memberId);
        if (!notableExists) {
          return err(
            createPublicError({
              code: "DM_NOTABLE_NOT_FOUND",
              category: "not-found",
              message: `Member notable '${memberId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }
      if (newGroup.populationGroupId !== void 0) {
        const popGroupExists = currentPeople.populationGroups.some(
          (pg) => pg.id === newGroup.populationGroupId
        );
        if (!popGroupExists) {
          return err(
            createPublicError({
              code: "DM_POPULATION_GROUP_NOT_FOUND",
              category: "not-found",
              message: `Linked population group '${newGroup.populationGroupId}' does not exist in domain '${domainDoc.name}'`
            })
          );
        }
      }
      const updatedGroups = Object.freeze([...currentPeople.operationalGroups, newGroup]);
      const updatedPeople = {
        ...currentPeople,
        operationalGroups: updatedGroups
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Create operational group '${newGroup.name}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdGroup = people.operationalGroups[people.operationalGroups.length - 1];
      return ok({
        result: createdGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created operational group in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:create-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates an operational group in a domain",
    mutationDefinition: createOperationalGroupMutation,
    handler: createTransactionalHandler(coordinator, createOperationalGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.group || typeof p.group !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "group is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const updateOperationalGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId4(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId4(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId, update } = ctx.command.payload;
      const groupIndex = currentPeople.operationalGroups.findIndex((g) => g.id === groupId);
      if (groupIndex === -1) {
        return err(
          createPublicError({
            code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
            category: "not-found",
            message: `OperationalGroup '${groupId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const existing = currentPeople.operationalGroups[groupIndex];
      const effectiveMode = update.membershipMode !== void 0 ? update.membershipMode : existing.membershipMode;
      const effectiveMembers = update.members !== void 0 ? update.members : existing.members;
      const effectiveSize = update.size !== void 0 ? update.size : effectiveMode === "explicit" ? effectiveMembers.length : existing.size;
      const mergedCandidate = {
        id: existing.id,
        name: update.name !== void 0 ? update.name : existing.name,
        definitionId: existing.definitionId,
        membershipMode: effectiveMode,
        size: effectiveSize,
        members: effectiveMembers,
        lifecycle: update.lifecycle !== void 0 ? update.lifecycle : existing.lifecycle,
        visibility: update.visibility !== void 0 ? update.visibility : existing.visibility,
        populationGroupId: update.populationGroupId === null ? void 0 : update.populationGroupId !== void 0 ? update.populationGroupId : existing.populationGroupId,
        notes: update.notes === null ? void 0 : update.notes !== void 0 ? update.notes : existing.notes,
        tags: update.tags !== void 0 ? update.tags : existing.tags
      };
      const groupValidation = validateOperationalGroup(mergedCandidate);
      if (!groupValidation.ok) {
        return groupValidation;
      }
      const updatedGroup = groupValidation.value;
      if (updatedGroup.membershipMode !== "abstract" && updatedGroup.members.length > 0) {
        for (const notableId of updatedGroup.members) {
          const notableExists = currentPeople.notables.some((n) => n.id === notableId);
          if (!notableExists) {
            return err(
              createPublicError({
                code: "DM_OPERATIONAL_GROUP_NOTABLE_NOT_FOUND",
                category: "not-found",
                message: `Member notable '${notableId}' not found in domain '${domainDoc.name}'`
              })
            );
          }
        }
      }
      if (updatedGroup.populationGroupId) {
        const popGroupExists = currentPeople.populationGroups.some((g) => g.id === updatedGroup.populationGroupId);
        if (!popGroupExists) {
          return err(
            createPublicError({
              code: "DM_OPERATIONAL_GROUP_POP_NOT_FOUND",
              category: "not-found",
              message: `Linked PopulationGroup '${updatedGroup.populationGroupId}' not found in domain '${domainDoc.name}'`
            })
          );
        }
      }
      const updatedGroups = [...currentPeople.operationalGroups];
      updatedGroups[groupIndex] = updatedGroup;
      const updatedPeople = {
        ...currentPeople,
        operationalGroups: Object.freeze(updatedGroups)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        customData: { groupId },
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Update operational group '${updatedGroup.name}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const targetGroupId = plan.customData?.groupId;
      const updatedGroup = people.operationalGroups.find((g) => g.id === targetGroupId) ?? people.operationalGroups[0];
      return ok({
        result: updatedGroup,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Updated operational group in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:update-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates an operational group in a domain",
    mutationDefinition: updateOperationalGroupMutation,
    handler: createTransactionalHandler(coordinator, updateOperationalGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "opg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (opg_*) is required"
          })
        );
      }
      if (!p.update || typeof p.update !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "update is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const deleteOperationalGroupMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId4(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId4(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { groupId } = ctx.command.payload;
      const existing = currentPeople.operationalGroups.find((g) => g.id === groupId);
      if (!existing) {
        return err(
          createPublicError({
            code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
            category: "not-found",
            message: `OperationalGroup '${groupId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const updatedGroups = currentPeople.operationalGroups.filter((g) => g.id !== groupId);
      const updatedPeople = {
        ...currentPeople,
        operationalGroups: Object.freeze(updatedGroups)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Delete operational group '${existing.name}' (${groupId}) in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { deletedGroupId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Deleted operational group in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:delete-operational-group",
    visibility: "public",
    transactional: true,
    description: "Authoritatively deletes an operational group in a domain",
    mutationDefinition: deleteOperationalGroupMutation,
    handler: createTransactionalHandler(coordinator, deleteOperationalGroupMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.groupId, "opg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid groupId (opg_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

// src/people/commands/assignment-commands.ts
function getSourceCapacity(people, sourceRef, workforceTypeId, nowReal = Date.now(), nowWorld) {
  const opGroup = people.operationalGroups?.find((og) => og.id === sourceRef);
  if (opGroup) {
    const baseType = resolveOperationalGroupWorkforceType(opGroup.definitionId);
    const capacity = opGroup.lifecycle === "active" && baseType === workforceTypeId ? opGroup.size : 0;
    const committed = (people.assignments ?? []).filter((a) => a.sourceRef === sourceRef && a.workforceTypeId === workforceTypeId && a.status === "active" && (nowWorld === void 0 || a.endsAtWorld === void 0 || a.endsAtWorld > nowWorld)).reduce((sum, a) => sum + a.amount, 0);
    const reserved = (people.reservations ?? []).filter((r) => r.sourceRef === sourceRef && r.workforceTypeId === workforceTypeId && r.status === "active" && (r.expiresAtReal === void 0 || r.expiresAtReal >= nowReal) && (nowWorld === void 0 || r.expiresAtWorld === void 0 || r.expiresAtWorld > nowWorld)).reduce((sum, r) => sum + r.amount, 0);
    return {
      capacity,
      committed,
      reserved,
      available: capacity - committed - reserved
    };
  }
  const popGroup = people.populationGroups?.find((pg) => pg.id === sourceRef);
  if (popGroup) {
    const contr = (popGroup.workforceContributions ?? []).filter((c) => c.workforceTypeId === workforceTypeId).reduce((sum, c) => sum + c.amount, 0);
    const linkedDeduction = (people.operationalGroups ?? []).filter((og) => og.populationGroupId === popGroup.id && og.lifecycle === "active" && resolveOperationalGroupWorkforceType(og.definitionId) === workforceTypeId).reduce((sum, og) => sum + og.size, 0);
    const capacity = Math.max(0, contr - linkedDeduction);
    const committed = (people.assignments ?? []).filter((a) => a.sourceRef === sourceRef && a.workforceTypeId === workforceTypeId && a.status === "active" && (nowWorld === void 0 || a.endsAtWorld === void 0 || a.endsAtWorld > nowWorld)).reduce((sum, a) => sum + a.amount, 0);
    const reserved = (people.reservations ?? []).filter((r) => r.sourceRef === sourceRef && r.workforceTypeId === workforceTypeId && r.status === "active" && (r.expiresAtReal === void 0 || r.expiresAtReal >= nowReal) && (nowWorld === void 0 || r.expiresAtWorld === void 0 || r.expiresAtWorld > nowWorld)).reduce((sum, r) => sum + r.amount, 0);
    return {
      capacity,
      committed,
      reserved,
      available: capacity - committed - reserved
    };
  }
  if (isOpaqueId(sourceRef, "not")) {
    const notable = people.notables?.find((n) => n.id === sourceRef);
    if (notable) {
      const capacity = 1;
      const committed = (people.assignments ?? []).filter((a) => a.sourceRef === sourceRef && a.workforceTypeId === workforceTypeId && a.status === "active" && (nowWorld === void 0 || a.endsAtWorld === void 0 || a.endsAtWorld > nowWorld)).reduce((sum, a) => sum + a.amount, 0);
      const reserved = (people.reservations ?? []).filter((r) => r.sourceRef === sourceRef && r.workforceTypeId === workforceTypeId && r.status === "active" && (r.expiresAtReal === void 0 || r.expiresAtReal >= nowReal) && (nowWorld === void 0 || r.expiresAtWorld === void 0 || r.expiresAtWorld > nowWorld)).reduce((sum, r) => sum + r.amount, 0);
      return {
        capacity,
        committed,
        reserved,
        available: capacity - committed - reserved
      };
    }
  }
  return null;
}
function resolveDomainId5(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function registerAssignmentCommandHandlers(registry, coordinator, domains) {
  const createAssignmentMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId5(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId5(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const input = ctx.command.payload.assignment;
      const newId = createOpaqueId("asg");
      const candidate = {
        id: newId,
        sourceRef: input.sourceRef,
        targetRef: input.targetRef,
        workforceTypeId: input.workforceTypeId,
        amount: input.amount,
        status: "active",
        visibility: input.visibility,
        startedAtWorld: input.startedAtWorld,
        endsAtWorld: input.endsAtWorld,
        notes: input.notes
      };
      const asgValidation = validateAssignment(candidate, { validateTarget: true });
      if (!asgValidation.ok) {
        return asgValidation;
      }
      const newAsg = asgValidation.value;
      const sourceCap = getSourceCapacity(
        currentPeople,
        newAsg.sourceRef,
        newAsg.workforceTypeId,
        Date.now(),
        newAsg.startedAtWorld
      );
      if (sourceCap === null) {
        return err(
          createPublicError({
            code: "DM_PEOPLE_SOURCE_NOT_FOUND",
            category: "not-found",
            message: `Source '${newAsg.sourceRef}' does not exist in domain '${domainDoc.name}'`
          })
        );
      }
      if (!ctx.command.payload.allowOvercommit) {
        if (sourceCap.available < newAsg.amount) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "validation",
              message: `Source '${newAsg.sourceRef}' does not have enough available '${newAsg.workforceTypeId}' workforce: available ${sourceCap.available} < requested ${newAsg.amount}`
            })
          );
        }
        const candidatePeople = {
          ...currentPeople,
          assignments: Object.freeze([...currentPeople.assignments, newAsg])
        };
        const wfReport = calculateWorkforce(candidatePeople);
        const wfTypeStat = wfReport.types[newAsg.workforceTypeId];
        if (wfTypeStat && wfTypeStat.isOvercommitted) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "validation",
              message: `Workforce type '${newAsg.workforceTypeId}' would be overcommitted: available ${wfTypeStat.available} < 0`
            })
          );
        }
      }
      const updatedAssignments = Object.freeze([...currentPeople.assignments, newAsg]);
      const updatedPeople = {
        ...currentPeople,
        assignments: updatedAssignments
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Assign ${newAsg.amount} of '${newAsg.workforceTypeId}' from '${newAsg.sourceRef}' to '${newAsg.targetRef}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdAsg = people.assignments[people.assignments.length - 1];
      return ok({
        result: createdAsg,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Assigned workforce in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:create-assignment",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates an active workforce assignment",
    mutationDefinition: createAssignmentMutation,
    handler: createTransactionalHandler(coordinator, createAssignmentMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.assignment || typeof p.assignment !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "assignment object is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const cancelAssignmentMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId5(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId5(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { assignmentId } = ctx.command.payload;
      const asgIndex = currentPeople.assignments.findIndex((a) => a.id === assignmentId);
      if (asgIndex === -1) {
        return err(
          createPublicError({
            code: "DM_ASSIGNMENT_NOT_FOUND",
            category: "not-found",
            message: `Assignment '${assignmentId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const updatedAssignments = currentPeople.assignments.filter((a) => a.id !== assignmentId);
      const updatedPeople = {
        ...currentPeople,
        assignments: Object.freeze(updatedAssignments)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Cancel assignment '${assignmentId}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { cancelledAssignmentId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Cancelled assignment in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:cancel-assignment",
    visibility: "public",
    transactional: true,
    description: "Authoritatively cancels an assignment and frees committed workforce",
    mutationDefinition: cancelAssignmentMutation,
    handler: createTransactionalHandler(coordinator, cancelAssignmentMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.assignmentId, "asg")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid assignmentId (asg_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const createReservationMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId5(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId5(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const input = ctx.command.payload.reservation;
      const newId = createOpaqueId("resv");
      const candidate = {
        id: newId,
        sourceRef: input.sourceRef,
        targetRef: input.targetRef,
        workforceTypeId: input.workforceTypeId,
        amount: input.amount,
        status: "active",
        correlationId: input.correlationId,
        visibility: input.visibility,
        expiresAtReal: input.expiresAtReal,
        expiresAtWorld: input.expiresAtWorld,
        notes: input.notes
      };
      const resvValidation = validateReservation(candidate, { validateTarget: true });
      if (!resvValidation.ok) {
        return resvValidation;
      }
      const newResv = resvValidation.value;
      const sourceCap = getSourceCapacity(
        currentPeople,
        newResv.sourceRef,
        newResv.workforceTypeId,
        Date.now(),
        void 0
      );
      if (sourceCap === null) {
        return err(
          createPublicError({
            code: "DM_PEOPLE_SOURCE_NOT_FOUND",
            category: "not-found",
            message: `Source '${newResv.sourceRef}' does not exist in domain '${domainDoc.name}'`
          })
        );
      }
      const updatedReservations = Object.freeze([...currentPeople.reservations ?? [], newResv]);
      const provisionalPeople = {
        ...currentPeople,
        reservations: updatedReservations
      };
      if (!ctx.command.payload.allowOvercommit) {
        if (sourceCap.available < newResv.amount) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "conflict",
              message: `Source '${newResv.sourceRef}' does not have enough available '${newResv.workforceTypeId}' workforce: available ${sourceCap.available} < requested ${newResv.amount}`
            })
          );
        }
        const report = calculateWorkforce(provisionalPeople);
        const typeRes = report.types[newResv.workforceTypeId];
        if (typeRes && typeRes.available < 0) {
          return err(
            createPublicError({
              code: "DM_WORKFORCE_OVERCOMMIT",
              category: "conflict",
              message: `Reservation requires ${newResv.amount} of '${newResv.workforceTypeId}', but only ${typeRes.capacity - typeRes.committed - (typeRes.reserved - newResv.amount)} is available`
            })
          );
        }
      }
      const updatedRecord = withDomainPeopleData(domainDoc.record, provisionalPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Reserve ${newResv.amount} workforce (${newResv.workforceTypeId}) for '${newResv.targetRef}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      const people = getDomainPeopleData(targetDoc.record);
      const createdResv = people.reservations[people.reservations.length - 1];
      return ok({
        result: createdResv,
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Created workforce reservation in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:create-reservation",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a workforce reservation",
    mutationDefinition: createReservationMutation,
    handler: createTransactionalHandler(coordinator, createReservationMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.reservation || typeof p.reservation !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservation is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
  const releaseReservationMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId5(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId5(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { reservationId } = ctx.command.payload;
      const resvIndex = currentPeople.reservations.findIndex((r) => r.id === reservationId);
      if (resvIndex === -1) {
        return err(
          createPublicError({
            code: "DM_RESERVATION_NOT_FOUND",
            category: "not-found",
            message: `Reservation '${reservationId}' not found in domain '${domainDoc.name}'`
          })
        );
      }
      const updatedReservations = currentPeople.reservations.filter((r) => r.id !== reservationId);
      const updatedPeople = {
        ...currentPeople,
        reservations: Object.freeze(updatedReservations)
      };
      const updatedRecord = withDomainPeopleData(domainDoc.record, updatedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Release reservation '${reservationId}' in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return err(
          createPublicError({
            code: "DM_INVALID_MUTATION_PLAN",
            category: "validation",
            message: "Missing document in mutation plan writeSet"
          })
        );
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: { releasedReservationId: plan.commandId },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary: `Released reservation in domain '${targetDoc.name}'`
      });
    }
  };
  registry.register({
    type: "people:release-reservation",
    visibility: "public",
    transactional: true,
    description: "Authoritatively releases a reservation and frees reserved workforce",
    mutationDefinition: releaseReservationMutation,
    handler: createTransactionalHandler(coordinator, releaseReservationMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isOpaqueId(p.reservationId, "resv")) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Valid reservationId (resv_*) is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: (ctx) => validatePeopleCommandPermission(ctx, domains)
  });
}

// src/people/commands/repair-commands.ts
function resolveDomainId6(domainUuid) {
  return domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
}
function requireGmOnlyPermission(ctx) {
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }
  const gameUser = globalThis.game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }
  return err(
    createPublicError({
      code: "DM_SECURITY_PERMISSION_DENIED",
      category: "permission",
      message: "Only Game Master or Primary Authority can execute domain repair operations"
    })
  );
}
function registerRepairCommandHandlers(registry, coordinator, domains) {
  const repairMutation = {
    getLockKeys: (ctx) => [`domain:${resolveDomainId6(ctx.command.payload?.domainUuid)}`],
    freshRead: async (ctx) => {
      const readRes = await domains.read(resolveDomainId6(ctx.command.payload.domainUuid));
      if (!readRes.ok) return readRes;
      return ok({
        revision: readRes.value.record.revision,
        state: readRes.value
      });
    },
    buildPlan: async (ctx, freshState) => {
      const domainDoc = freshState.state;
      const currentPeople = getDomainPeopleData(domainDoc.record);
      const { operation } = ctx.command.payload;
      const changes = [];
      let repairedPeople = null;
      let summary = "";
      switch (operation.type) {
        case "relink-notable": {
          const { oldNotableId, newNotableId } = operation;
          let changed = false;
          const updatedRoles = currentPeople.roles.map((r) => {
            if (r.occupants.includes(oldNotableId)) {
              changed = true;
              const newOccupants = r.occupants.map((occ) => occ === oldNotableId ? newNotableId : occ);
              const uniqueOccupants = Object.freeze([...new Set(newOccupants)]);
              changes.push(`Role '${r.id}': relinked occupant '${oldNotableId}' -> '${newNotableId}'`);
              return { ...r, occupants: uniqueOccupants };
            }
            return r;
          });
          const updatedGroups = currentPeople.operationalGroups.map((g) => {
            if (g.members.includes(oldNotableId)) {
              changed = true;
              const newMembers = g.members.map((m) => m === oldNotableId ? newNotableId : m);
              const uniqueMembers = Object.freeze([...new Set(newMembers)]);
              changes.push(`Operational Group '${g.id}': relinked member '${oldNotableId}' -> '${newNotableId}'`);
              return { ...g, members: uniqueMembers };
            }
            return g;
          });
          summary = `Relink notable '${oldNotableId}' -> '${newNotableId}'`;
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              roles: Object.freeze(updatedRoles),
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }
        case "purge-dangling-occupants": {
          const validNotableIds = new Set(currentPeople.notables.map((n) => n.id));
          let changed = false;
          const updatedRoles = currentPeople.roles.map((r) => {
            const validOccupants = r.occupants.filter((occId) => validNotableIds.has(occId));
            if (validOccupants.length !== r.occupants.length) {
              changed = true;
              const purgedCount = r.occupants.length - validOccupants.length;
              changes.push(`Role '${r.id}': purged ${purgedCount} dangling occupant(s)`);
              return { ...r, occupants: Object.freeze(validOccupants) };
            }
            return r;
          });
          const updatedGroups = currentPeople.operationalGroups.map((g) => {
            const validMembers = g.members.filter((mId) => validNotableIds.has(mId));
            if (validMembers.length !== g.members.length) {
              changed = true;
              const purgedCount = g.members.length - validMembers.length;
              changes.push(`Operational Group '${g.id}': purged ${purgedCount} dangling member(s)`);
              const newSize = g.membershipMode === "explicit" ? validMembers.length : g.size;
              return { ...g, members: Object.freeze(validMembers), size: newSize };
            }
            return g;
          });
          summary = "Purge dangling role occupants and group members";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              roles: Object.freeze(updatedRoles),
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }
        case "repair-explicit-group-sizes": {
          let changed = false;
          const updatedGroups = currentPeople.operationalGroups.map((g) => {
            if (g.membershipMode === "explicit" && g.size !== g.members.length) {
              changed = true;
              changes.push(`Operational Group '${g.id}' (${g.name}): aligned size from ${g.size} to ${g.members.length}`);
              return { ...g, size: g.members.length };
            }
            return g;
          });
          summary = "Repair explicit operational group sizes to match member counts";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              operationalGroups: Object.freeze(updatedGroups)
            };
          }
          break;
        }
        case "prune-expired-reservations": {
          const nowReal = operation.nowReal ?? Date.now();
          const nowWorld = operation.nowWorld;
          let changed = false;
          const activeReservations = (currentPeople.reservations ?? []).filter((r) => {
            if (r.status !== "active") return true;
            const realExpired = r.expiresAtReal !== void 0 && r.expiresAtReal < nowReal;
            const worldExpired = nowWorld !== void 0 && r.expiresAtWorld !== void 0 && r.expiresAtWorld <= nowWorld;
            if (realExpired || worldExpired) {
              changed = true;
              changes.push(`Pruned expired reservation '${r.id}' (${r.workforceTypeId}: ${r.amount})`);
              return false;
            }
            return true;
          });
          summary = "Prune expired reservations";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              reservations: Object.freeze(activeReservations)
            };
          }
          break;
        }
        case "prune-ended-assignments": {
          const { nowWorld } = operation;
          let changed = false;
          const updatedAssignments = (currentPeople.assignments ?? []).map((a) => {
            if (a.status === "active" && a.endsAtWorld !== void 0 && a.endsAtWorld <= nowWorld) {
              changed = true;
              changes.push(`Marked assignment '${a.id}' as ended (expired at world time ${a.endsAtWorld})`);
              return { ...a, status: "ended", endedReason: "expired" };
            }
            return a;
          });
          summary = "Prune ended assignments past world time";
          if (changed) {
            repairedPeople = {
              ...currentPeople,
              assignments: Object.freeze(updatedAssignments)
            };
          }
          break;
        }
      }
      if (!repairedPeople) {
        const plan2 = createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${domainDoc.uuid}`],
          writeSet: [],
          summary: `No inconsistencies found for operation: ${summary}`
        });
        return ok(plan2);
      }
      const updatedRecord = withDomainPeopleData(domainDoc.record, repairedPeople);
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: [`domain:${domainDoc.uuid}`],
        writeSet: [
          {
            targetRef: `domain:${domainDoc.uuid}`,
            operationType: "update",
            payload: {
              ...domainDoc,
              record: updatedRecord
            }
          }
        ],
        summary: `Execute repair: ${summary} in domain '${domainDoc.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const summary = plan.summary ?? "Repair operation";
      const targetDoc = plan.writeSet[0]?.payload;
      if (!targetDoc) {
        return ok({
          result: {
            domainUuid: plan.lockKeys[0]?.replace("domain:", "") ?? "",
            repaired: false,
            summary,
            changes: Object.freeze([])
          },
          resultingRevisions: {},
          changed: false,
          summary
        });
      }
      const updateRes = await domains.update(targetDoc);
      if (!updateRes.ok) return err(updateRes.error);
      return ok({
        result: {
          domainUuid: targetDoc.uuid,
          repaired: true,
          summary,
          changes: Object.freeze(
            summary.includes("Relink") || summary.includes("Purge") || summary.includes("Repair") || summary.includes("Prune") ? [summary] : []
          )
        },
        resultingRevisions: { [targetDoc.uuid]: updateRes.value.revision },
        changed: true,
        summary
      });
    }
  };
  registry.register({
    type: "people:repair",
    visibility: "public",
    transactional: true,
    description: "Authoritatively executes domain repair operations via transactional mutation pipeline",
    mutationDefinition: repairMutation,
    handler: createTransactionalHandler(coordinator, repairMutation),
    schemaValidator: (payload) => {
      if (!payload || typeof payload !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "Payload must be an object"
          })
        );
      }
      const p = payload;
      if (typeof p.domainUuid !== "string" || !p.domainUuid) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!p.operation || typeof p.operation !== "object") {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "operation is required"
          })
        );
      }
      return ok(payload);
    },
    permissionValidator: requireGmOnlyPermission
  });
}

// src/people/population/population-calculator.ts
function calculatePopulation(state, groups) {
  const warnings = [];
  switch (state.mode) {
    case "manual": {
      return {
        total: state.total,
        precision: state.total === null ? "unknown" : state.precision,
        warnings: Object.freeze(warnings)
      };
    }
    case "sumGroups": {
      const includedGroups = groups.filter((g) => g.includedInTotal);
      if (includedGroups.length === 0) {
        return {
          total: 0,
          precision: "exact",
          warnings: Object.freeze(warnings)
        };
      }
      let hasNull = false;
      let hasNumber = false;
      let sum = 0;
      for (const g of includedGroups) {
        if (g.count === null) {
          hasNull = true;
        } else {
          hasNumber = true;
          sum += g.count;
          if (!Number.isSafeInteger(sum)) {
            warnings.push("DM_POPULATION_SUM_OVERFLOW: Population group sum exceeds maximum safe integer");
          }
        }
      }
      if (hasNull && !hasNumber) {
        return {
          total: null,
          precision: "unknown",
          warnings: Object.freeze(warnings)
        };
      }
      if (hasNull) {
        warnings.push("DM_POPULATION_PARTIAL_UNKNOWN: Some included population groups have unknown counts");
        return {
          total: sum,
          precision: "estimated",
          warnings: Object.freeze(warnings)
        };
      }
      const anyEstimated = includedGroups.some((g) => g.precision === "estimated");
      if (anyEstimated) {
        return {
          total: sum,
          precision: "estimated",
          warnings: Object.freeze(warnings)
        };
      }
      return {
        total: sum,
        precision: "exact",
        warnings: Object.freeze(warnings)
      };
    }
    case "hybrid": {
      const includedGroups = groups.filter((g) => g.includedInTotal);
      let groupsSum = 0;
      let hasNullGroup = false;
      for (const g of includedGroups) {
        if (g.count === null) {
          hasNullGroup = true;
        } else {
          groupsSum += g.count;
        }
      }
      if (hasNullGroup) {
        warnings.push("DM_POPULATION_HYBRID_PARTIAL_UNKNOWN: Some subset groups have unknown counts");
      }
      if (state.total !== null && groupsSum > state.total) {
        warnings.push(
          `DM_POPULATION_GROUPS_EXCEED_TOTAL: Total of included population groups (${groupsSum}) exceeds declared domain population (${state.total})`
        );
      }
      return {
        total: state.total,
        precision: state.total === null ? "unknown" : state.precision,
        warnings: Object.freeze(warnings)
      };
    }
  }
}

// src/aggregation/capability-resolver.ts
var ExplicitDomainCapabilityProvider = class {
  id = "domain-explicit";
  resolveGrants(context) {
    const record = context.domainRecord ?? context.domainDoc?.record;
    if (!record) return [];
    const explicitEnabled = record.definition?.capabilities?.enabled ?? [];
    return explicitEnabled.map((capId) => ({
      capabilityId: capId,
      sourceType: "domain-explicit",
      sourceId: context.domainUuid,
      sourceLabel: "Domain Configuration"
    }));
  }
};
var PeopleRoleCapabilityProvider = class {
  id = "people-role";
  resolveGrants(context) {
    const record = context.domainRecord ?? context.domainDoc?.record;
    const people = context.peopleData ?? (record ? getDomainPeopleData(record) : void 0);
    if (!people) return [];
    const roleDefs = context.roleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
    const grants = [];
    for (const role of people.roles ?? []) {
      const def = roleDefs.find((d) => d.id === role.definitionId);
      if (!def || !Array.isArray(def.grants) || def.grants.length === 0) {
        continue;
      }
      if (role.scope === "operational-group" && role.operationalGroupId) {
        const group = (people.operationalGroups ?? []).find((g) => g.id === role.operationalGroupId);
        if (!group || group.lifecycle === "disbanded") {
          continue;
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
          const explicitCaps = record?.definition?.capabilities?.enabled ?? [];
          const evalResult = evaluateRole(role, roleDefs, people.operationalGroups, explicitCaps);
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
};
var PeopleOperationalGroupCapabilityProvider = class {
  id = "people-operational-group";
  resolveGrants(context) {
    const record = context.domainRecord ?? context.domainDoc?.record;
    const people = context.peopleData ?? (record ? getDomainPeopleData(record) : void 0);
    if (!people) return [];
    const groupDefs = context.operationalGroupDefinitions ?? DEFAULT_OPERATIONAL_GROUP_DEFINITIONS;
    const grants = [];
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
};
var CapabilityResolver = class {
  #providers = [];
  constructor(providers) {
    if (providers) {
      for (const p of providers) {
        this.registerProvider(p);
      }
    }
  }
  registerProvider(provider) {
    if (this.#providers.some((p) => p.id === provider.id)) {
      throw new Error(`Duplicate capability grant provider '${provider.id}'`);
    }
    this.#providers.push(provider);
  }
  resolveEffectiveCapabilities(context) {
    const grantsMap = /* @__PURE__ */ new Map();
    const explicitSet = /* @__PURE__ */ new Set();
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
    const effectiveCapabilities = [];
    const grantsByCapability = {};
    const enabledCapabilityIds = [];
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
};
function createDefaultCapabilityResolver() {
  return new CapabilityResolver([
    new ExplicitDomainCapabilityProvider(),
    new PeopleRoleCapabilityProvider(),
    new PeopleOperationalGroupCapabilityProvider()
  ]);
}

// src/projection/people/people-projection-service.ts
function isEntityVisible(entity, viewer) {
  if (viewer.isGm) {
    return true;
  }
  const vis = entity.visibility ?? "public";
  if (vis === "secret") {
    return false;
  }
  if (vis === "restricted") {
    if (!viewer.allowedRestrictedRefs || !entity.id) {
      return false;
    }
    return viewer.allowedRestrictedRefs.includes(entity.id);
  }
  return true;
}
var PeopleProjectionService = class {
  #roleDefinitions;
  #groupDefinitions;
  constructor(options = {}) {
    this.#roleDefinitions = options.roleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
    this.#groupDefinitions = options.groupDefinitions ?? DEFAULT_OPERATIONAL_GROUP_DEFINITIONS;
  }
  project(domainUuid, rawPeople, viewer, options = {}) {
    if (viewer.isGm) {
      return this.#projectAdministrative(domainUuid, rawPeople, viewer, options);
    }
    return this.#projectViewer(domainUuid, rawPeople, viewer, options);
  }
  #projectAdministrative(domainUuid, rawPeople, viewer, options) {
    const popRes = calculatePopulation(rawPeople.population, rawPeople.populationGroups);
    const workforce = calculateWorkforce(rawPeople, { nowReal: options.nowReal, nowWorld: options.nowWorld });
    const resolver = createDefaultCapabilityResolver();
    const capabilities = resolver.resolveEffectiveCapabilities({
      domainUuid,
      domainRecord: options.domainCapabilities ? {
        schemaVersion: 1,
        definition: {
          name: "Administrative View",
          capabilities: { enabled: [...options.domainCapabilities] }
        }
      } : void 0,
      peopleData: rawPeople,
      roleDefinitions: this.#roleDefinitions,
      operationalGroupDefinitions: this.#groupDefinitions
    });
    const hiddenSecretCounts = {
      populationGroups: rawPeople.populationGroups.filter((g) => g.visibility === "secret").length,
      notables: rawPeople.notables.filter((n) => n.visibility === "secret").length,
      roles: rawPeople.roles.filter((r) => r.visibility === "secret").length,
      operationalGroups: rawPeople.operationalGroups.filter((g) => g.visibility === "secret").length,
      assignments: (rawPeople.assignments ?? []).filter((a) => a.visibility === "secret").length,
      reservations: (rawPeople.reservations ?? []).filter((r) => r.visibility === "secret").length
    };
    return Object.freeze({
      domainUuid,
      viewer,
      population: Object.freeze({
        state: rawPeople.population,
        resolution: popRes
      }),
      populationGroups: rawPeople.populationGroups,
      notables: rawPeople.notables,
      roles: rawPeople.roles,
      operationalGroups: rawPeople.operationalGroups,
      assignments: Object.freeze(rawPeople.assignments ?? []),
      reservations: Object.freeze(rawPeople.reservations ?? []),
      workforce,
      capabilities,
      rawPeopleData: rawPeople,
      hiddenSecretCounts
    });
  }
  #projectViewer(domainUuid, rawPeople, viewer, options) {
    const visiblePopGroups = rawPeople.populationGroups.filter((g) => isEntityVisible(g, viewer));
    const hiddenPopGroupIds = new Set(
      rawPeople.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id)
    );
    const visibleNotables = rawPeople.notables.filter((n) => isEntityVisible(n, viewer));
    const hiddenNotableIds = new Set(
      rawPeople.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );
    const visibleRoles = rawPeople.roles.filter((r) => isEntityVisible(r, viewer)).map((r) => {
      const visibleOccupants = r.occupants.filter((occId) => !hiddenNotableIds.has(occId));
      if (visibleOccupants.length === r.occupants.length) return r;
      return {
        ...r,
        occupants: Object.freeze(visibleOccupants)
      };
    });
    const visibleOpGroups = rawPeople.operationalGroups.filter((g) => isEntityVisible(g, viewer)).map((g) => {
      const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
      if (visibleMembers.length === g.members.length) return g;
      return {
        ...g,
        members: Object.freeze(visibleMembers)
      };
    });
    const hiddenOpGroupIds = new Set(
      rawPeople.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id)
    );
    const visibleAssignments = (rawPeople.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef)) return false;
      if (hiddenOpGroupIds.has(a.sourceRef)) return false;
      if (hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    });
    const visibleReservations = (rawPeople.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef)) return false;
      if (hiddenOpGroupIds.has(r.sourceRef)) return false;
      if (hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    });
    let projectedPopState = rawPeople.population;
    const isPopStateVisible = isEntityVisible({ id: "population", visibility: rawPeople.population.visibility }, viewer);
    if (!isPopStateVisible) {
      projectedPopState = {
        mode: "manual",
        total: null,
        precision: "unknown",
        visibility: rawPeople.population.visibility
      };
    }
    const popRes = calculatePopulation(projectedPopState, visiblePopGroups);
    const projectedPeopleData = {
      schemaVersion: rawPeople.schemaVersion,
      population: projectedPopState,
      populationGroups: Object.freeze(visiblePopGroups),
      notables: Object.freeze(visibleNotables),
      roles: Object.freeze(visibleRoles),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations)
    };
    const workforce = calculateWorkforce(projectedPeopleData, { nowReal: options.nowReal, nowWorld: options.nowWorld });
    const resolver = createDefaultCapabilityResolver();
    const capabilities = resolver.resolveEffectiveCapabilities({
      domainUuid,
      domainRecord: options.domainCapabilities ? {
        schemaVersion: 1,
        definition: {
          name: "Viewer View",
          capabilities: { enabled: [...options.domainCapabilities] }
        }
      } : void 0,
      peopleData: projectedPeopleData,
      roleDefinitions: this.#roleDefinitions,
      operationalGroupDefinitions: this.#groupDefinitions
    });
    return Object.freeze({
      domainUuid,
      viewer,
      population: Object.freeze({
        state: projectedPopState,
        resolution: popRes
      }),
      populationGroups: Object.freeze(visiblePopGroups),
      notables: Object.freeze(visibleNotables),
      roles: Object.freeze(visibleRoles),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations),
      workforce,
      capabilities
    });
  }
};

// src/people/repositories/people-repository.ts
function resolveRepoViewer(options) {
  if (options.viewer) return options.viewer;
  return {
    userId: "repo-caller",
    isGm: options.viewerIsGm ?? false
  };
}
var PeopleRepository = class {
  #domainRepository;
  constructor(domainRepository) {
    this.#domainRepository = domainRepository;
  }
  async getPeopleData(domainUuid) {
    const id = domainUuid.startsWith("JournalEntry.") ? domainUuid.slice("JournalEntry.".length) : domainUuid;
    const domainRes = await this.#domainRepository.read(id);
    if (!domainRes.ok) {
      return domainRes;
    }
    return tryGetDomainPeopleData(domainRes.value.record);
  }
  async getPopulation(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const { population, populationGroups } = peopleRes.value;
    const visibleGroups = populationGroups.filter((g) => isEntityVisible(g, viewer));
    let effectivePopState = population;
    if (!isEntityVisible({ id: "population", visibility: population.visibility }, viewer)) {
      effectivePopState = {
        mode: "manual",
        total: null,
        precision: "unknown",
        visibility: population.visibility
      };
    }
    const resolution = calculatePopulation(effectivePopState, visibleGroups);
    return ok({
      state: effectivePopState,
      resolution
    });
  }
  async getPopulationGroups(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    return ok(peopleRes.value.populationGroups.filter((g) => isEntityVisible(g, viewer)));
  }
  async getPopulationGroup(domainUuid, groupId, options = {}) {
    const groupsRes = await this.getPopulationGroups(domainUuid, options);
    if (!groupsRes.ok) {
      return groupsRes;
    }
    const found = groupsRes.value.find((g) => g.id === groupId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_POPULATION_GROUP_NOT_FOUND",
          category: "not-found",
          message: `PopulationGroup '${groupId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }
  async getNotables(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    return ok(peopleRes.value.notables.filter((n) => isEntityVisible(n, viewer)));
  }
  async getNotable(domainUuid, notableId, options = {}) {
    const notablesRes = await this.getNotables(domainUuid, options);
    if (!notablesRes.ok) {
      return notablesRes;
    }
    const found = notablesRes.value.find((n) => n.id === notableId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_NOT_FOUND",
          category: "not-found",
          message: `Notable '${notableId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }
  async getNotableStatus(domainUuid, notableId, actorResolver, options = {}) {
    const notableRes = await this.getNotable(domainUuid, notableId, options);
    if (!notableRes.ok) {
      return notableRes;
    }
    return ok(resolveNotableStatus(notableRes.value, actorResolver));
  }
  async getRoles(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const hiddenNotableIds = new Set(
      peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );
    const visibleRoles = peopleRes.value.roles.filter((r) => isEntityVisible(r, viewer)).map((r) => {
      const visibleOccupants = r.occupants.filter((occId) => !hiddenNotableIds.has(occId));
      if (visibleOccupants.length === r.occupants.length) return r;
      return {
        ...r,
        occupants: Object.freeze(visibleOccupants)
      };
    });
    return ok(visibleRoles);
  }
  async getRole(domainUuid, roleId, options = {}) {
    const rolesRes = await this.getRoles(domainUuid, options);
    if (!rolesRes.ok) {
      return rolesRes;
    }
    const found = rolesRes.value.find((r) => r.id === roleId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_ROLE_NOT_FOUND",
          category: "not-found",
          message: `Role '${roleId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }
  async getOperationalGroups(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    const hiddenNotableIds = new Set(
      peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id)
    );
    const visibleGroups = peopleRes.value.operationalGroups.filter((g) => isEntityVisible(g, viewer)).map((g) => {
      const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
      if (visibleMembers.length === g.members.length) return g;
      return {
        ...g,
        members: Object.freeze(visibleMembers)
      };
    });
    return ok(visibleGroups);
  }
  async getOperationalGroup(domainUuid, groupId, options = {}) {
    const groupsRes = await this.getOperationalGroups(domainUuid, options);
    if (!groupsRes.ok) {
      return groupsRes;
    }
    const found = groupsRes.value.find((g) => g.id === groupId);
    if (!found) {
      return err(
        createPublicError({
          code: "DM_OPERATIONAL_GROUP_NOT_FOUND",
          category: "not-found",
          message: `OperationalGroup '${groupId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(found);
  }
  async getWorkforce(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const optObj = typeof options === "number" ? { nowReal: options } : options;
    const viewer = resolveRepoViewer(optObj);
    if (viewer.isGm) {
      return ok(calculateWorkforce(peopleRes.value, { nowReal: optObj.nowReal, nowWorld: optObj.nowWorld }));
    }
    const visibleGroups = peopleRes.value.populationGroups.filter((g) => isEntityVisible(g, viewer));
    const hiddenNotableIds = new Set(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const visibleOpGroups = peopleRes.value.operationalGroups.filter((g) => isEntityVisible(g, viewer)).map((g) => {
      const visibleMembers = g.members.filter((mId) => !hiddenNotableIds.has(mId));
      if (visibleMembers.length === g.members.length) return g;
      return { ...g, members: Object.freeze(visibleMembers) };
    });
    const hiddenPopGroupIds = new Set(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const visibleAssignments = (peopleRes.value.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef) || hiddenOpGroupIds.has(a.sourceRef) || hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    });
    const visibleReservations = (peopleRes.value.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef) || hiddenOpGroupIds.has(r.sourceRef) || hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    });
    const projectedPeople = {
      ...peopleRes.value,
      populationGroups: Object.freeze(visibleGroups),
      operationalGroups: Object.freeze(visibleOpGroups),
      assignments: Object.freeze(visibleAssignments),
      reservations: Object.freeze(visibleReservations)
    };
    return ok(calculateWorkforce(projectedPeople, { nowReal: optObj.nowReal, nowWorld: optObj.nowWorld }));
  }
  async getAssignments(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    if (viewer.isGm) {
      return ok(peopleRes.value.assignments ?? []);
    }
    const hiddenNotableIds = new Set(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const hiddenPopGroupIds = new Set(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    return ok((peopleRes.value.assignments ?? []).filter((a) => {
      if (!isEntityVisible(a, viewer)) return false;
      if (hiddenPopGroupIds.has(a.sourceRef) || hiddenOpGroupIds.has(a.sourceRef) || hiddenNotableIds.has(a.sourceRef)) return false;
      return true;
    }));
  }
  async getReservations(domainUuid, options = {}) {
    const peopleRes = await this.getPeopleData(domainUuid);
    if (!peopleRes.ok) {
      return peopleRes;
    }
    const viewer = resolveRepoViewer(options);
    if (viewer.isGm) {
      return ok(peopleRes.value.reservations ?? []);
    }
    const hiddenNotableIds = new Set(peopleRes.value.notables.filter((n) => !isEntityVisible(n, viewer)).map((n) => n.id));
    const hiddenPopGroupIds = new Set(peopleRes.value.populationGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    const hiddenOpGroupIds = new Set(peopleRes.value.operationalGroups.filter((g) => !isEntityVisible(g, viewer)).map((g) => g.id));
    return ok((peopleRes.value.reservations ?? []).filter((r) => {
      if (!isEntityVisible(r, viewer)) return false;
      if (hiddenPopGroupIds.has(r.sourceRef) || hiddenOpGroupIds.has(r.sourceRef) || hiddenNotableIds.has(r.sourceRef)) return false;
      return true;
    }));
  }
};

// src/projection/viewer-identity.ts
var globalCurrentUserProvider = null;
function resolveCurrentViewer(callerSuppliedViewer, customProvider) {
  const provider = customProvider ?? globalCurrentUserProvider ?? (() => {
    const user = globalThis.game?.user;
    if (user) {
      return { id: String(user.id ?? "anonymous"), isGM: Boolean(user.isGM) };
    }
    return null;
  });
  const current = provider();
  if (current) {
    const realIsGm = Boolean(current.isGM ?? current.isGm);
    const realUserId = String(current.id ?? current.userId ?? "anonymous");
    const trustedRestrictedRefs = current.allowedRestrictedRefs;
    if (!realIsGm) {
      return Object.freeze({
        userId: realUserId,
        isGm: false,
        allowedRestrictedRefs: trustedRestrictedRefs ? Object.freeze([...trustedRestrictedRefs]) : Object.freeze([])
      });
    }
    return Object.freeze({
      userId: callerSuppliedViewer?.userId ?? realUserId,
      isGm: callerSuppliedViewer?.isGm ?? true,
      allowedRestrictedRefs: callerSuppliedViewer?.allowedRestrictedRefs ?? trustedRestrictedRefs
    });
  }
  return Object.freeze({
    userId: callerSuppliedViewer?.userId ?? "anonymous",
    isGm: callerSuppliedViewer?.isGm === true,
    allowedRestrictedRefs: callerSuppliedViewer?.allowedRestrictedRefs ? Object.freeze([...callerSuppliedViewer.allowedRestrictedRefs]) : Object.freeze([])
  });
}

// src/aggregation/people-aggregation.ts
var PeopleAggregationService = class {
  #domains;
  constructor(domains) {
    this.#domains = domains;
  }
  queryPeopleAggregate(rootDomainUuid, options = {}) {
    const rootId = rootDomainUuid.startsWith("JournalEntry.") ? rootDomainUuid.slice("JournalEntry.".length) : rootDomainUuid;
    const rootDocRes = this.#domains.read(rootId);
    if (!rootDocRes.ok) {
      return rootDocRes;
    }
    const recursive = options.recursive ?? true;
    const viewer = resolveCurrentViewer(options.viewer);
    const projectionService = new PeopleProjectionService({
      roleDefinitions: options.roleDefinitions,
      groupDefinitions: options.groupDefinitions
    });
    const warnings = [];
    const visitedUuids = /* @__PURE__ */ new Set();
    const domainBreakdown = [];
    const unknownContributors = [];
    let hasEstimated = false;
    let hasUnknown = false;
    let hasNull = false;
    let cycleDetected = false;
    const queue = [
      { doc: rootDocRes.value, depth: 0 }
    ];
    visitedUuids.add(rootDocRes.value.uuid);
    while (queue.length > 0) {
      const current = queue.shift();
      const isRoot = current.depth === 0;
      const people = getDomainPeopleData(current.doc.record);
      const projected = projectionService.project(
        current.doc.uuid,
        people,
        viewer,
        { nowReal: options.nowReal, nowWorld: options.nowWorld }
      );
      const popRes = projected.population.resolution;
      if (popRes.precision === "estimated") hasEstimated = true;
      if (popRes.precision === "unknown" || popRes.total === null) {
        hasUnknown = true;
        unknownContributors.push(current.doc.uuid);
      }
      if (popRes.total === null) hasNull = true;
      const wfCap = {};
      for (const [typeId, res] of Object.entries(projected.workforce.types)) {
        wfCap[typeId] = res.capacity;
      }
      domainBreakdown.push({
        domainUuid: current.doc.uuid,
        domainName: current.doc.name,
        depth: current.depth,
        isRoot,
        population: {
          total: popRes.total,
          precision: popRes.precision
        },
        workforceCapacity: Object.freeze(wfCap),
        notableCount: projected.notables.length,
        roleCount: projected.roles.length,
        operationalGroupCount: projected.operationalGroups.length
      });
      if (isRoot || recursive) {
        const childrenRes = this.#domains.query({ parentDomainUuid: current.doc.uuid });
        if (childrenRes.ok) {
          for (const childDoc of childrenRes.value) {
            if (visitedUuids.has(childDoc.uuid)) {
              cycleDetected = true;
              warnings.push(`Cycle detected involving domain '${childDoc.name}' (${childDoc.uuid})`);
              continue;
            }
            visitedUuids.add(childDoc.uuid);
            queue.push({ doc: childDoc, depth: current.depth + 1 });
          }
        }
      }
    }
    let ownPopulation = null;
    let descendantSum = 0;
    let hasAnyDescendantCount = false;
    const ownWorkforce = {};
    const descendantWorkforce = {};
    const totalWorkforce = {};
    for (const item of domainBreakdown) {
      if (item.isRoot) {
        ownPopulation = item.population.total;
        for (const [typeId, cap] of Object.entries(item.workforceCapacity)) {
          ownWorkforce[typeId] = (ownWorkforce[typeId] ?? 0) + cap;
          totalWorkforce[typeId] = (totalWorkforce[typeId] ?? 0) + cap;
        }
      } else {
        if (item.population.total !== null) {
          descendantSum += item.population.total;
          hasAnyDescendantCount = true;
        }
        for (const [typeId, cap] of Object.entries(item.workforceCapacity)) {
          descendantWorkforce[typeId] = (descendantWorkforce[typeId] ?? 0) + cap;
          totalWorkforce[typeId] = (totalWorkforce[typeId] ?? 0) + cap;
        }
      }
    }
    const descendantPopulation = hasAnyDescendantCount ? descendantSum : domainBreakdown.length > 1 ? 0 : null;
    let totalPopulation = null;
    if (ownPopulation !== null || descendantPopulation !== null) {
      totalPopulation = (ownPopulation ?? 0) + (descendantPopulation ?? 0);
    }
    let precision = "exact";
    if (hasUnknown) {
      precision = "unknown";
    } else if (hasEstimated) {
      precision = "estimated";
    }
    let completeness = "complete";
    if (hasUnknown || hasNull) {
      completeness = totalPopulation !== null && totalPopulation > 0 ? "partial" : "incomplete";
    }
    return ok({
      rootDomainUuid: rootDocRes.value.uuid,
      completeness,
      precision,
      totalPopulation,
      ownPopulation,
      descendantPopulation,
      unknownContributors: Object.freeze(unknownContributors),
      domainBreakdown: Object.freeze(domainBreakdown),
      workforceSummary: {
        ownCapacity: Object.freeze(ownWorkforce),
        descendantCapacity: Object.freeze(descendantWorkforce),
        totalCapacity: Object.freeze(totalWorkforce)
      },
      cycleDetected,
      warnings: Object.freeze(warnings)
    });
  }
};

// src/aggregation/people-grants.ts
function resolvePeopleEffectiveCapabilities(domainInput, roleDefinitions = DEFAULT_ROLE_DEFINITIONS, operationalGroupDefinitions = DEFAULT_OPERATIONAL_GROUP_DEFINITIONS) {
  const record = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const resolver = createDefaultCapabilityResolver();
  return resolver.resolveEffectiveCapabilities({
    domainUuid,
    domainRecord: record,
    roleDefinitions,
    operationalGroupDefinitions
  });
}

// src/ui/domain-patterns/people/people-presenter.ts
function buildPeopleViewModel(domainInput, options) {
  const record = "record" in domainInput ? domainInput.record : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const people = getDomainPeopleData(record);
  const projectionService = new PeopleProjectionService({
    roleDefinitions: options.customRoleDefinitions
  });
  const context = projectionService.project(
    domainUuid,
    people,
    { userId: "viewer", isGm: options.viewerIsGm },
    {
      nowReal: options.nowReal,
      domainCapabilities: record.definition?.capabilities?.enabled
    }
  );
  let formattedTotal;
  if (context.population.resolution.total === null) {
    formattedTotal = "Unknown";
  } else {
    formattedTotal = `${context.population.resolution.total.toLocaleString("en-US")}${context.population.resolution.precision === "estimated" ? " (est.)" : ""}`;
  }
  const notableVMs = context.notables.map((n) => {
    const status = resolveNotableStatus(n, options.actorResolver);
    let badgeClass = "healthy";
    if (status.isBrokenRef) badgeClass = "broken";
    return {
      notable: n,
      status,
      isSecret: n.visibility === "secret",
      badgeClass
    };
  });
  const roleDefs = options.customRoleDefinitions ?? DEFAULT_ROLE_DEFINITIONS;
  const roleVMs = context.roles.map((r) => {
    const evaluation = evaluateRole(r, roleDefs, context.operationalGroups);
    let statusClass = "filled";
    if (evaluation.isVacant) statusClass = "vacant";
    else if (evaluation.isUnderstaffed) statusClass = "understaffed";
    return {
      evaluation,
      isSecret: r.visibility === "secret",
      statusClass
    };
  });
  const opgVMs = context.operationalGroups.map((g) => ({
    group: g,
    isSecret: g.visibility === "secret",
    statusClass: g.lifecycle
  }));
  return {
    domainUuid,
    viewerIsGm: options.viewerIsGm,
    population: {
      state: context.population.state,
      resolution: context.population.resolution,
      formattedTotal
    },
    notables: Object.freeze(notableVMs),
    roles: Object.freeze(roleVMs),
    operationalGroups: Object.freeze(opgVMs),
    workforce: context.workforce,
    capabilities: context.capabilities
  };
}

// src/ui/domain-patterns/people/people-view.ts
function escapeHtml(value) {
  if (value === null || value === void 0) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttribute(value) {
  return escapeHtml(value);
}
function renderPeopleSubsystemHtml(vm) {
  const pop = vm.population;
  const notablesHtml = vm.notables.length === 0 ? `<div class="dm-empty-state">No notables registered.</div>` : `<div class="dm-notables-grid">
        ${vm.notables.map((n) => {
    const portrait = n.notable.type === "inline" ? n.notable.portrait : void 0;
    return `
          <div class="dm-notable-card ${escapeAttribute(n.badgeClass)} ${n.isSecret ? "dm-secret" : ""}" data-notable-id="${escapeAttribute(n.notable.id)}">
            <div class="dm-notable-portrait">
              ${portrait ? `<img src="${escapeAttribute(portrait)}" alt="${escapeAttribute(n.status.resolvedName)}" />` : `<div class="dm-default-avatar"></div>`}
            </div>
            <div class="dm-notable-details">
              <span class="dm-notable-name">${escapeHtml(n.status.resolvedName)}</span>
              <span class="dm-notable-type">${escapeHtml(n.notable.type)}</span>
              ${n.isSecret ? `<span class="dm-badge-secret">Secret</span>` : ""}
            </div>
          </div>
        `;
  }).join("")}
      </div>`;
  const rolesHtml = vm.roles.length === 0 ? `<div class="dm-empty-state">No roles defined.</div>` : `<div class="dm-roles-list">
        ${vm.roles.map((r) => `
          <div class="dm-role-item ${escapeAttribute(r.statusClass)} ${r.isSecret ? "dm-secret" : ""}" data-role-id="${escapeAttribute(r.evaluation.role.id)}">
            <div class="dm-role-header">
              <span class="dm-role-title">${escapeHtml(r.evaluation.effectiveLabel)}</span>
              <span class="dm-role-badge dm-badge-${escapeAttribute(r.statusClass)}">${escapeHtml(r.statusClass)}</span>
              ${r.isSecret ? `<span class="dm-badge-secret">Secret</span>` : ""}
            </div>
            <div class="dm-role-occupants">
              ${r.evaluation.role.occupants.length === 0 ? "<em>Vacant</em>" : `${r.evaluation.role.occupants.length} occupant(s)`}
            </div>
          </div>
        `).join("")}
      </div>`;
  const opgHtml = vm.operationalGroups.length === 0 ? `<div class="dm-empty-state">No operational groups.</div>` : `<div class="dm-opg-list">
        ${vm.operationalGroups.map((g) => `
          <div class="dm-opg-item ${escapeAttribute(g.statusClass)} ${g.isSecret ? "dm-secret" : ""}" data-opg-id="${escapeAttribute(g.group.id)}">
            <span class="dm-opg-name">${escapeHtml(g.group.name)}</span>
            <span class="dm-opg-size">Size: ${g.group.size} (${escapeHtml(g.group.membershipMode)})</span>
            <span class="dm-badge dm-badge-${escapeAttribute(g.statusClass)}">${escapeHtml(g.statusClass)}</span>
          </div>
        `).join("")}
      </div>`;
  const workforceTypes = Object.values(vm.workforce.types);
  const wfHtml = workforceTypes.length === 0 ? `<div class="dm-empty-state">No workforce available.</div>` : `<div class="dm-workforce-grid">
        ${workforceTypes.map((w) => `
          <div class="dm-wf-stat ${w.isOvercommitted ? "dm-overcommitted" : ""}">
            <span class="dm-wf-label">${escapeHtml(w.workforceTypeId)}</span>
            <span class="dm-wf-value">${w.available} / ${w.capacity}</span>
            ${w.isOvercommitted ? `<span class="dm-alert">OVERCOMMIT</span>` : ""}
          </div>
        `).join("")}
      </div>`;
  return `
    <div class="dm-people-subsystem" data-domain-uuid="${escapeAttribute(vm.domainUuid)}">
      <header class="dm-subsystem-header">
        <h2>People & Demographics</h2>
        <div class="dm-population-counter">
          <span class="dm-label">Population:</span>
          <span class="dm-value">${escapeHtml(pop.formattedTotal)}</span>
        </div>
      </header>

      <section class="dm-section dm-notables-section">
        <h3>Notables</h3>
        ${notablesHtml}
      </section>

      <section class="dm-section dm-roles-section">
        <h3>Roles & Offices</h3>
        ${rolesHtml}
      </section>

      <section class="dm-section dm-opg-section">
        <h3>Operational Groups</h3>
        ${opgHtml}
      </section>

      <section class="dm-section dm-workforce-section">
        <h3>Workforce Status</h3>
        ${wfHtml}
      </section>
    </div>
  `;
}

// src/ui/domain-patterns/people/people-app.ts
function makeCommand(type, payload) {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload,
    issuedAtReal: Date.now()
  };
}
var PeopleApplicationController = class {
  #domainUuid;
  #commandBus;
  #peopleApi;
  #domains;
  #viewer;
  #activeTab = "notables";
  #selectedEntity = null;
  #lastViewModel = null;
  constructor(options) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#peopleApi = options.peopleApi;
    this.#domains = options.domains;
    this.#viewer = options.viewer;
  }
  get domainUuid() {
    return this.#domainUuid;
  }
  get activeTab() {
    return this.#activeTab;
  }
  get viewModel() {
    return this.#lastViewModel;
  }
  get selectedEntity() {
    return this.#selectedEntity;
  }
  selectTab(tab) {
    this.#activeTab = tab;
  }
  selectEntity(type, id) {
    this.#selectedEntity = { type, id };
  }
  clearSelection() {
    this.#selectedEntity = null;
  }
  async loadViewModel() {
    const id = this.#domainUuid.startsWith("JournalEntry.") ? this.#domainUuid.slice("JournalEntry.".length) : this.#domainUuid;
    const docRes = await this.#domains.read(id);
    if (!docRes.ok) return docRes;
    const isGm = this.#viewer?.isGm ?? true;
    const vm = this.#peopleApi.buildViewModel(docRes.value, {
      viewerIsGm: isGm
    });
    this.#lastViewModel = vm;
    return ok(vm);
  }
  async #executeCommand(cmd) {
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(
        res.value.error ?? createPublicError({
          code: "DM_COMMAND_REJECTED",
          category: "internal",
          message: "Command was rejected by authority"
        })
      );
    }
    await this.loadViewModel();
    return ok(res.value.result);
  }
  // Action Dispatchers via CommandBus
  async dispatchCreateNotable(payload) {
    const cmd = makeCommand("people:create-notable", {
      domainUuid: this.#domainUuid,
      notable: {
        type: payload.type ?? "inline",
        ...payload.name !== void 0 ? { name: payload.name } : {},
        ...payload.actorUuid !== void 0 ? { actorUuid: payload.actorUuid } : {},
        ...payload.description !== void 0 ? { description: payload.description } : {},
        tags: payload.tags ?? [],
        visibility: payload.visibility ?? "public"
      }
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCreateRole(payload) {
    const cmd = makeCommand("people:create-role", {
      domainUuid: this.#domainUuid,
      role: {
        definitionId: payload.definitionId,
        ...payload.customLabel !== void 0 ? { customLabel: payload.customLabel } : {},
        occupants: payload.occupants ?? [],
        visibility: payload.visibility ?? "public",
        scope: payload.scope ?? "domain",
        ...payload.operationalGroupId !== void 0 ? { operationalGroupId: payload.operationalGroupId } : {},
        ...payload.notes !== void 0 ? { notes: payload.notes } : {},
        tags: payload.tags ?? []
      }
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCreateOperationalGroup(payload) {
    const cmd = makeCommand("people:create-operational-group", {
      domainUuid: this.#domainUuid,
      group: {
        name: payload.name,
        definitionId: payload.definitionId,
        membershipMode: payload.membershipMode ?? "abstract",
        size: payload.size ?? payload.members?.length ?? 1,
        members: payload.members ?? [],
        ...payload.populationGroupId !== void 0 ? { populationGroupId: payload.populationGroupId } : {},
        visibility: payload.visibility ?? "public",
        ...payload.notes !== void 0 ? { notes: payload.notes } : {},
        tags: payload.tags ?? []
      }
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCreateAssignment(payload) {
    const cmd = makeCommand("people:create-assignment", {
      domainUuid: this.#domainUuid,
      assignment: {
        sourceRef: payload.sourceRef,
        targetRef: payload.targetRef,
        workforceTypeId: payload.workforceTypeId,
        amount: payload.amount,
        visibility: payload.visibility ?? "public",
        ...payload.startedAtWorld !== void 0 ? { startedAtWorld: payload.startedAtWorld } : {},
        ...payload.endsAtWorld !== void 0 ? { endsAtWorld: payload.endsAtWorld } : {},
        ...payload.notes !== void 0 ? { notes: payload.notes } : {}
      },
      ...payload.allowOvercommit !== void 0 ? { allowOvercommit: payload.allowOvercommit } : {}
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCancelAssignment(assignmentId) {
    const cmd = makeCommand("people:cancel-assignment", {
      domainUuid: this.#domainUuid,
      assignmentId
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCreateReservation(payload) {
    const cmd = makeCommand("people:create-reservation", {
      domainUuid: this.#domainUuid,
      reservation: {
        sourceRef: payload.sourceRef,
        targetRef: payload.targetRef,
        workforceTypeId: payload.workforceTypeId,
        amount: payload.amount,
        ...payload.correlationId !== void 0 ? { correlationId: payload.correlationId } : {},
        visibility: payload.visibility ?? "public",
        ...payload.expiresAtReal !== void 0 ? { expiresAtReal: payload.expiresAtReal } : {},
        ...payload.expiresAtWorld !== void 0 ? { expiresAtWorld: payload.expiresAtWorld } : {},
        ...payload.notes !== void 0 ? { notes: payload.notes } : {}
      },
      ...payload.allowOvercommit !== void 0 ? { allowOvercommit: payload.allowOvercommit } : {}
    });
    return this.#executeCommand(cmd);
  }
  async dispatchReleaseReservation(reservationId) {
    const cmd = makeCommand("people:release-reservation", {
      domainUuid: this.#domainUuid,
      reservationId
    });
    return this.#executeCommand(cmd);
  }
  // HTML Rendering (Collection + Inspector + Create Modals/Buttons)
  render(vm) {
    this.#lastViewModel = vm;
    const tabsHtml = `
      <nav class="dm-people-tabs" role="tablist">
        <button type="button" class="dm-tab ${this.#activeTab === "notables" ? "active" : ""}" data-action="selectTab" data-tab="notables">
          <i class="fas fa-user-shield"></i> Notables (${vm.notables.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "roles" ? "active" : ""}" data-action="selectTab" data-tab="roles">
          <i class="fas fa-sitemap"></i> Roles (${vm.roles.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "operationalGroups" ? "active" : ""}" data-action="selectTab" data-tab="operationalGroups">
          <i class="fas fa-users-cog"></i> Operational Groups (${vm.operationalGroups.length})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "population" ? "active" : ""}" data-action="selectTab" data-tab="population">
          <i class="fas fa-users"></i> Population (${escapeHtml(vm.population.formattedTotal)})
        </button>
        <button type="button" class="dm-tab ${this.#activeTab === "assignments" ? "active" : ""}" data-action="selectTab" data-tab="assignments">
          <i class="fas fa-tasks"></i> Workforce & Assignments
        </button>
      </nav>
    `;
    const collectionHtml = this.#renderCollectionView(vm);
    const inspectorHtml = this.#renderInspectorView(vm);
    return `
      <div class="dm-people-app-v2" data-domain-uuid="${escapeAttribute(this.#domainUuid)}">
        <header class="dm-app-header">
          <h2><i class="fas fa-users-crown"></i> People & Governance Subsystem</h2>
          <div class="dm-app-actions">
            <button type="button" class="dm-btn dm-btn-primary" data-action="openCreateModal" data-create-type="${escapeAttribute(this.#activeTab)}">
              <i class="fas fa-plus"></i> Create New
            </button>
          </div>
        </header>

        ${tabsHtml}

        <div class="dm-people-layout">
          <main class="dm-collection-container">
            ${collectionHtml}
          </main>

          <aside class="dm-inspector-container">
            ${inspectorHtml}
          </aside>
        </div>
      </div>
    `;
  }
  #renderCollectionView(vm) {
    switch (this.#activeTab) {
      case "notables":
        return this.#renderNotablesCollection(vm);
      case "roles":
        return this.#renderRolesCollection(vm);
      case "operationalGroups":
        return this.#renderOperationalGroupsCollection(vm);
      case "population":
        return this.#renderPopulationCollection(vm);
      case "assignments":
        return this.#renderAssignmentsCollection(vm);
    }
  }
  #renderNotablesCollection(vm) {
    if (vm.notables.length === 0) {
      return `<div class="dm-empty-state">No notables found in domain. Click 'Create New' to register a notable leader or agent.</div>`;
    }
    return `
      <div class="dm-collection-grid">
        ${vm.notables.map((n) => {
      const isSelected = this.#selectedEntity?.type === "notable" && this.#selectedEntity.id === n.notable.id;
      return `
            <div class="dm-card dm-notable-card ${isSelected ? "selected" : ""} ${n.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="notable" data-entity-id="${escapeAttribute(n.notable.id)}">
              <div class="dm-card-badge ${escapeAttribute(n.badgeClass)}">${escapeHtml(n.notable.type)}</div>
              <h4 class="dm-card-title">${escapeHtml(n.status.resolvedName)}</h4>
              ${n.notable.description ? `<div class="dm-card-subtitle">${escapeHtml(n.notable.description)}</div>` : ""}
              ${n.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
            </div>
          `;
    }).join("")}
      </div>
    `;
  }
  #renderRolesCollection(vm) {
    if (vm.roles.length === 0) {
      return `<div class="dm-empty-state">No roles configured. Click 'Create New' to establish a leadership office or operational group role.</div>`;
    }
    return `
      <div class="dm-collection-list">
        ${vm.roles.map((r) => {
      const isSelected = this.#selectedEntity?.type === "role" && this.#selectedEntity.id === r.evaluation.role.id;
      return `
            <div class="dm-list-row dm-role-row ${isSelected ? "selected" : ""} ${r.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="role" data-entity-id="${escapeAttribute(r.evaluation.role.id)}">
              <div class="dm-row-main">
                <span class="dm-role-name">${escapeHtml(r.evaluation.effectiveLabel)}</span>
                <span class="dm-badge dm-badge-${escapeAttribute(r.statusClass)}">${escapeHtml(r.statusClass)}</span>
                ${r.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              </div>
              <div class="dm-row-meta">
                <span>Occupants: ${r.evaluation.role.occupants.length}</span>
              </div>
            </div>
          `;
    }).join("")}
      </div>
    `;
  }
  #renderOperationalGroupsCollection(vm) {
    if (vm.operationalGroups.length === 0) {
      return `<div class="dm-empty-state">No operational groups registered. Click 'Create New' to muster squads, patrols, or guilds.</div>`;
    }
    return `
      <div class="dm-collection-list">
        ${vm.operationalGroups.map((g) => {
      const isSelected = this.#selectedEntity?.type === "group" && this.#selectedEntity.id === g.group.id;
      return `
            <div class="dm-list-row dm-group-row ${isSelected ? "selected" : ""} ${g.isSecret ? "secret" : ""}"
                 data-action="selectEntity" data-entity-type="group" data-entity-id="${escapeAttribute(g.group.id)}">
              <div class="dm-row-main">
                <span class="dm-group-name">${escapeHtml(g.group.name)}</span>
                <span class="dm-badge dm-badge-${escapeAttribute(g.statusClass)}">${escapeHtml(g.statusClass)}</span>
                ${g.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              </div>
              <div class="dm-row-meta">
                <span>Size: ${g.group.size} (${escapeHtml(g.group.membershipMode)})</span>
              </div>
            </div>
          `;
    }).join("")}
      </div>
    `;
  }
  #renderPopulationCollection(vm) {
    return `
      <div class="dm-population-view">
        <div class="dm-summary-card">
          <h3>Total Population: ${escapeHtml(vm.population.formattedTotal)}</h3>
          <p>Mode: <strong>${escapeHtml(vm.population.state.mode)}</strong> | Precision: <strong>${escapeHtml(vm.population.resolution.precision)}</strong></p>
        </div>
      </div>
    `;
  }
  #renderAssignmentsCollection(vm) {
    const workforceTypes = Object.values(vm.workforce.types);
    return `
      <div class="dm-assignments-view">
        <h3>Workforce Capacities</h3>
        <div class="dm-workforce-grid">
          ${workforceTypes.map((w) => `
            <div class="dm-wf-card ${w.isOvercommitted ? "overcommitted" : ""}">
              <h4>${escapeHtml(w.workforceTypeId)}</h4>
              <div class="dm-wf-numbers">
                <span>Available: <strong>${w.available}</strong></span>
                <span>Committed: ${w.committed}</span>
                <span>Reserved: ${w.reserved}</span>
                <span>Capacity: ${w.capacity}</span>
              </div>
              ${w.isOvercommitted ? `<div class="dm-badge-alert">OVERCOMMIT</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }
  #renderInspectorView(vm) {
    if (!this.#selectedEntity) {
      return `
        <div class="dm-inspector-empty">
          <i class="fas fa-info-circle"></i>
          <p>Select an item from the collection to inspect attributes, assignments, and resolution status.</p>
        </div>
      `;
    }
    const { type, id } = this.#selectedEntity;
    if (type === "notable") {
      const n = vm.notables.find((item) => item.notable.id === id);
      if (!n) return `<div class="dm-inspector-empty">Notable not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Notable Inspector</h3>
          <div class="dm-inspector-field">
            <label>Name:</label> <span>${escapeHtml(n.status.resolvedName)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>ID:</label> <code>${escapeHtml(n.notable.id)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Type:</label> <span>${escapeHtml(n.notable.type)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Visibility:</label> <span>${escapeHtml(n.notable.visibility)}</span>
          </div>
          ${n.notable.description ? `<div class="dm-inspector-field"><label>Description:</label> <p>${escapeHtml(n.notable.description)}</p></div>` : ""}
          ${n.notable.tags.length > 0 ? `<div class="dm-inspector-field"><label>Tags:</label> <span>${escapeHtml(n.notable.tags.join(", "))}</span></div>` : ""}
        </div>
      `;
    }
    if (type === "role") {
      const r = vm.roles.find((item) => item.evaluation.role.id === id);
      if (!r) return `<div class="dm-inspector-empty">Role not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Role Inspector</h3>
          <div class="dm-inspector-field">
            <label>Title:</label> <span>${escapeHtml(r.evaluation.effectiveLabel)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Definition ID:</label> <code>${escapeHtml(r.evaluation.role.definitionId)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Status:</label> <span class="dm-badge dm-badge-${escapeAttribute(r.statusClass)}">${escapeHtml(r.statusClass)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Requirements Satisfied:</label> <span>${r.evaluation.isRequirementSatisfied ? "Yes" : "No"}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Occupants (${r.evaluation.role.occupants.length}):</label>
            <ul>
              ${r.evaluation.role.occupants.map((occId) => `<li><code>${escapeHtml(occId)}</code></li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }
    if (type === "group") {
      const g = vm.operationalGroups.find((item) => item.group.id === id);
      if (!g) return `<div class="dm-inspector-empty">Group not found or hidden.</div>`;
      return `
        <div class="dm-inspector-content">
          <h3>Operational Group Inspector</h3>
          <div class="dm-inspector-field">
            <label>Name:</label> <span>${escapeHtml(g.group.name)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Definition:</label> <code>${escapeHtml(g.group.definitionId)}</code>
          </div>
          <div class="dm-inspector-field">
            <label>Size:</label> <span>${g.group.size} (${escapeHtml(g.group.membershipMode)})</span>
          </div>
          <div class="dm-inspector-field">
            <label>Lifecycle:</label> <span>${escapeHtml(g.group.lifecycle)}</span>
          </div>
          <div class="dm-inspector-field">
            <label>Members (${g.group.members.length}):</label>
            <ul>
              ${g.group.members.map((mId) => `<li><code>${escapeHtml(mId)}</code></li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }
    return `<div class="dm-inspector-empty">Unknown entity type.</div>`;
  }
  openCreateModal(createType) {
    const html = this.renderCreateModal(createType);
    return { type: createType, html };
  }
  renderCreateModal(createType) {
    switch (createType) {
      case "notables":
        return `
          <div class="dm-modal dm-create-notable-modal" data-modal-type="notable">
            <h3>Create Notable</h3>
            <form data-action="submitCreate" data-create-type="notable">
              <label>Name: <input type="text" name="name" required /></label>
              <label>Type: 
                <select name="type">
                  <option value="inline">Inline</option>
                  <option value="actor">Actor</option>
                </select>
              </label>
              <label>Actor UUID (optional): <input type="text" name="actorUuid" /></label>
              <label>Description: <textarea name="description"></textarea></label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary" data-action="submitCreate">Create</button>
              </div>
            </form>
          </div>
        `;
      case "roles":
        return `
          <div class="dm-modal dm-create-role-modal" data-modal-type="role">
            <h3>Create Role</h3>
            <form data-action="submitCreate" data-create-type="role">
              <label>Title/Label: <input type="text" name="name" required /></label>
              <label>Definition ID: <input type="text" name="definitionId" required /></label>
              <label>Scope:
                <select name="scope">
                  <option value="domain" selected>Domain</option>
                  <option value="operational-group">Operational Group</option>
                </select>
              </label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary" data-action="submitCreate">Create</button>
              </div>
            </form>
          </div>
        `;
      case "operationalGroups":
        return `
          <div class="dm-modal dm-create-group-modal" data-modal-type="group">
            <h3>Create Operational Group</h3>
            <form data-action="submitCreate" data-create-type="group">
              <label>Name: <input type="text" name="name" required /></label>
              <label>Definition ID: <input type="text" name="definitionId" required /></label>
              <label>Membership Mode:
                <select name="membershipMode">
                  <option value="abstract" selected>Abstract</option>
                  <option value="explicit">Explicit</option>
                </select>
              </label>
              <label>Visibility:
                <select name="visibility">
                  <option value="public" selected>Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary" data-action="submitCreate">Create</button>
              </div>
            </form>
          </div>
        `;
      default:
        return `
          <div class="dm-modal dm-create-default-modal">
            <h3>Create ${escapeHtml(createType)}</h3>
            <form data-action="submitCreate" data-create-type="${escapeAttribute(createType)}">
              <label>Name: <input type="text" name="name" required /></label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary" data-action="submitCreate">Create</button>
              </div>
            </form>
          </div>
        `;
    }
  }
};
function extractFormData(form) {
  const data = {};
  if (typeof FormData !== "undefined" && typeof globalThis.HTMLFormElement !== "undefined" && form instanceof globalThis.HTMLFormElement) {
    try {
      const fd = new FormData(form);
      fd.forEach?.((val, key) => {
        if (typeof val === "string") {
          data[key] = val.trim();
        }
      });
      return data;
    } catch {
    }
  }
  const elements = form.querySelectorAll?.("input, select, textarea") ?? [];
  elements.forEach((el) => {
    const name = el.getAttribute?.("name") || el.name;
    if (!name) return;
    let value = el.value;
    if (el.tagName === "SELECT" && (!value || value === "")) {
      const selectedOption = el.querySelector?.("option[selected]") ?? el.querySelector?.("option");
      if (selectedOption) {
        value = selectedOption.getAttribute?.("value") ?? selectedOption.value ?? "";
      }
    }
    if (el.tagName === "TEXTAREA" && (!value || value === "")) {
      if (el.textContent) {
        value = el.textContent;
      }
    }
    if (value === void 0 || value === null || value === "") {
      const attrVal = el.getAttribute?.("value");
      if (attrVal !== void 0 && attrVal !== null) {
        value = attrVal;
      }
    }
    if (value !== void 0 && value !== null) {
      data[name] = String(value).trim();
    }
  });
  return data;
}
function matchesSelector(el, sel) {
  sel = sel.trim();
  if (sel.includes(",")) {
    return sel.split(",").some((part) => matchesSelector(el, part.trim()));
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    const classes = (el.className || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("[")) {
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const expectedVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
      if (expectedVal === void 0) return el.hasAttribute?.(attrName) ?? false;
      return el.getAttribute?.(attrName) === expectedVal;
    }
  }
  if (sel.includes("[")) {
    const parts = sel.match(/^([a-zA-Z0-9_-]+)(\[.+\])$/);
    if (parts) {
      return matchesSelector(el, parts[1]) && matchesSelector(el, parts[2]);
    }
  }
  return (el.tagName || "").toLowerCase() === sel.toLowerCase();
}
function querySelectorMock(root, selector) {
  if (selector.includes(",")) {
    const parts = selector.split(",").map((s) => s.trim());
    for (const part of parts) {
      const found = querySelectorMock(root, part);
      if (found) return found;
    }
    return null;
  }
  for (const child of root.children ?? []) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorMock(child, selector);
    if (found) return found;
  }
  return null;
}
function querySelectorAllMock(root, selector) {
  if (selector.includes(",")) {
    const parts = selector.split(",").map((s) => s.trim());
    const set = /* @__PURE__ */ new Set();
    for (const part of parts) {
      for (const el of querySelectorAllMock(root, part)) {
        set.add(el);
      }
    }
    return Array.from(set);
  }
  const results = [];
  for (const child of root.children ?? []) {
    if (matchesSelector(child, selector)) results.push(child);
    results.push(...querySelectorAllMock(child, selector));
  }
  return results;
}
function createMockElement(tagName, props = {}) {
  const listeners = {};
  const children = [];
  const attributes = {};
  let innerHtml = props.innerHTML ?? "";
  const element = {
    tagName: tagName.toUpperCase(),
    className: props.className ?? "",
    attributes,
    children,
    parent: null,
    value: props.value ?? "",
    name: props.name ?? "",
    ownerDocument: {
      createElement: (tag) => createMockElement(tag)
    },
    get innerHTML() {
      return innerHtml;
    },
    set innerHTML(val) {
      innerHtml = val;
      parseHtmlToMockTree(element, val);
    },
    get textContent() {
      return innerHtml.replace(/<[^>]*>/g, "");
    },
    set textContent(val) {
      innerHtml = val;
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
      if (name === "class") element.className = String(value);
      if (name === "name") element.name = String(value);
      if (name === "value") element.value = String(value);
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    appendChild(child) {
      child.parent = element;
      children.push(child);
      return child;
    },
    prepend(child) {
      child.parent = element;
      children.unshift(child);
      return child;
    },
    remove() {
      if (element.parent) {
        const idx = element.parent.children.indexOf(element);
        if (idx !== -1) element.parent.children.splice(idx, 1);
        element.parent = null;
      }
    },
    replaceChildren(...newChildren) {
      children.length = 0;
      for (const c of newChildren) {
        c.parent = element;
        children.push(c);
      }
    },
    addEventListener(type, listener) {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(listener);
    },
    dispatchEvent(event) {
      event.target = element;
      if (!event.preventDefault) {
        event.preventDefault = () => {
        };
      }
      let curr = element;
      while (curr) {
        const handlers = curr._listeners?.[event.type] ?? [];
        for (const h of handlers) {
          h(event);
        }
        curr = curr.parent;
      }
      return true;
    },
    async dispatchEventAsync(event) {
      event.target = element;
      if (!event.preventDefault) {
        event.preventDefault = () => {
        };
      }
      let curr = element;
      while (curr) {
        const handlers = curr._listeners?.[event.type] ?? [];
        for (const h of handlers) {
          await h(event);
        }
        curr = curr.parent;
      }
      return true;
    },
    querySelector(selector) {
      return querySelectorMock(element, selector);
    },
    querySelectorAll(selector) {
      return querySelectorAllMock(element, selector);
    },
    closest(selector) {
      let curr = element;
      while (curr) {
        if (matchesSelector(curr, selector)) return curr;
        curr = curr.parent;
      }
      return null;
    },
    get _listeners() {
      return listeners;
    }
  };
  if (props.attributes) {
    for (const [k, v] of Object.entries(props.attributes)) {
      element.setAttribute(k, String(v));
    }
  }
  if (innerHtml) {
    parseHtmlToMockTree(element, innerHtml);
  }
  return element;
}
function parseHtmlToMockTree(root, html) {
  root.children.length = 0;
  const selfClosing = /* @__PURE__ */ new Set(["input", "img", "br", "hr", "meta", "link"]);
  const stack = [root];
  const tokenRegex = /<(\/?)([a-zA-Z0-9_-]+)([^>]*)>/g;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2].toUpperCase();
    const rawAttrs = match[3] ?? "";
    if (isClosing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === tagName) {
          while (stack.length >= i + 1) {
            stack.pop();
          }
          break;
        }
      }
      continue;
    }
    const isSelfClosing = rawAttrs.trim().endsWith("/") || selfClosing.has(tagName.toLowerCase());
    const child = createMockElement(tagName);
    child.parent = stack[stack.length - 1];
    const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = attrMatch[1];
      if (attrName === "/") continue;
      const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      child.setAttribute(attrName, attrVal);
      if (attrName === "class") child.className = attrVal;
      if (attrName === "name") child.name = attrVal;
      if (attrName === "value") child.value = attrVal;
    }
    stack[stack.length - 1].appendChild(child);
    if (!isSelfClosing) {
      stack.push(child);
    }
  }
}
var BaseApp = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class MockApplicationV2 {
  options;
  element = null;
  constructor(options = {}) {
    this.options = options;
  }
  async _prepareContext(options) {
    return {};
  }
  _renderHTML(context, options) {
    return "";
  }
  _replaceHTML(result, content, options) {
    if (typeof result === "string") {
      content.innerHTML = result;
    } else if (result && typeof content.replaceChildren === "function") {
      content.replaceChildren(result);
    }
  }
  _onRender(context, options) {
  }
  async render(force, options) {
    if (!this.element) {
      if (typeof globalThis.document?.createElement === "function") {
        this.element = globalThis.document.createElement("div");
      } else {
        this.element = createMockElement("div", {
          className: "domain-manager dm-people-app-v2"
        });
      }
    }
    const context = await this._prepareContext(options);
    const result = await this._renderHTML(context, options);
    this._replaceHTML(result, this.element, options);
    this._onRender(context, options);
    return this;
  }
  async close(options) {
    this.element = null;
  }
};
var PeopleApplication = class _PeopleApplication extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-people-{id}",
    classes: ["domain-manager", "dm-people-app-v2"],
    tag: "div",
    window: {
      title: "People & Governance",
      icon: "fas fa-users-crown",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 820,
      height: 640
    },
    actions: {
      selectTab: _PeopleApplication.#onSelectTab,
      selectEntity: _PeopleApplication.#onSelectEntity,
      openCreateModal: _PeopleApplication.#onOpenCreateModal,
      closeModal: _PeopleApplication.#onCloseModal,
      submitCreate: _PeopleApplication.#onSubmitCreate
    }
  };
  #controller;
  #element = null;
  constructor(options) {
    super(options);
    this.#controller = new PeopleApplicationController(options);
  }
  get controller() {
    return this.#controller;
  }
  get element() {
    return this._element ?? this.#element;
  }
  async _prepareContext(options) {
    const vmRes = await this.#controller.loadViewModel();
    return {
      viewModel: vmRes.ok ? vmRes.value : null,
      error: !vmRes.ok ? vmRes.error : null
    };
  }
  _renderHTML(context, options) {
    if (context.error) {
      return `<div class="dm-error-state">${escapeHtml(context.error.message)}</div>`;
    }
    return this.#controller.render(context.viewModel);
  }
  _replaceHTML(result, content, options) {
    if (typeof result === "string") {
      content.innerHTML = result;
    } else if (result && typeof content.replaceChildren === "function") {
      content.replaceChildren(result);
    } else if (result) {
      content.innerHTML = String(result);
    }
  }
  _onRender(context, options) {
    const el = this.element ?? this._element ?? this.#element;
    if (el) {
      this.attachEventListeners(el);
    }
  }
  attachEventListeners(element) {
    this.#element = element;
    const forms = element.querySelectorAll?.("form") ?? [];
    forms.forEach((form) => {
      if (form.__submitBound) return;
      form.__submitBound = true;
      form.addEventListener?.("submit", async (event) => {
        event.preventDefault?.();
        await _PeopleApplication.#onSubmitCreate.call(this, event, form);
      });
    });
    if (element.__clickBound) return;
    element.__clickBound = true;
    element.addEventListener?.("click", async (event) => {
      const target = event.target?.closest?.("[data-action]");
      if (!target) return;
      const action = target.getAttribute?.("data-action");
      if (action === "selectTab") {
        await _PeopleApplication.#onSelectTab.call(this, event, target);
      } else if (action === "selectEntity") {
        await _PeopleApplication.#onSelectEntity.call(this, event, target);
      } else if (action === "openCreateModal") {
        await _PeopleApplication.#onOpenCreateModal.call(this, event, target);
      } else if (action === "closeModal") {
        await _PeopleApplication.#onCloseModal.call(this, event, target);
      } else if (action === "submitCreate") {
        const form = target.tagName === "FORM" ? target : target.closest?.("form");
        if (form) {
          await _PeopleApplication.#onSubmitCreate.call(this, event, form);
        }
      }
    });
  }
  closeModal() {
    const el = this.element ?? this.#element;
    if (el) {
      const backdrops = el.querySelectorAll?.(".dm-modal-backdrop") ?? [];
      backdrops.forEach((b) => b.remove?.());
    }
  }
  openCreateModal(createType) {
    const modal = this.#controller.openCreateModal(createType);
    const el = this.element ?? this.#element;
    if (el) {
      let modalContainer;
      if (typeof globalThis.document?.createElement === "function") {
        modalContainer = globalThis.document.createElement("div");
      } else {
        modalContainer = createMockElement("div", { className: "dm-modal-backdrop" });
      }
      modalContainer.className = "dm-modal-backdrop";
      modalContainer.innerHTML = modal.html;
      el.appendChild(modalContainer);
      this.attachEventListeners(el);
    }
    return modal;
  }
  static async #onSelectTab(event, target) {
    const tab = target.getAttribute?.("data-tab");
    if (tab) {
      this.#controller.selectTab(tab);
      await this.#controller.loadViewModel();
      await this.render?.();
    }
  }
  static async #onSelectEntity(event, target) {
    const type = target.getAttribute?.("data-entity-type");
    const id = target.getAttribute?.("data-entity-id");
    if (type && id) {
      this.#controller.selectEntity(type, id);
      await this.#controller.loadViewModel();
      await this.render?.();
    }
  }
  static async #onOpenCreateModal(event, target) {
    const createType = target.getAttribute?.("data-create-type") ?? this.#controller.activeTab;
    this.openCreateModal(createType);
  }
  static async #onCloseModal(event, target) {
    event?.preventDefault?.();
    this.closeModal();
  }
  static async #onSubmitCreate(event, target) {
    event?.preventDefault?.();
    const form = target.tagName === "FORM" ? target : target.closest?.("form");
    if (!form) return;
    const createType = form.getAttribute?.("data-create-type") ?? target.getAttribute?.("data-create-type") ?? "";
    const formData = extractFormData(form);
    let result;
    switch (createType) {
      case "notables":
      case "notable": {
        result = await this.#controller.dispatchCreateNotable({
          name: formData.name,
          type: formData.type || "inline",
          actorUuid: formData.actorUuid || void 0,
          description: formData.description || void 0,
          visibility: formData.visibility || "public"
        });
        break;
      }
      case "roles":
      case "role": {
        result = await this.#controller.dispatchCreateRole({
          definitionId: formData.definitionId,
          customLabel: formData.name || formData.customLabel || void 0,
          scope: formData.scope || "domain",
          visibility: formData.visibility || "public"
        });
        break;
      }
      case "group":
      case "operationalGroups": {
        result = await this.#controller.dispatchCreateOperationalGroup({
          name: formData.name,
          definitionId: formData.definitionId || formData.type,
          membershipMode: formData.membershipMode || "abstract",
          visibility: formData.visibility || "public"
        });
        break;
      }
      default: {
        result = err(
          createPublicError({
            code: "DM_UNKNOWN_CREATE_TYPE",
            category: "validation",
            message: `Unknown create type: ${createType}`
          })
        );
      }
    }
    if (!result.ok) {
      const errorMsg = result.error.message;
      const notify = globalThis.ui?.notifications?.error;
      if (typeof notify === "function") {
        notify(`Failed to create ${createType}: ${errorMsg}`);
      }
      let errorContainer = form.querySelector?.(".dm-form-error");
      if (!errorContainer && form.ownerDocument) {
        errorContainer = form.ownerDocument.createElement("div");
        errorContainer.className = "dm-form-error";
        form.prepend?.(errorContainer);
      }
      if (errorContainer) {
        errorContainer.textContent = errorMsg;
      }
      return;
    }
    this.closeModal();
    await this.#controller.loadViewModel();
    await this.render?.();
  }
};

// src/people/services/people-service.ts
var PeopleService = class {
  #domains;
  #commandBus;
  #repository;
  #projection;
  #aggregation;
  constructor(domains, options = {}) {
    this.#domains = domains;
    this.#commandBus = options.commandBus;
    this.#repository = new PeopleRepository(domains);
    this.#projection = new PeopleProjectionService({
      roleDefinitions: options.roleDefinitions,
      groupDefinitions: options.groupDefinitions
    });
    this.#aggregation = new PeopleAggregationService(domains);
  }
  /**
   * Internal/Authority-only raw people data access. Not part of PublicPeopleApi.
   */
  async getPeopleData(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const rawRes = await this.#repository.getPeopleData(domainUuid);
    if (!rawRes.ok) return rawRes;
    if (viewer.isGm) {
      return rawRes;
    }
    const projected = this.#projection.project(domainUuid, rawRes.value, viewer);
    return ok({
      schemaVersion: rawRes.value.schemaVersion,
      population: projected.population.state,
      populationGroups: projected.populationGroups,
      notables: projected.notables,
      roles: projected.roles,
      operationalGroups: projected.operationalGroups,
      assignments: projected.assignments,
      reservations: projected.reservations
    });
  }
  async getViewerContext(domainUuid, callerViewer, options = {}) {
    const viewer = resolveCurrentViewer(callerViewer);
    const dataRes = await this.#repository.getPeopleData(domainUuid);
    if (!dataRes.ok) return dataRes;
    return ok(this.#projection.project(domainUuid, dataRes.value, viewer, options));
  }
  async getPopulation(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok({
      state: ctxRes.value.population.state,
      resolution: ctxRes.value.population.resolution
    });
  }
  async getPopulationGroups(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.populationGroups);
  }
  async getPopulationGroup(domainUuid, groupId, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getPopulationGroup(domainUuid, groupId, { viewer });
  }
  async getNotables(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.notables);
  }
  async getNotable(domainUuid, notableId, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getNotable(domainUuid, notableId, { viewer });
  }
  async getNotableStatus(domainUuid, notableId, actorResolver, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getNotableStatus(domainUuid, notableId, actorResolver, { viewer });
  }
  async getRoles(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.roles);
  }
  async getRole(domainUuid, roleId, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getRole(domainUuid, roleId, { viewer });
  }
  async getOperationalGroups(domainUuid, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.operationalGroups);
  }
  async getOperationalGroup(domainUuid, groupId, callerViewer) {
    const viewer = resolveCurrentViewer(callerViewer);
    return this.#repository.getOperationalGroup(domainUuid, groupId, { viewer });
  }
  async getWorkforce(domainUuid, callerViewer, options) {
    const viewer = resolveCurrentViewer(callerViewer);
    const optObj = typeof options === "number" ? { nowReal: options } : options;
    const ctxRes = await this.getViewerContext(domainUuid, viewer, optObj);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.workforce);
  }
  async getAssignments(domainUuid, callerViewer, options) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer, options);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.assignments);
  }
  async getReservations(domainUuid, callerViewer, options) {
    const viewer = resolveCurrentViewer(callerViewer);
    const ctxRes = await this.getViewerContext(domainUuid, viewer, options);
    if (!ctxRes.ok) return ctxRes;
    return ok(ctxRes.value.reservations);
  }
  getAggregate(rootDomainUuid, options = {}) {
    return this.#aggregation.queryPeopleAggregate(rootDomainUuid, options);
  }
  getEffectiveCapabilities(domainInput, roleDefinitions, operationalGroupDefinitions) {
    return resolvePeopleEffectiveCapabilities(domainInput, roleDefinitions, operationalGroupDefinitions);
  }
  buildViewModel(domainInput, options = {}) {
    const viewer = resolveCurrentViewer();
    const effectiveIsGm = viewer.isGm ? options.viewerIsGm ?? true : false;
    return buildPeopleViewModel(domainInput, {
      ...options,
      viewerIsGm: effectiveIsGm,
      allowedRestrictedRefs: viewer.allowedRestrictedRefs
    });
  }
  renderSubsystemHtml(vm) {
    return renderPeopleSubsystemHtml(vm);
  }
  openApp(domainUuid, options) {
    const bus = options?.commandBus ?? this.#commandBus;
    if (!bus) {
      throw new Error("CommandBus is required to open PeopleApplication");
    }
    return new PeopleApplication({
      domainUuid,
      commandBus: bus,
      peopleApi: this,
      domains: this.#domains,
      viewer: options?.viewer
    });
  }
};

// src/people/services/people-repair-tool.ts
var PeopleRepairTool = class {
  #commandBus;
  constructor(commandBus) {
    if (!commandBus || typeof commandBus.execute !== "function") {
      throw new TypeError("PeopleRepairTool requires an authorized CommandBus instance");
    }
    this.#commandBus = commandBus;
  }
  get commandBus() {
    return this.#commandBus;
  }
  async relinkNotable(domainUuid, oldNotableId, newNotableId) {
    return this.#dispatchRepair(domainUuid, {
      type: "relink-notable",
      oldNotableId,
      newNotableId
    });
  }
  async purgeDanglingOccupants(domainUuid) {
    return this.#dispatchRepair(domainUuid, {
      type: "purge-dangling-occupants"
    });
  }
  async repairExplicitGroupSizes(domainUuid) {
    return this.#dispatchRepair(domainUuid, {
      type: "repair-explicit-group-sizes"
    });
  }
  async pruneExpiredReservations(domainUuid, nowReal = Date.now(), nowWorld) {
    return this.#dispatchRepair(domainUuid, {
      type: "prune-expired-reservations",
      nowReal,
      nowWorld
    });
  }
  async pruneEndedAssignments(domainUuid, nowWorld) {
    return this.#dispatchRepair(domainUuid, {
      type: "prune-ended-assignments",
      nowWorld
    });
  }
  async #dispatchRepair(domainUuid, operation) {
    const cmd = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createCommandId(),
      type: "people:repair",
      payload: {
        domainUuid,
        operation
      },
      issuedAtReal: Date.now()
    };
    const res = await this.#commandBus.execute(cmd);
    if (!res.ok) return res;
    if (res.value.status === "rejected") {
      return err(
        res.value.error ?? createPublicError({
          code: "DM_COMMAND_REJECTED",
          category: "internal",
          message: "Repair command was rejected by authority"
        })
      );
    }
    const receiptResult = res.value.result;
    return ok({
      domainUuid: receiptResult.domainUuid,
      repaired: receiptResult.repaired,
      summary: receiptResult.summary,
      changes: receiptResult.changes
    });
  }
};

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
  registerPopulationCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerNotableCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRoleCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerOperationalGroupCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerAssignmentCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRepairCommandHandlers(registry, coordinator, mutableDomainRepo);
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
  const people = new PeopleService(readOnlyDomains, { commandBus });
  const repairTool = new PeopleRepairTool(commandBus);
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
    people,
    repairTool,
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
  const module = globalThis.game?.modules?.get?.("domain-manager");
  if (module) {
    module.api = runtime;
  }
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
export {
  PeopleApplication,
  PeopleApplicationController,
  PeopleRepairTool,
  PeopleService,
  clearDomainControllerPolicies,
  composeDomainManagerRuntime,
  registerDomainControllerPolicy
};
//# sourceMappingURL=main.js.map
