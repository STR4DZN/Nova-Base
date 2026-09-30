import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isOpaqueId } from "../../core/identity/ids.js";
import { isActorUuid, isFoundryUuid, isJournalEntryUuid, type TypedRef } from "../../core/identity/refs.js";
import {
  RELATION_SCHEMA_VERSION, type RelationDefinition, type RelationInstance,
  type RelationPartyRef, type RelationLifecycle, type RelationBaseAxis, type RelationAxisDefinition, type RelationStanceRule
} from "./relation-types.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const namespaced = (value: unknown): value is string => text(value) && /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const timestamp = (value: unknown): value is number => integer(value) && value >= 0;
const uniqueTexts = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(text) && new Set(value).size === value.length;
const builtins = ["domain", "populationGroup", "operationalGroup", "notable", "actor", "narrative"];
const partyType = (value: unknown): boolean => text(value) && (builtins.includes(value) || namespaced(value));
const invalid = (code: `DM_${string}`, message: string): Result<never> => err(createPublicError({ code, category: "validation", message }));

export function validateRelationDefinition(raw: unknown): Result<RelationDefinition> {
  if (!object(raw) || !namespaced(raw.id) || !integer(raw.version) || raw.version < 1 || !text(raw.label))
    return invalid("DM_RELATION_DEFINITION_INVALID", "Definition requires a namespaced ID, positive integer version and label");
  if (raw.symmetry !== "symmetric" && raw.symmetry !== "asymmetric")
    return invalid("DM_RELATION_SYMMETRY_INVALID", "Relation symmetry must be symmetric or asymmetric");
  if (!integer(raw.minParties) || raw.minParties < 2 || (raw.maxParties !== null
    && (!integer(raw.maxParties) || raw.maxParties < raw.minParties)))
    return invalid("DM_RELATION_PARTY_COUNT_INVALID", "Relation requires at least two parties and a valid optional maximum");
  if (!uniqueTexts(raw.allowedPartyTypes) || !raw.allowedPartyTypes.length || !raw.allowedPartyTypes.every(partyType)
    || !uniqueTexts(raw.allowedPartyRoles) || !raw.allowedPartyRoles.length || typeof raw.allowMultiple !== "boolean")
    return invalid("DM_RELATION_DEFINITION_INVALID", "Party types/roles must be nonempty unique lists; allowMultiple must be boolean");
  if ((raw.stancePolicy !== "none" && raw.stancePolicy !== "manual" && raw.stancePolicy !== "derived") || !Array.isArray(raw.axes))
    return invalid("DM_RELATION_DEFINITION_INVALID", "Definition requires an explicit stance policy and axis list");
  const axes: RelationAxisDefinition[] = [], seen = new Set<string>();
  for (const axis of raw.axes) {
    if (!object(axis) || !namespaced(axis.id) || !text(axis.label) || !integer(axis.minimum)
      || !integer(axis.maximum) || axis.maximum < axis.minimum || !integer(axis.defaultValue)
      || axis.defaultValue < axis.minimum || axis.defaultValue > axis.maximum || seen.has(axis.id))
      return invalid("DM_RELATION_AXIS_DEFINITION_INVALID", "Axes require unique namespaced IDs and safe integer ranges/defaults");
    seen.add(axis.id);
    axes.push(Object.freeze({ id: axis.id, label: axis.label, minimum: axis.minimum, maximum: axis.maximum, defaultValue: axis.defaultValue }));
  }
  const stanceRules: RelationStanceRule[] = [], ruleIds = new Set<string>();
  if (raw.stanceRules !== undefined) {
    if (raw.stancePolicy !== "derived" || !Array.isArray(raw.stanceRules))
      return invalid("DM_RELATION_STANCE_POLICY_INVALID", "Stance rules require the derived policy");
    for (const rule of raw.stanceRules) {
      if (!object(rule) || !namespaced(rule.id) || ruleIds.has(rule.id) || !text(rule.label)
        || !["public", "restricted", "secret"].includes(rule.visibility as string)
        || !Array.isArray(rule.conditions) || !rule.conditions.length)
        return invalid("DM_RELATION_STANCE_POLICY_INVALID", "Stance rules require unique IDs, labels, visibility and axis conditions");
      const conditionIds = new Set<string>(), conditions: RelationStanceRule["conditions"][number][] = [];
      for (const condition of rule.conditions) {
        if (!object(condition) || !text(condition.axisId) || conditionIds.has(condition.axisId)
          || !integer(condition.minimum) || !integer(condition.maximum) || condition.maximum < condition.minimum)
          return invalid("DM_RELATION_STANCE_POLICY_INVALID", "Stance conditions require unique axes and integer intervals");
        const axis = axes.find(a => a.id === condition.axisId);
        if (!axis || condition.minimum < axis.minimum || condition.maximum > axis.maximum)
          return invalid("DM_RELATION_STANCE_POLICY_INVALID", "Stance condition is outside its declared axis range");
        conditionIds.add(condition.axisId);
        conditions.push(Object.freeze({ axisId: condition.axisId, minimum: condition.minimum, maximum: condition.maximum }));
      }
      ruleIds.add(rule.id);
      stanceRules.push(Object.freeze({ id: rule.id, label: rule.label, visibility: rule.visibility as RelationStanceRule["visibility"],
        conditions: Object.freeze(conditions) }));
    }
  }
  return ok(Object.freeze({ id: raw.id, version: raw.version, label: raw.label,
    symmetry: raw.symmetry as RelationDefinition["symmetry"], minParties: raw.minParties, maxParties: raw.maxParties as number | null,
    allowedPartyTypes: Object.freeze([...raw.allowedPartyTypes]) as RelationDefinition["allowedPartyTypes"],
    allowedPartyRoles: Object.freeze([...raw.allowedPartyRoles]), allowMultiple: raw.allowMultiple,
    axes: Object.freeze(axes), stancePolicy: raw.stancePolicy as RelationDefinition["stancePolicy"],
    ...(raw.stanceRules !== undefined ? { stanceRules: Object.freeze(stanceRules) } : {}) }));
}

