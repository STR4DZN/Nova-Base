import { ok, type Result } from "../core/contracts/result.js";
import { immutable, failure, isTimestamp } from "../core/validation/value-validation.js";
import type { RelationDefinition, RelationVisibility } from "./types/relation-types.js";
import { resolveRelationAxis, validateRelationState, type RelationState } from "./relation-history.js";
export interface RelationStanceView {
  readonly fromPartyId: string | null;
  readonly toPartyId: string | null;
  readonly value: string | null;
  readonly ruleId: string | null;
  readonly status: "manual" | "derived" | "unconfigured" | "unmatched";
  readonly reasons: readonly {
    readonly axisId: string; readonly base: number; readonly effective: number; readonly modifierIds: readonly string[];
  }[];
}
/** Read-only and audience-specific; hidden rules and modifiers never participate in public classification. */
export function resolveRelationStances(s: RelationState, d: RelationDefinition, at: number, worldTick: number | null,
  canSee: (visibility: RelationVisibility) => boolean): Result<readonly RelationStanceView[]> {
  const valid = validateRelationState(s, d); if (!valid.ok) return valid;
  if (!isTimestamp(at) || (worldTick !== null && !isTimestamp(worldTick))) return failure("DM_RELATION_TIME_INVALID", "Invalid resolver time");
  if (!canSee(s.relation.visibility)) return failure("DM_RELATION_NOT_FOUND", "Relation not available", "not-found");
  if (d.stancePolicy === "none") return ok(Object.freeze([]));
  if (d.stancePolicy === "manual") return ok(immutable([{ fromPartyId: null, toPartyId: null,
    value: s.relation.stance ?? null, ruleId: null, status: "manual" as const, reasons: [] }]));
  const directions = d.symmetry === "symmetric" ? [{ fromPartyId: null, toPartyId: null }]
    : s.relation.parties.flatMap(from => s.relation.parties.filter(to => to.id !== from.id)
      .map(to => ({ fromPartyId: from.id, toPartyId: to.id })));
  const views: RelationStanceView[] = [], rules = d.stanceRules?.filter(rule => canSee(rule.visibility)) ?? [];
  for (const direction of directions) {
    const scores = new Map<string, RelationStanceView["reasons"][number]>();
    for (const axis of d.axes) {
      const score = resolveRelationAxis(s, d, { axisId: axis.id, ...direction }, at, worldTick, canSee);
      if (!score.ok) return score;
      scores.set(axis.id, { axisId: axis.id, ...score.value });
    }
    const rule = rules.find(rule => rule.conditions.every(condition => {
        const score = scores.get(condition.axisId)!;
        return score.effective >= condition.minimum && score.effective <= condition.maximum;
      }));
    views.push({ ...direction, value: rule?.label ?? null, ruleId: rule?.id ?? null,
      status: rule ? "derived" : rules.length ? "unmatched" : "unconfigured",
      reasons: rule ? rule.conditions.map(condition => scores.get(condition.axisId)!) : [] });
  }
  return ok(immutable(views));
}
