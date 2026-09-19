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
  const pattern = prefix === void 0 ? /^(cmd|tx|prj|rel|rep|led|resv|reve|thrs|req|role|pop|not|opg|asg|plan)_[0-9a-f-]{36}$/ : new RegExp(`^${prefix}_[0-9a-f-]{36}$`);
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

// src/economy/definitions/resource-definition-types.ts
function isNamespacedResourceId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value);
}
function validateResourceDefinition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition must be an object"
      })
    );
  }
  const candidate = raw;
  if (!isNamespacedResourceId(candidate.id)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID_ID",
        category: "validation",
        message: `ResourceDefinition ID must be namespaced (e.g. 'domain-manager:treasury' or 'world:gold'): received '${String(candidate.id)}'`
      })
    );
  }
  const version = typeof candidate.version === "number" ? candidate.version : 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition version must be a positive safe integer >= 1"
      })
    );
  }
  if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "ResourceDefinition label must be a non-empty string"
      })
    );
  }
  const precision = candidate.precision;
  if (typeof precision !== "number" || !Number.isSafeInteger(precision) || precision < 0 || precision > 4) {
    return err(
      createPublicError({
        code: "DM_ECON_PRECISION_INVALID",
        category: "validation",
        message: `Resource precision must be an integer between 0 and 4: received '${String(precision)}'`
      })
    );
  }
  const allowNegative = Boolean(candidate.allowNegative);
  let minimumMinor = null;
  if (candidate.minimumMinor !== void 0 && candidate.minimumMinor !== null) {
    if (typeof candidate.minimumMinor !== "number" || !Number.isSafeInteger(candidate.minimumMinor)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_INVALID",
          category: "validation",
          message: "minimumMinor must be a safe integer or null"
        })
      );
    }
    minimumMinor = candidate.minimumMinor;
  } else if (!allowNegative) {
    minimumMinor = 0;
  }
  let maximumMinor = null;
  if (candidate.maximumMinor !== void 0 && candidate.maximumMinor !== null) {
    if (typeof candidate.maximumMinor !== "number" || !Number.isSafeInteger(candidate.maximumMinor)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_INVALID",
          category: "validation",
          message: "maximumMinor must be a safe integer or null"
        })
      );
    }
    maximumMinor = candidate.maximumMinor;
  }
  if (minimumMinor !== null && maximumMinor !== null && minimumMinor > maximumMinor) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `minimumMinor (${minimumMinor}) cannot exceed maximumMinor (${maximumMinor})`
      })
    );
  }
  if (!allowNegative && minimumMinor !== null && minimumMinor < 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: "minimumMinor cannot be negative when allowNegative is false"
      })
    );
  }
  const validPolicies = ["block", "allow-with-warning", "overflow", "provider"];
  const capacityPolicy = candidate.defaultCapacityPolicy || "block";
  if (!validPolicies.includes(capacityPolicy)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `Invalid defaultCapacityPolicy: received '${String(capacityPolicy)}'`
      })
    );
  }
  const lifecycle = candidate.lifecycle || "active";
  if (lifecycle !== "active" && lifecycle !== "archived") {
    return err(
      createPublicError({
        code: "DM_ECON_RESOURCE_INVALID",
        category: "validation",
        message: `Invalid lifecycle: received '${String(lifecycle)}'`
      })
    );
  }
  const tags = Array.isArray(candidate.tags) ? candidate.tags.filter((t) => typeof t === "string") : [];
  let displayUnit = void 0;
  if (candidate.displayUnit && typeof candidate.displayUnit === "object") {
    const rawUnit = candidate.displayUnit;
    displayUnit = {
      ...typeof rawUnit.singular === "string" ? { singular: rawUnit.singular } : {},
      ...typeof rawUnit.plural === "string" ? { plural: rawUnit.plural } : {},
      ...typeof rawUnit.abbreviation === "string" ? { abbreviation: rawUnit.abbreviation } : {}
    };
  }
  return ok({
    id: candidate.id,
    version,
    label: candidate.label.trim(),
    ...typeof candidate.description === "string" ? { description: candidate.description } : {},
    ...typeof candidate.icon === "string" ? { icon: candidate.icon } : {},
    categoryId: typeof candidate.categoryId === "string" ? candidate.categoryId : null,
    tags: Object.freeze(tags),
    precision,
    ...displayUnit ? { displayUnit } : {},
    minimumMinor,
    maximumMinor,
    allowNegative,
    defaultCapacityPolicy: capacityPolicy,
    lifecycle
  });
}

// src/economy/accounts/account-types.ts
var VALID_VISIBILITIES = Object.freeze([
  "public",
  "restricted",
  "secret"
]);
function validateResourceAccount(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: "ResourceAccount must be an object"
      })
    );
  }
  const candidate = raw;
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: "ResourceAccount domainUuid must be a non-empty string"
      })
    );
  }
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_ACCOUNT_INVALID",
        category: "validation",
        message: `ResourceAccount resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }
  let visibility = void 0;
  if (candidate.visibility !== void 0 && candidate.visibility !== null) {
    if (!VALID_VISIBILITIES.includes(candidate.visibility)) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_INVALID",
          category: "validation",
          message: `Invalid visibility: received '${String(candidate.visibility)}'`
        })
      );
    }
    visibility = candidate.visibility;
  }
  const mode = candidate.mode;
  switch (mode) {
    case "native": {
      const balance = candidate.balanceMinor;
      if (typeof balance !== "number" || !Number.isSafeInteger(balance)) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: `Native account balanceMinor must be a safe integer: received '${String(balance)}'`
          })
        );
      }
      let baseCapacity = null;
      if (candidate.baseCapacityMinor !== void 0 && candidate.baseCapacityMinor !== null) {
        if (typeof candidate.baseCapacityMinor !== "number" || !Number.isSafeInteger(candidate.baseCapacityMinor) || candidate.baseCapacityMinor < 0) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_INVALID",
              category: "validation",
              message: "baseCapacityMinor must be a non-negative safe integer or null"
            })
          );
        }
        baseCapacity = candidate.baseCapacityMinor;
      }
      const status = candidate.status === "closed" ? "closed" : "active";
      const closedAt = typeof candidate.closedAt === "number" ? candidate.closedAt : void 0;
      return ok({
        mode: "native",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        balanceMinor: balance,
        baseCapacityMinor: baseCapacity,
        ...visibility ? { visibility } : {},
        status,
        ...closedAt !== void 0 ? { closedAt } : {}
      });
    }
    case "derived": {
      if (typeof candidate.resolverId !== "string" || candidate.resolverId.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Derived account must specify a non-empty resolverId"
          })
        );
      }
      return ok({
        mode: "derived",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        resolverId: candidate.resolverId.trim(),
        ...visibility ? { visibility } : {}
      });
    }
    case "provider": {
      if (typeof candidate.providerId !== "string" || candidate.providerId.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account must specify a non-empty providerId"
          })
        );
      }
      if (typeof candidate.providerRef !== "string" || candidate.providerRef.trim().length === 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account must specify a non-empty providerRef"
          })
        );
      }
      return ok({
        mode: "provider",
        domainUuid: candidate.domainUuid.trim(),
        resourceId: candidate.resourceId,
        providerId: candidate.providerId.trim(),
        providerRef: candidate.providerRef.trim(),
        ...visibility ? { visibility } : {}
      });
    }
    default:
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_INVALID",
          category: "validation",
          message: `Invalid ResourceAccount mode: '${String(mode)}'. Expected 'native', 'derived', or 'provider'`
        })
      );
  }
}

// src/economy/economy-data.ts
var ECONOMY_CAPABILITY_ID = "domain-manager:economy";
var ECONOMY_CAPABILITY_ALIAS = "domain:economy";
var ECONOMY_SCHEMA_VERSION = 1;
function createDefaultDomainEconomyData() {
  return {
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    accounts: Object.freeze([])
  };
}
function validateDomainEconomyData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_DATA_INVALID",
        category: "validation",
        message: "Economy data must be an object"
      })
    );
  }
  const candidate = raw;
  if (candidate.schemaVersion !== ECONOMY_SCHEMA_VERSION) {
    return err(
      createPublicError({
        code: "DM_ECON_INVALID_SCHEMA_VERSION",
        category: "validation",
        message: `Invalid Economy schemaVersion: ${String(candidate.schemaVersion)}. Expected ${ECONOMY_SCHEMA_VERSION}`
      })
    );
  }
  if (!Array.isArray(candidate.accounts)) {
    return err(
      createPublicError({
        code: "DM_ECON_DATA_INVALID",
        category: "validation",
        message: "Economy accounts must be an array"
      })
    );
  }
  const validatedAccounts = [];
  const resourceIds = /* @__PURE__ */ new Set();
  for (const a of candidate.accounts) {
    const accRes = validateResourceAccount(a);
    if (!accRes.ok) {
      return accRes;
    }
    const acc = accRes.value;
    if (resourceIds.has(acc.resourceId)) {
      return err(
        createPublicError({
          code: "DM_ECON_DUPLICATE_RESOURCE_ACCOUNT",
          category: "validation",
          message: `Duplicate account for resource '${acc.resourceId}' in domain '${acc.domainUuid}'`
        })
      );
    }
    resourceIds.add(acc.resourceId);
    validatedAccounts.push(acc);
  }
  return ok({
    schemaVersion: ECONOMY_SCHEMA_VERSION,
    accounts: Object.freeze(validatedAccounts)
  });
}
function tryGetDomainEconomyData(domain) {
  const record = "record" in domain ? domain.record : domain;
  const config = record?.definition?.capabilities?.config ?? {};
  const rawEconomy = config[ECONOMY_CAPABILITY_ID] ?? config[ECONOMY_CAPABILITY_ALIAS];
  if (!rawEconomy) {
    return ok(createDefaultDomainEconomyData());
  }
  return validateDomainEconomyData(rawEconomy);
}
function getDomainEconomyData(domain) {
  const res = tryGetDomainEconomyData(domain);
  if (!res.ok) {
    throw new Error(`Domain economy data corruption: [${res.error.code}] ${res.error.message}`);
  }
  return res.value;
}
function withDomainEconomyData(domain, economyData) {
  const currentEnabled = domain.definition.capabilities.enabled;
  const newEnabled = currentEnabled.includes(ECONOMY_CAPABILITY_ID) ? currentEnabled : Object.freeze([...currentEnabled, ECONOMY_CAPABILITY_ID]);
  const newConfig = Object.freeze({
    ...domain.definition.capabilities.config,
    [ECONOMY_CAPABILITY_ID]: economyData
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
  registry.register({
    id: "domain-manager:economy",
    label: "Economy & Resources",
    functional: true,
    validateConfig: (config) => {
      if (config === void 0 || config === null) return ok(void 0);
      const res = validateDomainEconomyData(config);
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
      if (queueEntry.abortController.signal.aborted || queueEntry.status === "cancelled") {
        finalReceipt = {
          commandId: command.commandId,
          status: "rejected",
          error: createPublicError({
            code: "DM_COMMAND_CANCELLED",
            category: "busy",
            message: `Command was cancelled: ${queueEntry.cancelReason ?? "Unknown reason"}`
          }),
          transportTimestamp: now
        };
      } else {
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
  compensating: /* @__PURE__ */ new Set(["compensated", "committed", "needs-recovery", "failed"]),
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
function createTransactionRecord(params) {
  const now = params.now ?? Date.now();
  const transactionId = params.transactionId ?? `tx_${params.commandId}_${now}`;
  return Object.freeze({
    transactionId,
    commandId: params.commandId,
    authorityEpoch: params.authorityEpoch,
    state: "planned",
    lockKeys: Object.freeze([...params.lockKeys]),
    safeAutoRecovery: params.safeAutoRecovery ?? false,
    recoveryData: params.recoveryData,
    createdAt: now,
    updatedAt: now,
    history: Object.freeze([])
  });
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

// src/mutations/transaction-storage-adapter.ts
var TRANSACTION_STORAGE_SCHEMA_VERSION = 1;
var TRANSACTION_DOCUMENT_NAME = "[Domain Manager] Transaction Store";
var TRANSACTION_FLAG_NAMESPACE = "domain-manager-transactions";
function runtimeFromGlobals3() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalTransactionStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals3();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[TRANSACTION_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    return rawFlag;
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    let doc = this.#findDocument();
    if (!doc) {
      const created = await this.#runtime.createJournalEntry({
        name: TRANSACTION_DOCUMENT_NAME,
        flags: {
          [TRANSACTION_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
      return;
    }
    this.#documentId = doc.id;
    await doc.update({
      [`flags.${TRANSACTION_FLAG_NAMESPACE}`]: snapshot
    });
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const doc = this.#runtime.journal.get(this.#documentId);
      if (doc) return doc;
    }
    return this.#runtime.journal.contents.find((d) => d.name === TRANSACTION_DOCUMENT_NAME);
  }
};

// src/mutations/transaction-store.ts
var TransactionStore = class {
  #records = /* @__PURE__ */ new Map();
  #byCommandId = /* @__PURE__ */ new Map();
  #storageAdapter;
  #persistQueue = Promise.resolve();
  #lastPersistError = null;
  constructor(options = {}) {
    this.#storageAdapter = options.storageAdapter;
  }
  async rehydrate() {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#records.clear();
      this.#byCommandId.clear();
      for (const record of snapshot.records) {
        this.#records.set(record.transactionId, record);
        this.#byCommandId.set(record.commandId, record.transactionId);
      }
    }
  }
  save(record) {
    this.#records.set(record.transactionId, record);
    this.#byCommandId.set(record.commandId, record.transactionId);
    this.#schedulePersist();
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
  listAll() {
    return Object.freeze(Array.from(this.#records.values()));
  }
  get count() {
    return this.#records.size;
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
  async flush() {
    if (!this.#storageAdapter) return;
    this.#schedulePersist();
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err3 = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err3;
    }
  }
  clear() {
    this.#records.clear();
    this.#byCommandId.clear();
    this.#schedulePersist();
  }
  #schedulePersist() {
    if (!this.#storageAdapter) return;
    this.#persistQueue = this.#persistQueue.then(async () => {
      await this.#persist();
    }).catch((err3) => {
      this.#lastPersistError = err3 instanceof Error ? err3 : new Error(String(err3));
    });
  }
  async #persist() {
    if (!this.#storageAdapter) return;
    const snapshot = {
      schemaVersion: TRANSACTION_STORAGE_SCHEMA_VERSION,
      records: Array.from(this.#records.values()),
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
};

// src/mutations/recovery-service.ts
var RecoveryService = class {
  #transactionStore;
  #lockManager;
  #heldRecoveryLocks = /* @__PURE__ */ new Map();
  #compensators = /* @__PURE__ */ new Map();
  constructor(options, lockManager) {
    if ("transactionStore" in options) {
      this.#transactionStore = options.transactionStore;
      this.#lockManager = options.lockManager;
    } else {
      this.#transactionStore = options;
      this.#lockManager = lockManager;
    }
  }
  registerCompensator(type, compensator) {
    this.#compensators.set(type, compensator);
  }
  getCompensator(type) {
    return this.#compensators.get(type);
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
    const recoveryType = record.recoveryData?.type;
    const effectiveCompensator = compensator ?? (recoveryType ? this.#compensators.get(recoveryType) : void 0);
    if (!effectiveCompensator) {
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
      const compRes = await effectiveCompensator(compTransition.value);
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
    const currentTx = this.#transactionStore.get(transactionId);
    if (currentTx && isFinalTransactionState(currentTx.state)) {
      this.#releaseRecoveryLock(transactionId);
      return ok(currentTx);
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
  /**
   * Recovers all unresolved transactions using registered compensators.
   */
  async recoverAll(currentEpoch) {
    const unresolved = await this.scanOnStartup(currentEpoch);
    const results = [];
    for (const tx of unresolved) {
      if (!isFinalTransactionState(tx.state)) {
        const res = await this.recoverTransaction(tx.transactionId, currentEpoch);
        results.push(res);
      }
    }
    return Object.freeze(results);
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
  if (options?.controllerProvider) {
    const providerResult = await options.controllerProvider.isDomainController(cleanId, ctx.senderUserId, {
      record,
      document: doc
    });
    if (providerResult) {
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
            <form data-create-type="notable">
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
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      case "roles":
        return `
          <div class="dm-modal dm-create-role-modal" data-modal-type="role">
            <h3>Create Role</h3>
            <form data-create-type="role">
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
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      case "operationalGroups":
        return `
          <div class="dm-modal dm-create-group-modal" data-modal-type="group">
            <h3>Create Operational Group</h3>
            <form data-create-type="group">
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
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
              </div>
            </form>
          </div>
        `;
      default:
        return `
          <div class="dm-modal dm-create-default-modal">
            <h3>Create ${escapeHtml(createType)}</h3>
            <form data-create-type="${escapeAttribute(createType)}">
              <label>Name: <input type="text" name="name" required /></label>
              <div class="dm-modal-actions">
                <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
                <button type="submit" class="dm-btn dm-btn-primary">Create</button>
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
      let defaultPrevented = false;
      if (!event.preventDefault) {
        event.preventDefault = () => {
          defaultPrevented = true;
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
      if (!defaultPrevented && event.type === "click") {
        const isBtn = element.tagName === "BUTTON" || element.tagName === "INPUT" && attributes.type === "submit";
        const btnType = attributes.type ?? (element.tagName === "BUTTON" ? "submit" : "button");
        if (isBtn && btnType === "submit") {
          const form = element.closest?.("form");
          if (form) {
            form.dispatchEvent({ type: "submit", target: form });
          }
        }
      }
      return true;
    },
    async dispatchEventAsync(event) {
      event.target = element;
      let defaultPrevented = false;
      if (!event.preventDefault) {
        event.preventDefault = () => {
          defaultPrevented = true;
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
      if (!defaultPrevented && event.type === "click") {
        const isBtn = element.tagName === "BUTTON" || element.tagName === "INPUT" && attributes.type === "submit";
        const btnType = attributes.type ?? (element.tagName === "BUTTON" ? "submit" : "button");
        if (isBtn && btnType === "submit") {
          const form = element.closest?.("form");
          if (form) {
            await form.dispatchEventAsync({ type: "submit", target: form });
          }
        }
      }
      return true;
    },
    click() {
      element.dispatchEvent({ type: "click" });
    },
    async clickAsync() {
      await element.dispatchEventAsync({ type: "click" });
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
  get rendered() {
    return this.element !== null;
  }
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
  _attachActionListeners(element) {
    if (!element || element.__actionsBound) return;
    element.__actionsBound = true;
    const actions = this.constructor.DEFAULT_OPTIONS?.actions ?? {};
    element.addEventListener("click", async (event) => {
      const actionEl = event.target?.closest?.("[data-action]");
      if (!actionEl) return;
      const actionName = actionEl.getAttribute?.("data-action");
      if (actionName && typeof actions[actionName] === "function") {
        event.preventDefault?.();
        await actions[actionName].call(this, event, actionEl);
      }
    });
  }
  _onRender(context, options) {
  }
  async render(force, options) {
    if (!this.element) {
      const classes = (this.constructor.DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-people-app-v2"]).join(" ");
      if (typeof globalThis.document?.createElement === "function") {
        const el = globalThis.document.createElement("div");
        el.className = classes;
        this.element = el;
      } else {
        this.element = createMockElement("div", {
          className: classes
        });
      }
    }
    const context = await this._prepareContext(options);
    const result = await this._renderHTML(context, options);
    this._replaceHTML(result, this.element, options);
    this._attachActionListeners(this.element);
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
      closeModal: _PeopleApplication.#onCloseModal
    }
  };
  #controller;
  constructor(options) {
    super(options);
    this.#controller = new PeopleApplicationController(options);
  }
  get controller() {
    return this.#controller;
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
    const el = this.element;
    if (el) {
      this.attachEventListeners(el);
    }
  }
  attachEventListeners(element) {
    const forms = element.querySelectorAll?.("form") ?? [];
    forms.forEach((form) => {
      if (form.__submitBound) return;
      form.__submitBound = true;
      form.addEventListener?.("submit", async (event) => {
        event.preventDefault?.();
        await _PeopleApplication.#onSubmitCreate.call(this, event, form);
      });
    });
  }
  closeModal() {
    const el = this.element;
    if (el) {
      const backdrops = el.querySelectorAll?.(".dm-modal-backdrop") ?? [];
      backdrops.forEach((b) => b.remove?.());
    }
  }
  openCreateModal(createType) {
    this.closeModal();
    const modal = this.#controller.openCreateModal(createType);
    const el = this.element;
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

// src/domains/domain-controller-provider.ts
var DefaultDomainControllerProvider = class {
  #assignedControllers = /* @__PURE__ */ new Map();
  assignController(domainId, userId) {
    const cleanId = domainId.startsWith("JournalEntry.") ? domainId.slice("JournalEntry.".length) : domainId;
    let set = this.#assignedControllers.get(cleanId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.#assignedControllers.set(cleanId, set);
    }
    set.add(userId);
  }
  revokeController(domainId, userId) {
    const cleanId = domainId.startsWith("JournalEntry.") ? domainId.slice("JournalEntry.".length) : domainId;
    this.#assignedControllers.get(cleanId)?.delete(userId);
  }
  getControllers(domainId) {
    const cleanId = domainId.startsWith("JournalEntry.") ? domainId.slice("JournalEntry.".length) : domainId;
    const set = this.#assignedControllers.get(cleanId);
    return set ? Array.from(set) : [];
  }
  clear() {
    this.#assignedControllers.clear();
  }
  isDomainController(domainId, userId, context) {
    const cleanId = domainId.startsWith("JournalEntry.") ? domainId.slice("JournalEntry.".length) : domainId;
    const assigned = this.#assignedControllers.get(cleanId);
    if (assigned && assigned.has(userId)) {
      return true;
    }
    const record = context?.record ?? context?.document?.record;
    if (record?.definition?.capabilities?.config) {
      const config = record.definition.capabilities.config;
      const domainCapConfig = config["domain-manager:domain"];
      if (domainCapConfig && Array.isArray(domainCapConfig.controllers) && domainCapConfig.controllers.includes(userId)) {
        return true;
      }
      const generalControllers = config.controllers;
      if (Array.isArray(generalControllers) && generalControllers.includes(userId)) {
        return true;
      }
    }
    return false;
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

// src/core/versioning/build-metadata.ts
var BUILD_METADATA = Object.freeze({
  moduleVersion: "0.0.4",
  buildChannel: "dev",
  target: "foundry-vtt"
});

// src/economy/definitions/canonical-definitions.ts
var CANONICAL_RESOURCE_TREASURY = Object.freeze({
  id: "domain-manager:treasury",
  version: 1,
  label: "Treasury",
  description: "Standard sovereign treasury and fungible monetary currency.",
  icon: "fas fa-coins",
  categoryId: "currency",
  tags: Object.freeze(["currency", "monetary", "core"]),
  precision: 2,
  displayUnit: Object.freeze({
    singular: "credit",
    plural: "credits",
    abbreviation: "cr"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});
var CANONICAL_RESOURCE_SUPPLIES = Object.freeze({
  id: "domain-manager:supplies",
  version: 1,
  label: "Supplies",
  description: "General subsistence, provisions, rations and maintenance supplies.",
  icon: "fas fa-boxes",
  categoryId: "logistics",
  tags: Object.freeze(["logistics", "upkeep", "core"]),
  precision: 0,
  displayUnit: Object.freeze({
    singular: "crate",
    plural: "crates",
    abbreviation: "bx"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});
var CANONICAL_RESOURCE_MATERIALS = Object.freeze({
  id: "domain-manager:materials",
  version: 1,
  label: "Materials",
  description: "Raw and processed materials for construction, expansion and manufacturing.",
  icon: "fas fa-cubes",
  categoryId: "production",
  tags: Object.freeze(["production", "construction", "core"]),
  precision: 0,
  displayUnit: Object.freeze({
    singular: "unit",
    plural: "units",
    abbreviation: "mat"
  }),
  minimumMinor: 0,
  maximumMinor: null,
  allowNegative: false,
  defaultCapacityPolicy: "block",
  lifecycle: "active"
});
var DEFAULT_CANONICAL_RESOURCES = Object.freeze([
  CANONICAL_RESOURCE_TREASURY,
  CANONICAL_RESOURCE_SUPPLIES,
  CANONICAL_RESOURCE_MATERIALS
]);

// src/economy/definitions/resource-registry.ts
var ResourceDefinitionRegistry = class {
  #definitions = /* @__PURE__ */ new Map();
  #frozen = false;
  register(definition) {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_ECON_REGISTRY_FROZEN",
          category: "validation",
          message: "ResourceDefinitionRegistry is frozen and cannot accept new registrations"
        })
      );
    }
    const valRes = validateResourceDefinition(definition);
    if (!valRes.ok) {
      return valRes;
    }
    const validated = valRes.value;
    if (this.#definitions.has(validated.id)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_ALREADY_EXISTS",
          category: "validation",
          message: `ResourceDefinition already registered with ID '${validated.id}'`
        })
      );
    }
    this.#definitions.set(validated.id, validated);
    return ok(void 0);
  }
  get(id) {
    return this.#definitions.get(id);
  }
  has(id) {
    return this.#definitions.has(id);
  }
  unregister(id) {
    if (this.#frozen) {
      return false;
    }
    return this.#definitions.delete(id);
  }
  list(filter) {
    const all = Array.from(this.#definitions.values());
    if (!filter) {
      return Object.freeze(all);
    }
    const filtered = all.filter((d) => {
      if (filter.lifecycle !== void 0 && d.lifecycle !== filter.lifecycle) {
        return false;
      }
      if (filter.categoryId !== void 0 && d.categoryId !== filter.categoryId) {
        return false;
      }
      if (filter.tag !== void 0 && !d.tags.includes(filter.tag)) {
        return false;
      }
      return true;
    });
    return Object.freeze(filtered);
  }
  freeze() {
    this.#frozen = true;
  }
  isFrozen() {
    return this.#frozen;
  }
};
function createDefaultResourceRegistry() {
  const registry = new ResourceDefinitionRegistry();
  for (const def of DEFAULT_CANONICAL_RESOURCES) {
    const res = registry.register(def);
    if (!res.ok) {
      throw new Error(`Failed to register canonical resource '${def.id}': ${res.error.message}`);
    }
  }
  return registry;
}

// src/economy/ledger/ledger-types.ts
var CANONICAL_LEDGER_KINDS = Object.freeze([
  "opening-balance",
  "adjustment",
  "transfer-debit",
  "transfer-credit",
  "consumption",
  "production",
  "income",
  "upkeep",
  "fee",
  "waste",
  "decay",
  "conversion-debit",
  "conversion-credit",
  "reversal",
  "migration"
]);
function validateLedgerEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry must be an object"
      })
    );
  }
  const candidate = raw;
  if (typeof candidate.id !== "string" || !candidate.id.startsWith("led_")) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry ID must start with 'led_': received '${String(candidate.id)}'`
      })
    );
  }
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry domainUuid must be a non-empty string"
      })
    );
  }
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }
  const delta = candidate.deltaMinor;
  if (typeof delta !== "number" || !Number.isSafeInteger(delta) || delta === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `LedgerEntry deltaMinor must be a non-zero safe integer: received '${String(delta)}'`
      })
    );
  }
  const kind = candidate.kind;
  if (!CANONICAL_LEDGER_KINDS.includes(kind)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: `Invalid LedgerEntry kind: received '${String(kind)}'`
      })
    );
  }
  const sequence = candidate.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry sequence must be a positive safe integer >= 1"
      })
    );
  }
  const timestampReal = candidate.timestampReal;
  if (typeof timestampReal !== "number" || !Number.isFinite(timestampReal)) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry timestampReal must be a finite number"
      })
    );
  }
  if (!candidate.source || typeof candidate.source !== "object") {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry source must be an object"
      })
    );
  }
  const rawSource = candidate.source;
  if (typeof rawSource.type !== "string" || rawSource.type.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_LEDGER_INVALID",
        category: "validation",
        message: "LedgerEntry source.type must be a non-empty string"
      })
    );
  }
  const source = {
    type: rawSource.type.trim(),
    ...typeof rawSource.ref === "string" ? { ref: rawSource.ref.trim() } : {},
    ...typeof rawSource.reason === "string" ? { reason: rawSource.reason.trim() } : {},
    ...typeof rawSource.userId === "string" ? { userId: rawSource.userId.trim() } : {}
  };
  return ok({
    id: candidate.id,
    domainUuid: candidate.domainUuid.trim(),
    resourceId: candidate.resourceId,
    deltaMinor: delta,
    kind,
    timestampReal,
    ...typeof candidate.timestampWorld === "number" ? { timestampWorld: candidate.timestampWorld } : {},
    ...typeof candidate.transactionId === "string" ? { transactionId: candidate.transactionId } : {},
    ...typeof candidate.reservationId === "string" ? { reservationId: candidate.reservationId } : {},
    ...typeof candidate.reversesEntryId === "string" ? { reversesEntryId: candidate.reversesEntryId } : {},
    source,
    sequence
  });
}

// src/economy/storage/ledger-storage-adapter.ts
var LEDGER_STORAGE_SCHEMA_VERSION = 1;
var LEDGER_DOCUMENT_NAME = "[Domain Manager] Ledger Store";
var LEDGER_FLAG_NAMESPACE = "domain-manager-ledger";
function runtimeFromGlobals4() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalLedgerStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals4();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[LEDGER_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    return rawFlag;
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [LEDGER_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: LEDGER_DOCUMENT_NAME,
        flags: {
          [LEDGER_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) => d.name === LEDGER_DOCUMENT_NAME || Boolean(d.flags?.[LEDGER_FLAG_NAMESPACE])
    );
  }
};