function validateScope(raw: unknown): Result<TypedRef | null> {
  if (raw === null) return ok(null);
  if (!object(raw) || !text(raw.type) || (text(raw.id) === text(raw.uuid)) || raw.domainUuid !== undefined
    || (raw.id !== undefined && !text(raw.id)) || (raw.uuid !== undefined && !isFoundryUuid(raw.uuid)))
    return invalid("DM_RELATION_SCOPE_INVALID", "Scope must be null or a typed reference with exactly one ID or document UUID");
  return ok(Object.freeze({ type: raw.type, ...(raw.id !== undefined ? { id: raw.id as string } : { uuid: raw.uuid as string }) }));
}

/** Syntax/ownership validation only; existence is revalidated by future authority commands. */
export function validateRelationPartyRef(raw: unknown): Result<RelationPartyRef> {
  if (!object(raw) || !partyType(raw.type))
    return invalid("DM_RELATION_PARTY_REF_INVALID", "Party type must be a supported entity type or namespaced integration type");
  const type = raw.type as RelationPartyRef["type"];
  const embedded = ["populationGroup", "operationalGroup", "notable"].includes(type);
  if (embedded) {
    if (!text(raw.id) || raw.uuid !== undefined || !isJournalEntryUuid(raw.domainUuid))
      return invalid("DM_RELATION_PARTY_REF_INVALID", "People party requires local entity ID and owning Domain UUID");
    return ok(Object.freeze({ type, id: raw.id, domainUuid: raw.domainUuid }));
  }
  if (raw.domainUuid !== undefined || (text(raw.id) === text(raw.uuid))
    || (raw.id !== undefined && !text(raw.id)) || (raw.uuid !== undefined && !isFoundryUuid(raw.uuid)))
    return invalid("DM_RELATION_PARTY_REF_INVALID", "Party requires exactly one valid ID or document UUID");
  if ((type === "domain" && !isJournalEntryUuid(raw.uuid)) || (type === "actor" && !isActorUuid(raw.uuid))
    || (type === "narrative" && !text(raw.id)) || (typeof raw.uuid === "string" && raw.uuid.split(".").includes("User")))
    return invalid("DM_RELATION_PARTY_REF_INVALID", "Domain/Actor parties require matching UUIDs; narrative parties require stable IDs; Users are not parties");
  return ok(Object.freeze({ type, ...(raw.id !== undefined ? { id: raw.id as string } : { uuid: raw.uuid as string }) }));
}

