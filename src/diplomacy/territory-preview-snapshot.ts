import { computeFingerprint } from "../commands/command-dedupe-store.js";
import { isRecord, isTimestamp, immutable } from "../core/validation/value-validation.js";
import type { TerritoryState } from "../territory/territory-state.js";
import type { AgreementOwnerData } from "../agreements/agreement-owner.js";
import type { RightConditionEvaluation } from "../territory/territory-rights-impact.js";
import type { OwnerIntent } from "./owner-commands.js";
export interface TerritoryPreviewSnapshot { readonly worldTick: number; readonly fingerprint: string; }
export const isTerritoryPreviewSnapshot = (x: unknown): x is TerritoryPreviewSnapshot => isRecord(x) && isTimestamp(x.worldTick)
  && typeof x.fingerprint === "string" && /^fp_[a-f0-9]{16}$/.test(x.fingerprint);
/** Change detector using the existing canonical fingerprint; authority is checked independently, never granted by this value. */
export function territoryPreviewSnapshot(intent: OwnerIntent, states: readonly TerritoryState[], worldTick: number, rights?: { readonly agreements: readonly AgreementOwnerData[]; readonly conditions: readonly RightConditionEvaluation[] }): TerritoryPreviewSnapshot {
  return immutable({ worldTick, fingerprint: computeFingerprint({ id: intent.id, expectedRevision: intent.expectedRevision, action: intent.action,
    reason: intent.reason, worldTick, ...(rights ? { rights: { agreements: [...rights.agreements].sort((a, b) => a.state.agreement.id.localeCompare(b.state.agreement.id)), conditions: [...rights.conditions].sort((a, b) => a.key.localeCompare(b.key)) } } : {}), territories: [...states].sort((a, b) => a.territory.uuid.localeCompare(b.territory.uuid)) }) });
}