// src/economy/ledger/ledger-store.ts
var LedgerStore = class {
  #entries = /* @__PURE__ */ new Map();
  #reversedTargetIds = /* @__PURE__ */ new Set();
  #sequenceIndex = [];
  #nextSequence = 1;
  #storageAdapter;
  #persistQueue = Promise.resolve();
  #lastPersistError = null;
  constructor(options = {}) {
    this.#storageAdapter = options.storageAdapter;
  }
  async rehydrate() {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#entries.clear();
      this.#reversedTargetIds.clear();
      this.#sequenceIndex.length = 0;
      for (const id of snapshot.reversedTargetIds) {
        this.#reversedTargetIds.add(id);
      }
      const sorted = [...snapshot.entries].sort((a, b) => a.sequence - b.sequence);
      for (const entry of sorted) {
        this.#entries.set(entry.id, entry);
        this.#sequenceIndex.push(entry);
      }
      const maxSeq = sorted.length > 0 ? sorted[sorted.length - 1].sequence : 0;
      this.#nextSequence = Math.max(snapshot.nextSequence ?? 1, maxSeq + 1);
    }
  }
  append(input) {
    const id = createOpaqueId("led");
    const sequence = this.#nextSequence;
    const fullEntry = {
      ...input,
      id,
      sequence,
      timestampReal: input.timestampReal ?? Date.now()
    };
    const valRes = validateLedgerEntry(fullEntry);
    if (!valRes.ok) {
      return valRes;
    }
    const entry = valRes.value;
    if (entry.reversesEntryId) {
      if (this.#reversedTargetIds.has(entry.reversesEntryId)) {
        return err(
          createPublicError({
            code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
            category: "validation",
            message: `Entry '${entry.reversesEntryId}' has already been reversed`
          })
        );
      }
      this.#reversedTargetIds.add(entry.reversesEntryId);
    }
    this.#entries.set(entry.id, entry);
    this.#sequenceIndex.push(entry);
    this.#nextSequence++;
    this.#schedulePersist();
    return ok(entry);
  }
  get(id) {
    return this.#entries.get(id);
  }
  query(filter) {
    const paged = this.queryPaged(filter);
    return paged.entries;
  }
  queryPaged(filter) {
    let list = this.#sequenceIndex;
    if (!filter) {
      return {
        entries: Object.freeze([...list]),
        totalCount: list.length,
        hasMore: false
      };
    }
    let filtered = list;
    if (filter.domainUuid !== void 0) {
      filtered = filtered.filter((e) => e.domainUuid === filter.domainUuid);
    }
    if (filter.resourceId !== void 0) {
      filtered = filtered.filter((e) => e.resourceId === filter.resourceId);
    }
    if (filter.allowedResourceIds !== void 0) {
      filtered = filtered.filter((e) => filter.allowedResourceIds.includes(e.resourceId));
    }
    if (filter.allowedDomainResourceKeys !== void 0) {
      const allowedSet = filter.allowedDomainResourceKeys instanceof Set ? filter.allowedDomainResourceKeys : new Set(filter.allowedDomainResourceKeys);
      filtered = filtered.filter((e) => {
        const cleanDom = e.domainUuid.startsWith("JournalEntry.") ? e.domainUuid.slice("JournalEntry.".length) : e.domainUuid;
        return allowedSet.has(`${e.domainUuid}:${e.resourceId}`) || allowedSet.has(`${cleanDom}:${e.resourceId}`) || allowedSet.has(`JournalEntry.${cleanDom}:${e.resourceId}`);
      });
    }
    if (filter.transactionId !== void 0) {
      filtered = filtered.filter((e) => e.transactionId === filter.transactionId);
    }
    if (filter.reservationId !== void 0) {
      filtered = filtered.filter((e) => e.reservationId === filter.reservationId);
    }
    if (filter.kind !== void 0) {
      filtered = filtered.filter((e) => e.kind === filter.kind);
    }
    if (filter.sourceType !== void 0) {
      filtered = filtered.filter((e) => e.source.type === filter.sourceType);
    }
    if (filter.sourceRef !== void 0) {
      filtered = filtered.filter((e) => e.source.ref === filter.sourceRef);
    }
    if (filter.fromSequence !== void 0) {
      filtered = filtered.filter((e) => e.sequence >= filter.fromSequence);
    }
    if (filter.toSequence !== void 0) {
      filtered = filtered.filter((e) => e.sequence <= filter.toSequence);
    }
    if (filter.afterSequence !== void 0) {
      filtered = filtered.filter((e) => e.sequence > filter.afterSequence);
    }
    if (filter.beforeSequence !== void 0) {
      filtered = filtered.filter((e) => e.sequence < filter.beforeSequence);
    }
    if (filter.sinceRealTime !== void 0) {
      filtered = filtered.filter((e) => e.timestampReal >= filter.sinceRealTime);
    }
    if (filter.untilRealTime !== void 0) {
      filtered = filtered.filter((e) => e.timestampReal <= filter.untilRealTime);
    }
    if (filter.sinceWorldTime !== void 0) {
      filtered = filtered.filter((e) => (e.timestampWorld ?? 0) >= filter.sinceWorldTime);
    }
    if (filter.untilWorldTime !== void 0) {
      filtered = filtered.filter((e) => (e.timestampWorld ?? 0) <= filter.untilWorldTime);
    }
    if (filter.cursor !== void 0) {
      const cursorSeq = parseInt(filter.cursor, 10);
      if (Number.isSafeInteger(cursorSeq)) {
        if (filter.direction === "desc") {
          filtered = filtered.filter((e) => e.sequence < cursorSeq);
        } else {
          filtered = filtered.filter((e) => e.sequence > cursorSeq);
        }
      }
    }
    const totalCount = filtered.length;
    const direction = filter.direction ?? (filter.recent ? "desc" : "asc");
    const sorted = [...filtered];
    if (direction === "desc") {
      sorted.sort((a, b) => b.sequence - a.sequence);
    } else {
      sorted.sort((a, b) => a.sequence - b.sequence);
    }
    let resultEntries = sorted;
    let hasMore = false;
    if (filter.limit !== void 0 && filter.limit > 0) {
      if (resultEntries.length > filter.limit) {
        hasMore = true;
        resultEntries = resultEntries.slice(0, filter.limit);
      }
    }
    const nextCursor = hasMore && resultEntries.length > 0 ? String(resultEntries[resultEntries.length - 1].sequence) : void 0;
    const prevCursor = resultEntries.length > 0 ? String(resultEntries[0].sequence) : void 0;
    return {
      entries: Object.freeze(resultEntries),
      totalCount,
      hasMore,
      nextCursor,
      prevCursor
    };
  }
  createReversal(targetEntryId, sourceOrReason, userId) {
    const source = typeof sourceOrReason === "string" ? { type: "reversal", reason: sourceOrReason, userId } : sourceOrReason;
    const target = this.#entries.get(targetEntryId);
    if (!target) {
      return err(
        createPublicError({
          code: "DM_ECON_LEDGER_ENTRY_NOT_FOUND",
          category: "validation",
          message: `Target LedgerEntry '${targetEntryId}' not found for reversal`
        })
      );
    }
    if (target.kind === "reversal") {
      return err(
        createPublicError({
          code: "DM_ECON_CANNOT_REVERSE_REVERSAL",
          category: "validation",
          message: `Cannot reverse entry '${targetEntryId}' because it is already a reversal`
        })
      );
    }
    if (this.#reversedTargetIds.has(targetEntryId)) {
      return err(
        createPublicError({
          code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
          category: "validation",
          message: `Entry '${targetEntryId}' has already been reversed`
        })
      );
    }
    return this.append({
      domainUuid: target.domainUuid,
      resourceId: target.resourceId,
      deltaMinor: -target.deltaMinor,
      // opposing amount
      kind: "reversal",
      timestampReal: Date.now(),
      reversesEntryId: target.id,
      source
    });
  }
  isReversed(entryId) {
    return this.#reversedTargetIds.has(entryId);
  }
  get count() {
    return this.#entries.size;
  }
  async flush() {
    if (!this.#storageAdapter) return;
    this.#schedulePersist();
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err3 = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err3;
    }
  }
  #schedulePersist() {
    if (!this.#storageAdapter) return;
    this.#persistQueue = this.#persistQueue.then(async () => {
      await this.#persist();
    }).catch((err3) => {
      this.#lastPersistError = err3 instanceof Error ? err3 : new Error(String(err3));
    });
  }
  async #persist() {
    if (!this.#storageAdapter) return;
    const snapshot = {
      schemaVersion: LEDGER_STORAGE_SCHEMA_VERSION,
      entries: this.#sequenceIndex,
      reversedTargetIds: Array.from(this.#reversedTargetIds),
      nextSequence: this.#nextSequence,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
};

// src/economy/reservations/reservation-types.ts
var CANONICAL_RESERVATION_STATUSES = Object.freeze([
  "active",
  "partially-consumed",
  "consumed",
  "released",
  "expired"
]);
var CANONICAL_RESERVATION_EVENT_TYPES = Object.freeze([
  "created",
  "partially-consumed",
  "consumed",
  "released",
  "expired",
  "adjusted"
]);
function validateReservation2(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation must be an object"
      })
    );
  }
  const candidate = raw;
  if (typeof candidate.id !== "string" || !candidate.id.startsWith("resv_")) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation ID must start with 'resv_': received '${String(candidate.id)}'`
      })
    );
  }
  if (typeof candidate.domainUuid !== "string" || candidate.domainUuid.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation domainUuid must be a non-empty string"
      })
    );
  }
  if (!isNamespacedResourceId(candidate.resourceId)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation resourceId must be namespaced: received '${String(candidate.resourceId)}'`
      })
    );
  }
  const orig = candidate.originalAmountMinor;
  if (typeof orig !== "number" || !Number.isSafeInteger(orig) || orig <= 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `originalAmountMinor must be a positive safe integer (> 0): received '${String(orig)}'`
      })
    );
  }
  const remaining = candidate.remainingAmountMinor;
  if (typeof remaining !== "number" || !Number.isSafeInteger(remaining) || remaining < 0 || remaining > orig) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `remainingAmountMinor must be between 0 and originalAmountMinor (${orig}): received '${String(remaining)}'`
      })
    );
  }
  const status = candidate.status;
  if (!CANONICAL_RESERVATION_STATUSES.includes(status)) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Invalid reservation status: received '${String(status)}'`
      })
    );
  }
  if (remaining === 0 && (status === "active" || status === "partially-consumed")) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: `Reservation with 0 remaining amount cannot have status '${status}'`
      })
    );
  }
  if (!candidate.source || typeof candidate.source !== "object") {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation source must be an object"
      })
    );
  }
  const rawSource = candidate.source;
  if (typeof rawSource.type !== "string" || rawSource.type.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_RESERVATION_INVALID",
        category: "validation",
        message: "Reservation source.type must be a non-empty string"
      })
    );
  }
  const source = {
    type: rawSource.type.trim(),
    ...typeof rawSource.ref === "string" ? { ref: rawSource.ref.trim() } : {},
    ...typeof rawSource.reason === "string" ? { reason: rawSource.reason.trim() } : {},
    ...typeof rawSource.userId === "string" ? { userId: rawSource.userId.trim() } : {}
  };
  const revision = typeof candidate.revision === "number" ? candidate.revision : 0;
  return ok({
    id: candidate.id,
    domainUuid: candidate.domainUuid.trim(),
    resourceId: candidate.resourceId,
    originalAmountMinor: orig,
    remainingAmountMinor: remaining,
    status,
    source,
    createdAtReal: typeof candidate.createdAtReal === "number" ? candidate.createdAtReal : Date.now(),
    ...typeof candidate.createdAtWorld === "number" ? { createdAtWorld: candidate.createdAtWorld } : {},
    ...typeof candidate.expiresAtWorld === "number" ? { expiresAtWorld: candidate.expiresAtWorld } : {},
    ...typeof candidate.expiresAtReal === "number" ? { expiresAtReal: candidate.expiresAtReal } : {},
    revision
  });
}

// src/economy/storage/reservation-storage-adapter.ts
var RESERVATION_STORAGE_SCHEMA_VERSION = 1;
var RESERVATION_DOCUMENT_NAME = "[Domain Manager] Reservation Store";
var RESERVATION_FLAG_NAMESPACE = "domain-manager-reservations";
function runtimeFromGlobals5() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalReservationStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals5();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[RESERVATION_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    return rawFlag;
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [RESERVATION_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: RESERVATION_DOCUMENT_NAME,
        flags: {
          [RESERVATION_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) => d.name === RESERVATION_DOCUMENT_NAME || Boolean(d.flags?.[RESERVATION_FLAG_NAMESPACE])
    );
  }
};

// src/economy/reservations/reservation-store.ts
var ReservationStore = class {
  #reservations = /* @__PURE__ */ new Map();
  #events = [];
  #storageAdapter;
  #persistQueue = Promise.resolve();
  #lastPersistError = null;
  constructor(options = {}) {
    this.#storageAdapter = options.storageAdapter;
  }
  async rehydrate() {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#reservations.clear();
      this.#events.length = 0;
      for (const res of snapshot.reservations) {
        this.#reservations.set(res.id, res);
      }
      for (const evt of snapshot.events) {
        this.#events.push(evt);
      }
    }
  }
  create(input) {
    const id = createOpaqueId("resv");
    const raw = {
      id,
      domainUuid: input.domainUuid,
      resourceId: input.resourceId,
      originalAmountMinor: input.originalAmountMinor,
      remainingAmountMinor: input.originalAmountMinor,
      status: "active",
      source: input.source,
      createdAtReal: Date.now(),
      ...input.createdAtWorld !== void 0 ? { createdAtWorld: input.createdAtWorld } : {},
      ...input.expiresAtWorld !== void 0 ? { expiresAtWorld: input.expiresAtWorld } : {},
      ...input.expiresAtReal !== void 0 ? { expiresAtReal: input.expiresAtReal } : {},
      revision: 0
    };
    const valRes = validateReservation2(raw);
    if (!valRes.ok) {
      return valRes;
    }
    const res = valRes.value;
    this.#reservations.set(res.id, res);
    this.#recordEvent({
      reservationId: res.id,
      type: "created",
      deltaMinor: res.originalAmountMinor,
      remainingAmountMinor: res.remainingAmountMinor,
      timestampReal: res.createdAtReal,
      timestampWorld: res.createdAtWorld,
      reason: res.source.reason,
      sourceRef: res.source.ref,
      userId: res.source.userId
    });
    this.#schedulePersist();
    return ok(res);
  }
  get(id) {
    return this.#reservations.get(id);
  }
  list(filter) {
    let all = Array.from(this.#reservations.values());
    if (!filter) {
      return Object.freeze(all);
    }
    if (filter.domainUuid !== void 0) {
      all = all.filter((r) => r.domainUuid === filter.domainUuid);
    }
    if (filter.resourceId !== void 0) {
      all = all.filter((r) => r.resourceId === filter.resourceId);
    }
    if (filter.status !== void 0) {
      all = all.filter((r) => r.status === filter.status);
    }
    if (filter.sourceRef !== void 0) {
      all = all.filter((r) => r.source.ref === filter.sourceRef);
    }
    return Object.freeze(all);
  }
  listEvents(reservationId) {
    if (reservationId) {
      return Object.freeze(this.#events.filter((e) => e.reservationId === reservationId));
    }
    return Object.freeze([...this.#events]);
  }
  getEvents(reservationId) {
    return this.listEvents(reservationId);
  }
  getReservedTotal(domainUuid, resourceId) {
    let total = 0;
    for (const r of this.#reservations.values()) {
      if (r.domainUuid === domainUuid && r.resourceId === resourceId && (r.status === "active" || r.status === "partially-consumed")) {
        total += r.remainingAmountMinor;
      }
    }
    return total;
  }
  consume(reservationId, amountMinor, options) {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }
    if (existing.status !== "active" && existing.status !== "partially-consumed") {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_ACTIVE",
          category: "validation",
          message: `Cannot consume from reservation in '${existing.status}' status`
        })
      );
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      return err(
        createPublicError({
          code: "DM_ECON_AMOUNT_INVALID",
          category: "validation",
          message: `Consumed amount must be a positive safe integer (> 0): received ${String(amountMinor)}`
        })
      );
    }
    if (amountMinor > existing.remainingAmountMinor) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_EXHAUSTED",
          category: "validation",
          message: `Requested consumption (${amountMinor}) exceeds remaining reserved amount (${existing.remainingAmountMinor})`
        })
      );
    }
    const newRemaining = existing.remainingAmountMinor - amountMinor;
    const newStatus = newRemaining === 0 ? "consumed" : "partially-consumed";
    const updated = {
      ...existing,
      remainingAmountMinor: newRemaining,
      status: newStatus,
      revision: existing.revision + 1
    };
    this.#reservations.set(reservationId, updated);
    this.#recordEvent({
      reservationId,
      type: newStatus,
      deltaMinor: -amountMinor,
      remainingAmountMinor: newRemaining,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason,
      userId: options?.userId
    });
    this.#schedulePersist();
    return ok({ reservation: updated, consumedAmount: amountMinor });
  }
  release(reservationId, amountMinor, options) {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }
    if (existing.status !== "active" && existing.status !== "partially-consumed") {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_ACTIVE",
          category: "validation",
          message: `Cannot release reservation in '${existing.status}' status`
        })
      );
    }
    const toRelease = amountMinor !== void 0 ? amountMinor : existing.remainingAmountMinor;
    if (!Number.isSafeInteger(toRelease) || toRelease <= 0) {
      return err(
        createPublicError({
          code: "DM_ECON_AMOUNT_INVALID",
          category: "validation",
          message: `Released amount must be a positive safe integer (> 0): received ${String(toRelease)}`
        })
      );
    }
    if (toRelease > existing.remainingAmountMinor) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_EXHAUSTED",
          category: "validation",
          message: `Requested release amount (${toRelease}) exceeds remaining reserved amount (${existing.remainingAmountMinor})`
        })
      );
    }
    const newRemaining = existing.remainingAmountMinor - toRelease;
    const newStatus = newRemaining === 0 ? "released" : "partially-consumed";
    const updated = {
      ...existing,
      remainingAmountMinor: newRemaining,
      status: newStatus,
      revision: existing.revision + 1
    };
    this.#reservations.set(reservationId, updated);
    this.#recordEvent({
      reservationId,
      type: "released",
      deltaMinor: -toRelease,
      remainingAmountMinor: newRemaining,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason,
      userId: options?.userId
    });
    this.#schedulePersist();
    return ok({ reservation: updated, releasedAmount: toRelease });
  }
  expire(reservationId, options) {
    const existing = this.#reservations.get(reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }
    if (existing.status === "consumed" || existing.status === "released" || existing.status === "expired") {
      return ok(existing);
    }
    const releasedAmount = existing.remainingAmountMinor;
    const updated = {
      ...existing,
      remainingAmountMinor: 0,
      status: "expired",
      revision: existing.revision + 1
    };
    this.#reservations.set(reservationId, updated);
    this.#recordEvent({
      reservationId,
      type: "expired",
      deltaMinor: -releasedAmount,
      remainingAmountMinor: 0,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason ?? "Reservation expired"
    });
    this.#schedulePersist();
    return ok(updated);
  }
  /**
   * Rolls back a consumed reservation to its pre-consumption state (G4-AUD-003, G4-AUD-002).
   * Restores remaining amount and status exactly as in snapshot, recording an 'adjusted' event.
   */
  rollbackConsume(snapshot, consumedAmount, options) {
    const current = this.#reservations.get(snapshot.id);
    const restored = {
      ...snapshot,
      revision: (current?.revision ?? snapshot.revision) + 1
    };
    this.#reservations.set(snapshot.id, restored);
    this.#recordEvent({
      reservationId: snapshot.id,
      type: "adjusted",
      deltaMinor: consumedAmount,
      remainingAmountMinor: restored.remainingAmountMinor,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason: options?.reason ?? "Rollback consumed reservation",
      userId: options?.userId
    });
    this.#schedulePersist();
    return ok(restored);
  }
  /**
   * Restores a reservation to an exact prior snapshot with an audit adjustment event.
   */
  restore(snapshot, reason, options) {
    const current = this.#reservations.get(snapshot.id);
    const currentRemaining = current ? current.remainingAmountMinor : 0;
    const delta = snapshot.remainingAmountMinor - currentRemaining;
    const restored = {
      ...snapshot,
      revision: (current?.revision ?? snapshot.revision) + 1
    };
    this.#reservations.set(snapshot.id, restored);
    this.#recordEvent({
      reservationId: snapshot.id,
      type: "adjusted",
      deltaMinor: delta,
      remainingAmountMinor: restored.remainingAmountMinor,
      timestampReal: Date.now(),
      timestampWorld: options?.worldTime,
      reason,
      userId: options?.userId
    });
    this.#schedulePersist();
    return ok(restored);
  }
  async flush() {
    if (!this.#storageAdapter) return;
    this.#schedulePersist();
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err3 = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err3;
    }
  }
  #schedulePersist() {
    if (!this.#storageAdapter) return;
    this.#persistQueue = this.#persistQueue.then(async () => {
      await this.#persist();
    }).catch((err3) => {
      this.#lastPersistError = err3 instanceof Error ? err3 : new Error(String(err3));
    });
  }
  #recordEvent(eventParams) {
    const event = {
      id: createOpaqueId("reve"),
      ...eventParams
    };
    this.#events.push(event);
  }
  async #persist() {
    if (!this.#storageAdapter) return;
    const snapshot = {
      schemaVersion: RESERVATION_STORAGE_SCHEMA_VERSION,
      reservations: Array.from(this.#reservations.values()),
      events: this.#events,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
};

// src/economy/definitions/custom-resource-store.ts
var CUSTOM_RESOURCE_STORAGE_SCHEMA_VERSION = 1;
var CUSTOM_RESOURCE_DOCUMENT_NAME = "[Domain Manager] Custom Resources";
var CUSTOM_RESOURCE_FLAG_NAMESPACE = "domain-manager-custom-resources";
var InMemoryCustomResourceStorageAdapter = class {
  #state;
  constructor(state) {
    this.#state = state ?? { snapshot: null };
  }
  async loadSnapshot() {
    return this.#state.snapshot ? structuredClone(this.#state.snapshot) : null;
  }
  async saveSnapshot(snapshot) {
    this.#state.snapshot = structuredClone(snapshot);
  }
  get state() {
    return this.#state;
  }
};
function runtimeFromGlobals6() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalCustomResourceStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals6();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[CUSTOM_RESOURCE_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    return rawFlag;
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [CUSTOM_RESOURCE_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: CUSTOM_RESOURCE_DOCUMENT_NAME,
        flags: {
          [CUSTOM_RESOURCE_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) => d.name === CUSTOM_RESOURCE_DOCUMENT_NAME || Boolean(d.flags?.[CUSTOM_RESOURCE_FLAG_NAMESPACE])
    );
  }
};
var CustomResourceDefinitionStore = class {
  #adapter;
  #definitions = /* @__PURE__ */ new Map();
  constructor(adapter = new InMemoryCustomResourceStorageAdapter()) {
    this.#adapter = adapter;
  }
  async rehydrate() {
    const snapshot = await this.#adapter.loadSnapshot();
    if (snapshot) {
      for (const def of snapshot.definitions) {
        this.#definitions.set(def.id, def);
      }
    }
    return this.list();
  }
  has(id) {
    return this.#definitions.has(id);
  }
  register(definition) {
    const valRes = validateResourceDefinition(definition);
    if (!valRes.ok) return valRes;
    this.#definitions.set(valRes.value.id, valRes.value);
    void this.#persist().catch(() => {
    });
    return ok(valRes.value);
  }
  async save(definition) {
    const previous = this.#definitions.get(definition.id);
    this.#definitions.set(definition.id, definition);
    try {
      await this.#persist();
    } catch (err3) {
      if (previous) {
        this.#definitions.set(definition.id, previous);
      } else {
        this.#definitions.delete(definition.id);
      }
      throw err3;
    }
  }
  get(id) {
    return this.#definitions.get(id);
  }
  list() {
    return Object.freeze(Array.from(this.#definitions.values()));
  }
  async #persist() {
    const snapshot = {
      schemaVersion: CUSTOM_RESOURCE_STORAGE_SCHEMA_VERSION,
      definitions: Array.from(this.#definitions.values()),
      updatedAt: Date.now()
    };
    await this.#adapter.saveSnapshot(snapshot);
  }
};

// src/economy/providers/provider-types.ts
function isNamespacedProviderId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value);
}
async function assertProviderHealthy(provider) {
  const health = await provider.getHealth();
  if (health.status === "unavailable" || health.status === "incompatible") {
    return err(
      createPublicError({
        code: "DM_ECON_PROVIDER_UNAVAILABLE",
        category: "provider",
        message: `Provider '${provider.providerId}' is ${health.status}: ${health.message ?? "No details provided"}`
      })
    );
  }
  return ok(health);
}
function assertDebitAllowedOnProviderBalance(balanceResult, providerId) {
  if (balanceResult.isStale) {
    return err(
      createPublicError({
        code: "DM_ECON_PROVIDER_STALE_CACHE",
        category: "provider",
        message: `Provider '${providerId}' balance is stale/cached; debit operations are strictly blocked`
      })
    );
  }
  return ok(void 0);
}

// src/economy/accounts/capacity-resolver.ts
function resolveEffectiveCapacity(baseCapacityMinor, modifiers = [], resourceDef) {
  if (baseCapacityMinor === null) {
    return {
      effectiveCapacityMinor: null,
      baseCapacityMinor: null,
      modifiers: Object.freeze([...modifiers]),
      hardLimitClamped: false
    };
  }
  if (!Number.isSafeInteger(baseCapacityMinor) || baseCapacityMinor < 0) {
    throw new Error(
      `baseCapacityMinor must be a non-negative safe integer or null, got: ${String(baseCapacityMinor)}`
    );
  }
  let totalCapacity = baseCapacityMinor;
  for (const mod of modifiers) {
    if (mod.active) {
      totalCapacity += mod.deltaMinor;
    }
  }
  if (totalCapacity < 0) {
    totalCapacity = 0;
  }
  if (!Number.isSafeInteger(totalCapacity)) {
    throw new Error(
      `Effective capacity overflowed safe integer bounds: ${totalCapacity}`
    );
  }
  let hardLimitClamped = false;
  if (resourceDef?.maximumMinor !== null && resourceDef?.maximumMinor !== void 0) {
    if (totalCapacity > resourceDef.maximumMinor) {
      totalCapacity = resourceDef.maximumMinor;
      hardLimitClamped = true;
    }
  }
  return {
    effectiveCapacityMinor: totalCapacity,
    baseCapacityMinor,
    modifiers: Object.freeze([...modifiers]),
    hardLimitClamped
  };
}
function evaluateCapacity(proposedBalanceMinor, effectiveCapacityMinor, policy, resourceDef) {
  if (!Number.isSafeInteger(proposedBalanceMinor)) {
    return {
      allowed: false,
      effectiveCapacityMinor,
      proposedBalanceMinor,
      excessMinor: 0,
      policy,
      error: createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Proposed balance must be a safe integer: received '${String(proposedBalanceMinor)}'`
      })
    };
  }
  if (resourceDef) {
    if (!resourceDef.allowNegative && proposedBalanceMinor < 0) {
      return {
        allowed: false,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor: 0,
        policy,
        error: createPublicError({
          code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
          category: "validation",
          message: `Resource '${resourceDef.id}' does not permit negative balance: proposed ${proposedBalanceMinor}`
        })
      };
    }
    if (resourceDef.minimumMinor !== null && resourceDef.minimumMinor !== void 0) {
      if (proposedBalanceMinor < resourceDef.minimumMinor) {
        return {
          allowed: false,
          effectiveCapacityMinor,
          proposedBalanceMinor,
          excessMinor: 0,
          policy,
          error: createPublicError({
            code: "DM_ECON_MINIMUM_EXCEEDED",
            category: "validation",
            message: `Proposed balance ${proposedBalanceMinor} is below absolute minimum ${resourceDef.minimumMinor}`
          })
        };
      }
    }
    if (resourceDef.maximumMinor !== null && resourceDef.maximumMinor !== void 0) {
      if (proposedBalanceMinor > resourceDef.maximumMinor) {
        return {
          allowed: false,
          effectiveCapacityMinor,
          proposedBalanceMinor,
          excessMinor: proposedBalanceMinor - resourceDef.maximumMinor,
          policy,
          error: createPublicError({
            code: "DM_ECON_CAPACITY_EXCEEDED",
            category: "validation",
            message: `Proposed balance ${proposedBalanceMinor} exceeds definition absolute maximum ${resourceDef.maximumMinor}`
          })
        };
      }
    }
  }
  if (effectiveCapacityMinor === null) {
    return {
      allowed: true,
      effectiveCapacityMinor: null,
      proposedBalanceMinor,
      excessMinor: 0,
      policy
    };
  }
  if (proposedBalanceMinor <= effectiveCapacityMinor) {
    return {
      allowed: true,
      effectiveCapacityMinor,
      proposedBalanceMinor,
      excessMinor: 0,
      policy
    };
  }
  const excessMinor = proposedBalanceMinor - effectiveCapacityMinor;
  switch (policy) {
    case "block":
      return {
        allowed: false,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        error: createPublicError({
          code: "DM_ECON_CAPACITY_EXCEEDED",
          category: "validation",
          message: `Proposed balance ${proposedBalanceMinor} exceeds effective capacity ${effectiveCapacityMinor} by ${excessMinor} minor units`
        })
      };
    case "allow-with-warning":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        warning: `Capacity exceeded by ${excessMinor} minor units (capacity: ${effectiveCapacityMinor}, proposed: ${proposedBalanceMinor})`
      };
    case "overflow":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy,
        warning: `Overflow detected: ${excessMinor} minor units exceed storage capacity`
      };
    case "provider":
      return {
        allowed: true,
        effectiveCapacityMinor,
        proposedBalanceMinor,
        excessMinor,
        policy
      };
  }
}