function refKey(ref: RelationPartyRef | TypedRef): string {
  return JSON.stringify([ref.type, ref.id ?? null, ref.uuid ?? null, "domainUuid" in ref ? ref.domainUuid : null]);
}

export function validateRelationInstance(raw: unknown, definition: RelationDefinition): Result<RelationInstance> {
  const def = validateRelationDefinition(definition);
  if (!def.ok) return def;
  if (!object(raw) || raw.schemaVersion !== RELATION_SCHEMA_VERSION || !isOpaqueId(raw.id, "rel")
    || raw.definitionId !== def.value.id || raw.definitionVersion !== def.value.version || !text(raw.label)
    || !integer(raw.revision) || raw.revision < 0)
    return invalid("DM_RELATION_INSTANCE_INVALID", "Instance requires schema 1, stable rel ID, exact definition version, label and nonnegative revision");
  if (raw.lifecycle !== "active" && raw.lifecycle !== "ended")
    return invalid("DM_RELATION_LIFECYCLE_INVALID", "Relation lifecycle must be active or ended (DEC-104)");
  if (!timestamp(raw.createdAt) || !timestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt
    || (raw.lifecycle === "active" ? raw.endedAt !== null : !timestamp(raw.endedAt)
      || raw.endedAt < raw.createdAt || raw.endedAt > raw.updatedAt))
    return invalid("DM_RELATION_TIMESTAMP_INVALID", "Relation timestamps and endedAt must agree with lifecycle");
  if (!Array.isArray(raw.parties) || raw.parties.length < def.value.minParties
    || (def.value.maxParties !== null && raw.parties.length > def.value.maxParties))
    return invalid("DM_RELATION_PARTY_COUNT_INVALID", "Party count is outside this definition's range");
  const parties: RelationInstance["parties"][number][] = [], ids = new Set<string>(), refs = new Set<string>();
  for (const party of raw.parties) {
    if (!object(party) || !text(party.id) || ids.has(party.id) || !text(party.role) || !def.value.allowedPartyRoles.includes(party.role))
      return invalid("DM_RELATION_PARTY_INVALID", "Parties require unique local IDs and definition-approved roles");
    const ref = validateRelationPartyRef(party.ref);
    if (!ref.ok) return ref;
    if (!def.value.allowedPartyTypes.includes(ref.value.type) || refs.has(refKey(ref.value)))
      return invalid("DM_RELATION_PARTY_INVALID", "Party type is not allowed or the same entity is repeated");
    ids.add(party.id); refs.add(refKey(ref.value));
    parties.push(Object.freeze({ id: party.id, role: party.role, ref: ref.value }));
  }
  const scope = validateScope(raw.scope);
  if (!scope.ok) return scope;
  if (!Array.isArray(raw.baseAxes)) return invalid("DM_RELATION_AXIS_VALUE_INVALID", "Base axes must be a list");
  const axes = new Map(def.value.axes.map(axis => [axis.id, axis]));
  const keys = new Set<string>(), baseAxes: RelationBaseAxis[] = [];
  for (const score of raw.baseAxes) {
    if (!object(score) || !text(score.axisId) || !integer(score.value))
      return invalid("DM_RELATION_AXIS_VALUE_INVALID", "Axis scores must be safe integers");
    const axis = axes.get(score.axisId);
    if (!axis || score.value < axis.minimum || score.value > axis.maximum)
      return invalid("DM_RELATION_AXIS_VALUE_INVALID", "Axis is unknown or score is out of definition range");
    if (def.value.symmetry === "symmetric" ? score.fromPartyId !== null || score.toPartyId !== null
      : !text(score.fromPartyId) || !text(score.toPartyId) || score.fromPartyId === score.toPartyId
        || !ids.has(score.fromPartyId) || !ids.has(score.toPartyId))
      return invalid("DM_RELATION_AXIS_DIRECTION_INVALID", "Shared scores require null direction; directed scores require distinct existing parties");
    const key = JSON.stringify([score.axisId, score.fromPartyId, score.toPartyId]);
    if (keys.has(key)) return invalid("DM_RELATION_AXIS_VALUE_INVALID", "Duplicate score for the same axis/direction");
    keys.add(key); baseAxes.push(Object.freeze({ axisId: score.axisId, value: score.value,
      fromPartyId: score.fromPartyId as string | null, toPartyId: score.toPartyId as string | null }));
  }
  if (raw.visibility !== "public" && raw.visibility !== "restricted" && raw.visibility !== "secret")
    return invalid("DM_RELATION_VISIBILITY_INVALID", "Relation visibility must be public, restricted or secret");
  if (raw.stance !== undefined && (def.value.stancePolicy !== "manual" || !text(raw.stance)))
    return invalid("DM_RELATION_STANCE_INVALID", "Only manual stance may be persisted; derived stance belongs to a read model");
  return ok(Object.freeze({ schemaVersion: RELATION_SCHEMA_VERSION, id: raw.id, definitionId: def.value.id,
    definitionVersion: def.value.version, revision: raw.revision, label: raw.label, lifecycle: raw.lifecycle,
    parties: Object.freeze(parties), scope: scope.value, baseAxes: Object.freeze(baseAxes),
    visibility: raw.visibility as RelationInstance["visibility"], ...(raw.stance !== undefined ? { stance: raw.stance as string } : {}),
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, endedAt: raw.endedAt as number | null }));
}