// src/economy/plans/economy-plan.ts
function buildAdjustPlan(params) {
  const warnings = [];
  const blockers = [];
  const domainUuids = Object.freeze([params.domainUuid]);
  if (!params.reason || params.reason.trim().length === 0) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_ADJUST_REASON_REQUIRED",
        category: "validation",
        message: "Manual adjustment strictly requires a non-empty reason"
      })
    );
  }
  const currentBalance = params.account ? params.account.balanceMinor : 0;
  let deltaMinor;
  if (params.deltaMinor !== void 0) {
    deltaMinor = params.deltaMinor;
  } else if (params.targetBalanceMinor !== void 0) {
    deltaMinor = params.targetBalanceMinor - currentBalance;
  } else {
    blockers.push(
      createPublicError({
        code: "DM_ECON_ADJUST_INVALID",
        category: "validation",
        message: "Adjust requires either deltaMinor or targetBalanceMinor"
      })
    );
    deltaMinor = 0;
  }
  if (!Number.isSafeInteger(deltaMinor)) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Adjustment delta must be a safe integer: received '${String(deltaMinor)}'`
      })
    );
  }
  if (deltaMinor === 0 && blockers.length === 0) {
    warnings.push("Adjustment delta is zero: operation is a no-op");
  }
  const proposedBalance = currentBalance + deltaMinor;
  if (!Number.isSafeInteger(proposedBalance)) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_OVERFLOW",
        category: "validation",
        message: `Proposed balance ${proposedBalance} overflows safe integer limits`
      })
    );
  }
  const capEval = evaluateCapacity(
    proposedBalance,
    params.effectiveCapacityMinor,
    params.definition.defaultCapacityPolicy,
    params.definition
  );
  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }
  const ledgerIntents = [];
  if (deltaMinor !== 0 && blockers.length === 0) {
    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.resourceId,
      deltaMinor,
      kind: "adjustment",
      source: {
        type: "manual",
        reason: params.reason.trim(),
        userId: params.userId
      }
    });
  }
  const isNoop = deltaMinor === 0;
  return {
    planId: createOpaqueId("plan"),
    planType: "adjust",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0,
    isNoop,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function buildTransferPlan(params) {
  const warnings = [];
  const blockers = [];
  const domainUuids = Object.freeze(
    [params.sourceDomainUuid, params.targetDomainUuid].sort((a, b) => a.localeCompare(b))
  );
  if (params.sourceDomainUuid === params.targetDomainUuid) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_TRANSFER_SAME_DOMAIN",
        category: "validation",
        message: "Transfer source and target domain cannot be the same"
      })
    );
  }
  if (typeof params.amountMinor !== "number" || !Number.isSafeInteger(params.amountMinor) || params.amountMinor <= 0) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Transfer amount must be a positive safe integer: received '${String(params.amountMinor)}'`
      })
    );
  }
  const sourceBalance = params.sourceAccount?.balanceMinor ?? 0;
  const sourceReserved = params.sourceReservedMinor ?? 0;
  const sourceAvailable = sourceBalance - sourceReserved;
  if (params.amountMinor > sourceAvailable) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_INSUFFICIENT_AVAILABLE",
        category: "validation",
        message: `Insufficient available funds for transfer: available is ${sourceAvailable}, requested ${params.amountMinor}`
      })
    );
  }
  const targetBalance = params.targetAccount?.balanceMinor ?? 0;
  const proposedTargetBalance = targetBalance + params.amountMinor;
  const capEval = evaluateCapacity(
    proposedTargetBalance,
    params.targetCapacityMinor,
    params.definition.defaultCapacityPolicy,
    params.definition
  );
  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }
  const ledgerIntents = [];
  if (blockers.length === 0) {
    ledgerIntents.push({
      domainUuid: params.sourceDomainUuid,
      resourceId: params.resourceId,
      deltaMinor: -params.amountMinor,
      kind: "transfer-debit",
      source: {
        type: "transfer",
        ref: `transfer_to:${params.targetDomainUuid}`,
        reason: params.reason,
        userId: params.userId
      }
    });
    ledgerIntents.push({
      domainUuid: params.targetDomainUuid,
      resourceId: params.resourceId,
      deltaMinor: params.amountMinor,
      kind: "transfer-credit",
      source: {
        type: "transfer",
        ref: `transfer_from:${params.sourceDomainUuid}`,
        reason: params.reason,
        userId: params.userId
      }
    });
  }
  return {
    planId: createOpaqueId("plan"),
    planType: "transfer",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function buildConvertPlan(params) {
  const warnings = [];
  const blockers = [];
  const domainUuids = Object.freeze([params.domainUuid]);
  if (params.fromResourceId === params.toResourceId) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_CONVERT_SAME_RESOURCE",
        category: "validation",
        message: "Conversion source and target resource cannot be the same"
      })
    );
  }
  if (typeof params.fromAmountMinor !== "number" || !Number.isSafeInteger(params.fromAmountMinor) || params.fromAmountMinor <= 0) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `fromAmountMinor must be a positive safe integer: received '${String(params.fromAmountMinor)}'`
      })
    );
  }
  if (typeof params.toAmountMinor !== "number" || !Number.isSafeInteger(params.toAmountMinor) || params.toAmountMinor <= 0) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `toAmountMinor must be a positive safe integer: received '${String(params.toAmountMinor)}'`
      })
    );
  }
  const fromBalance = params.fromAccount?.balanceMinor ?? 0;
  const fromReserved = params.fromReservedMinor ?? 0;
  const fromAvailable = fromBalance - fromReserved;
  if (params.fromAmountMinor > fromAvailable) {
    blockers.push(
      createPublicError({
        code: "DM_ECON_INSUFFICIENT_AVAILABLE",
        category: "validation",
        message: `Insufficient available funds for conversion: available is ${fromAvailable}, required ${params.fromAmountMinor}`
      })
    );
  }
  const toBalance = params.toAccount?.balanceMinor ?? 0;
  const proposedToBalance = toBalance + params.toAmountMinor;
  const capEval = evaluateCapacity(
    proposedToBalance,
    params.toCapacityMinor,
    params.toDefinition.defaultCapacityPolicy,
    params.toDefinition
  );
  if (!capEval.allowed && capEval.error) {
    blockers.push(capEval.error);
  }
  if (capEval.warning) {
    warnings.push(capEval.warning);
  }
  const ledgerIntents = [];
  if (blockers.length === 0) {
    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.fromResourceId,
      deltaMinor: -params.fromAmountMinor,
      kind: "conversion-debit",
      source: {
        type: "conversion",
        ref: `converted_to:${params.toResourceId}`,
        reason: params.reason ?? params.rateDescription,
        userId: params.userId
      }
    });
    ledgerIntents.push({
      domainUuid: params.domainUuid,
      resourceId: params.toResourceId,
      deltaMinor: params.toAmountMinor,
      kind: "conversion-credit",
      source: {
        type: "conversion",
        ref: `converted_from:${params.fromResourceId}`,
        reason: params.reason ?? params.rateDescription,
        userId: params.userId
      }
    });
  }
  return {
    planId: createOpaqueId("plan"),
    planType: "convert",
    domainUuids,
    ledgerIntents: Object.freeze(ledgerIntents),
    reservationEffects: Object.freeze([]),
    warnings: Object.freeze(warnings),
    blockers: Object.freeze(blockers),
    isExecutable: blockers.length === 0,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/economy/services/economy-service.ts
var EconomyService = class {
  #domains;
  #resourceRegistry;
  #ledgerStore;
  #reservationStore;
  #lockManager;
  #transactionStore;
  #recoveryService;
  #providerRegistry;
  #thresholdService;
  #derivedResolvers;
  constructor(options) {
    this.#domains = options.domains;
    this.#resourceRegistry = options.resourceRegistry;
    this.#ledgerStore = options.ledgerStore;
    this.#reservationStore = options.reservationStore;
    this.#lockManager = options.lockManager ?? new LockManager();
    this.#transactionStore = options.transactionStore;
    this.#recoveryService = options.recoveryService;
    this.#providerRegistry = options.providerRegistry;
    this.#thresholdService = options.thresholdService;
    this.#derivedResolvers = options.derivedResolvers;
    if (this.#recoveryService) {
      this.#registerRecoveryCompensators(this.#recoveryService);
    }
  }
  get registry() {
    return this.#resourceRegistry;
  }
  get ledgerStore() {
    return this.#ledgerStore;
  }
  get reservationStore() {
    return this.#reservationStore;
  }
  get providerRegistry() {
    return this.#providerRegistry;
  }
  get thresholdService() {
    return this.#thresholdService;
  }
  getResourceDefinition(resourceId) {
    return this.#resourceRegistry.get(resourceId);
  }
  async getAccount(domainUuid, resourceId) {
    const docRes = await this.#domains.read(this.#cleanUuid(domainUuid));
    if (!docRes.ok) {
      return docRes;
    }
    const econDataRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econDataRes.ok) {
      return econDataRes;
    }
    const acc = econDataRes.value.accounts.find((a) => a.resourceId === resourceId);
    return ok(acc);
  }
  async getAllAccounts(domainUuid) {
    const docRes = await this.#domains.read(this.#cleanUuid(domainUuid));
    if (!docRes.ok) {
      return docRes;
    }
    const econDataRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econDataRes.ok) {
      return econDataRes;
    }
    return ok(econDataRes.value.accounts);
  }
  async getAccountAvailability(domainUuid, resourceId) {
    const accRes = await this.getAccount(domainUuid, resourceId);
    if (!accRes.ok) {
      return accRes;
    }
    const acc = accRes.value;
    if (!acc) {
      return ok(void 0);
    }
    if (acc.mode === "native") {
      const reservedMinor2 = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
      const availableMinor = acc.balanceMinor - reservedMinor2;
      const def = this.#resourceRegistry.get(resourceId);
      const effectiveCap = resolveEffectiveCapacity(acc.baseCapacityMinor, [], def);
      return ok({
        account: acc,
        balanceMinor: acc.balanceMinor,
        reservedMinor: reservedMinor2,
        availableMinor,
        effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
      });
    }
    if (acc.mode === "provider") {
      let balanceMinor2 = 0;
      let capacityMinor = null;
      let isStale2 = false;
      let isUnavailable2 = false;
      if (this.#providerRegistry) {
        const provider = this.#providerRegistry.get(acc.providerId);
        if (provider && "readBalance" in provider) {
          const balRes = await provider.readBalance(domainUuid, resourceId, acc.providerRef);
          if (balRes?.ok) {
            balanceMinor2 = balRes.value.balanceMinor;
            capacityMinor = balRes.value.effectiveCapacityMinor ?? null;
            isStale2 = Boolean(balRes.value.isStale);
          } else {
            isUnavailable2 = true;
          }
        } else {
          isUnavailable2 = true;
        }
      } else {
        isUnavailable2 = true;
      }
      const reservedMinor2 = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
      const availableMinor = balanceMinor2 - reservedMinor2;
      return ok({
        account: acc,
        balanceMinor: balanceMinor2,
        reservedMinor: reservedMinor2,
        availableMinor,
        effectiveCapacityMinor: capacityMinor,
        isStale: isStale2,
        isUnavailable: isUnavailable2
      });
    }
    const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
    let balanceMinor = 0;
    let isUnavailable = true;
    let isStale = false;
    if (this.#derivedResolvers) {
      const resolver = this.#derivedResolvers.get(acc.resolverId);
      if (resolver) {
        const res = await resolver(domainUuid, acc);
        if (res.ok) {
          balanceMinor = res.value.balanceMinor;
          isStale = Boolean(res.value.isStale);
          isUnavailable = false;
        }
      }
    }
    return ok({
      account: acc,
      balanceMinor,
      reservedMinor,
      availableMinor: balanceMinor - reservedMinor,
      effectiveCapacityMinor: null,
      isStale,
      isUnavailable
    });
  }
  async createAccount(params) {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }
    const mode = params.mode ?? "native";
    let newAccount;
    if (mode === "provider") {
      if (!params.providerId || !params.providerRef) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Provider account requires providerId and providerRef"
          })
        );
      }
      newAccount = {
        mode: "provider",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        providerId: params.providerId,
        providerRef: params.providerRef,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    } else if (mode === "derived") {
      if (!params.resolverId) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_INVALID",
            category: "validation",
            message: "Derived account requires resolverId"
          })
        );
      }
      newAccount = {
        mode: "derived",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        resolverId: params.resolverId,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    } else {
      const initialBalance = params.initialBalanceMinor ?? 0;
      if (!Number.isSafeInteger(initialBalance)) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "initialBalanceMinor must be a safe integer"
          })
        );
      }
      if (!def.allowNegative && initialBalance < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
            category: "validation",
            message: `Resource '${params.resourceId}' does not allow negative balances`
          })
        );
      }
      newAccount = {
        mode: "native",
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        balanceMinor: initialBalance,
        baseCapacityMinor: params.baseCapacityMinor ?? null,
        visibility: params.visibility ?? "public",
        status: "active"
      };
    }
    const valRes = validateResourceAccount(newAccount);
    if (!valRes.ok) {
      return valRes;
    }
    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `create-account:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const existing = econData.accounts.find((a) => a.resourceId === params.resourceId);
      if (existing) {
        if (existing.status === "closed") {
          const reactivated = {
            ...newAccount,
            ...newAccount.mode === "native" ? { balanceMinor: params.initialBalanceMinor ?? 0 } : {}
          };
          const updatedAccounts2 = econData.accounts.map(
            (a) => a.resourceId === params.resourceId ? reactivated : a
          );
          const updatedRecord2 = withDomainEconomyData(doc.record, {
            ...econData,
            accounts: Object.freeze(updatedAccounts2)
          });
          const updateRes2 = await this.#domains.update({ ...doc, record: updatedRecord2 });
          if (!updateRes2.ok) return updateRes2;
          return ok(reactivated);
        }
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_ALREADY_EXISTS",
            category: "conflict",
            message: `Account for resource '${params.resourceId}' already exists in domain '${params.domainUuid}'`
          })
        );
      }
      const updatedAccounts = [...econData.accounts, newAccount];
      const updatedEconData = {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      };
      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;
      if (newAccount.mode === "native" && newAccount.balanceMinor !== 0) {
        this.#ledgerStore.append({
          domainUuid: params.domainUuid,
          resourceId: params.resourceId,
          deltaMinor: newAccount.balanceMinor,
          kind: "opening-balance",
          source: {
            type: "init",
            reason: params.reason ?? "Account creation opening balance",
            userId: params.userId
          }
        });
        await this.#ledgerStore.flush();
      }
      return ok(newAccount);
    } finally {
      await lockRes.value.release();
    }
  }
  async closeAccount(params) {
    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `close-account:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const acc = econData.accounts.find((a) => a.resourceId === params.resourceId);
      if (!acc) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account for resource '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      if (acc.mode === "native") {
        if (acc.balanceMinor !== 0) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_NOT_EMPTY",
              category: "validation",
              message: `Cannot close account '${params.resourceId}' with non-zero balance: ${acc.balanceMinor}`
            })
          );
        }
        const activeReserved = this.#reservationStore.getReservedTotal(params.domainUuid, params.resourceId);
        if (activeReserved > 0) {
          return err(
            createPublicError({
              code: "DM_ECON_ACCOUNT_HAS_RESERVATIONS",
              category: "validation",
              message: `Cannot close account '${params.resourceId}' with active reservations total: ${activeReserved}`
            })
          );
        }
      }
      const hasHistory = this.#ledgerStore.query({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        limit: 1
      }).length > 0;
      let updatedAccounts;
      let softClosed = false;
      if (hasHistory) {
        softClosed = true;
        updatedAccounts = econData.accounts.map(
          (a) => a.resourceId === params.resourceId ? { ...a, status: "closed", closedAt: Date.now() } : a
        );
      } else {
        updatedAccounts = econData.accounts.filter((a) => a.resourceId !== params.resourceId);
      }
      const updatedEconData = {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      };
      const updatedRecord = withDomainEconomyData(doc.record, updatedEconData);
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) return updateRes;
      return ok({ success: true, softClosed });
    } finally {
      await lockRes.value.release();
    }
  }
  async previewAdjust(params) {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }
    const accRes = await this.getAccount(params.domainUuid, params.resourceId);
    if (!accRes.ok) return accRes;
    const account = accRes.value?.mode === "native" ? accRes.value : void 0;
    const effectiveCap = resolveEffectiveCapacity(account?.baseCapacityMinor ?? null, [], def);
    const plan = buildAdjustPlan({
      domainUuid: params.domainUuid,
      resourceId: params.resourceId,
      deltaMinor: params.deltaMinor,
      targetBalanceMinor: params.targetBalanceMinor,
      reason: params.reason,
      userId: params.userId,
      account,
      definition: def,
      effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
    });
    return ok(plan);
  }
  async commitAdjust(params) {
    const lockKey = `domain:${params.domainUuid}`;
    const txId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `adjust:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const def = this.#resourceRegistry.get(params.resourceId);
      if (!def) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.resourceId}' is not registered`
          })
        );
      }
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (accIndex < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account for resource '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const existingAccount = econData.accounts[accIndex];
      if (existingAccount.mode === "derived") {
        return err(
          createPublicError({
            code: "DM_ECON_DERIVED_ACCOUNT_READ_ONLY",
            category: "validation",
            message: `Account '${params.resourceId}' is derived and cannot be adjusted manually`
          })
        );
      }
      if (existingAccount.mode === "provider") {
        const providerAccount = existingAccount;
        if (!this.#providerRegistry) {
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_UNAVAILABLE",
              category: "provider",
              message: "Provider registry is not available"
            })
          );
        }
        const provider = this.#providerRegistry.get(providerAccount.providerId);
        if (!provider || !("mutateBalance" in provider)) {
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_UNAVAILABLE",
              category: "provider",
              message: `Provider '${providerAccount.providerId}' is unavailable or does not support balance mutations`
            })
          );
        }
        const healthRes = await assertProviderHealthy(provider);
        if (!healthRes.ok) {
          return healthRes;
        }
        const delta = params.deltaMinor ?? 0;
        if (delta === 0) {
          return ok({
            account: providerAccount,
            entry: void 0,
            isNoop: true
          });
        }
        if (delta < 0 && "readBalance" in provider && typeof provider.readBalance === "function") {
          const balRes = await provider.readBalance(
            params.domainUuid,
            params.resourceId,
            providerAccount.providerRef
          );
          if (!balRes.ok) {
            return err(
              createPublicError({
                code: "DM_ECON_PROVIDER_UNAVAILABLE",
                category: "provider",
                message: `Failed to read fresh balance from provider before debit: ${balRes.error.message}`
              })
            );
          }
          const debitCheck = assertDebitAllowedOnProviderBalance(balRes.value, providerAccount.providerId);
          if (!debitCheck.ok) {
            return debitCheck;
          }
          if (balRes.value.balanceMinor + delta < 0) {
            return err(
              createPublicError({
                code: "DM_ECON_INSUFFICIENT_FUNDS",
                category: "validation",
                message: `Insufficient funds in provider account '${params.resourceId}'. Current: ${balRes.value.balanceMinor}, required: ${Math.abs(delta)}`
              })
            );
          }
        }
        const transactionId = createOpaqueId("tx");
        const cmdId = params.commandId ?? createOpaqueId("cmd");
        const epoch = params.authorityEpoch ?? 1;
        const txRecord = createTransactionRecord({
          transactionId,
          commandId: cmdId,
          authorityEpoch: epoch,
          lockKeys: [lockKey],
          safeAutoRecovery: true,
          recoveryData: {
            type: "economy:provider-adjust",
            domainUuid: params.domainUuid,
            resourceId: params.resourceId,
            providerId: providerAccount.providerId,
            providerRef: providerAccount.providerRef,
            deltaMinor: delta,
            reason: params.reason,
            userId: params.userId,
            providerWriteConfirmed: false
          }
        });
        this.#transactionStore?.save(txRecord);
        this.#transactionStore?.transition(transactionId, "claimed", epoch);
        this.#transactionStore?.transition(transactionId, "prepared", epoch);
        this.#transactionStore?.transition(transactionId, "committing", epoch);
        await this.#transactionStore?.flush();
        let mutRes;
        let unknownOutcome = false;
        try {
          mutRes = await provider.mutateBalance(
            params.domainUuid,
            params.resourceId,
            providerAccount.providerRef,
            delta,
            params.reason,
            { operationRef: transactionId }
          );
        } catch (caughtErr) {
          unknownOutcome = true;
          mutRes = err(
            createPublicError({
              code: "DM_ECON_PROVIDER_TIMEOUT",
              category: "provider",
              message: `Provider mutation timed out or threw unknown error: ${caughtErr instanceof Error ? caughtErr.message : String(caughtErr)}`,
              details: { outcome: "unknown" }
            })
          );
        }
        if (!mutRes.ok) {
          const isUnknown = unknownOutcome || mutRes.error.code === "DM_ECON_PROVIDER_TIMEOUT" || mutRes.error.details?.outcome === "unknown" || mutRes.error.retryable === true;
          if (isUnknown) {
            this.#transactionStore?.transition(
              transactionId,
              "needs-recovery",
              epoch,
              `Provider mutation outcome unknown: ${mutRes.error.message}`
            );
            await this.#transactionStore?.flush();
            return mutRes;
          }
          this.#transactionStore?.transition(transactionId, "failed", epoch, mutRes.error.message);
          await this.#transactionStore?.flush();
          return mutRes;
        }
        const valueOutcome = mutRes.value?.outcome;
        if (valueOutcome === "unknown") {
          this.#transactionStore?.transition(
            transactionId,
            "needs-recovery",
            epoch,
            "Provider mutation outcome is unknown despite successful call"
          );
          await this.#transactionStore?.flush();
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_TIMEOUT",
              category: "provider",
              message: "Provider mutation outcome is unknown; transaction transitioned to needs-recovery",
              details: { outcome: "unknown" }
            })
          );
        }
        if (valueOutcome === "failed-before-write") {
          this.#transactionStore?.transition(
            transactionId,
            "failed",
            epoch,
            "Provider mutation failed before write"
          );
          await this.#transactionStore?.flush();
          return err(
            createPublicError({
              code: "DM_ECON_PROVIDER_MUTATION_FAILED",
              category: "provider",
              message: "Provider reported mutation failed before write",
              details: { outcome: "failed-before-write" }
            })
          );
        }
        txRecord.recoveryData.providerWriteConfirmed = true;
        if (mutRes.value?.providerTransactionRef) {
          txRecord.recoveryData.providerTransactionRef = mutRes.value.providerTransactionRef;
        }
        const entryRes2 = this.#ledgerStore.append({
          domainUuid: params.domainUuid,
          resourceId: params.resourceId,
          deltaMinor: delta,
          kind: "adjustment",
          transactionId,
          source: {
            type: "adjustment",
            ref: providerAccount.providerRef,
            reason: params.reason,
            userId: params.userId
          }
        });
        if (!entryRes2.ok) {
          this.#transactionStore?.transition(
            transactionId,
            "needs-recovery",
            epoch,
            "Failed to append ledger entry after provider mutation"
          );
          await this.#transactionStore?.flush();
          return entryRes2;
        }
        await this.#ledgerStore.flush();
        if (typeof provider.flush === "function") {
          try {
            await provider.flush();
          } catch (flushErr) {
            this.#transactionStore?.transition(
              transactionId,
              "needs-recovery",
              epoch,
              `Provider persistence flush failed: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`
            );
            await this.#transactionStore?.flush();
            return err(
              createPublicError({
                code: "DM_ECON_PROVIDER_STORAGE_ERROR",
                category: "provider",
                message: `Provider persistence flush failed: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`
              })
            );
          }
        }
        this.#transactionStore?.transition(
          transactionId,
          "committed",
          epoch,
          "Provider adjust completed cleanly"
        );
        await this.#transactionStore?.flush();
        this.#evaluateThresholds(
          params.domainUuid,
          params.resourceId,
          mutRes.value.newBalanceMinor ?? mutRes.value.balanceMinor,
          null
        );
        return ok({
          account: providerAccount,
          entry: entryRes2.value,
          isNoop: false,
          transactionId
        });
      }
      const nativeAccount = existingAccount;
      const effectiveCap = resolveEffectiveCapacity(nativeAccount.baseCapacityMinor, [], def);
      const plan = buildAdjustPlan({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        deltaMinor: params.deltaMinor,
        targetBalanceMinor: params.targetBalanceMinor,
        reason: params.reason,
        userId: params.userId,
        account: nativeAccount,
        definition: def,
        effectiveCapacityMinor: effectiveCap.effectiveCapacityMinor
      });
      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ?? createPublicError({
            code: "DM_ECON_PLAN_INVALID",
            category: "validation",
            message: "Adjust plan is not executable"
          })
        );
      }
      if (plan.isNoop || !plan.ledgerIntents[0] || plan.ledgerIntents[0].deltaMinor === 0) {
        return ok({
          account: existingAccount,
          entry: void 0,
          isNoop: true
        });
      }
      const intent = plan.ledgerIntents[0];
      const newBalance = existingAccount.balanceMinor + intent.deltaMinor;
      const updatedAccount = {
        ...existingAccount,
        balanceMinor: newBalance
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });
      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) return updateDocRes;
      const entryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        deltaMinor: intent.deltaMinor,
        kind: intent.kind,
        source: intent.source
      });
      if (!entryRes.ok) {
        await this.#domains.update(doc);
        return entryRes;
      }
      await this.#ledgerStore.flush();
      this.#evaluateThresholds(
        params.domainUuid,
        params.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );
      return ok({
        account: updatedAccount,
        entry: entryRes.value
      });
    } finally {
      await lockRes.value.release();
    }
  }
  async previewTransfer(params) {
    const def = this.#resourceRegistry.get(params.resourceId);
    if (!def) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.resourceId}' is not registered`
        })
      );
    }
    const srcAccRes = await this.getAccount(params.sourceDomainUuid, params.resourceId);
    if (!srcAccRes.ok) return srcAccRes;
    const srcAccount = srcAccRes.value?.mode === "native" ? srcAccRes.value : void 0;
    const tgtAccRes = await this.getAccount(params.targetDomainUuid, params.resourceId);
    if (!tgtAccRes.ok) return tgtAccRes;
    const tgtAccount = tgtAccRes.value?.mode === "native" ? tgtAccRes.value : void 0;
    const srcReserved = this.#reservationStore.getReservedTotal(
      params.sourceDomainUuid,
      params.resourceId
    );
    const tgtEffectiveCap = resolveEffectiveCapacity(tgtAccount?.baseCapacityMinor ?? null, [], def);
    const plan = buildTransferPlan({
      sourceDomainUuid: params.sourceDomainUuid,
      targetDomainUuid: params.targetDomainUuid,
      resourceId: params.resourceId,
      amountMinor: params.amountMinor,
      reason: params.reason,
      userId: params.userId,
      sourceAccount: srcAccount,
      sourceReservedMinor: srcReserved,
      targetAccount: tgtAccount,
      definition: def,
      targetCapacityMinor: tgtEffectiveCap.effectiveCapacityMinor
    });
    return ok(plan);
  }
  async commitTransfer(params) {
    if (params.sourceDomainUuid === params.targetDomainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_TRANSFER_SAME_DOMAIN",
          category: "validation",
          message: "Transfer source and target domain cannot be the same"
        })
      );
    }
    const lockKeys = [params.sourceDomainUuid, params.targetDomainUuid].sort((a, b) => a.localeCompare(b)).map((u) => `domain:${u}`);
    const transactionId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `transfer:${transactionId}`,
      keys: lockKeys
    });
    if (!lockRes.ok) return lockRes;
    try {
      const def = this.#resourceRegistry.get(params.resourceId);
      if (!def) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.resourceId}' is not registered`
          })
        );
      }
      const srcDocRes = await this.#domains.read(this.#cleanUuid(params.sourceDomainUuid));
      if (!srcDocRes.ok) return srcDocRes;
      const srcDoc = srcDocRes.value;
      const tgtDocRes = await this.#domains.read(this.#cleanUuid(params.targetDomainUuid));
      if (!tgtDocRes.ok) return tgtDocRes;
      const tgtDoc = tgtDocRes.value;
      const srcEcon = getDomainEconomyData(srcDoc.record);
      const srcAccIndex = srcEcon.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (srcAccIndex < 0 || srcEcon.accounts[srcAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Source domain '${params.sourceDomainUuid}' does not have a native account for '${params.resourceId}'`
          })
        );
      }
      const srcAccount = srcEcon.accounts[srcAccIndex];
      const tgtEcon = getDomainEconomyData(tgtDoc.record);
      const tgtAccIndex = tgtEcon.accounts.findIndex((a) => a.resourceId === params.resourceId);
      if (tgtAccIndex < 0 || tgtEcon.accounts[tgtAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Target domain '${params.targetDomainUuid}' does not have a native account for '${params.resourceId}'`
          })
        );
      }
      const tgtAccount = tgtEcon.accounts[tgtAccIndex];
      const srcReserved = this.#reservationStore.getReservedTotal(
        params.sourceDomainUuid,
        params.resourceId
      );
      const tgtEffectiveCap = resolveEffectiveCapacity(tgtAccount.baseCapacityMinor, [], def);
      const plan = buildTransferPlan({
        sourceDomainUuid: params.sourceDomainUuid,
        targetDomainUuid: params.targetDomainUuid,
        resourceId: params.resourceId,
        amountMinor: params.amountMinor,
        reason: params.reason,
        userId: params.userId,
        sourceAccount: srcAccount,
        sourceReservedMinor: srcReserved,
        targetAccount: tgtAccount,
        definition: def,
        targetCapacityMinor: tgtEffectiveCap.effectiveCapacityMinor
      });
      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ?? createPublicError({
            code: "DM_ECON_PLAN_INVALID",
            category: "validation",
            message: "Transfer plan is not executable"
          })
        );
      }
      const cmdId = params.commandId ?? createOpaqueId("cmd");
      const epoch = params.authorityEpoch ?? 1;
      const txRecord = createTransactionRecord({
        transactionId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys,
        safeAutoRecovery: true,
        recoveryData: {
          type: "economy:transfer",
          sourceDomainUuid: params.sourceDomainUuid,
          targetDomainUuid: params.targetDomainUuid,
          resourceId: params.resourceId,
          amountMinor: params.amountMinor,
          sourceInitialBalance: srcAccount.balanceMinor,
          targetInitialBalance: tgtAccount.balanceMinor,
          sourceInitialDoc: srcDoc,
          targetInitialDoc: tgtDoc
        }
      });
      this.#transactionStore?.save(txRecord);
      this.#transactionStore?.transition(transactionId, "claimed", epoch);
      this.#transactionStore?.transition(transactionId, "prepared", epoch);
      this.#transactionStore?.transition(transactionId, "committing", epoch);
      await this.#transactionStore?.flush();
      const updatedSrcAccount = {
        ...srcAccount,
        balanceMinor: srcAccount.balanceMinor - params.amountMinor
      };
      const updatedTgtAccount = {
        ...tgtAccount,
        balanceMinor: tgtAccount.balanceMinor + params.amountMinor
      };
      const srcAccounts = [...srcEcon.accounts];
      srcAccounts[srcAccIndex] = updatedSrcAccount;
      const updatedSrcRecord = withDomainEconomyData(srcDoc.record, {
        ...srcEcon,
        accounts: Object.freeze(srcAccounts)
      });
      const tgtAccounts = [...tgtEcon.accounts];
      tgtAccounts[tgtAccIndex] = updatedTgtAccount;
      const updatedTgtRecord = withDomainEconomyData(tgtDoc.record, {
        ...tgtEcon,
        accounts: Object.freeze(tgtAccounts)
      });
      const updateSrcRes = await this.#domains.update({ ...srcDoc, record: updatedSrcRecord });
      if (!updateSrcRes.ok) {
        this.#transactionStore?.transition(transactionId, "failed", epoch, "Failed to update source domain");
        await this.#transactionStore?.flush();
        return updateSrcRes;
      }
      const updateTgtRes = await this.#domains.update({ ...tgtDoc, record: updatedTgtRecord });
      if (!updateTgtRes.ok) {
        const rollbackRes = await this.#domains.update({
          ...srcDoc,
          record: {
            ...srcDoc.record,
            revision: updateSrcRes.value.revision
          }
        });
        if (rollbackRes.ok) {
          this.#transactionStore?.transition(
            transactionId,
            "failed",
            epoch,
            "Rolled back source domain after target update failure"
          );
        } else {
          this.#transactionStore?.transition(
            transactionId,
            "needs-recovery",
            epoch,
            "Rollback of source domain failed; needs manual or auto recovery"
          );
        }
        await this.#transactionStore?.flush();
        return updateTgtRes;
      }
      const debitEntryRes = this.#ledgerStore.append({
        domainUuid: params.sourceDomainUuid,
        resourceId: params.resourceId,
        deltaMinor: -params.amountMinor,
        kind: "transfer-debit",
        transactionId,
        source: {
          type: "transfer",
          ref: `transfer_to:${params.targetDomainUuid}`,
          reason: params.reason,
          userId: params.userId
        }
      });
      if (!debitEntryRes.ok) {
        this.#transactionStore?.transition(
          transactionId,
          "needs-recovery",
          epoch,
          "Failed to append debit ledger entry"
        );
        await this.#transactionStore?.flush();
        return debitEntryRes;
      }
      const creditEntryRes = this.#ledgerStore.append({
        domainUuid: params.targetDomainUuid,
        resourceId: params.resourceId,
        deltaMinor: params.amountMinor,
        kind: "transfer-credit",
        transactionId,
        source: {
          type: "transfer",
          ref: `transfer_from:${params.sourceDomainUuid}`,
          reason: params.reason,
          userId: params.userId
        }
      });
      if (!creditEntryRes.ok) {
        this.#transactionStore?.transition(
          transactionId,
          "needs-recovery",
          epoch,
          "Failed to append credit ledger entry"
        );
        await this.#transactionStore?.flush();
        return creditEntryRes;
      }
      await this.#ledgerStore.flush();
      this.#transactionStore?.transition(
        transactionId,
        "committed",
        epoch,
        "Transfer completed cleanly"
      );
      await this.#transactionStore?.flush();
      this.#evaluateThresholds(
        params.sourceDomainUuid,
        params.resourceId,
        updatedSrcAccount.balanceMinor,
        updatedSrcAccount.baseCapacityMinor
      );
      this.#evaluateThresholds(
        params.targetDomainUuid,
        params.resourceId,
        updatedTgtAccount.balanceMinor,
        updatedTgtAccount.baseCapacityMinor
      );
      return ok({
        sourceAccount: updatedSrcAccount,
        targetAccount: updatedTgtAccount,
        debitEntry: debitEntryRes.value,
        creditEntry: creditEntryRes.value,
        transactionId
      });
    } finally {
      await lockRes.value.release();
    }
  }
  async previewConvert(params) {
    const fromDef = this.#resourceRegistry.get(params.fromResourceId);
    if (!fromDef) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.fromResourceId}' is not registered`
        })
      );
    }
    const toDef = this.#resourceRegistry.get(params.toResourceId);
    if (!toDef) {
      return err(
        createPublicError({
          code: "DM_ECON_RESOURCE_NOT_FOUND",
          category: "not-found",
          message: `Resource '${params.toResourceId}' is not registered`
        })
      );
    }
    const fromAccRes = await this.getAccount(params.domainUuid, params.fromResourceId);
    if (!fromAccRes.ok) return fromAccRes;
    const fromAccount = fromAccRes.value?.mode === "native" ? fromAccRes.value : void 0;
    const toAccRes = await this.getAccount(params.domainUuid, params.toResourceId);
    if (!toAccRes.ok) return toAccRes;
    const toAccount = toAccRes.value?.mode === "native" ? toAccRes.value : void 0;
    const fromReserved = this.#reservationStore.getReservedTotal(
      params.domainUuid,
      params.fromResourceId
    );
    const toEffectiveCap = resolveEffectiveCapacity(toAccount?.baseCapacityMinor ?? null, [], toDef);
    const plan = buildConvertPlan({
      domainUuid: params.domainUuid,
      fromResourceId: params.fromResourceId,
      toResourceId: params.toResourceId,
      fromAmountMinor: params.fromAmountMinor,
      toAmountMinor: params.toAmountMinor,
      rateDescription: params.rateDescription,
      reason: params.reason,
      userId: params.userId,
      fromAccount,
      fromReservedMinor: fromReserved,
      toAccount,
      fromDefinition: fromDef,
      toDefinition: toDef,
      toCapacityMinor: toEffectiveCap.effectiveCapacityMinor
    });
    return ok(plan);
  }
  async commitConvert(params) {
    const lockKey = `domain:${params.domainUuid}`;
    const transactionId = createOpaqueId("tx");
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `convert:${transactionId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const fromDef = this.#resourceRegistry.get(params.fromResourceId);
      if (!fromDef) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.fromResourceId}' is not registered`
          })
        );
      }
      const toDef = this.#resourceRegistry.get(params.toResourceId);
      if (!toDef) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_NOT_FOUND",
            category: "not-found",
            message: `Resource '${params.toResourceId}' is not registered`
          })
        );
      }
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const fromAccIndex = econData.accounts.findIndex((a) => a.resourceId === params.fromResourceId);
      if (fromAccIndex < 0 || econData.accounts[fromAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Source account '${params.fromResourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const fromAccount = econData.accounts[fromAccIndex];
      const toAccIndex = econData.accounts.findIndex((a) => a.resourceId === params.toResourceId);
      if (toAccIndex < 0 || econData.accounts[toAccIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Destination account '${params.toResourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const toAccount = econData.accounts[toAccIndex];
      const fromReserved = this.#reservationStore.getReservedTotal(
        params.domainUuid,
        params.fromResourceId
      );
      const toEffectiveCap = resolveEffectiveCapacity(toAccount.baseCapacityMinor, [], toDef);
      const plan = buildConvertPlan({
        domainUuid: params.domainUuid,
        fromResourceId: params.fromResourceId,
        toResourceId: params.toResourceId,
        fromAmountMinor: params.fromAmountMinor,
        toAmountMinor: params.toAmountMinor,
        rateDescription: params.rateDescription,
        reason: params.reason,
        userId: params.userId,
        fromAccount,
        fromReservedMinor: fromReserved,
        toAccount,
        fromDefinition: fromDef,
        toDefinition: toDef,
        toCapacityMinor: toEffectiveCap.effectiveCapacityMinor
      });
      if (!plan.isExecutable) {
        return err(
          plan.blockers[0] ?? createPublicError({
            code: "DM_ECON_PLAN_INVALID",
            category: "validation",
            message: "Convert plan is not executable"
          })
        );
      }
      const cmdId = params.commandId ?? createOpaqueId("cmd");
      const epoch = params.authorityEpoch ?? 1;
      const txRecord = createTransactionRecord({
        transactionId,
        commandId: cmdId,
        authorityEpoch: epoch,
        lockKeys: [lockKey],
        safeAutoRecovery: true,
        recoveryData: {
          type: "economy:convert",
          domainUuid: params.domainUuid,
          fromResourceId: params.fromResourceId,
          toResourceId: params.toResourceId,
          fromAmountMinor: params.fromAmountMinor,
          toAmountMinor: params.toAmountMinor,
          fromInitialBalance: fromAccount.balanceMinor,
          toInitialBalance: toAccount.balanceMinor
        }
      });
      this.#transactionStore?.save(txRecord);
      this.#transactionStore?.transition(transactionId, "claimed", epoch);
      this.#transactionStore?.transition(transactionId, "prepared", epoch);
      this.#transactionStore?.transition(transactionId, "committing", epoch);
      await this.#transactionStore?.flush();
      const updatedFromAccount = {
        ...fromAccount,
        balanceMinor: fromAccount.balanceMinor - params.fromAmountMinor
      };
      const updatedToAccount = {
        ...toAccount,
        balanceMinor: toAccount.balanceMinor + params.toAmountMinor
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[fromAccIndex] = updatedFromAccount;
      updatedAccounts[toAccIndex] = updatedToAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });
      const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateRes.ok) {
        this.#transactionStore?.transition(transactionId, "failed", epoch, "Failed to update domain document");
        await this.#transactionStore?.flush();
        return updateRes;
      }
      const rateReason = params.reason ?? params.rateDescription ?? (params.rateRatio ? `Rate: ${params.rateRatio.numerator}/${params.rateRatio.denominator}` : "Currency/Resource conversion");
      const debitEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.fromResourceId,
        deltaMinor: -params.fromAmountMinor,
        kind: "conversion-debit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_to:${params.toResourceId}`,
          reason: rateReason,
          userId: params.userId
        }
      });
      if (!debitEntryRes.ok) {
        this.#transactionStore?.transition(transactionId, "needs-recovery", epoch, "Failed to append conversion debit entry");
        await this.#transactionStore?.flush();
        return debitEntryRes;
      }
      const creditEntryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: params.toResourceId,
        deltaMinor: params.toAmountMinor,
        kind: "conversion-credit",
        transactionId,
        source: {
          type: "conversion",
          ref: `converted_from:${params.fromResourceId}`,
          reason: rateReason,
          userId: params.userId
        }
      });
      if (!creditEntryRes.ok) {
        this.#transactionStore?.transition(transactionId, "needs-recovery", epoch, "Failed to append conversion credit entry");
        await this.#transactionStore?.flush();
        return creditEntryRes;
      }
      await this.#ledgerStore.flush();
      this.#transactionStore?.transition(transactionId, "committed", epoch, "Conversion completed cleanly");
      await this.#transactionStore?.flush();
      this.#evaluateThresholds(
        params.domainUuid,
        params.fromResourceId,
        updatedFromAccount.balanceMinor,
        updatedFromAccount.baseCapacityMinor
      );
      this.#evaluateThresholds(
        params.domainUuid,
        params.toResourceId,
        updatedToAccount.balanceMinor,
        updatedToAccount.baseCapacityMinor
      );
      return ok({
        fromAccount: updatedFromAccount,
        toAccount: updatedToAccount,
        debitEntry: debitEntryRes.value,
        creditEntry: creditEntryRes.value,
        transactionId
      });
    } finally {
      await lockRes.value.release();
    }
  }
  async reserve(params) {
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `reserve:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const accRes = await this.getAccount(params.domainUuid, params.resourceId);
      if (!accRes.ok) return accRes;
      const acc = accRes.value;
      if (!acc || acc.mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Native account '${params.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const currentReserved = this.#reservationStore.getReservedTotal(
        params.domainUuid,
        params.resourceId
      );
      const available = acc.balanceMinor - currentReserved;
      if (params.amountMinor > available) {
        return err(
          createPublicError({
            code: "DM_ECON_INSUFFICIENT_AVAILABLE",
            category: "validation",
            message: `Cannot reserve ${params.amountMinor}: only ${available} available (balance: ${acc.balanceMinor}, reserved: ${currentReserved})`
          })
        );
      }
      const res = this.#reservationStore.create({
        domainUuid: params.domainUuid,
        resourceId: params.resourceId,
        originalAmountMinor: params.amountMinor,
        source: params.source,
        expiresAtWorld: params.expiresAtWorld,
        expiresAtReal: params.expiresAtReal
      });
      if (res.ok) {
        await this.#reservationStore.flush();
        this.#evaluateThresholds(
          params.domainUuid,
          params.resourceId,
          acc.balanceMinor,
          acc.baseCapacityMinor
        );
      }
      return res;
    } finally {
      await lockRes.value.release();
    }
  }
  async consumeReservation(params) {
    const existing = this.#reservationStore.get(params.reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${params.reservationId}' not found`
        })
      );
    }
    if (existing.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
          category: "permission",
          message: `Reservation '${params.reservationId}' belongs to domain '${existing.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `consume-reservation:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const lockedRes = this.#reservationStore.get(params.reservationId);
      if (!lockedRes) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_NOT_FOUND",
            category: "validation",
            message: `Reservation '${params.reservationId}' not found`
          })
        );
      }
      if (lockedRes.domainUuid !== params.domainUuid) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
            category: "permission",
            message: `Reservation '${params.reservationId}' belongs to domain '${lockedRes.domainUuid}', not '${params.domainUuid}'`
          })
        );
      }
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === lockedRes.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account '${lockedRes.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const account = econData.accounts[accIndex];
      if (account.balanceMinor < params.amountMinor) {
        return err(
          createPublicError({
            code: "DM_ECON_INSUFFICIENT_BALANCE",
            category: "validation",
            message: `Insufficient balance: account has ${account.balanceMinor}, required ${params.amountMinor}`
          })
        );
      }
      const consumeRes = this.#reservationStore.consume(params.reservationId, params.amountMinor, {
        reason: params.reason,
        userId: params.userId
      });
      if (!consumeRes.ok) return consumeRes;
      const { reservation, consumedAmount } = consumeRes.value;
      const updatedAccount = {
        ...account,
        balanceMinor: account.balanceMinor - consumedAmount
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });
      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) {
        this.#reservationStore.rollbackConsume(lockedRes, consumedAmount, {
          reason: "Rollback after failed domain balance update",
          userId: params.userId
        });
        await this.#reservationStore.flush();
        return updateDocRes;
      }
      const entryRes = this.#ledgerStore.append({
        domainUuid: params.domainUuid,
        resourceId: reservation.resourceId,
        deltaMinor: -consumedAmount,
        kind: "consumption",
        reservationId: reservation.id,
        source: {
          type: reservation.source.type,
          ref: reservation.source.ref,
          reason: params.reason ?? "Reservation consumption",
          userId: params.userId
        }
      });
      if (!entryRes.ok) {
        await this.#domains.update({
          ...doc,
          record: {
            ...doc.record,
            revision: updateDocRes.value.revision
          }
        });
        this.#reservationStore.rollbackConsume(lockedRes, consumedAmount, {
          reason: "Rollback after failed ledger append",
          userId: params.userId
        });
        await this.#reservationStore.flush();
        return entryRes;
      }
      await this.#ledgerStore.flush();
      await this.#reservationStore.flush();
      this.#evaluateThresholds(
        params.domainUuid,
        reservation.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );
      return ok({
        reservation,
        entry: entryRes.value,
        account: updatedAccount
      });
    } finally {
      await lockRes.value.release();
    }
  }
  async releaseReservation(params) {
    const existing = this.#reservationStore.get(params.reservationId);
    if (!existing) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "validation",
          message: `Reservation '${params.reservationId}' not found`
        })
      );
    }
    if (existing.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
          category: "permission",
          message: `Reservation '${params.reservationId}' belongs to domain '${existing.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `release-reservation:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      const lockedRes = this.#reservationStore.get(params.reservationId);
      if (!lockedRes) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_NOT_FOUND",
            category: "validation",
            message: `Reservation '${params.reservationId}' not found`
          })
        );
      }
      if (lockedRes.domainUuid !== params.domainUuid) {
        return err(
          createPublicError({
            code: "DM_ECON_RESERVATION_DOMAIN_MISMATCH",
            category: "permission",
            message: `Reservation '${params.reservationId}' belongs to domain '${lockedRes.domainUuid}', not '${params.domainUuid}'`
          })
        );
      }
      const relRes = this.#reservationStore.release(params.reservationId, params.amountMinor, {
        reason: params.reason,
        userId: params.userId
      });
      if (relRes.ok) {
        await this.#reservationStore.flush();
        const accRes = await this.getAccount(params.domainUuid, lockedRes.resourceId);
        if (accRes.ok && accRes.value?.mode === "native") {
          this.#evaluateThresholds(
            params.domainUuid,
            lockedRes.resourceId,
            accRes.value.balanceMinor,
            accRes.value.baseCapacityMinor
          );
        }
      }
      return relRes;
    } finally {
      await lockRes.value.release();
    }
  }
  async reverseLedgerEntry(params) {
    const originalEntry = this.#ledgerStore.get(params.entryId);
    if (!originalEntry) {
      return err(
        createPublicError({
          code: "DM_ECON_LEDGER_NOT_FOUND",
          category: "not-found",
          message: `Ledger entry '${params.entryId}' not found`
        })
      );
    }
    if (originalEntry.domainUuid !== params.domainUuid) {
      return err(
        createPublicError({
          code: "DM_ECON_DOMAIN_MISMATCH",
          category: "validation",
          message: `Entry '${params.entryId}' belongs to domain '${originalEntry.domainUuid}', not '${params.domainUuid}'`
        })
      );
    }
    const txId = createOpaqueId("tx");
    const lockKey = `domain:${params.domainUuid}`;
    const lockRes = await this.#lockManager.acquireLocks({
      ownerId: `reversal:${txId}`,
      keys: [lockKey]
    });
    if (!lockRes.ok) return lockRes;
    try {
      if (this.#ledgerStore.isReversed(params.entryId)) {
        return err(
          createPublicError({
            code: "DM_ECON_REVERSAL_ALREADY_EXISTS",
            category: "conflict",
            message: `Entry '${params.entryId}' has already been reversed`
          })
        );
      }
      const docRes = await this.#domains.read(this.#cleanUuid(params.domainUuid));
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econData = getDomainEconomyData(doc.record);
      const accIndex = econData.accounts.findIndex((a) => a.resourceId === originalEntry.resourceId);
      if (accIndex < 0 || econData.accounts[accIndex].mode !== "native") {
        return err(
          createPublicError({
            code: "DM_ECON_ACCOUNT_NOT_FOUND",
            category: "not-found",
            message: `Account '${originalEntry.resourceId}' not found in domain '${params.domainUuid}'`
          })
        );
      }
      const targetAccount = econData.accounts[accIndex];
      const newBalance = targetAccount.balanceMinor - originalEntry.deltaMinor;
      const def = this.#resourceRegistry.get(originalEntry.resourceId);
      if (def && !def.allowNegative && newBalance < 0) {
        return err(
          createPublicError({
            code: "DM_ECON_NEGATIVE_NOT_ALLOWED",
            category: "validation",
            message: `Reversal would cause balance to drop below zero (${newBalance}) for resource '${originalEntry.resourceId}'`
          })
        );
      }
      const updatedAccount = {
        ...targetAccount,
        balanceMinor: newBalance
      };
      const updatedAccounts = [...econData.accounts];
      updatedAccounts[accIndex] = updatedAccount;
      const updatedRecord = withDomainEconomyData(doc.record, {
        ...econData,
        accounts: Object.freeze(updatedAccounts)
      });
      const updateDocRes = await this.#domains.update({ ...doc, record: updatedRecord });
      if (!updateDocRes.ok) return updateDocRes;
      const reversalRes = this.#ledgerStore.createReversal(
        params.entryId,
        params.reason,
        params.userId
      );
      if (!reversalRes.ok) {
        await this.#domains.update(doc);
        return reversalRes;
      }
      await this.#ledgerStore.flush();
      this.#evaluateThresholds(
        params.domainUuid,
        originalEntry.resourceId,
        updatedAccount.balanceMinor,
        updatedAccount.baseCapacityMinor
      );
      return ok({
        reversalEntry: reversalRes.value,
        account: updatedAccount
      });
    } finally {
      await lockRes.value.release();
    }
  }
  #cleanUuid(domainUuid) {
    return domainUuid.trim();
  }
  #evaluateThresholds(domainUuid, resourceId, balanceMinor, capacityMinor) {
    if (!this.#thresholdService) return;
    const reservedMinor = this.#reservationStore.getReservedTotal(domainUuid, resourceId);
    const availableMinor = balanceMinor - reservedMinor;
    this.#thresholdService.evaluateCrossings(domainUuid, resourceId, {
      balanceMinor,
      reservedMinor,
      availableMinor,
      capacityMinor
    });
  }
  #registerRecoveryCompensators(recoveryService) {
    recoveryService.registerCompensator("economy:transfer", async (record) => {
      const data = record.recoveryData;
      if (!data || !data.sourceDomainUuid || !data.targetDomainUuid || !data.resourceId || !data.amountMinor) {
        return ok(void 0);
      }
      const srcCleanUuid = this.#cleanUuid(data.sourceDomainUuid);
      const tgtCleanUuid = this.#cleanUuid(data.targetDomainUuid);
      const srcRes = await this.#domains.read(srcCleanUuid);
      if (!srcRes.ok) return srcRes;
      const srcDoc = srcRes.value;
      const tgtRes = await this.#domains.read(tgtCleanUuid);
      if (!tgtRes.ok) return tgtRes;
      const tgtDoc = tgtRes.value;
      const srcEcon = getDomainEconomyData(srcDoc.record);
      const tgtEcon = getDomainEconomyData(tgtDoc.record);
      const srcAccIndex = srcEcon.accounts.findIndex((a) => a.resourceId === data.resourceId);
      const tgtAccIndex = tgtEcon.accounts.findIndex((a) => a.resourceId === data.resourceId);
      if (srcAccIndex < 0 || tgtAccIndex < 0) return ok(void 0);
      const srcAccount = srcEcon.accounts[srcAccIndex];
      const tgtAccount = tgtEcon.accounts[tgtAccIndex];
      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId });
      const hasDebitEntry = txEntries.some(
        (e) => e.kind === "transfer-debit" && e.domainUuid === data.sourceDomainUuid
      );
      const hasCreditEntry = txEntries.some(
        (e) => e.kind === "transfer-credit" && e.domainUuid === data.targetDomainUuid
      );
      const hasCompensatingDebitReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.domainUuid === data.sourceDomainUuid
      );
      const hasCompensatingCreditReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.domainUuid === data.targetDomainUuid
      );
      const sourceInitialBalance = typeof data.sourceInitialBalance === "number" ? data.sourceInitialBalance : srcAccount.balanceMinor;
      const targetInitialBalance = typeof data.targetInitialBalance === "number" ? data.targetInitialBalance : tgtAccount.balanceMinor;
      const amountMinor = data.amountMinor;
      const srcIsDebited = srcAccount.balanceMinor === sourceInitialBalance - amountMinor;
      const tgtIsCredited = tgtAccount.balanceMinor === targetInitialBalance + amountMinor;
      if (hasDebitEntry && hasCreditEntry && srcIsDebited && tgtIsCredited) {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed both domain writes and ledger entries completed"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      if (srcIsDebited) {
        const restoredSrcAccount = {
          ...srcAccount,
          balanceMinor: sourceInitialBalance
        };
        const updatedAccounts = [...srcEcon.accounts];
        updatedAccounts[srcAccIndex] = restoredSrcAccount;
        const updatedRecord = withDomainEconomyData(srcDoc.record, {
          ...srcEcon,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...srcDoc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }
      if (tgtIsCredited) {
        const restoredTgtAccount = {
          ...tgtAccount,
          balanceMinor: targetInitialBalance
        };
        const updatedAccounts = [...tgtEcon.accounts];
        updatedAccounts[tgtAccIndex] = restoredTgtAccount;
        const updatedRecord = withDomainEconomyData(tgtDoc.record, {
          ...tgtEcon,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...tgtDoc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }
      let ledgerMutated = false;
      if (hasDebitEntry && !hasCompensatingDebitReversal) {
        this.#ledgerStore.append({
          domainUuid: data.sourceDomainUuid,
          resourceId: data.resourceId,
          deltaMinor: amountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed transfer ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }
      if (hasCreditEntry && !hasCompensatingCreditReversal) {
        this.#ledgerStore.append({
          domainUuid: data.targetDomainUuid,
          resourceId: data.resourceId,
          deltaMinor: -amountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed transfer ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }
      if (ledgerMutated) {
        await this.#ledgerStore.flush();
      }
      return ok(void 0);
    });
    recoveryService.registerCompensator("economy:convert", async (record) => {
      const data = record.recoveryData;
      if (!data || !data.domainUuid || !data.fromResourceId || !data.toResourceId || !data.fromAmountMinor || !data.toAmountMinor) {
        return ok(void 0);
      }
      const cleanUuid = this.#cleanUuid(data.domainUuid);
      const docRes = await this.#domains.read(cleanUuid);
      if (!docRes.ok) return docRes;
      const doc = docRes.value;
      const econ = getDomainEconomyData(doc.record);
      const fromIndex = econ.accounts.findIndex((a) => a.resourceId === data.fromResourceId);
      const toIndex = econ.accounts.findIndex((a) => a.resourceId === data.toResourceId);
      if (fromIndex < 0 || toIndex < 0) return ok(void 0);
      const fromAcc = econ.accounts[fromIndex];
      const toAcc = econ.accounts[toIndex];
      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId, domainUuid: data.domainUuid });
      const hasFromDebitEntry = txEntries.some((e) => e.kind === "conversion-debit" && e.resourceId === data.fromResourceId);
      const hasToCreditEntry = txEntries.some((e) => e.kind === "conversion-credit" && e.resourceId === data.toResourceId);
      const hasCompensatingFromReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.resourceId === data.fromResourceId
      );
      const hasCompensatingToReversal = txEntries.some(
        (e) => e.source?.type === "recovery" && e.resourceId === data.toResourceId
      );
      const fromInitialBalance = typeof data.fromInitialBalance === "number" ? data.fromInitialBalance : fromAcc.balanceMinor;
      const toInitialBalance = typeof data.toInitialBalance === "number" ? data.toInitialBalance : toAcc.balanceMinor;
      const fromAmountMinor = data.fromAmountMinor;
      const toAmountMinor = data.toAmountMinor;
      const fromIsDebited = fromAcc.balanceMinor === fromInitialBalance - fromAmountMinor;
      const toIsCredited = toAcc.balanceMinor === toInitialBalance + toAmountMinor;
      if (hasFromDebitEntry && hasToCreditEntry && fromIsDebited && toIsCredited) {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed conversion completed cleanly"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      let needsDomainUpdate = false;
      const updatedAccounts = [...econ.accounts];
      if (fromIsDebited) {
        updatedAccounts[fromIndex] = {
          ...fromAcc,
          balanceMinor: fromInitialBalance
        };
        needsDomainUpdate = true;
      }
      if (toIsCredited) {
        updatedAccounts[toIndex] = {
          ...toAcc,
          balanceMinor: toInitialBalance
        };
        needsDomainUpdate = true;
      }
      if (needsDomainUpdate) {
        const updatedRecord = withDomainEconomyData(doc.record, {
          ...econ,
          accounts: Object.freeze(updatedAccounts)
        });
        const updateRes = await this.#domains.update({ ...doc, record: updatedRecord });
        if (!updateRes.ok) return updateRes;
      }
      let ledgerMutated = false;
      if (hasFromDebitEntry && !hasCompensatingFromReversal) {
        this.#ledgerStore.append({
          domainUuid: data.domainUuid,
          resourceId: data.fromResourceId,
          deltaMinor: fromAmountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed conversion ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }
      if (hasToCreditEntry && !hasCompensatingToReversal) {
        this.#ledgerStore.append({
          domainUuid: data.domainUuid,
          resourceId: data.toResourceId,
          deltaMinor: -toAmountMinor,
          kind: "adjustment",
          transactionId: record.transactionId,
          source: {
            type: "recovery",
            reason: `Recovery compensation for failed conversion ${record.transactionId}`
          }
        });
        ledgerMutated = true;
      }
      if (ledgerMutated) {
        await this.#ledgerStore.flush();
      }
      return ok(void 0);
    });
    recoveryService.registerCompensator("economy:provider-adjust", async (record) => {
      const data = record.recoveryData;
      if (!data || !data.domainUuid || !data.resourceId || !data.deltaMinor) {
        return ok(void 0);
      }
      const txEntries = this.#ledgerStore.query({ transactionId: record.transactionId });
      const hasLedgerEntry = txEntries.length > 0;
      if (!this.#providerRegistry || !data.providerId) {
        return err(
          createPublicError({
            code: "DM_ECON_PROVIDER_UNAVAILABLE",
            category: "provider",
            message: `Provider registry or providerId missing for transaction '${record.transactionId}'`
          })
        );
      }
      const provider = this.#providerRegistry.get(data.providerId);
      if (!provider) {
        return err(
          createPublicError({
            code: "DM_ECON_PROVIDER_UNAVAILABLE",
            category: "provider",
            message: `Provider '${data.providerId}' is not registered; cannot reconcile '${record.transactionId}'`
          })
        );
      }
      let providerOutcome = "unknown";
      if (typeof provider.reconcile === "function") {
        const recRes = await provider.reconcile(
          data.domainUuid,
          data.resourceId,
          data.providerRef ?? "",
          record.transactionId
        );
        if (!recRes.ok) {
          return recRes;
        }
        providerOutcome = recRes.value.outcome;
      } else if (data.providerWriteConfirmed) {
        providerOutcome = "written";
      } else {
        providerOutcome = "unknown";
      }
      if (providerOutcome === "unknown") {
        return err(
          createPublicError({
            code: "DM_ECON_RECOVERY_INDETERMINATE",
            category: "recovery",
            message: `Provider reconciliation outcome is unknown for transaction '${record.transactionId}'`
          })
        );
      }
      if (hasLedgerEntry && providerOutcome === "written") {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "committed",
            record.authorityEpoch,
            "Reconciliation confirmed provider mutation and ledger entry both present"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      if (hasLedgerEntry && providerOutcome === "not-written") {
        const hasCompensatingReversal = txEntries.some(
          (e) => e.source?.type === "recovery"
        );
        if (!hasCompensatingReversal) {
          this.#ledgerStore.append({
            domainUuid: data.domainUuid,
            resourceId: data.resourceId,
            deltaMinor: -data.deltaMinor,
            kind: "adjustment",
            transactionId: record.transactionId,
            source: {
              type: "recovery",
              reason: `Recovery compensation for unwritten provider adjustment ${record.transactionId}`
            }
          });
          await this.#ledgerStore.flush();
        }
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "failed",
            record.authorityEpoch,
            "Reconciliation confirmed mutation was not applied on provider; compensated local ledger"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      if (!hasLedgerEntry && providerOutcome === "written") {
        if (typeof provider.mutateBalance === "function") {
          const compRes = await provider.mutateBalance(
            data.domainUuid,
            data.resourceId,
            data.providerRef ?? "",
            -data.deltaMinor,
            `Recovery compensation for aborted adjustment ${record.transactionId}`
          );
          if (!compRes.ok) {
            return compRes;
          }
          if (typeof provider.flush === "function") {
            await provider.flush();
          }
        }
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "compensated",
            record.authorityEpoch,
            "Reconciliation reverted orphan provider mutation because ledger entry was missing"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      if (!hasLedgerEntry && providerOutcome === "not-written") {
        if (this.#transactionStore) {
          this.#transactionStore.transition(
            record.transactionId,
            "failed",
            record.authorityEpoch,
            "Reconciliation confirmed mutation was not applied on provider and ledger is absent"
          );
          await this.#transactionStore.flush();
        }
        return ok(void 0);
      }
      return ok(void 0);
    });
  }
};

// src/economy/projection/economy-projection-service.ts
var EconomyProjectionService = class {
  resolveViewer(callerSuppliedViewer) {
    return resolveCurrentViewer(callerSuppliedViewer);
  }
  isAccountVisible(account, viewer) {
    if (viewer.isGm) {
      return true;
    }
    const visibility = account.visibility ?? "public";
    if (visibility === "secret") {
      return false;
    }
    if (visibility === "restricted") {
      const allowed = viewer.allowedRestrictedRefs ?? [];
      return allowed.includes(account.resourceId) || allowed.includes(account.domainUuid) || allowed.includes(`${account.domainUuid}:${account.resourceId}`);
    }
    return true;
  }
  projectAccount(account, definition, reservedMinor, viewer, options) {
    if (!this.isAccountVisible(account, viewer)) {
      return null;
    }
    const mode = account.mode;
    const balanceMinor = options?.balanceMinor ?? (mode === "native" ? account.balanceMinor : 0);
    const availableMinor = balanceMinor - reservedMinor;
    const capacityMinor = options?.capacityMinor !== void 0 ? options.capacityMinor : mode === "native" ? account.baseCapacityMinor : null;
    return {
      resourceId: account.resourceId,
      mode,
      balanceMinor,
      availableMinor,
      reservedMinor,
      capacityMinor,
      visibility: account.visibility ?? "public",
      status: account.status ?? "active",
      ...options?.isStale ? { isStale: true } : {},
      ...options?.isUnavailable ? { isUnavailable: true } : {},
      ...definition ? {
        definition: {
          id: definition.id,
          label: definition.label,
          symbol: definition.displayUnit?.abbreviation ?? definition.displayUnit?.singular,
          precision: definition.precision
        }
      } : {}
    };
  }
  projectLedgerEntry(entry, visibleResourceIdsOrKeys, viewer) {
    if (!viewer.isGm) {
      const cleanDom = entry.domainUuid.startsWith("JournalEntry.") ? entry.domainUuid.slice("JournalEntry.".length) : entry.domainUuid;
      const isAllowed = visibleResourceIdsOrKeys.has(`${entry.domainUuid}:${entry.resourceId}`) || visibleResourceIdsOrKeys.has(`${cleanDom}:${entry.resourceId}`) || visibleResourceIdsOrKeys.has(`JournalEntry.${cleanDom}:${entry.resourceId}`) || visibleResourceIdsOrKeys.has(entry.resourceId);
      if (!isAllowed) {
        return null;
      }
    }
    return {
      id: entry.id,
      sequence: entry.sequence,
      domainUuid: entry.domainUuid,
      resourceId: entry.resourceId,
      deltaMinor: entry.deltaMinor,
      kind: entry.kind,
      timestampReal: entry.timestampReal,
      timestampWorld: entry.timestampWorld,
      source: {
        type: entry.source.type,
        ref: entry.source.ref,
        reason: viewer.isGm ? entry.source.reason : void 0
      },
      reversesEntryId: entry.reversesEntryId,
      reservationId: entry.reservationId,
      transactionId: entry.transactionId
    };
  }
  projectReservation(reservation, visibleResourceIds, viewer) {
    if (!visibleResourceIds.has(reservation.resourceId) && !viewer.isGm) {
      return null;
    }
    return {
      id: reservation.id,
      domainUuid: reservation.domainUuid,
      resourceId: reservation.resourceId,
      originalAmountMinor: reservation.originalAmountMinor,
      remainingAmountMinor: reservation.remainingAmountMinor,
      status: reservation.status,
      createdAtReal: reservation.createdAtReal,
      expiresAtWorld: reservation.expiresAtWorld,
      reason: viewer.isGm ? reservation.source.reason : void 0
    };
  }
};