export function validateRelationLifecycleTransition(from: RelationLifecycle, to: RelationLifecycle): Result<void> {
  if (!["active", "ended"].includes(from) || !["active", "ended"].includes(to) || (from === "ended" && to !== "ended"))
    return invalid("DM_RELATION_INVALID_TRANSITION", "An ended relation cannot be silently reopened");
  return ok(undefined);
}

/** Pure duplicate guard (DEC-100–101); no writes, indexes or hidden-state projection. */
export function validateRelationUniqueness(candidate: RelationInstance, definition: RelationDefinition,
  existing: readonly RelationInstance[]): Result<void> {
  const validated = validateRelationInstance(candidate, definition);
  if (!validated.ok) return validated;
  if (existing.some(item => item.id === candidate.id))
    return err(createPublicError({ code: "DM_RELATION_DUPLICATE_ID", category: "conflict", message: "Relation ID already exists" }));
  if (definition.allowMultiple || candidate.lifecycle === "ended") return ok(undefined);
  const partyKey = (item: RelationInstance) => JSON.stringify(item.parties.map(p => refKey(p.ref)).sort());
  if (existing.some(item => item.lifecycle === "active" && item.definitionId === candidate.definitionId
    && partyKey(item) === partyKey(candidate) && (item.scope === null ? "" : refKey(item.scope))
      === (candidate.scope === null ? "" : refKey(candidate.scope))))
    return err(createPublicError({ code: "DM_RELATION_DUPLICATE_TYPE", category: "conflict", message: "Same relation type/parties/scope already active" }));
  return ok(undefined);
}