// src/economy/aggregation/economy-aggregation-provider.ts
var EconomyAggregationProvider = class {
  #domains;
  #resourceRegistry;
  #reservationStore;
  #providerRegistry;
  #projection;
  #derivedResolvers;
  constructor(options) {
    this.#domains = options.domains;
    this.#resourceRegistry = options.resourceRegistry;
    this.#reservationStore = options.reservationStore;
    this.#providerRegistry = options.providerRegistry;
    this.#derivedResolvers = options.derivedResolvers;
    this.#projection = options.projectionService ?? new EconomyProjectionService();
  }
  async getAggregateContext(domainUuids, callerViewer) {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const totalsByResource = /* @__PURE__ */ new Map();
    const hiddenContributors = [];
    const unknownContributors = [];
    for (const uuid of domainUuids) {
      const docRes = await this.#domains.read(uuid);
      if (!docRes.ok) {
        if (!unknownContributors.includes(uuid)) {
          unknownContributors.push(uuid);
        }
        continue;
      }
      const econRes = tryGetDomainEconomyData(docRes.value.record);
      if (!econRes.ok) {
        if (!unknownContributors.includes(uuid)) {
          unknownContributors.push(uuid);
        }
        continue;
      }
      let domainContributed = false;
      let domainHadSecret = false;
      for (const account of econRes.value.accounts) {
        const isVisible = this.#projection.isAccountVisible(account, viewer);
        if (!isVisible) {
          domainHadSecret = true;
          let resourceStats2 = totalsByResource.get(account.resourceId);
          if (!resourceStats2) {
            resourceStats2 = {
              totalBalance: 0,
              totalReserved: 0,
              totalAvailable: 0,
              contributingCount: 0,
              hiddenCount: 0,
              isComplete: true,
              unknownContributorCount: 0
            };
            totalsByResource.set(account.resourceId, resourceStats2);
          }
          resourceStats2.hiddenCount++;
          continue;
        }
        domainContributed = true;
        let resourceStats = totalsByResource.get(account.resourceId);
        if (!resourceStats) {
          resourceStats = {
            totalBalance: 0,
            totalReserved: 0,
            totalAvailable: 0,
            contributingCount: 0,
            hiddenCount: 0,
            isComplete: true,
            unknownContributorCount: 0
          };
          totalsByResource.set(account.resourceId, resourceStats);
        }
        let balance = account.mode === "native" ? account.balanceMinor : 0;
        if (account.mode === "provider") {
          let readSuccess = false;
          if (this.#providerRegistry) {
            const provider = this.#providerRegistry.get(account.providerId);
            if (provider && "readBalance" in provider) {
              try {
                const balRes = await provider.readBalance(uuid, account.resourceId, account.providerRef);
                if (balRes?.ok) {
                  balance = balRes.value.balanceMinor;
                  readSuccess = true;
                }
              } catch {
              }
            }
          }
          if (!readSuccess) {
            resourceStats.isComplete = false;
            resourceStats.unknownContributorCount++;
            if (!unknownContributors.includes(uuid)) {
              unknownContributors.push(uuid);
            }
          }
        }
        if (account.mode === "derived") {
          let readSuccess = false;
          if (this.#derivedResolvers) {
            const resolver = this.#derivedResolvers.get(account.resolverId);
            if (resolver) {
              try {
                const balRes = await resolver(uuid, account);
                if (balRes?.ok) {
                  balance = balRes.value.balanceMinor;
                  readSuccess = true;
                }
              } catch {
              }
            }
          }
          if (!readSuccess) {
            resourceStats.isComplete = false;
            resourceStats.unknownContributorCount++;
            if (!unknownContributors.includes(uuid)) {
              unknownContributors.push(uuid);
            }
          }
        }
        const reserved = this.#reservationStore.getReservedTotal(uuid, account.resourceId);
        const available = balance - reserved;
        resourceStats.totalBalance += balance;
        resourceStats.totalReserved += reserved;
        resourceStats.totalAvailable += available;
        resourceStats.contributingCount++;
      }
      if (domainHadSecret && viewer.isGm) {
        hiddenContributors.push(uuid);
      }
    }
    const totals = [];
    for (const [resourceId, stats] of totalsByResource.entries()) {
      totals.push({
        resourceId,
        totalBalanceMinor: stats.totalBalance,
        totalReservedMinor: stats.totalReserved,
        totalAvailableMinor: stats.totalAvailable,
        contributingDomainCount: stats.contributingCount,
        hiddenDomainCount: stats.hiddenCount,
        isComplete: stats.isComplete && stats.unknownContributorCount === 0,
        unknownContributorCount: stats.unknownContributorCount
      });
    }
    return {
      totals: Object.freeze(totals),
      totalDomainsEvaluated: domainUuids.length,
      hiddenContributors: Object.freeze(hiddenContributors),
      unknownContributors: Object.freeze(unknownContributors),
      isComplete: unknownContributors.length === 0,
      evaluatedAt: Date.now()
    };
  }
};

// src/economy/services/public-economy-api.ts
function toTransactionDto(tx, viewer, accessibleDomains) {
  const lastTransition = tx.history[tx.history.length - 1];
  if (viewer.isGm) {
    return {
      transactionId: tx.transactionId,
      commandId: tx.commandId,
      authorityEpoch: tx.authorityEpoch,
      state: tx.state,
      lockKeys: tx.lockKeys,
      createdAtReal: tx.createdAt,
      updatedAtReal: tx.updatedAt,
      failureReason: lastTransition?.reason
    };
  }
  const sanitizedLocks = tx.lockKeys.filter((k) => {
    if (!accessibleDomains) return true;
    for (const d of accessibleDomains) {
      if (k.includes(d)) return true;
    }
    return false;
  });
  return {
    transactionId: tx.transactionId,
    commandId: tx.commandId,
    authorityEpoch: tx.authorityEpoch,
    state: tx.state,
    lockKeys: Object.freeze(sanitizedLocks),
    createdAtReal: tx.createdAt,
    updatedAtReal: tx.updatedAt,
    failureReason: tx.state === "failed" ? "Transaction failed" : void 0
  };
}
var DefaultPublicEconomyApi = class {
  #domains;
  #commandBus;
  #resourceRegistry;
  #ledgerStore;
  #reservationStore;
  #providerRegistry;
  #projection;
  #aggregation;
  #thresholdService;
  #derivedResolvers;
  #transactionStore;
  constructor(options) {
    this.#domains = options.domains;
    this.#commandBus = options.commandBus;
    this.#resourceRegistry = options.resourceRegistry;
    this.#ledgerStore = options.ledgerStore;
    this.#reservationStore = options.reservationStore;
    this.#providerRegistry = options.providerRegistry;
    this.#thresholdService = options.thresholdService;
    this.#derivedResolvers = options.derivedResolvers;
    this.#transactionStore = options.transactionStore;
    this.#projection = options.projectionService ?? new EconomyProjectionService();
    this.#aggregation = options.aggregationProvider ?? new EconomyAggregationProvider({
      domains: options.domains,
      resourceRegistry: options.resourceRegistry,
      reservationStore: options.reservationStore,
      providerRegistry: options.providerRegistry,
      derivedResolvers: options.derivedResolvers,
      projectionService: this.#projection
    });
  }
  async setThreshold(payload, options) {
    return this.#dispatchCommand("economy:set-threshold", payload, options);
  }
  async #projectTransaction(tx, viewer) {
    if (viewer.isGm) {
      return toTransactionDto(tx, viewer);
    }
    const rec = tx.recoveryData && typeof tx.recoveryData === "object" ? tx.recoveryData : null;
    const directDomainUuid = rec?.domainUuid;
    const sourceDomainUuid = rec?.sourceDomainUuid;
    const targetDomainUuid = rec?.targetDomainUuid;
    const candidateDomains = [];
    if (directDomainUuid) candidateDomains.push(directDomainUuid);
    if (sourceDomainUuid) candidateDomains.push(sourceDomainUuid);
    if (targetDomainUuid) candidateDomains.push(targetDomainUuid);
    if (candidateDomains.length === 0) {
      for (const k of tx.lockKeys) {
        if (k.startsWith("domain:")) candidateDomains.push(k.slice("domain:".length));
        else if (k.startsWith("JournalEntry.")) candidateDomains.push(k);
      }
    }
    const accessibleDomains = /* @__PURE__ */ new Set();
    for (const d of candidateDomains) {
      const cleanId = d.startsWith("JournalEntry.") ? d.slice("JournalEntry.".length) : d;
      const docRes = await this.#domains.read(cleanId);
      if (docRes.ok) {
        const doc = docRes.value;
        const ownership = doc.ownership;
        const userLevel = ownership ? viewer.userId ? ownership[viewer.userId] ?? ownership.default ?? 0 : ownership.default ?? 0 : 0;
        if (userLevel >= 1) {
          accessibleDomains.add(cleanId);
          accessibleDomains.add(d);
          accessibleDomains.add(docRes.value.uuid);
        }
      }
    }
    if (accessibleDomains.size === 0) {
      return null;
    }
    const resourceIds = [];
    if (rec?.resourceId) resourceIds.push(rec.resourceId);
    if (rec?.fromResourceId) resourceIds.push(rec.fromResourceId);
    if (rec?.toResourceId) resourceIds.push(rec.toResourceId);
    if (resourceIds.length > 0) {
      let anyResourceVisible = false;
      for (const d of accessibleDomains) {
        const cleanId = d.startsWith("JournalEntry.") ? d.slice("JournalEntry.".length) : d;
        const docRes = await this.#domains.read(cleanId);
        if (docRes.ok) {
          const econRes = tryGetDomainEconomyData(docRes.value.record);
          if (econRes.ok) {
            for (const resId of resourceIds) {
              const acc = econRes.value.accounts.find((a) => a.resourceId === resId);
              if (acc && this.#projection.isAccountVisible(acc, viewer)) {
                anyResourceVisible = true;
                break;
              }
            }
          }
        }
        if (anyResourceVisible) break;
      }
      if (!anyResourceVisible) {
        return null;
      }
    }
    return toTransactionDto(tx, viewer, accessibleDomains);
  }
  async getTransaction(transactionId, callerViewer) {
    if (!this.#transactionStore) {
      return ok(void 0);
    }
    const viewer = this.#projection.resolveViewer(callerViewer);
    const tx = this.#transactionStore.get(transactionId);
    if (!tx) {
      return ok(void 0);
    }
    const projected = await this.#projectTransaction(tx, viewer);
    if (!projected) {
      if (!viewer.isGm) {
        return err(
          createPublicError({
            code: "DM_SECURITY_PERMISSION_DENIED",
            category: "permission",
            message: "Permission denied for transaction"
          })
        );
      }
      return ok(void 0);
    }
    return ok(projected);
  }
  async listTransactions(filter, callerViewer) {
    if (!this.#transactionStore) {
      return ok(Object.freeze([]));
    }
    const viewer = this.#projection.resolveViewer(callerViewer);
    let list = this.#transactionStore.listAll();
    if (filter?.state) {
      list = list.filter((tx) => tx.state === filter.state);
    }
    if (filter?.domainUuid) {
      const cleanFilter = filter.domainUuid.startsWith("JournalEntry.") ? filter.domainUuid.slice("JournalEntry.".length) : filter.domainUuid;
      list = list.filter((tx) => {
        if (tx.lockKeys.some((k) => k.includes(cleanFilter))) {
          return true;
        }
        if (tx.recoveryData && typeof tx.recoveryData === "object") {
          const rec = tx.recoveryData;
          return rec.domainUuid === filter.domainUuid || rec.domainUuid === cleanFilter || rec.sourceDomainUuid === filter.domainUuid || rec.sourceDomainUuid === cleanFilter || rec.targetDomainUuid === filter.domainUuid || rec.targetDomainUuid === cleanFilter;
        }
        return false;
      });
    }
    const allowed = [];
    for (const tx of list) {
      const proj = await this.#projectTransaction(tx, viewer);
      if (proj) {
        allowed.push(proj);
      }
    }
    return ok(Object.freeze(allowed));
  }
  listThresholds(domainUuid, resourceId) {
    return this.#thresholdService ? this.#thresholdService.listThresholds(domainUuid, resourceId) : [];
  }
  async evaluateThresholds(domainUuid, resourceId) {
    if (!this.#thresholdService) {
      return err(
        createPublicError({
          code: "DM_ECON_THRESHOLD_SERVICE_UNAVAILABLE",
          category: "internal",
          message: "Threshold service is not configured"
        })
      );
    }
    const availRes = await this.getAccountAvailability(domainUuid, resourceId);
    if (!availRes.ok) return availRes;
    if (!availRes.value) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Account '${resourceId}' in domain '${domainUuid}' not found`
        })
      );
    }
    const status = this.#thresholdService.evaluateStatus(domainUuid, resourceId, {
      balanceMinor: availRes.value.balanceMinor,
      availableMinor: availRes.value.availableMinor,
      capacityMinor: availRes.value.capacityMinor
    });
    return ok(status);
  }
  async getContext(domainUuid, callerViewer) {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;
    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) return econRes;
    const accounts = [];
    const visibleResourceIds = /* @__PURE__ */ new Set();
    for (const acc of econRes.value.accounts) {
      if (!this.#projection.isAccountVisible(acc, viewer)) {
        continue;
      }
      visibleResourceIds.add(acc.resourceId);
      const def = this.#resourceRegistry.get(acc.resourceId);
      const reserved = this.#reservationStore.getReservedTotal(domainUuid, acc.resourceId);
      let balance = acc.mode === "native" ? acc.balanceMinor : 0;
      let capacity = acc.mode === "native" ? acc.baseCapacityMinor : null;
      let isStale = false;
      let isUnavailable = false;
      if (acc.mode === "provider" && this.#providerRegistry) {
        const provider = this.#providerRegistry.get(acc.providerId);
        if (provider && "readBalance" in provider) {
          const balRes = await provider.readBalance(domainUuid, acc.resourceId, acc.providerRef);
          if (balRes?.ok) {
            balance = balRes.value.balanceMinor;
            capacity = balRes.value.effectiveCapacityMinor ?? capacity;
            isStale = Boolean(balRes.value.isStale);
          } else {
            isUnavailable = true;
          }
        } else {
          isUnavailable = true;
        }
      }
      if (acc.mode === "derived") {
        let resolved = false;
        if (this.#derivedResolvers) {
          const resolver = this.#derivedResolvers.get(acc.resolverId);
          if (resolver) {
            const res = await resolver(domainUuid, acc);
            if (res.ok) {
              balance = res.value.balanceMinor;
              isStale = Boolean(res.value.isStale);
              resolved = true;
            }
          }
        }
        if (!resolved) {
          isUnavailable = true;
        }
      }
      const projected = this.#projection.projectAccount(acc, def, reserved, viewer, {
        balanceMinor: balance,
        capacityMinor: capacity,
        isStale,
        isUnavailable
      });
      if (projected) {
        accounts.push(projected);
      }
    }
    const rawLedger = this.#ledgerStore.query({
      domainUuid,
      direction: "desc",
      limit: 20
    });
    const recentLedger = [];
    for (const entry of rawLedger) {
      const proj = this.#projection.projectLedgerEntry(entry, visibleResourceIds, viewer);
      if (proj) recentLedger.push(proj);
    }
    const rawReservations = this.#reservationStore.list({ domainUuid, status: "active" });
    const activeReservations = [];
    for (const r of rawReservations) {
      const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
      if (proj) activeReservations.push(proj);
    }
    return ok({
      domainUuid,
      accounts: Object.freeze(accounts),
      recentLedger: Object.freeze(recentLedger),
      activeReservations: Object.freeze(activeReservations),
      isGmView: viewer.isGm,
      projectedAt: Date.now()
    });
  }
  async getResource(domainUuid, resourceId, callerViewer) {
    const ctxRes = await this.getContext(domainUuid, callerViewer);
    if (!ctxRes.ok) return ctxRes;
    const acc = ctxRes.value.accounts.find((a) => a.resourceId === resourceId);
    if (!acc) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Resource account '${resourceId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok(acc);
  }
  async getAccount(domainUuid, resourceId, callerViewer) {
    const ctxRes = await this.getContext(domainUuid, callerViewer);
    if (!ctxRes.ok) return ctxRes;
    const acc = ctxRes.value.accounts.find((a) => a.resourceId === resourceId);
    return ok(acc);
  }
  async getAccountAvailability(domainUuid, resourceId, callerViewer) {
    const accRes = await this.getAccount(domainUuid, resourceId, callerViewer);
    if (!accRes.ok) return accRes;
    if (!accRes.value) return ok(void 0);
    return ok({
      balanceMinor: accRes.value.balanceMinor,
      availableMinor: accRes.value.availableMinor,
      reservedMinor: accRes.value.reservedMinor,
      capacityMinor: accRes.value.capacityMinor
    });
  }
  async queryLedger(filter, callerViewer) {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const visibleDomainResourceKeys = /* @__PURE__ */ new Set();
    if (filter.domainUuid) {
      const cleanId = filter.domainUuid.startsWith("JournalEntry.") ? filter.domainUuid.slice("JournalEntry.".length) : filter.domainUuid;
      const docRes = await this.#domains.read(cleanId);
      if (docRes.ok) {
        const econRes = tryGetDomainEconomyData(docRes.value.record);
        if (econRes.ok) {
          for (const acc of econRes.value.accounts) {
            if (this.#projection.isAccountVisible(acc, viewer)) {
              visibleDomainResourceKeys.add(`${cleanId}:${acc.resourceId}`);
              visibleDomainResourceKeys.add(`JournalEntry.${cleanId}:${acc.resourceId}`);
              visibleDomainResourceKeys.add(`${docRes.value.uuid}:${acc.resourceId}`);
            }
          }
        }
      }
    } else {
      const allDocsRes = this.#domains.query();
      if (allDocsRes.ok) {
        for (const doc of allDocsRes.value) {
          const cleanId = doc.id;
          const econRes = tryGetDomainEconomyData(doc.record);
          if (econRes.ok) {
            for (const acc of econRes.value.accounts) {
              if (this.#projection.isAccountVisible(acc, viewer)) {
                visibleDomainResourceKeys.add(`${cleanId}:${acc.resourceId}`);
                visibleDomainResourceKeys.add(`JournalEntry.${cleanId}:${acc.resourceId}`);
                visibleDomainResourceKeys.add(`${doc.uuid}:${acc.resourceId}`);
              }
            }
          }
        }
      }
    }
    const storeFilter = viewer.isGm ? filter : {
      ...filter,
      allowedDomainResourceKeys: visibleDomainResourceKeys
    };
    const paged = this.#ledgerStore.queryPaged(storeFilter);
    const projected = [];
    for (const entry of paged.entries) {
      const proj = this.#projection.projectLedgerEntry(entry, visibleDomainResourceKeys, viewer);
      if (proj) projected.push(proj);
    }
    return ok({
      entries: Object.freeze(projected),
      totalCount: paged.totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
      prevCursor: paged.prevCursor
    });
  }
  async getReservation(reservationId, callerViewer) {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const r = this.#reservationStore.get(reservationId);
    if (!r) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found`
        })
      );
    }
    const docRes = await this.#domains.read(r.domainUuid);
    if (!docRes.ok) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }
    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }
    const account = econRes.value.accounts.find((a) => a.resourceId === r.resourceId);
    if (!account || !this.#projection.isAccountVisible(account, viewer)) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }
    const visibleResourceIds = /* @__PURE__ */ new Set([r.resourceId]);
    const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
    if (!proj) {
      return err(
        createPublicError({
          code: "DM_ECON_RESERVATION_NOT_FOUND",
          category: "not-found",
          message: `Reservation '${reservationId}' not found or clearance insufficient`
        })
      );
    }
    return ok(proj);
  }
  async queryReservations(filter, callerViewer) {
    const viewer = this.#projection.resolveViewer(callerViewer);
    const raw = this.#reservationStore.list(filter);
    const visibleResourceIds = /* @__PURE__ */ new Set();
    if (filter.domainUuid) {
      const docRes = await this.#domains.read(filter.domainUuid);
      if (docRes.ok) {
        const econRes = tryGetDomainEconomyData(docRes.value.record);
        if (econRes.ok) {
          for (const acc of econRes.value.accounts) {
            if (this.#projection.isAccountVisible(acc, viewer)) {
              visibleResourceIds.add(acc.resourceId);
            }
          }
        }
      }
    }
    const projected = [];
    for (const r of raw) {
      const proj = this.#projection.projectReservation(r, visibleResourceIds, viewer);
      if (proj) projected.push(proj);
    }
    return ok(Object.freeze(projected));
  }
  async getProviderHealth(providerId) {
    if (!this.#providerRegistry) {
      return ok(Object.freeze([]));
    }
    if (providerId) {
      const p = this.#providerRegistry.get(providerId);
      if (!p) {
        return err(
          createPublicError({
            code: "DM_ECON_PROVIDER_NOT_FOUND",
            category: "not-found",
            message: `Provider '${providerId}' is not registered`
          })
        );
      }
      const h = await p.getHealth();
      return ok(Object.freeze([h]));
    }
    const healths = [];
    for (const p of this.#providerRegistry.list()) {
      healths.push(await p.getHealth());
    }
    return ok(Object.freeze(healths));
  }
  async getAggregateContext(domainUuids, callerViewer) {
    const agg = await this.#aggregation.getAggregateContext(domainUuids, callerViewer);
    return ok(agg);
  }
  // --- Safe Command Dispatch Helpers ---
  async adjust(payload, options) {
    return this.#dispatchCommand("economy:adjust", payload, options);
  }
  async transfer(payload, options) {
    return this.#dispatchCommand("economy:transfer", payload, options);
  }
  async convert(payload, options) {
    return this.#dispatchCommand("economy:convert", payload, options);
  }
  async reserve(payload, options) {
    return this.#dispatchCommand("economy:reserve", payload, options);
  }
  async consumeReservation(payload, options) {
    return this.#dispatchCommand("economy:consume-reservation", payload, options);
  }
  async releaseReservation(payload, options) {
    return this.#dispatchCommand("economy:release-reservation", payload, options);
  }
  async createAccount(payload, options) {
    return this.#dispatchCommand("economy:create-account", payload, options);
  }
  async closeAccount(payload, options) {
    return this.#dispatchCommand("economy:close-account", payload, options);
  }
  async reversal(payload, options) {
    return this.#dispatchCommand("economy:reversal", payload, options);
  }
  async #dispatchCommand(commandType, payload, options) {
    const envelope = {
      contractVersion: COMMAND_CONTRACT_VERSION_V1,
      commandId: createOpaqueId("cmd"),
      type: commandType,
      payload,
      issuedAtReal: Date.now()
    };
    return this.#commandBus.execute(envelope, options);
  }
};

// src/economy/commands/economy-permissions.ts
async function validateEconomyCommandPermission(ctx, domains, domainUuids, options) {
  if (ctx.senderUserId === null || ctx.senderUserId === ctx.authorityUserId) {
    return ok(true);
  }
  const gameUser = globalThis.game?.users?.get?.(ctx.senderUserId);
  if (gameUser?.isGM) {
    return ok(true);
  }
  if (options?.gmOnly) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Economy operation requires Game Master authorization"
      })
    );
  }
  if (domainUuids.length === 0) {
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: "Permission denied: target domain context required"
      })
    );
  }
  for (const rawDomainUuid of domainUuids) {
    const cleanId = rawDomainUuid.startsWith("JournalEntry.") ? rawDomainUuid.slice("JournalEntry.".length) : rawDomainUuid;
    const docRes = await domains.read(cleanId);
    if (!docRes.ok) {
      return err(
        createPublicError({
          code: "DM_SECURITY_PERMISSION_DENIED",
          category: "permission",
          message: `Permission denied: unable to resolve target domain '${rawDomainUuid}'`
        })
      );
    }
    const doc = docRes.value;
    if (options?.controllerProvider) {
      const isController = await options.controllerProvider.isDomainController(
        doc.uuid,
        ctx.senderUserId,
        { record: doc.record, document: doc }
      );
      if (isController) {
        continue;
      }
    }
    const ownership = doc.ownership;
    const userLevel = ownership ? ownership[ctx.senderUserId] ?? ownership.default ?? 0 : 0;
    if (userLevel >= 3) {
      continue;
    }
    return err(
      createPublicError({
        code: "DM_SECURITY_PERMISSION_DENIED",
        category: "permission",
        message: `User '${ctx.senderUserId}' is not authorized as Domain Controller for domain '${rawDomainUuid}'`
      })
    );
  }
  return ok(true);
}

// src/economy/commands/economy-commands.ts
function registerEconomyCommands(options) {
  const {
    registry,
    economyService,
    domains,
    controllerProvider,
    thresholdService,
    customResourceStore,
    resourceRegistry
  } = options;
  registry.register({
    type: "economy:adjust",
    visibility: "public",
    description: "Authoritatively adjusts resource balance on a domain (GM only)",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (typeof p.reason !== "string" || !p.reason.trim()) {
        return err(
          createPublicError({
            code: "DM_ECON_ADJUST_REASON_REQUIRED",
            category: "validation",
            message: "Adjustment requires a reason"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider,
      gmOnly: true
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.commitAdjust({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        deltaMinor: p.deltaMinor,
        targetBalanceMinor: p.targetBalanceMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.authorityEpoch
      });
    }
  });
  registry.register({
    type: "economy:transfer",
    visibility: "public",
    description: "Authoritatively transfers resources between two domains",
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
      if (typeof p.sourceDomainUuid !== "string" || !p.sourceDomainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "sourceDomainUuid is required"
          })
        );
      }
      if (typeof p.targetDomainUuid !== "string" || !p.targetDomainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "targetDomainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (typeof p.amountMinor !== "number" || !Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(
      ctx,
      domains,
      [ctx.command.payload.sourceDomainUuid, ctx.command.payload.targetDomainUuid],
      { controllerProvider }
    ),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.commitTransfer({
        sourceDomainUuid: p.sourceDomainUuid,
        targetDomainUuid: p.targetDomainUuid,
        resourceId: p.resourceId,
        amountMinor: p.amountMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.authorityEpoch
      });
    }
  });
  registry.register({
    type: "economy:convert",
    visibility: "public",
    description: "Converts one resource to another within a domain",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.fromResourceId) || !isNamespacedResourceId(p.toResourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "fromResourceId and toResourceId must be namespaced"
          })
        );
      }
      if (typeof p.fromAmountMinor !== "number" || !Number.isSafeInteger(p.fromAmountMinor) || p.fromAmountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "fromAmountMinor must be a positive safe integer"
          })
        );
      }
      if (typeof p.toAmountMinor !== "number" || !Number.isSafeInteger(p.toAmountMinor) || p.toAmountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "toAmountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.commitConvert({
        domainUuid: p.domainUuid,
        fromResourceId: p.fromResourceId,
        toResourceId: p.toResourceId,
        fromAmountMinor: p.fromAmountMinor,
        toAmountMinor: p.toAmountMinor,
        rateDescription: p.rateDescription,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.authorityEpoch
      });
    }
  });
  registry.register({
    type: "economy:reserve",
    visibility: "public",
    description: "Creates a resource reservation",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (typeof p.amountMinor !== "number" || !Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.reserve({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        amountMinor: p.amountMinor,
        source: p.source ?? { type: "command", ref: ctx.command.commandId },
        expiresAtWorld: p.expiresAtWorld,
        expiresAtReal: p.expiresAtReal
      });
    }
  });
  registry.register({
    type: "economy:consume-reservation",
    visibility: "public",
    description: "Consumes a reservation, debiting account balance and recording ledger entry",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.reservationId !== "string" || !p.reservationId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservationId is required"
          })
        );
      }
      if (typeof p.amountMinor !== "number" || !Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) {
        return err(
          createPublicError({
            code: "DM_ECON_AMOUNT_INVALID",
            category: "validation",
            message: "amountMinor must be a positive safe integer"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.consumeReservation({
        domainUuid: p.domainUuid,
        reservationId: p.reservationId,
        amountMinor: p.amountMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0,
        commandId: ctx.command.commandId,
        authorityEpoch: ctx.authorityEpoch
      });
    }
  });
  registry.register({
    type: "economy:release-reservation",
    visibility: "public",
    description: "Releases a reservation, freeing up availability without changing balance",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.reservationId !== "string" || !p.reservationId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "reservationId is required"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.releaseReservation({
        domainUuid: p.domainUuid,
        reservationId: p.reservationId,
        amountMinor: p.amountMinor,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0
      });
    }
  });
  registry.register({
    type: "economy:create-account",
    visibility: "public",
    description: "Creates a resource account in a domain (GM only)",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider,
      gmOnly: true
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.createAccount({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        mode: p.mode,
        initialBalanceMinor: p.initialBalanceMinor,
        baseCapacityMinor: p.baseCapacityMinor,
        visibility: p.visibility,
        providerId: p.providerId,
        providerRef: p.providerRef,
        resolverId: p.resolverId,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0
      });
    }
  });
  registry.register({
    type: "economy:close-account",
    visibility: "public",
    description: "Closes an empty resource account in a domain (GM only)",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider,
      gmOnly: true
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.closeAccount({
        domainUuid: p.domainUuid,
        resourceId: p.resourceId,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0
      });
    }
  });
  registry.register({
    type: "economy:reversal",
    visibility: "public",
    description: "Appends a compensating reversal entry to the ledger and updates balance (GM only)",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (typeof p.entryId !== "string" || !p.entryId.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "entryId is required"
          })
        );
      }
      if (typeof p.reason !== "string" || !p.reason.trim()) {
        return err(
          createPublicError({
            code: "DM_ECON_ADJUST_REASON_REQUIRED",
            category: "validation",
            message: "Reversal requires a reason"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider,
      gmOnly: true
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      return economyService.reverseLedgerEntry({
        domainUuid: p.domainUuid,
        entryId: p.entryId,
        reason: p.reason,
        userId: ctx.senderUserId ?? void 0
      });
    }
  });
  registry.register({
    type: "economy:set-threshold",
    visibility: "public",
    description: "Sets a resource threshold alert configuration",
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
      if (typeof p.domainUuid !== "string" || !p.domainUuid.trim()) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "domainUuid is required"
          })
        );
      }
      if (!isNamespacedResourceId(p.resourceId)) {
        return err(
          createPublicError({
            code: "DM_INVALID_COMMAND_PAYLOAD",
            category: "validation",
            message: "resourceId must be namespaced"
          })
        );
      }
      if (p.metric !== "balance" && p.metric !== "available") {
        return err(
          createPublicError({
            code: "DM_ECON_THRESHOLD_INVALID",
            category: "validation",
            message: "metric must be 'balance' or 'available'"
          })
        );
      }
      const val = p.targetValueMinor ?? p.valueMinor;
      if (typeof val !== "number" || !Number.isSafeInteger(val)) {
        return err(
          createPublicError({
            code: "DM_ECON_THRESHOLD_INVALID",
            category: "validation",
            message: "valueMinor/targetValueMinor must be a safe integer"
          })
        );
      }
      const validSeverities = ["info", "warning", "critical"];
      if (typeof p.severity !== "string" || !validSeverities.includes(p.severity)) {
        return err(
          createPublicError({
            code: "DM_ECON_THRESHOLD_INVALID",
            category: "validation",
            message: "severity must be 'info', 'warning', or 'critical'"
          })
        );
      }
      return ok(p);
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [ctx.command.payload.domainUuid], {
      controllerProvider
    }),
    handler: async (ctx) => {
      const p = ctx.command.payload;
      const targetThresholdService = thresholdService ?? economyService.thresholdService;
      if (!targetThresholdService) {
        return err(
          createPublicError({
            code: "DM_ECON_THRESHOLD_SERVICE_UNAVAILABLE",
            category: "internal",
            message: "Threshold service is not available"
          })
        );
      }
      const previous = p.id ? targetThresholdService.getThreshold(p.id) : void 0;
      const regRes = targetThresholdService.registerThreshold(p);
      if (regRes.ok) {
        try {
          await targetThresholdService.flush();
        } catch (e) {
          targetThresholdService.rollbackThreshold(regRes.value.id, previous);
          return err(
            createPublicError({
              code: "DM_DOMAIN_STORAGE_ERROR",
              category: "provider",
              message: `Failed to persist threshold: ${e instanceof Error ? e.message : String(e)}`,
              retryable: true
            })
          );
        }
      }
      return regRes;
    }
  });
  registry.register({
    type: "economy:register-custom-resource",
    visibility: "public",
    description: "Registers a custom resource definition (GM only)",
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
      const candidate = p.definition && typeof p.definition === "object" ? p.definition : p;
      const valRes = validateResourceDefinition(candidate);
      if (!valRes.ok) {
        return valRes;
      }
      return ok({ definition: valRes.value });
    },
    permissionValidator: (ctx) => validateEconomyCommandPermission(ctx, domains, [], { gmOnly: true }),
    handler: async (ctx) => {
      const def = ctx.command.payload.definition;
      const targetRegistry = resourceRegistry ?? economyService.registry;
      const targetStore = customResourceStore;
      if (targetRegistry && targetRegistry.has(def.id)) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_ALREADY_EXISTS",
            category: "conflict",
            message: `Resource definition with ID '${def.id}' already exists`
          })
        );
      }
      if (targetStore && targetStore.has(def.id)) {
        return err(
          createPublicError({
            code: "DM_ECON_RESOURCE_ALREADY_EXISTS",
            category: "conflict",
            message: `Resource definition with ID '${def.id}' already exists in store`
          })
        );
      }
      if (targetStore) {
        try {
          await targetStore.save(def);
        } catch (e) {
          return err(
            createPublicError({
              code: "DM_DOMAIN_STORAGE_ERROR",
              category: "provider",
              message: `Failed to persist custom resource: ${e instanceof Error ? e.message : String(e)}`,
              retryable: true
            })
          );
        }
      }
      if (targetRegistry) {
        const regRes = targetRegistry.register(def);
        if (!regRes.ok) {
          return regRes;
        }
      }
      return ok(def);
    }
  });
}

// src/economy/providers/native-resource-provider.ts
var NATIVE_RESOURCE_PROVIDER_ID = "domain-manager:native-provider";
var NativeResourceProvider = class {
  providerId = NATIVE_RESOURCE_PROVIDER_ID;
  contractVersion = 1;
  family = "resource-storage";
  label = "Canonical Native Resource Storage";
  capabilities = Object.freeze(["read", "write", "atomic-balance"]);
  isReadOnly = false;
  #domains;
  constructor(domains) {
    this.#domains = domains;
  }
  getHealth() {
    return {
      status: "healthy",
      message: "Native repository online",
      lastCheckedAt: Date.now()
    };
  }
  hasCapability(cap) {
    return this.capabilities.includes(cap);
  }
  async readBalance(domainUuid, resourceId, _providerRef) {
    const docRes = await this.#domains.read(domainUuid);
    if (!docRes.ok) return docRes;
    const econRes = tryGetDomainEconomyData(docRes.value.record);
    if (!econRes.ok) return econRes;
    const acc = econRes.value.accounts.find(
      (a) => a.resourceId === resourceId && a.mode === "native"
    );
    if (!acc) {
      return err(
        createPublicError({
          code: "DM_ECON_ACCOUNT_NOT_FOUND",
          category: "not-found",
          message: `Native account for '${resourceId}' not found in domain '${domainUuid}'`
        })
      );
    }
    return ok({
      balanceMinor: acc.balanceMinor,
      effectiveCapacityMinor: acc.baseCapacityMinor,
      isStale: false
    });
  }
};

// src/economy/storage/manual-currency-storage-adapter.ts
var MANUAL_CURRENCY_STORAGE_SCHEMA_VERSION = 1;
var MANUAL_CURRENCY_DOCUMENT_NAME = "[Domain Manager] Manual Currency Store";
var MANUAL_CURRENCY_FLAG_NAMESPACE = "domain-manager-manual-currency";
function runtimeFromGlobals7() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalManualCurrencyStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals7();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[MANUAL_CURRENCY_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    return rawFlag;
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    let doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      if (typeof doc.update === "function") {
        await doc.update({
          flags: {
            [MANUAL_CURRENCY_FLAG_NAMESPACE]: snapshot
          }
        });
      }
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: MANUAL_CURRENCY_DOCUMENT_NAME,
        flags: {
          [MANUAL_CURRENCY_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) => d.name === MANUAL_CURRENCY_DOCUMENT_NAME || Boolean(d.flags?.[MANUAL_CURRENCY_FLAG_NAMESPACE])
    );
  }
};

// src/economy/providers/manual-currency-provider.ts
var MANUAL_CURRENCY_PROVIDER_ID = "domain-manager:manual-currency";
var ManualCurrencyProvider = class {
  providerId = MANUAL_CURRENCY_PROVIDER_ID;
  contractVersion = 1;
  family = "currency";
  label = "Manual World Currency Provider";
  capabilities = Object.freeze(["read", "write"]);
  isReadOnly = false;
  #balances = /* @__PURE__ */ new Map();
  #storageAdapter;
  #persistQueue = Promise.resolve();
  #lastPersistError = null;
  #isHealthy = true;
  constructor(options) {
    this.#storageAdapter = options?.storageAdapter ?? new FoundryJournalManualCurrencyStorageAdapter();
  }
  async rehydrate() {
    if (!this.#storageAdapter) return;
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#balances.clear();
      for (const [key, bal] of Object.entries(snapshot.balances)) {
        this.#balances.set(key, bal);
      }
      this.#operations.clear();
      if (snapshot.operations) {
        for (const [key, op] of Object.entries(snapshot.operations)) {
          this.#operations.set(key, op);
        }
      }
    }
  }
  #schedulePersist() {
    if (!this.#storageAdapter) return;
    this.#persistQueue = this.#persistQueue.then(async () => {
      await this.#persist();
    }).catch((err3) => {
      this.#lastPersistError = err3 instanceof Error ? err3 : new Error(String(err3));
    });
  }
  async #persist() {
    if (!this.#storageAdapter) return;
    const balancesObj = {};
    for (const [k, v] of this.#balances.entries()) {
      balancesObj[k] = v;
    }
    const operationsObj = {};
    for (const [k, v] of this.#operations.entries()) {
      operationsObj[k] = v;
    }
    const snapshot = {
      schemaVersion: MANUAL_CURRENCY_STORAGE_SCHEMA_VERSION,
      balances: balancesObj,
      operations: operationsObj,
      updatedAt: Date.now()
    };
    await this.#storageAdapter.saveSnapshot(snapshot);
  }
  async flush() {
    this.#schedulePersist();
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err3 = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err3;
    }
  }
  getHealth() {
    return {
      status: this.#isHealthy ? "healthy" : "unavailable",
      message: this.#isHealthy ? "Manual currency online" : "Manual currency simulated offline",
      lastCheckedAt: Date.now()
    };
  }
  setHealthy(healthy) {
    this.#isHealthy = healthy;
  }
  hasCapability(cap) {
    return this.capabilities.includes(cap);
  }
  async getCurrencyBalance(targetRef) {
    if (!this.#isHealthy) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_UNAVAILABLE",
          category: "provider",
          message: `Manual currency provider is unavailable for target '${targetRef}'`
        })
      );
    }
    return ok(this.#balances.get(targetRef) ?? 0);
  }
  #operations = /* @__PURE__ */ new Map();
  async mutateCurrency(targetRef, deltaMinor, _reason, options) {
    if (!this.#isHealthy) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_UNAVAILABLE",
          category: "provider",
          message: `Manual currency provider is unavailable for target '${targetRef}'`
        })
      );
    }
    const current = this.#balances.get(targetRef) ?? 0;
    const next = current + deltaMinor;
    this.#balances.set(targetRef, next);
    if (options?.operationRef) {
      this.#operations.set(options.operationRef, { deltaMinor, timestamp: Date.now() });
    }
    this.#schedulePersist();
    return ok({
      newBalanceMinor: next,
      outcome: "success",
      ...options?.operationRef ? { providerTransactionRef: options.operationRef } : {}
    });
  }
  async readBalance(domainUuid, resourceId, providerRef) {
    const key = providerRef || `${domainUuid}:${resourceId}`;
    const balRes = await this.getCurrencyBalance(key);
    if (!balRes.ok) return balRes;
    return ok({ balanceMinor: balRes.value, isStale: false });
  }
  async mutateBalance(domainUuid, resourceId, providerRef, deltaMinor, reason, options) {
    const key = providerRef || `${domainUuid}:${resourceId}`;
    return this.mutateCurrency(key, deltaMinor, reason, options);
  }
  async reconcile(_domainUuidOrTargetRef, _resourceIdOrOpRef, providerRef, operationRef) {
    const opKey = operationRef ?? _resourceIdOrOpRef;
    const balKey = providerRef ?? _domainUuidOrTargetRef;
    const currentBalance = this.#balances.get(balKey) ?? 0;
    if (!this.#isHealthy) {
      return ok({
        written: false,
        outcome: "unknown",
        currentBalanceMinor: currentBalance
      });
    }
    const op = this.#operations.get(opKey);
    if (op) {
      return ok({
        written: true,
        outcome: "written",
        currentBalanceMinor: currentBalance
      });
    }
    return ok({
      written: false,
      outcome: "not-written",
      currentBalanceMinor: currentBalance
    });
  }
  async applyDelta(params) {
    return this.mutateBalance(
      params.domainUuid,
      params.resourceId,
      params.providerRef,
      params.deltaMinor,
      params.reason,
      params.options
    );
  }
  setBalance(targetRef, balanceMinor) {
    this.#balances.set(targetRef, balanceMinor);
    this.#schedulePersist();
  }
};

// src/economy/providers/provider-registry.ts
var ProviderRegistry = class {
  #providers = /* @__PURE__ */ new Map();
  #frozen = false;
  register(provider) {
    if (this.#frozen) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_REGISTRY_FROZEN",
          category: "conflict",
          message: "ProviderRegistry is frozen and cannot accept new registrations"
        })
      );
    }
    if (!isNamespacedProviderId(provider.providerId)) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_INVALID_ID",
          category: "validation",
          message: `Provider ID must be namespaced (e.g. 'pf2e:currency' or 'vault:inventory'): received '${String(provider.providerId)}'`
        })
      );
    }
    if (this.#providers.has(provider.providerId)) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_ALREADY_EXISTS",
          category: "conflict",
          message: `Provider '${provider.providerId}' is already registered`
        })
      );
    }
    if (!Number.isSafeInteger(provider.contractVersion) || provider.contractVersion < 1) {
      return err(
        createPublicError({
          code: "DM_ECON_PROVIDER_INCOMPATIBLE",
          category: "validation",
          message: `Provider '${provider.providerId}' has invalid contract version: ${provider.contractVersion}`
        })
      );
    }
    this.#providers.set(provider.providerId, provider);
    return ok(void 0);
  }
  get(providerId) {
    return this.#providers.get(providerId);
  }
  has(providerId) {
    return this.#providers.has(providerId);
  }
  getByFamily(family) {
    const matched = [];
    for (const p of this.#providers.values()) {
      if (p.family === family) {
        matched.push(p);
      }
    }
    return Object.freeze(matched);
  }
  list() {
    return Object.freeze(Array.from(this.#providers.values()));
  }
  freeze() {
    this.#frozen = true;
  }
  isFrozen() {
    return this.#frozen;
  }
};
function createDefaultProviderRegistry(domains) {
  const registry = new ProviderRegistry();
  if (domains) {
    registry.register(new NativeResourceProvider(domains));
  }
  registry.register(new ManualCurrencyProvider());
  return registry;
}

// src/economy/storage/threshold-storage-adapter.ts
var THRESHOLD_STORAGE_SCHEMA_VERSION = 1;
var THRESHOLD_DOCUMENT_NAME = "[Domain Manager] Threshold Store";
var THRESHOLD_FLAG_NAMESPACE = "domain-manager-thresholds";
function runtimeFromGlobals8() {
  const globals = globalThis;
  const journal = globals.game?.journal;
  const JournalEntry = globals.JournalEntry;
  if (!journal || !JournalEntry || typeof JournalEntry.create !== "function") {
    return void 0;
  }
  return {
    journal,
    createJournalEntry: (data) => JournalEntry.create(data)
  };
}
var FoundryJournalThresholdStorageAdapter = class {
  #runtime;
  #documentId;
  constructor(runtime2) {
    this.#runtime = runtime2 ?? runtimeFromGlobals8();
  }
  async loadSnapshot() {
    if (!this.#runtime) {
      return null;
    }
    const doc = this.#findDocument();
    if (!doc) {
      return null;
    }
    this.#documentId = doc.id;
    const rawFlag = doc.flags?.[THRESHOLD_FLAG_NAMESPACE];
    if (!rawFlag || typeof rawFlag !== "object") {
      return null;
    }
    const snap = rawFlag;
    if (snap.schemaVersion !== THRESHOLD_STORAGE_SCHEMA_VERSION || !Array.isArray(snap.thresholds)) {
      return null;
    }
    return {
      schemaVersion: snap.schemaVersion,
      thresholds: snap.thresholds,
      crossedStates: snap.crossedStates ?? {},
      updatedAt: snap.updatedAt ?? Date.now()
    };
  }
  async saveSnapshot(snapshot) {
    if (!this.#runtime) {
      return;
    }
    const doc = this.#findDocument();
    if (doc) {
      this.#documentId = doc.id;
      await doc.update({
        [`flags.${THRESHOLD_FLAG_NAMESPACE}`]: snapshot
      });
    } else {
      const created = await this.#runtime.createJournalEntry({
        name: THRESHOLD_DOCUMENT_NAME,
        flags: {
          [THRESHOLD_FLAG_NAMESPACE]: snapshot
        }
      });
      if (created) {
        this.#documentId = created.id;
      }
    }
  }
  #findDocument() {
    if (!this.#runtime) return void 0;
    if (this.#documentId) {
      const found = this.#runtime.journal.get(this.#documentId);
      if (found) return found;
    }
    return this.#runtime.journal.contents.find(
      (d) => d.name === THRESHOLD_DOCUMENT_NAME || Boolean(d.flags?.[THRESHOLD_FLAG_NAMESPACE])
    );
  }
};

// src/economy/thresholds/threshold-service.ts
var ThresholdService = class {
  #thresholds = /* @__PURE__ */ new Map();
  #crossedStates = /* @__PURE__ */ new Map();
  #storageAdapter;
  #persistQueue = Promise.resolve();
  #lastPersistError = null;
  constructor(options) {
    if (options && "loadSnapshot" in options) {
      this.#storageAdapter = options;
    } else if (options && typeof options === "object") {
      this.#storageAdapter = options.storageAdapter;
    }
  }
  async rehydrate() {
    if (!this.#storageAdapter) return this.listThresholds();
    const snapshot = await this.#storageAdapter.loadSnapshot();
    if (snapshot) {
      this.#thresholds.clear();
      this.#crossedStates.clear();
      for (const th of snapshot.thresholds) {
        this.#thresholds.set(th.id, th);
      }
      if (snapshot.crossedStates) {
        for (const [id, state] of Object.entries(snapshot.crossedStates)) {
          this.#crossedStates.set(id, Boolean(state));
        }
      }
    }
    return this.listThresholds();
  }
  #schedulePersist() {
    if (!this.#storageAdapter) return;
    const snapshot = {
      schemaVersion: THRESHOLD_STORAGE_SCHEMA_VERSION,
      thresholds: Array.from(this.#thresholds.values()),
      crossedStates: Object.fromEntries(this.#crossedStates.entries()),
      updatedAt: Date.now()
    };
    this.#persistQueue = this.#persistQueue.then(async () => {
      await this.#storageAdapter.saveSnapshot(snapshot);
    }).catch((err3) => {
      this.#lastPersistError = err3 instanceof Error ? err3 : new Error(String(err3));
    });
  }
  async flush() {
    if (!this.#storageAdapter) return;
    await this.#persistQueue;
    if (this.#lastPersistError) {
      const err3 = this.#lastPersistError;
      this.#lastPersistError = null;
      throw err3;
    }
  }
  register(input) {
    return this.registerThreshold(input);
  }
  registerThreshold(input) {
    const id = input.id ?? createOpaqueId("thrs");
    const value = input.targetValueMinor ?? input.valueMinor ?? 0;
    if (!Number.isSafeInteger(value)) {
      return err(
        createPublicError({
          code: "DM_ECON_THRESHOLD_INVALID",
          category: "validation",
          message: `Threshold valueMinor must be a safe integer: received ${String(value)}`
        })
      );
    }
    const op = input.operator ?? input.comparator ?? "<=";
    const label = input.name ?? input.label ?? "Alert";
    const definition = {
      id,
      domainUuid: input.domainUuid,
      resourceId: input.resourceId,
      metric: input.metric,
      comparator: op,
      operator: op,
      valueMinor: value,
      targetValueMinor: value,
      severity: input.severity,
      label,
      name: label,
      autoHoldReservations: Boolean(input.autoHoldReservations)
    };
    this.#thresholds.set(id, definition);
    this.#schedulePersist();
    return ok(definition);
  }
  removeThreshold(id) {
    const deleted = this.#thresholds.delete(id);
    if (deleted) {
      this.#crossedStates.delete(id);
      this.#schedulePersist();
    }
    return deleted;
  }
  rollbackThreshold(id, previous) {
    if (previous) {
      this.#thresholds.set(id, previous);
    } else {
      this.#thresholds.delete(id);
      this.#crossedStates.delete(id);
    }
  }
  getThreshold(id) {
    return this.#thresholds.get(id);
  }
  listThresholds(domainUuid, resourceId) {
    let list = Array.from(this.#thresholds.values());
    if (domainUuid) {
      list = list.filter((t) => t.domainUuid === domainUuid);
    }
    if (resourceId) {
      list = list.filter((t) => t.resourceId === resourceId);
    }
    return Object.freeze(list);
  }
  evaluate(domainUuid, resourceId, values) {
    const domainThresholds = this.listThresholds(domainUuid, resourceId);
    const results = [];
    for (const th of domainThresholds) {
      const current = th.metric === "balance" ? values.balanceMinor : values.availableMinor;
      let isCrossed = false;
      switch (th.operator) {
        case "<":
        case "lt":
          isCrossed = current < th.valueMinor;
          break;
        case "<=":
        case "lte":
          isCrossed = current <= th.valueMinor;
          break;
        case ">":
        case "gt":
          isCrossed = current > th.valueMinor;
          break;
        case ">=":
        case "gte":
          isCrossed = current >= th.valueMinor;
          break;
      }
      if (isCrossed) {
        results.push({
          breached: true,
          definition: th,
          actualValueMinor: current
        });
      }
    }
    return Object.freeze(results);
  }
  isCrossed(id) {
    return this.#crossedStates.get(id) ?? false;
  }
  resetCrossedState(id) {
    if (id !== void 0) {
      this.#crossedStates.delete(id);
    } else {
      this.#crossedStates.clear();
    }
    this.#schedulePersist();
  }
  getCrossedStates() {
    return new Map(this.#crossedStates);
  }
  evaluateCrossings(domainUuid, resourceId, values) {
    const domainThresholds = this.listThresholds(domainUuid, resourceId);
    const transitions = [];
    for (const th of domainThresholds) {
      const current = th.metric === "balance" ? values.balanceMinor : values.availableMinor;
      let isBreached = false;
      switch (th.operator) {
        case "<":
        case "lt":
          isBreached = current < th.valueMinor;
          break;
        case "<=":
        case "lte":
          isBreached = current <= th.valueMinor;
          break;
        case ">":
        case "gt":
          isBreached = current > th.valueMinor;
          break;
        case ">=":
        case "gte":
          isBreached = current >= th.valueMinor;
          break;
      }
      const previousState = this.#crossedStates.get(th.id) ?? false;
      if (isBreached !== previousState) {
        this.#crossedStates.set(th.id, isBreached);
        transitions.push({
          type: isBreached ? "breach" : "recovery",
          definition: th,
          actualValueMinor: current,
          previousState,
          currentState: isBreached
        });
      }
    }
    if (transitions.length > 0) {
      this.#schedulePersist();
    }
    return Object.freeze(transitions);
  }
  evaluateStatus(domainUuid, resourceId, values) {
    const breaches = this.evaluate(domainUuid, resourceId, values);
    const crossed = breaches.map((b) => b.definition);
    let highestSeverity;
    if (crossed.some((t) => t.severity === "critical")) {
      highestSeverity = "critical";
    } else if (crossed.some((t) => t.severity === "warning")) {
      highestSeverity = "warning";
    } else if (crossed.some((t) => t.severity === "info")) {
      highestSeverity = "info";
    }
    const cap = values.capacityMinor;
    const isOverCapacity = cap !== null && cap !== void 0 && values.balanceMinor > cap;
    const isNearCapacity = cap !== null && cap !== void 0 && cap > 0 && values.balanceMinor >= cap * 0.85 && !isOverCapacity;
    const isLowReserve = values.availableMinor < 0;
    return {
      domainUuid,
      resourceId,
      crossedThresholds: Object.freeze(crossed),
      highestSeverity,
      isNearCapacity,
      isOverCapacity,
      isLowReserve
    };
  }
};

// src/economy/math/minor-units.ts
function assertSafeInteger(value, fieldName = "amount") {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_OVERFLOW",
        category: "validation",
        message: `${fieldName} must be a safe integer (between -(2^53 - 1) and 2^53 - 1): received ${String(value)}`
      })
    );
  }
  return ok(value);
}
function minorToMajor(amountMinor, precision) {
  if (precision === 0) return amountMinor;
  const factor = 10 ** precision;
  return amountMinor / factor;
}
function majorToMinor(amountMajor, precision) {
  if (typeof amountMajor !== "number" || !Number.isFinite(amountMajor)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Amount must be a finite number: received ${String(amountMajor)}`
      })
    );
  }
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 4) {
    return err(
      createPublicError({
        code: "DM_ECON_PRECISION_INVALID",
        category: "validation",
        message: `Precision must be an integer between 0 and 4: received ${String(precision)}`
      })
    );
  }
  const factor = 10 ** precision;
  const minor = Math.round(amountMajor * factor);
  return assertSafeInteger(minor, "Calculated minor units");
}
function formatResourceAmount(amountMinor, definition, options) {
  const precision = definition.precision;
  const major = minorToMajor(amountMinor, precision);
  const locale = options?.locale ?? "en-US";
  const formattedNumber = major.toLocaleString(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
  if (!options?.showUnit || !definition.displayUnit) {
    return formattedNumber;
  }
  const unit = definition.displayUnit;
  if (unit.abbreviation) {
    return `${formattedNumber} ${unit.abbreviation}`;
  }
  const isSingular = Math.abs(major) === 1;
  const unitLabel = isSingular ? unit.singular ?? unit.plural ?? "" : unit.plural ?? unit.singular ?? "";
  return unitLabel ? `${formattedNumber} ${unitLabel}` : formattedNumber;
}
function parseResourceAmount(text, precision) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: "Amount string cannot be empty"
      })
    );
  }
  const clean = text.trim();
  let normalized = clean;
  const commaIdx = clean.lastIndexOf(",");
  const dotIdx = clean.lastIndexOf(".");
  if (commaIdx !== -1 && dotIdx !== -1) {
    if (commaIdx > dotIdx) {
      normalized = clean.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = clean.replace(/,/g, "");
    }
  } else if (commaIdx !== -1) {
    if (precision > 0) {
      normalized = clean.replace(",", ".");
    } else {
      normalized = clean.replace(/,/g, "");
    }
  }
  const parsedFloat = Number(normalized);
  if (Number.isNaN(parsedFloat) || !Number.isFinite(parsedFloat)) {
    return err(
      createPublicError({
        code: "DM_ECON_AMOUNT_INVALID",
        category: "validation",
        message: `Could not parse '${text}' as a valid number`
      })
    );
  }
  return majorToMinor(parsedFloat, precision);
}

// src/ui/domain-patterns/economy/economy-presenter.ts
function buildEconomyViewModel(domainInput, options) {
  const record = "record" in domainInput ? domainInput.record : "flags" in domainInput && domainInput.flags?.["domain-manager"] ? domainInput.flags["domain-manager"] : domainInput;
  const domainUuid = "uuid" in domainInput ? domainInput.uuid : "unknown";
  const economyData = getDomainEconomyData(record);
  const projectionService = new EconomyProjectionService();
  const viewer = options.viewer ? projectionService.resolveViewer(options.viewer) : projectionService.resolveViewer({ isGm: options.viewerIsGm ?? false });
  const accountVMs = [];
  for (const acc of economyData.accounts) {
    if (!projectionService.isAccountVisible(acc, viewer)) {
      continue;
    }
    const def = options.resourceRegistry.get(acc.resourceId);
    const label = def?.label ?? acc.resourceId;
    const precision = def?.precision ?? 0;
    const unit = def?.displayUnit?.singular ?? def?.displayUnit?.abbreviation ?? "";
    const isClosed = acc.status === "closed";
    let balanceMinor = acc.mode === "native" ? acc.balanceMinor : 0;
    let providerAvailable = true;
    let providerStatus = void 0;
    if (acc.mode === "provider") {
      const health = options.providerHealthMap?.get(acc.providerId);
      if (health) {
        providerStatus = health.status;
        providerAvailable = health.status === "healthy" || health.status === "degraded";
      } else {
        providerAvailable = Boolean(options.providerRegistry?.has(acc.providerId));
        providerStatus = providerAvailable ? "healthy" : "unavailable";
      }
    }
    const reservedMinor = options.reservationStore ? options.reservationStore.getReservedTotal(domainUuid, acc.resourceId) : 0;
    const availableMinor = balanceMinor - reservedMinor;
    const baseCap = acc.mode === "native" ? acc.baseCapacityMinor : null;
    const effectiveCap = resolveEffectiveCapacity(baseCap, [], def);
    const effectiveCapacityMinor = effectiveCap.effectiveCapacityMinor;
    let capacityPercentage = null;
    let statusBadgeClass = "normal";
    if (isClosed) {
      statusBadgeClass = "closed";
    } else {
      if (effectiveCapacityMinor !== null && effectiveCapacityMinor > 0) {
        capacityPercentage = Math.min(100, Math.round(balanceMinor / effectiveCapacityMinor * 100));
        if (balanceMinor > effectiveCapacityMinor) {
          statusBadgeClass = "over-capacity";
        } else if (capacityPercentage >= 85) {
          statusBadgeClass = "near-capacity";
        }
      }
      if (availableMinor < 0) {
        statusBadgeClass = "low-reserve";
      }
    }
    const resDef = def ?? {
      id: acc.resourceId,
      version: 1,
      label,
      description: "",
      icon: "",
      categoryId: "custom",
      tags: [],
      precision,
      displayUnit: { singular: unit, plural: unit },
      minimumMinor: 0,
      maximumMinor: null,
      allowNegative: false,
      defaultCapacityPolicy: "block",
      lifecycle: "active"
    };
    let balanceFormatted;
    if (acc.mode === "provider" && !providerAvailable) {
      balanceFormatted = "Provider Unavailable";
    } else if (acc.mode === "provider") {
      balanceFormatted = "External Sync";
    } else {
      balanceFormatted = formatResourceAmount(balanceMinor, resDef, { showUnit: true });
    }
    const reservedFormatted = formatResourceAmount(reservedMinor, resDef, { showUnit: true });
    const availableFormatted = acc.mode === "native" ? formatResourceAmount(availableMinor, resDef, { showUnit: true }) : balanceFormatted;
    const capacityFormatted = effectiveCapacityMinor !== null ? formatResourceAmount(effectiveCapacityMinor, resDef, { showUnit: true }) : "Unlimited";
    accountVMs.push({
      resourceId: acc.resourceId,
      label,
      ...def?.icon ? { icon: def.icon } : {},
      displayUnit: unit,
      precision,
      mode: acc.mode,
      status: acc.status === "closed" ? "closed" : "active",
      balanceMinor,
      balanceFormatted,
      reservedMinor,
      reservedFormatted,
      availableMinor,
      availableFormatted,
      effectiveCapacityMinor,
      capacityFormatted,
      capacityPercentage,
      isSecret: acc.visibility === "secret",
      statusBadgeClass,
      providerId: acc.mode === "provider" ? acc.providerId : void 0,
      providerAvailable: acc.mode === "provider" ? providerAvailable : void 0,
      providerStatus: acc.mode === "provider" ? providerStatus : void 0,
      description: def?.description,
      categoryId: def?.categoryId ?? void 0,
      tags: def?.tags
    });
  }
  const visibleResourceIds = new Set(accountVMs.map((a) => a.resourceId));
  const reservationVMs = [];
  if (options.reservationStore) {
    const rawReservations = options.reservationStore.list({ domainUuid });
    for (const r of rawReservations) {
      if (r.status !== "active" && r.status !== "partially-consumed") {
        continue;
      }
      if (!viewer.isGm && !visibleResourceIds.has(r.resourceId)) {
        continue;
      }
      const def = options.resourceRegistry.get(r.resourceId);
      const resDef = def ?? {
        id: r.resourceId,
        version: 1,
        label: r.resourceId,
        description: "",
        icon: "",
        categoryId: "custom",
        tags: [],
        precision: 0,
        displayUnit: { singular: "", plural: "" },
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      };
      reservationVMs.push({
        id: r.id,
        resourceId: r.resourceId,
        resourceLabel: def?.label ?? r.resourceId,
        amountMinor: r.remainingAmountMinor,
        amountFormatted: formatResourceAmount(r.remainingAmountMinor, resDef, { showUnit: true }),
        status: r.status,
        reason: viewer.isGm ? r.source.reason : void 0,
        expiresAtFormatted: r.expiresAtReal ? new Date(r.expiresAtReal).toLocaleTimeString() : void 0,
        canRelease: true
      });
    }
  }
  const ledgerVMs = [];
  const ledgerPage = Math.max(0, options.ledgerPage ?? 0);
  const ledgerPageSize = Math.max(1, options.ledgerPageSize ?? 20);
  let ledgerTotalCount = 0;
  let ledgerHasMore = false;
  let ledgerHasPrev = ledgerPage > 0;
  if (options.ledgerStore) {
    const allEntries = options.ledgerStore.query({ domainUuid, direction: "desc" });
    const filteredEntries = allEntries.filter(
      (entry) => viewer.isGm || visibleResourceIds.has(entry.resourceId)
    );
    ledgerTotalCount = filteredEntries.length;
    ledgerHasMore = (ledgerPage + 1) * ledgerPageSize < ledgerTotalCount;
    ledgerHasPrev = ledgerPage > 0;
    const pagedEntries = filteredEntries.slice(
      ledgerPage * ledgerPageSize,
      (ledgerPage + 1) * ledgerPageSize
    );
    for (const entry of pagedEntries) {
      const def = options.resourceRegistry.get(entry.resourceId);
      const label = def?.label ?? entry.resourceId;
      const precision = def?.precision ?? 0;
      const unit = def?.displayUnit?.singular ?? "";
      const resDef = def ?? {
        id: entry.resourceId,
        version: 1,
        label,
        description: "",
        icon: "",
        categoryId: "custom",
        tags: [],
        precision,
        displayUnit: { singular: unit, plural: unit },
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      };
      const deltaFormatted = (entry.deltaMinor > 0 ? "+" : "") + formatResourceAmount(entry.deltaMinor, resDef, { showUnit: true });
      ledgerVMs.push({
        id: entry.id,
        timestampFormatted: new Date(entry.timestampReal).toLocaleTimeString(),
        kind: entry.kind,
        deltaFormatted,
        deltaClass: entry.deltaMinor >= 0 ? "positive" : "negative",
        reason: viewer.isGm ? entry.source?.reason : void 0,
        resourceLabel: def?.label ?? entry.resourceId
      });
    }
  }
  const providerStatuses = [];
  if (options.providerRegistry) {
    for (const provider of options.providerRegistry.list()) {
      const health = options.providerHealthMap?.get(provider.providerId);
      const status = health?.status ?? "healthy";
      providerStatuses.push({
        providerId: provider.providerId,
        status,
        statusBadgeClass: `badge--${status}`,
        lastCheckedAt: health?.lastCheckedAt,
        lastCheckedFormatted: health?.lastCheckedAt ? new Date(health.lastCheckedAt).toLocaleTimeString() : void 0,
        message: health?.message
      });
    }
  }
  const transactionVMs = [];
  if (options.transactionStore) {
    let rawTxs = options.transactionStore.listAll();
    rawTxs = rawTxs.filter((tx) => {
      if (tx.lockKeys.some((k) => k.includes(domainUuid))) return true;
      if (tx.recoveryData && typeof tx.recoveryData === "object") {
        const rec = tx.recoveryData;
        return rec.domainUuid === domainUuid || rec.sourceDomainUuid === domainUuid || rec.targetDomainUuid === domainUuid;
      }
      return false;
    });
    for (const tx of rawTxs) {
      if (!viewer.isGm && tx.recoveryData && typeof tx.recoveryData === "object") {
        const rec = tx.recoveryData;
        const resIds = [];
        if (rec.resourceId) resIds.push(rec.resourceId);
        if (rec.fromResourceId) resIds.push(rec.fromResourceId);
        if (rec.toResourceId) resIds.push(rec.toResourceId);
        if (resIds.length > 0) {
          const hasVisibleResource = resIds.some((rId) => visibleResourceIds.has(rId));
          if (!hasVisibleResource) {
            continue;
          }
        }
      }
      const lastTransition = tx.history[tx.history.length - 1];
      let stateBadgeClass = "in-flight";
      if (tx.state === "committed") stateBadgeClass = "committed";
      else if (tx.state === "compensated") stateBadgeClass = "compensated";
      else if (tx.state === "failed") stateBadgeClass = "failed";
      let reason = void 0;
      if (tx.recoveryData && typeof tx.recoveryData === "object") {
        reason = viewer.isGm ? tx.recoveryData.reason : void 0;
      }
      const lockKeys = viewer.isGm ? tx.lockKeys : tx.lockKeys.filter((k) => k.includes(domainUuid));
      const failureReason = viewer.isGm ? lastTransition?.reason : tx.state === "failed" ? "Transaction failed" : void 0;
      transactionVMs.push({
        transactionId: tx.transactionId,
        commandId: tx.commandId,
        state: tx.state,
        authorityEpoch: tx.authorityEpoch,
        lockKeys: Object.freeze(lockKeys),
        createdAtFormatted: new Date(tx.createdAt).toLocaleTimeString(),
        stateBadgeClass,
        reason,
        failureReason
      });
    }
  }
  return {
    domainUuid,
    viewerIsGm: viewer.isGm,
    accounts: Object.freeze(accountVMs),
    reservations: Object.freeze(reservationVMs),
    recentLedger: Object.freeze(ledgerVMs),
    providerStatuses: Object.freeze(providerStatuses),
    transactions: Object.freeze(transactionVMs),
    ledgerPage,
    ledgerTotalCount,
    ledgerHasMore,
    ledgerHasPrev
  };
}

// src/ui/domain-patterns/economy/economy-view.ts
function escapeHtml2(value) {
  if (value === null || value === void 0) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttribute2(value) {
  return escapeHtml2(value);
}
function renderEconomySubsystemHtml(vm) {
  return `
    <div class="dm-economy-subsystem" data-domain-uuid="${escapeAttribute2(vm.domainUuid)}">
      <header class="dm-economy-header">
        <div class="dm-header-title">
          <h3><i class="fas fa-coins"></i> Economy & Resources</h3>
        </div>
        <div class="dm-header-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="openTransferModal">
            <i class="fas fa-exchange-alt"></i> Transfer
          </button>
          <button type="button" class="dm-btn dm-btn-secondary" data-action="openTransactionHistoryModal">
            <i class="fas fa-receipt"></i> Transactions
          </button>
          ${vm.viewerIsGm ? `
            <button type="button" class="dm-btn dm-btn-secondary" data-action="openAdjustModal">
              <i class="fas fa-sliders-h"></i> Adjust
            </button>
            <button type="button" class="dm-btn dm-btn-primary" data-action="openCreateAccountModal">
              <i class="fas fa-plus"></i> New Account
            </button>
          ` : ""}
        </div>
      </header>

      ${renderProviderStatusSection(vm.providerStatuses)}

      <section class="dm-resource-cards-section">
        ${renderResourceCards(vm.accounts)}
      </section>

      <section class="dm-reservations-section">
        <h4><i class="fas fa-bookmark"></i> Active Reservations</h4>
        ${renderReservationsTable(vm.reservations)}
      </section>

      <section class="dm-ledger-history-section">
        <h4><i class="fas fa-history"></i> Recent Ledger Activity</h4>
        ${renderLedgerTable(vm.recentLedger, {
    page: vm.ledgerPage,
    totalCount: vm.ledgerTotalCount,
    hasMore: vm.ledgerHasMore,
    hasPrev: vm.ledgerHasPrev
  })}
      </section>
    </div>
  `;
}
function renderProviderStatusSection(providers = []) {
  if (!providers || providers.length === 0) return "";
  return `
    <section class="dm-provider-status-section">
      <div class="dm-provider-status-strip">
        <span class="dm-strip-label"><i class="fas fa-server"></i> Provider Status:</span>
        <div class="dm-provider-badges-list">
          ${providers.map(
    (p) => `
            <span class="dm-badge-provider-health dm-health-${escapeAttribute2(p.status)}" title="${escapeAttribute2(p.message ?? p.status)}">
              <i class="fas fa-circle"></i> ${escapeHtml2(p.providerId)}: <strong>${escapeHtml2(p.status.toUpperCase())}</strong>
              ${p.lastCheckedFormatted ? `<small>(${escapeHtml2(p.lastCheckedFormatted)})</small>` : ""}
            </span>
          `
  ).join("")}
        </div>
      </div>
    </section>
  `;
}
function renderResourceCards(accounts = []) {
  if (!accounts || accounts.length === 0) {
    return `<div class="dm-empty-state">No resource accounts configured in this domain.</div>`;
  }
  return `
    <div class="dm-resource-grid">
      ${accounts.map(
    (acc) => `
        <div class="dm-card dm-resource-card ${escapeAttribute2(acc.statusBadgeClass)} ${acc.isSecret ? "secret" : ""}"
             data-resource-id="${escapeAttribute2(acc.resourceId)}">
          <div class="dm-card-header">
            <div class="dm-card-icon"><i class="${escapeAttribute2(acc.icon ?? "fas fa-box")}"></i></div>
            <h4 class="dm-card-title">${escapeHtml2(acc.label)}</h4>
            <div class="dm-card-badges">
              ${acc.isSecret ? `<span class="dm-badge-secret"><i class="fas fa-eye-slash"></i> Secret</span>` : ""}
              ${acc.mode === "provider" ? `<span class="dm-badge-provider ${acc.providerStatus ? `status-${escapeAttribute2(acc.providerStatus)}` : acc.providerAvailable ? "online" : "offline"}"><i class="fas fa-plug"></i> ${escapeHtml2(acc.providerId ?? "Provider")} (${escapeHtml2((acc.providerStatus ?? (acc.providerAvailable ? "Active" : "Offline")).toUpperCase())})</span>` : ""}
              <button type="button" class="dm-btn-icon dm-btn-detail" data-action="openResourceDetail" data-resource-id="${escapeAttribute2(acc.resourceId)}" title="View details">
                <i class="fas fa-info-circle"></i>
              </button>
            </div>
          </div>

          <div class="dm-card-balance">
            <span class="dm-balance-major">${escapeHtml2(acc.balanceFormatted)}</span>
          </div>

          <div class="dm-card-metrics">
            <div class="dm-metric">
              <span class="dm-metric-label">Reserved:</span>
              <span class="dm-metric-value">${escapeHtml2(acc.reservedFormatted)}</span>
            </div>
            <div class="dm-metric">
              <span class="dm-metric-label">Available:</span>
              <span class="dm-metric-value dm-metric-available">${escapeHtml2(acc.availableFormatted)}</span>
            </div>
            <div class="dm-metric">
              <span class="dm-metric-label">Capacity:</span>
              <span class="dm-metric-value">${escapeHtml2(acc.capacityFormatted)}</span>
            </div>
          </div>

          ${acc.capacityPercentage !== null ? `
            <div class="dm-capacity-progress-bar">
              <div class="dm-progress-fill ${escapeAttribute2(acc.statusBadgeClass)}" style="width: ${acc.capacityPercentage}%"></div>
            </div>
          ` : ""}
        </div>
      `
  ).join("")}
    </div>
  `;
}
function renderLedgerTable(entries = [], pagination) {
  if (!entries || entries.length === 0) {
    return `<div class="dm-empty-state">No recent ledger transactions recorded.</div>`;
  }
  return `
    <div class="dm-ledger-container">
      <table class="dm-ledger-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Resource</th>
            <th>Type</th>
            <th>Delta</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(
    (e) => `
            <tr class="dm-ledger-row">
              <td class="dm-col-time">${escapeHtml2(e.timestampFormatted)}</td>
              <td class="dm-col-resource">${escapeHtml2(e.resourceLabel)}</td>
              <td class="dm-col-kind"><span class="dm-kind-badge">${escapeHtml2(e.kind)}</span></td>
              <td class="dm-col-delta ${escapeAttribute2(e.deltaClass)}">${escapeHtml2(e.deltaFormatted)}</td>
              <td class="dm-col-reason">${escapeHtml2(e.reason ?? "\u2014")}</td>
            </tr>
          `
  ).join("")}
        </tbody>
      </table>
      ${pagination !== void 0 ? `
        <div class="dm-ledger-pagination">
          <button type="button" class="dm-btn dm-btn-secondary dm-btn-sm" data-action="prevLedgerPage" ${!pagination.hasPrev ? "disabled" : ""}>
            <i class="fas fa-chevron-left"></i> Previous
          </button>
          <span class="dm-ledger-page-info">Showing ${entries.length} of ${pagination.totalCount} transactions (Page ${pagination.page + 1})</span>
          <button type="button" class="dm-btn dm-btn-secondary dm-btn-sm" data-action="nextLedgerPage" ${!pagination.hasMore ? "disabled" : ""}>
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ""}
    </div>
  `;
}
function renderReservationsTable(reservations = []) {
  if (!reservations || reservations.length === 0) {
    return `<div class="dm-empty-state">No active reservations recorded.</div>`;
  }
  return `
    <table class="dm-reservations-table">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Reserved Amount</th>
          <th>Status</th>
          <th>Reason</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${reservations.map(
    (r) => `
          <tr class="dm-reservation-row" data-reservation-id="${escapeAttribute2(r.id)}">
            <td class="dm-col-resource">${escapeHtml2(r.resourceLabel)}</td>
            <td class="dm-col-amount">${escapeHtml2(r.amountFormatted)}</td>
            <td class="dm-col-status"><span class="dm-kind-badge ${escapeAttribute2(r.status)}">${escapeHtml2(r.status)}</span></td>
            <td class="dm-col-reason">${escapeHtml2(r.reason ?? "\u2014")}</td>
            <td class="dm-col-expires">${escapeHtml2(r.expiresAtFormatted ?? "Never")}</td>
            <td class="dm-col-actions">
              <button type="button" class="dm-btn dm-btn-xs dm-btn-danger" data-action="releaseReservation" data-reservation-id="${escapeAttribute2(r.id)}" title="Release Reservation">
                <i class="fas fa-times-circle"></i> Release
              </button>
            </td>
          </tr>
        `
  ).join("")}
      </tbody>
    </table>
  `;
}
function renderTransferModalHtml(domainUuid, accounts) {
  return `
    <div class="dm-modal dm-transfer-modal" data-modal-type="transfer">
      <h3><i class="fas fa-exchange-alt"></i> Transfer Resources</h3>
      <form data-form-type="transfer">
        <input type="hidden" name="sourceDomainUuid" value="${escapeAttribute2(domainUuid)}" />
        <label>
          Resource:
          <select name="resourceId" required>
            ${accounts.map((a) => `<option value="${escapeAttribute2(a.resourceId)}" data-precision="${escapeAttribute2(a.precision)}" data-available="${escapeAttribute2(a.availableMinor)}" data-label="${escapeAttribute2(a.label)}" data-unit="${escapeAttribute2(a.displayUnit ?? "")}">${escapeHtml2(a.label)} (Available: ${escapeHtml2(a.availableFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Target Domain UUID:
          <input type="text" name="targetDomainUuid" required placeholder="JournalEntry.id..." />
        </label>
        <label>
          Amount:
          <input type="text" inputmode="decimal" name="amount" required placeholder="Amount (e.g. 10 or 10.50)" />
        </label>
        <div class="dm-preview-box" id="dm-transfer-preview">
          <div class="dm-preview-title"><i class="fas fa-eye"></i> Transfer Impact Preview</div>
          <div class="dm-preview-body">
            <span class="dm-preview-item">Available after transfer: <span class="dm-preview-val">\u2014</span></span>
          </div>
        </div>
        <label>
          Reason:
          <input type="text" name="reason" placeholder="Transfer notes or motivation" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Transfer</button>
        </div>
      </form>
    </div>
  `;
}
function renderAdjustModalHtml(domainUuid, accounts) {
  return `
    <div class="dm-modal dm-adjust-modal" data-modal-type="adjust">
      <h3><i class="fas fa-sliders-h"></i> Authoritative Adjustment</h3>
      <form data-form-type="adjust">
        <input type="hidden" name="domainUuid" value="${escapeAttribute2(domainUuid)}" />
        <label>
          Resource:
          <select name="resourceId" required>
            ${accounts.map((a) => `<option value="${escapeAttribute2(a.resourceId)}" data-precision="${escapeAttribute2(a.precision)}" data-balance="${escapeAttribute2(a.balanceMinor)}" data-label="${escapeAttribute2(a.label)}" data-unit="${escapeAttribute2(a.displayUnit ?? "")}">${escapeHtml2(a.label)} (Current: ${escapeHtml2(a.balanceFormatted)})</option>`).join("")}
          </select>
        </label>
        <label>
          Delta Amount (positive or negative):
          <input type="text" inputmode="decimal" name="delta" required placeholder="Delta (e.g. +10.50 or -5)" />
        </label>
        <div class="dm-preview-box" id="dm-adjust-preview">
          <div class="dm-preview-title"><i class="fas fa-eye"></i> Adjustment Impact Preview</div>
          <div class="dm-preview-body">
            <span class="dm-preview-item">Balance after adjustment: <span class="dm-preview-val">\u2014</span></span>
          </div>
        </div>
        <label>
          Reason (Required):
          <input type="text" name="reason" required placeholder="Mandatory audit explanation" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Apply Adjustment</button>
        </div>
      </form>
    </div>
  `;
}
function renderResourceDetailModalHtml(account) {
  return `
    <div class="dm-modal dm-detail-modal" data-modal-type="resourceDetail">
      <h3><i class="${escapeAttribute2(account.icon ?? "fas fa-box")}"></i> ${escapeHtml2(account.label)}</h3>
      <div class="dm-detail-content">
        <div class="dm-detail-row"><span class="dm-detail-label">Resource ID:</span> <code>${escapeHtml2(account.resourceId)}</code></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Description:</span> <span>${escapeHtml2(account.description || "No description provided.")}</span></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Category:</span> <span>${escapeHtml2(account.categoryId || "Custom")}</span></div>
        ${account.tags && account.tags.length > 0 ? `<div class="dm-detail-row"><span class="dm-detail-label">Tags:</span> <span>${account.tags.map((t) => `<span class="dm-tag">${escapeHtml2(t)}</span>`).join(" ")}</span></div>` : ""}
        <div class="dm-detail-row"><span class="dm-detail-label">Mode:</span> <span class="dm-kind-badge">${escapeHtml2(account.mode)}</span></div>
        ${account.mode === "provider" ? `<div class="dm-detail-row"><span class="dm-detail-label">Provider:</span> <span>${escapeHtml2(account.providerId ?? "external")} (${account.providerAvailable ? "Active" : "Unavailable"})</span></div>` : ""}
        <div class="dm-detail-row"><span class="dm-detail-label">Balance:</span> <strong>${escapeHtml2(account.balanceFormatted)}</strong> (raw: ${escapeHtml2(account.balanceMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Reserved:</span> <span>${escapeHtml2(account.reservedFormatted)}</span> (raw: ${escapeHtml2(account.reservedMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Available:</span> <span>${escapeHtml2(account.availableFormatted)}</span> (raw: ${escapeHtml2(account.availableMinor)})</div>
        <div class="dm-detail-row"><span class="dm-detail-label">Capacity:</span> <span>${escapeHtml2(account.capacityFormatted)}</span></div>
        <div class="dm-detail-row"><span class="dm-detail-label">Status:</span> <span>${escapeHtml2(account.status)}</span></div>
      </div>
      <div class="dm-modal-actions">
        <button type="button" class="dm-btn dm-btn-primary" data-action="closeModal">Close</button>
      </div>
    </div>
  `;
}
function renderTransactionHistoryModalHtml(domainUuid, transactions = []) {
  return `
    <div class="dm-modal dm-tx-history-modal" data-modal-type="transactionHistory">
      <h3><i class="fas fa-receipt"></i> Domain Transactions</h3>
      <div class="dm-tx-content">
        ${transactions.length === 0 ? `<div class="dm-empty-state">No transaction records found for this domain.</div>` : `
          <table class="dm-transactions-table">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>State</th>
                <th>Epoch</th>
                <th>Time</th>
                <th>Details / Reason</th>
              </tr>
            </thead>
            <tbody>
              ${transactions.map(
    (tx) => `
                <tr class="dm-tx-row ${escapeAttribute2(tx.stateBadgeClass)}">
                  <td><code>${escapeHtml2(tx.transactionId)}</code></td>
                  <td><span class="dm-badge-tx dm-state-${escapeAttribute2(tx.stateBadgeClass)}">${escapeHtml2(tx.state)}</span></td>
                  <td>${escapeHtml2(tx.authorityEpoch)}</td>
                  <td>${escapeHtml2(tx.createdAtFormatted)}</td>
                  <td>${escapeHtml2(tx.failureReason ?? "\u2014")}</td>
                </tr>
              `
  ).join("")}
            </tbody>
          </table>
        `}
      </div>
      <div class="dm-modal-actions">
        <button type="button" class="dm-btn dm-btn-primary" data-action="closeModal">Close</button>
      </div>
    </div>
  `;
}
function renderCreateAccountModalHtml(domainUuid, availableDefinitions = []) {
  return `
    <div class="dm-modal dm-create-account-modal" data-modal-type="createAccount">
      <h3><i class="fas fa-plus-circle"></i> Create Resource Account</h3>
      <form data-form-type="createAccount">
        <input type="hidden" name="domainUuid" value="${escapeAttribute2(domainUuid)}" />

        <div class="dm-form-group dm-mode-selector">
          <label class="dm-radio-inline">
            <input type="radio" name="creationMode" value="existing" checked data-action="toggleCreationMode" />
            Existing Resource
          </label>
          <label class="dm-radio-inline">
            <input type="radio" name="creationMode" value="quickCreate" data-action="toggleCreationMode" />
            Quick Create Custom Resource
          </label>
        </div>

        <div class="dm-existing-resource-group" id="dm-existing-group">
          <label>
            Resource:
            ${availableDefinitions.length > 0 ? `
              <select name="resourceId">
                ${availableDefinitions.map((d) => `<option value="${escapeAttribute2(d.id)}" data-precision="${escapeAttribute2(d.precision)}">${escapeHtml2(d.label)} (${escapeHtml2(d.id)})</option>`).join("")}
              </select>
            ` : `
              <input type="text" name="resourceId" placeholder="e.g. domain-manager:treasury" />
            `}
          </label>
        </div>

        <div class="dm-quick-resource-group" id="dm-quick-group" style="display: none;">
          <label>
            New Resource ID:
            <input type="text" name="quickResourceId" placeholder="e.g. custom:mana or domain-manager:gems" />
          </label>
          <label>
            Resource Label:
            <input type="text" name="quickResourceLabel" placeholder="e.g. Mana Crystals" />
          </label>
          <div class="dm-form-row">
            <label>
              Precision:
              <input type="number" name="quickResourcePrecision" value="0" min="0" max="4" />
            </label>
            <label>
              Unit:
              <input type="text" name="quickResourceUnit" placeholder="e.g. crystal, crystals" />
            </label>
          </div>
          <label>
            Description:
            <input type="text" name="quickResourceDescription" placeholder="Resource description" />
          </label>
        </div>

        <label>
          Initial Balance:
          <input type="text" inputmode="decimal" name="initialBalance" placeholder="0" />
        </label>
        <label>
          Base Capacity (leave empty for unlimited):
          <input type="text" inputmode="decimal" name="baseCapacity" placeholder="Unlimited" />
        </label>
        <label>
          Visibility:
          <select name="visibility">
            <option value="public" selected>Public (Visible to all players)</option>
            <option value="restricted">Restricted (Controller / Authorized)</option>
            <option value="secret">Secret (GM Only)</option>
          </select>
        </label>
        <label>
          Reason:
          <input type="text" name="reason" placeholder="Initial allocation note" />
        </label>
        <div class="dm-modal-actions">
          <button type="button" class="dm-btn dm-btn-secondary" data-action="closeModal">Cancel</button>
          <button type="submit" class="dm-btn dm-btn-primary">Create Account</button>
        </div>
      </form>
    </div>
  `;
}

// src/ui/domain-patterns/economy/economy-app.ts
function cleanPayload(payload) {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map(cleanPayload);
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== void 0) {
      cleaned[key] = typeof value === "object" && value !== null ? cleanPayload(value) : value;
    }
  }
  return cleaned;
}
function makeCommand2(type, payload) {
  return {
    contractVersion: COMMAND_CONTRACT_VERSION_V1,
    commandId: createCommandId(),
    type,
    payload: cleanPayload(payload),
    issuedAtReal: Date.now()
  };
}
var EconomyApplicationController = class {
  #domainUuid;
  #commandBus;
  #resourceRegistry;
  #ledgerStore;
  #reservationStore;
  #providerRegistry;
  #transactionStore;
  #domains;
  #viewer;
  #activeModal = null;
  #selectedResourceId = null;
  #ledgerPage = 0;
  #lastViewModel = null;
  constructor(options) {
    this.#domainUuid = options.domainUuid;
    this.#commandBus = options.commandBus;
    this.#resourceRegistry = options.resourceRegistry ?? options.economyService?.registry;
    this.#ledgerStore = options.ledgerStore ?? options.economyService?.ledgerStore;
    this.#reservationStore = options.reservationStore ?? options.economyService?.reservationStore;
    this.#providerRegistry = options.providerRegistry ?? options.economyService?.providerRegistry;
    this.#transactionStore = options.transactionStore ?? options.economyService?.transactionStore;
    this.#domains = options.domains;
    this.#viewer = options.viewer;
  }
  get domainUuid() {
    return this.#domainUuid;
  }
  get activeModal() {
    return this.#activeModal;
  }
  get selectedResourceId() {
    return this.#selectedResourceId;
  }
  get ledgerPage() {
    return this.#ledgerPage;
  }
  get viewModel() {
    return this.#lastViewModel;
  }
  async loadViewModel() {
    const cleanId = this.#domainUuid.startsWith("JournalEntry.") ? this.#domainUuid.slice("JournalEntry.".length) : this.#domainUuid;
    const docRes = await this.#domains.read(cleanId);
    if (!docRes.ok) {
      return docRes;
    }
    const viewer = resolveCurrentViewer(this.#viewer);
    const isGm = viewer.isGm;
    const providerHealthMap = /* @__PURE__ */ new Map();
    if (this.#providerRegistry) {
      for (const p of this.#providerRegistry.list()) {
        try {
          const health = await p.getHealth();
          providerHealthMap.set(p.providerId, health);
        } catch {
          providerHealthMap.set(p.providerId, {
            status: "unavailable",
            lastCheckedAt: Date.now(),
            message: "Provider health check failed"
          });
        }
      }
    }
    const presenterOptions = {
      viewerIsGm: isGm,
      viewer,
      resourceRegistry: this.#resourceRegistry ?? { get: () => void 0, list: () => [] },
      ledgerStore: this.#ledgerStore,
      reservationStore: this.#reservationStore,
      providerRegistry: this.#providerRegistry,
      providerHealthMap,
      transactionStore: this.#transactionStore,
      ledgerPage: this.#ledgerPage,
      ledgerPageSize: 20
    };
    const vm = buildEconomyViewModel(docRes.value, presenterOptions);
    this.#lastViewModel = vm;
    return ok(vm);
  }
  openModal(modalType, resourceId) {
    this.#activeModal = modalType;
    if (resourceId !== void 0) {
      this.#selectedResourceId = resourceId;
    }
  }
  openResourceDetail(resourceId) {
    this.#selectedResourceId = resourceId;
    this.#activeModal = "resourceDetail";
  }
  closeModal() {
    this.#activeModal = null;
    this.#selectedResourceId = null;
  }
  nextLedgerPage() {
    this.#ledgerPage++;
  }
  prevLedgerPage() {
    if (this.#ledgerPage > 0) {
      this.#ledgerPage--;
    }
  }
  async dispatchReleaseReservation(payload) {
    const cmd = makeCommand2("economy:release-reservation", {
      domainUuid: this.#domainUuid,
      reservationId: payload.reservationId,
      amountMinor: payload.amountMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }
  async dispatchTransfer(payload) {
    const cmd = makeCommand2("economy:transfer", {
      sourceDomainUuid: this.#domainUuid,
      targetDomainUuid: payload.targetDomainUuid,
      resourceId: payload.resourceId,
      amountMinor: payload.amountMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }
  async dispatchAdjust(payload) {
    const cmd = makeCommand2("economy:adjust", {
      domainUuid: this.#domainUuid,
      resourceId: payload.resourceId,
      deltaMinor: payload.deltaMinor,
      targetBalanceMinor: payload.targetBalanceMinor,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }
  async dispatchCreateAccount(payload) {
    const cmd = makeCommand2("economy:create-account", {
      domainUuid: this.#domainUuid,
      resourceId: payload.resourceId,
      mode: payload.mode ?? "native",
      initialBalanceMinor: payload.initialBalanceMinor,
      baseCapacityMinor: payload.baseCapacityMinor,
      visibility: payload.visibility,
      reason: payload.reason
    });
    return this.#executeCommand(cmd);
  }
  async dispatchQuickResourceCreateAndAccount(payload) {
    const regCmd = makeCommand2("economy:register-custom-resource", {
      definition: {
        id: payload.definition.id,
        version: 1,
        label: payload.definition.label,
        precision: payload.definition.precision ?? 0,
        displayUnit: {
          singular: payload.definition.unit ?? "",
          plural: payload.definition.unit ?? ""
        },
        description: payload.definition.description ?? "",
        icon: "fas fa-box",
        categoryId: "custom",
        tags: ["custom"],
        minimumMinor: 0,
        maximumMinor: null,
        allowNegative: false,
        defaultCapacityPolicy: "block",
        lifecycle: "active"
      }
    });
    const regRes = await this.#executeCommand(regCmd);
    if (!regRes.ok) {
      return regRes;
    }
    return this.dispatchCreateAccount({
      resourceId: payload.definition.id,
      mode: payload.account.mode ?? "native",
      initialBalanceMinor: payload.account.initialBalanceMinor,
      baseCapacityMinor: payload.account.baseCapacityMinor,
      visibility: payload.account.visibility,
      reason: payload.account.reason ?? `Initial allocation for ${payload.definition.label}`
    });
  }
  async #executeCommand(cmd) {
    const receiptRes = await this.#commandBus.execute(cmd);
    if (!receiptRes.ok) {
      return receiptRes;
    }
    const receipt = receiptRes.value;
    if (receipt.status === "rejected") {
      return err(
        receipt.error ?? createPublicError({
          code: "DM_COMMAND_REJECTED",
          category: "internal",
          message: "Economy command rejected"
        })
      );
    }
    return ok(receipt.result);
  }
  render(vm) {
    if (!vm) {
      return `<div class="dm-loading">Loading Economy Subsystem...</div>`;
    }
    const mainHtml = renderEconomySubsystemHtml(vm);
    let modalHtml = "";
    if (this.#activeModal === "transfer") {
      modalHtml = renderTransferModalHtml(this.#domainUuid, vm.accounts);
    } else if (this.#activeModal === "adjust") {
      modalHtml = renderAdjustModalHtml(this.#domainUuid, vm.accounts);
    } else if (this.#activeModal === "createAccount") {
      const defs = this.#resourceRegistry ? this.#resourceRegistry.list() : [];
      modalHtml = renderCreateAccountModalHtml(this.#domainUuid, defs);
    } else if (this.#activeModal === "transactionHistory") {
      modalHtml = renderTransactionHistoryModalHtml(this.#domainUuid, vm.transactions);
    } else if (this.#activeModal === "resourceDetail" && this.#selectedResourceId) {
      const acc = vm.accounts.find((a) => a.resourceId === this.#selectedResourceId);
      if (acc) {
        modalHtml = renderResourceDetailModalHtml(acc);
      }
    }
    return `
      <div class="dm-economy-app-v2" data-domain-uuid="${escapeAttribute2(this.#domainUuid)}">
        ${mainHtml}
        ${modalHtml ? `<div class="dm-modal-backdrop">${modalHtml}</div>` : ""}
      </div>
    `;
  }
};
var MockApplicationV22 = class {
  element = null;
  options;
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
    }
  }
  _setupActions(element) {
    if (!element || element._dmActionsConfigured) return;
    element._dmActionsConfigured = true;
    const actions = this.constructor.DEFAULT_OPTIONS?.actions ?? {};
    element.addEventListener?.("click", async (event) => {
      let target = event?.target;
      while (target) {
        const action = target.getAttribute?.("data-action") ?? target.dataset?.action;
        if (action && typeof actions[action] === "function") {
          await actions[action].call(this, event, target);
          return;
        }
        if (target === element) break;
        target = target.parentElement;
      }
    });
  }
  async render(force, options) {
    if (!this.element) {
      const classes = (this.constructor.DEFAULT_OPTIONS?.classes ?? ["domain-manager", "dm-economy-app-v2"]).join(" ");
      if (typeof globalThis.document?.createElement === "function") {
        const el = globalThis.document.createElement("div");
        el.className = classes;
        this.element = el;
      } else {
        const listeners = {};
        this.element = {
          className: classes,
          innerHTML: "",
          children: [],
          querySelectorAll: () => [],
          querySelector: () => null,
          addEventListener: (evt, cb) => {
            listeners[evt] = listeners[evt] || [];
            listeners[evt].push(cb);
          },
          _listeners: listeners
        };
      }
    }
    const context = await this._prepareContext(options);
    const result = await this._renderHTML(context, options);
    this._replaceHTML(result, this.element, options);
    this._setupActions(this.element);
    this._onRender(context, options);
    return this;
  }
  _onRender(context, options) {
  }
  async close(options) {
    this.element = null;
  }
};
var BaseApp2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? MockApplicationV22;
var EconomyApplication = class _EconomyApplication extends BaseApp2 {
  static DEFAULT_OPTIONS = {
    id: "domain-manager-economy-{id}",
    classes: ["domain-manager", "dm-economy-app-v2"],
    tag: "div",
    window: {
      title: "Economy & Resources",
      icon: "fas fa-coins",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 780,
      height: 600
    },
    actions: {
      openTransferModal: _EconomyApplication.#onOpenTransferModal,
      openAdjustModal: _EconomyApplication.#onOpenAdjustModal,
      openCreateAccountModal: _EconomyApplication.#onOpenCreateAccountModal,
      openTransactionHistoryModal: _EconomyApplication.#onOpenTransactionHistoryModal,
      openResourceDetail: _EconomyApplication.#onOpenResourceDetail,
      releaseReservation: _EconomyApplication.#onReleaseReservation,
      nextLedgerPage: _EconomyApplication.#onNextLedgerPage,
      prevLedgerPage: _EconomyApplication.#onPrevLedgerPage,
      closeModal: _EconomyApplication.#onCloseModal
    }
  };
  #controller;
  constructor(options) {
    super(options);
    this.#controller = new EconomyApplicationController(options);
  }
  get controller() {
    return this.#controller;
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
      return `<div class="dm-error-state">${escapeHtml2(context.error.message)}</div>`;
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
    const el = this.element;
    if (el) {
      this.attachEventListeners(el);
    }
  }
  attachEventListeners(element) {
    const transferForm = element.querySelector?.('form[data-form-type="transfer"]');
    if (transferForm && !transferForm._dmPreviewBound) {
      transferForm._dmPreviewBound = true;
      const amountInput = transferForm.querySelector?.('input[name="amount"]');
      const resSelect = transferForm.querySelector?.('select[name="resourceId"]');
      const previewVal = transferForm.querySelector?.("#dm-transfer-preview .dm-preview-val");
      const updateTransferPreview = () => {
        if (!previewVal) return;
        const opt = resSelect?.selectedOptions?.[0];
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;
        const availableMinor = opt?.dataset?.available ? parseInt(opt.dataset.available, 10) : 0;
        const unit = opt?.dataset?.unit ?? "";
        const valStr = (amountInput?.value ?? "").trim();
        if (!valStr) {
          previewVal.textContent = "\u2014";
          return;
        }
        const parsed = parseResourceAmount(valStr, precision);
        if (!parsed.ok || parsed.value <= 0) {
          previewVal.textContent = "Invalid amount";
          return;
        }
        const remainingMinor = availableMinor - parsed.value;
        const formatted = (remainingMinor / Math.pow(10, precision)).toFixed(precision);
        previewVal.textContent = `${formatted} ${unit} (remaining)`;
        if (remainingMinor < 0) {
          previewVal.style.color = "var(--dm-color-danger, #d9534f)";
        } else {
          previewVal.style.color = "inherit";
        }
      };
      amountInput?.addEventListener("input", updateTransferPreview);
      resSelect?.addEventListener("change", updateTransferPreview);
    }
    const adjustForm = element.querySelector?.('form[data-form-type="adjust"]');
    if (adjustForm && !adjustForm._dmPreviewBound) {
      adjustForm._dmPreviewBound = true;
      const deltaInput = adjustForm.querySelector?.('input[name="delta"]');
      const resSelect = adjustForm.querySelector?.('select[name="resourceId"]');
      const previewVal = adjustForm.querySelector?.("#dm-adjust-preview .dm-preview-val");
      const updateAdjustPreview = () => {
        if (!previewVal) return;
        const opt = resSelect?.selectedOptions?.[0];
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;
        const balanceMinor = opt?.dataset?.balance ? parseInt(opt.dataset.balance, 10) : 0;
        const unit = opt?.dataset?.unit ?? "";
        const valStr = (deltaInput?.value ?? "").trim();
        if (!valStr) {
          previewVal.textContent = "\u2014";
          return;
        }
        const parsed = parseResourceAmount(valStr, precision);
        if (!parsed.ok) {
          previewVal.textContent = "Invalid delta";
          return;
        }
        const newBalanceMinor = balanceMinor + parsed.value;
        const formatted = (newBalanceMinor / Math.pow(10, precision)).toFixed(precision);
        previewVal.textContent = `${formatted} ${unit} (new balance)`;
        if (newBalanceMinor < 0) {
          previewVal.style.color = "var(--dm-color-danger, #d9534f)";
        } else {
          previewVal.style.color = "inherit";
        }
      };
      deltaInput?.addEventListener("input", updateAdjustPreview);
      resSelect?.addEventListener("change", updateAdjustPreview);
    }
    const forms = element.querySelectorAll?.("form[data-form-type]") ?? [];
    forms.forEach((form) => {
      if (form._dmSubmitBound) return;
      form._dmSubmitBound = true;
      const modeRadios = form.querySelectorAll?.('input[name="creationMode"]') ?? [];
      modeRadios.forEach((radio) => {
        radio.addEventListener?.("change", () => {
          const isQuick = radio.value === "quickCreate";
          const existingGroup = form.querySelector?.("#dm-existing-group");
          const quickGroup = form.querySelector?.("#dm-quick-group");
          if (existingGroup) existingGroup.style.display = isQuick ? "none" : "";
          if (quickGroup) quickGroup.style.display = isQuick ? "" : "none";
        });
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formType = form.getAttribute?.("data-form-type");
        const formData = new FormData(form);
        const data = {};
        formData.forEach((val, key) => {
          data[key] = String(val).trim();
        });
        const resSelect = form.querySelector?.('select[name="resourceId"]');
        const opt = resSelect?.selectedOptions?.[0];
        const precision = opt?.dataset?.precision ? parseInt(opt.dataset.precision, 10) : 0;
        if (formType === "transfer") {
          const parsedAmount = parseResourceAmount(data.amount, precision);
          if (!parsedAmount.ok) {
            console.error(parsedAmount.error.message);
            return;
          }
          if (parsedAmount.value > 0) {
            await this.#controller.dispatchTransfer({
              targetDomainUuid: data.targetDomainUuid,
              resourceId: data.resourceId,
              amountMinor: parsedAmount.value,
              reason: data.reason || void 0
            });
            this.#controller.closeModal();
            this.render();
          }
        } else if (formType === "adjust") {
          const parsedDelta = parseResourceAmount(data.delta, precision);
          if (!parsedDelta.ok) {
            console.error(parsedDelta.error.message);
            return;
          }
          if (data.reason) {
            await this.#controller.dispatchAdjust({
              resourceId: data.resourceId,
              deltaMinor: parsedDelta.value,
              reason: data.reason
            });
            this.#controller.closeModal();
            this.render();
          }
        } else if (formType === "createAccount") {
          const isQuick = data.creationMode === "quickCreate";
          let accountPrecision = 0;
          let resourceId = data.resourceId;
          if (isQuick) {
            resourceId = data.quickResourceId;
            accountPrecision = data.quickResourcePrecision ? parseInt(data.quickResourcePrecision, 10) : 0;
          } else {
            accountPrecision = precision;
          }
          let initialBalanceMinor = void 0;
          if (data.initialBalance) {
            const parsedInit = parseResourceAmount(data.initialBalance, accountPrecision);
            if (parsedInit.ok) initialBalanceMinor = parsedInit.value;
          }
          let baseCapacityMinor = void 0;
          if (data.baseCapacity) {
            const parsedCap = parseResourceAmount(data.baseCapacity, accountPrecision);
            if (parsedCap.ok) baseCapacityMinor = parsedCap.value;
          }
          if (isQuick) {
            const quickRes = await this.#controller.dispatchQuickResourceCreateAndAccount({
              definition: {
                id: resourceId,
                label: data.quickResourceLabel || resourceId,
                precision: accountPrecision,
                unit: data.quickResourceUnit || void 0,
                description: data.quickResourceDescription || void 0
              },
              account: {
                initialBalanceMinor,
                baseCapacityMinor,
                visibility: data.visibility || "public",
                reason: data.reason || void 0
              }
            });
            if (!quickRes.ok) {
              console.error("Quick resource create failed:", quickRes.error.message);
              return;
            }
          } else {
            await this.#controller.dispatchCreateAccount({
              resourceId,
              initialBalanceMinor,
              baseCapacityMinor,
              visibility: data.visibility || "public",
              reason: data.reason || void 0
            });
          }
          this.#controller.closeModal();
          this.render();
        }
      });
    });
  }
  static #onOpenTransferModal() {
    this.#controller.openModal("transfer");
    this.render();
  }
  static #onOpenAdjustModal() {
    this.#controller.openModal("adjust");
    this.render();
  }
  static #onOpenCreateAccountModal() {
    this.#controller.openModal("createAccount");
    this.render();
  }
  static #onOpenTransactionHistoryModal() {
    this.#controller.openModal("transactionHistory");
    this.render();
  }
  static #onOpenResourceDetail(event, target) {
    const resId = target?.dataset?.resourceId ?? target?.getAttribute?.("data-resource-id") ?? event?.currentTarget?.dataset?.resourceId ?? event?.currentTarget?.getAttribute?.("data-resource-id");
    if (resId) {
      this.#controller.openResourceDetail(resId);
      this.render();
    }
  }
  static async #onReleaseReservation(event, target) {
    const resId = target?.dataset?.reservationId ?? target?.getAttribute?.("data-reservation-id") ?? event?.currentTarget?.dataset?.reservationId ?? event?.currentTarget?.getAttribute?.("data-reservation-id");
    if (!resId) return;
    let confirmed = true;
    let releaseReason = void 0;
    const foundryDialog = globalThis.foundry?.applications?.api?.DialogV2;
    if (foundryDialog?.confirm) {
      confirmed = await foundryDialog.confirm({
        window: { title: "Release Reservation" },
        content: "<p>Are you sure you want to release this reservation? This will restore domain availability.</p>",
        yes: { label: "Release" },
        no: { label: "Cancel" }
      });
    } else if (typeof globalThis.confirm === "function") {
      try {
        confirmed = globalThis.confirm("Are you sure you want to release this reservation?");
      } catch {
        confirmed = true;
      }
    }
    if (!confirmed) return;
    if (typeof globalThis.prompt === "function") {
      try {
        const inputReason = globalThis.prompt("Optional release reason:");
        if (inputReason && inputReason.trim()) {
          releaseReason = inputReason.trim();
        }
      } catch {
      }
    }
    await this.#controller.dispatchReleaseReservation({
      reservationId: resId,
      reason: releaseReason
    });
    this.render();
  }
  static #onNextLedgerPage() {
    this.#controller.nextLedgerPage();
    this.render();
  }
  static #onPrevLedgerPage() {
    this.#controller.prevLedgerPage();
    this.render();
  }
  static #onCloseModal() {
    this.#controller.closeModal();
    this.render();
  }
};

// src/bootstrap/domain-manager-runtime.ts
function composeDomainManagerRuntime(options = {}) {
  const domainStore = options.domainStore ?? new FoundryDomainDocumentStore();
  const mutableDomainRepo = new DomainRepository(domainStore);
  const authority = options.authority ?? new FoundryPrimaryAuthorityAdapter();
  const lockManager = options.lockManager ?? new LockManager();
  const coordinator = new MutationCoordinator({ lockManager });
  const transactionStore = options.transactionStore ?? new TransactionStore({
    storageAdapter: options.transactionStorageAdapter ?? new FoundryJournalTransactionStorageAdapter()
  });
  const recovery = new RecoveryService({ transactionStore, lockManager });
  const resourceRegistry = options.resourceRegistry ?? createDefaultResourceRegistry();
  const ledgerStore = options.ledgerStore ?? new LedgerStore({
    storageAdapter: options.ledgerStorageAdapter ?? new FoundryJournalLedgerStorageAdapter()
  });
  const reservationStore = options.reservationStore ?? new ReservationStore({
    storageAdapter: options.reservationStorageAdapter ?? new FoundryJournalReservationStorageAdapter()
  });
  const customResourceStore = options.customResourceStore ?? new CustomResourceDefinitionStore(
    options.customResourceStorageAdapter ?? new FoundryJournalCustomResourceStorageAdapter()
  );
  const providerRegistry = options.providerRegistry ?? createDefaultProviderRegistry(mutableDomainRepo);
  const thresholdService = options.thresholdService ?? new ThresholdService(
    options.thresholdStorageAdapter ?? new FoundryJournalThresholdStorageAdapter()
  );
  const economyService = new EconomyService({
    domains: mutableDomainRepo,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    lockManager,
    transactionStore,
    recoveryService: recovery,
    providerRegistry,
    thresholdService
  });
  const controllerProvider = options.controllerProvider ?? new DefaultDomainControllerProvider();
  const registry = new CommandRegistry();
  registerDomainCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerPopulationCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerNotableCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRoleCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerOperationalGroupCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerAssignmentCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerRepairCommandHandlers(registry, coordinator, mutableDomainRepo);
  registerEconomyCommands({
    registry,
    economyService,
    domains: mutableDomainRepo,
    controllerProvider,
    thresholdService,
    customResourceStore,
    resourceRegistry
  });
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
  const unregisterPolicy = registerDomainControllerPolicy((domainId, userId, context) => {
    return controllerProvider.isDomainController(domainId, userId, context);
  });
  const people = new PeopleService(readOnlyDomains, { commandBus });
  const repairTool = new PeopleRepairTool(commandBus);
  const publicEconomy = new DefaultPublicEconomyApi({
    domains: readOnlyDomains,
    commandBus,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    providerRegistry,
    thresholdService,
    transactionStore
  });
  const publicApi = Object.freeze({
    version: BUILD_METADATA.moduleVersion,
    domains: readOnlyDomains,
    economy: publicEconomy,
    people,
    diagnostics
  });
  return Object.freeze({
    publicApi,
    // G2-AUD-008 & G4-AUD-004: Read-only facades exposed publicly
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
    controllerProvider,
    economy: publicEconomy,
    resourceRegistry,
    ledgerStore,
    reservationStore,
    providerRegistry,
    customResourceStore,
    thresholds: thresholdService,
    initialize: async () => {
      await transactionStore.rehydrate();
      await ledgerStore.rehydrate();
      await reservationStore.rehydrate();
      await thresholdService.rehydrate();
      const customDefs = await customResourceStore.rehydrate();
      for (const def of customDefs) {
        if (!resourceRegistry.get(def.id)) {
          resourceRegistry.register(def);
        }
      }
      const manualCurrency = providerRegistry.get(MANUAL_CURRENCY_PROVIDER_ID);
      if (manualCurrency && "rehydrate" in manualCurrency && typeof manualCurrency.rehydrate === "function") {
        await manualCurrency.rehydrate();
      }
    },
    destroy: () => {
      unregisterPolicy();
      commandBus.destroy();
      if ("destroy" in transport && typeof transport.destroy === "function") {
        transport.destroy();
      }
      recovery.clear();
    }
  });
}

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
Hooks.once("ready", async () => {
  runtime = composeDomainManagerRuntime();
  await runtime.initialize();
  const module = globalThis.game?.modules?.get?.("domain-manager");
  if (module) {
    module.api = runtime.publicApi;
  }
  reconcileAuthority();
  if (runtime.authority.service.isCurrentUser()) {
    const currentEpoch = runtime.authority.service.getStatus().authorityEpoch;
    void runtime.recovery.recoverAll(currentEpoch).then((results) => {
      if (results.length > 0) {
        logger.info(
          `Startup recovery processed ${results.length} transactions`,
          { processedCount: results.length }
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
  DefaultDomainControllerProvider,
  DefaultPublicEconomyApi,
  EconomyApplication,
  EconomyApplicationController,
  PeopleApplication,
  PeopleApplicationController,
  PeopleRepairTool,
  PeopleService,
  ProviderRegistry,
  ResourceDefinitionRegistry,
  ThresholdService,
  clearDomainControllerPolicies,
  composeDomainManagerRuntime,
  createDefaultProviderRegistry,
  createDefaultResourceRegistry,
  registerDomainControllerPolicy
};
//# sourceMappingURL=main.js.map
