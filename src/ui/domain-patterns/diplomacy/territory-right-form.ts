import { ok, type Result } from "../../../core/contracts/result.js";
import { failure, isTimestamp, isText, isVisibility, isNamespaced, isTypedRef } from "../../../core/validation/value-validation.js";
import { validateRelationPartyRef } from "../../../relations/types/relation-validation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import type { TerritoryRight } from "../../../territory/territory-state.js";
import { escapeHtml as h, escapeAttribute as attr } from "../facilities/facility-view.js";
export const RIGHT_ACTIONS = ["right", "revoke-right"] as const;
const partyTypes = [["domain", "Domínio"], ["actor", "Actor"], ["narrative", "Parte narrativa"], ["populationGroup", "Grupo populacional"], ["operationalGroup", "Grupo operacional"], ["notable", "Notável"]] as const;
const label = (r: any) => `${r.type}: ${r.uuid ?? r.id}${r.domainUuid ? ` (${r.domainUuid})` : ""}`;
export function rightFields(r?: TerritoryRight): Record<string, string> {
  const f: Record<string, string> = { rightPartyType: r?.beneficiaryRef.type ?? "domain", rightPartyRef: r?.beneficiaryRef.uuid ?? r?.beneficiaryRef.id ?? "", rightDomainUuid: r?.beneficiaryRef.domainUuid ?? "",
    rightType: r?.rightType ?? "domain-manager:entry", rightVisibility: r?.visibility ?? "public", rightStarts: r ? String(r.startsAtWorldTick) : "", rightExpires: r?.expiresAtWorldTick == null ? "" : String(r.expiresAtWorldTick),
    rightInherited: String(r?.inherited ?? false), rightRevocable: String(r?.revocable ?? true), rightActive: String(r?.active ?? true), rightGrants: r?.grants.join("\n") ?? "", rightConditionCount: String(r?.conditionRefs.length ?? 0) };
  r?.conditionRefs.forEach((ref, i) => { f[`rightConditionType${i}`] = ref.type; f[`rightConditionMode${i}`] = ref.uuid ? "uuid" : "id"; f[`rightConditionValue${i}`] = ref.uuid ?? ref.id!; }); return f;
}
function conditionCount(f: Record<string, string>): number | null {
  const raw = f.rightConditionCount ?? "0", n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n <= 100 ? n : null;
}
/** Pure form admission. Conditions are declared references; their truth belongs to the authority's provider. */
export function parseRightFields(f: Record<string, string>, tick: number, id: string, sourceRef: TypedRef): Result<{ kind: "right"; value: TerritoryRight }> {
  const type = f.rightPartyType, value = f.rightPartyRef?.trim(), domainUuid = f.rightDomainUuid?.trim(), embedded = ["populationGroup", "operationalGroup", "notable"].includes(type);
  if (!partyTypes.some(([key]) => key === type) || !value || !embedded && domainUuid)
    return failure("DM_TERRITORY_RIGHT_PARTY_INVALID", "Informe uma parte válida; origem somente para grupos e notáveis.");
  const party = validateRelationPartyRef({ type, ...(type === "domain" || type === "actor" ? { uuid: value } : { id: value }), ...(embedded ? { domainUuid } : {}) }); if (!party.ok) return party;
  const start = f.rightStarts?.trim() ? Number(f.rightStarts) : tick, end = f.rightExpires?.trim() ? Number(f.rightExpires) : null;
  if (!isTimestamp(tick) || !isTimestamp(start) || end !== null && (!isTimestamp(end) || end <= start))
    return failure("DM_TERRITORY_RIGHT_TIME_INVALID", "Use ticks inteiros não negativos; o fim deve ser posterior ao início.");
  if (!isNamespaced(f.rightType?.trim()) || !isVisibility(f.rightVisibility) || !isText(id) || !isTypedRef(sourceRef)
    || [f.rightInherited, f.rightRevocable, f.rightActive].some(x => x !== "true" && x !== "false"))
    return failure("DM_TERRITORY_RIGHT_INVALID", "Selecione tipo com namespace, estado, propagação, revogabilidade e visibilidade válidos.");
  const count = conditionCount(f), conditionRefs: TypedRef[] = [], seen = new Set<string>();
  if (count === null) return failure("DM_TERRITORY_RIGHT_CONDITIONS_INVALID", "Use até 100 condições com tipo e ID ou UUID válidos.");
  for (let i = 0; i < count; i++) {
    const mode = f[`rightConditionMode${i}`], ref = { type: f[`rightConditionType${i}`]?.trim(), [mode]: f[`rightConditionValue${i}`]?.trim() };
    if (!["id", "uuid"].includes(mode) || !isTypedRef(ref) || seen.has(JSON.stringify(ref)))
      return failure("DM_TERRITORY_RIGHT_CONDITIONS_INVALID", "Informe condições válidas, sem referências repetidas.");
    seen.add(JSON.stringify(ref)); conditionRefs.push(ref);
  }
  const grants = (f.rightGrants ?? "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (grants.some(x => !isNamespaced(x)) || new Set(grants).size !== grants.length)
    return failure("DM_TERRITORY_RIGHT_GRANTS_INVALID", "Informe uma capacidade com namespace por linha, sem repetições.");
  return ok({ kind: "right", value: { id, sourceRef: structuredClone(sourceRef), beneficiaryRef: party.value, rightType: f.rightType.trim(), visibility: f.rightVisibility,
    startsAtWorldTick: start, expiresAtWorldTick: end, inherited: f.rightInherited === "true", revocable: f.rightRevocable === "true", active: f.rightActive === "true", conditionRefs, grants } });
}
export function parseRightRevocation(f: Record<string, string>, rights: readonly TerritoryRight[]): Result<{ kind: "revoke-right"; id: string }> {
  if (!rights.some(r => r.id === f.rightId && r.active && r.revocable)) return failure("DM_TERRITORY_RIGHT_UNAVAILABLE", "Selecione um direito local visível, ativo e revogável.", "not-found");
  return ok({ kind: "revoke-right", id: f.rightId });
}
/** Reindex rows without dropping unsaved fields. Invalid count is retained for explicit correction. */
export function changeRightConditionRows(f: Record<string, string>, remove?: number): Record<string, string> {
  const count = conditionCount(f); if (count === null || remove === undefined && count === 100 || remove !== undefined && (!Number.isInteger(remove) || remove < 0 || remove >= count)) return { ...f };
  const next = { ...f }, rows = Array.from({ length: count }, (_, i) => [f[`rightConditionType${i}`] ?? "", f[`rightConditionMode${i}`] ?? "id", f[`rightConditionValue${i}`] ?? ""]);
  if (remove === undefined) rows.push(["", "id", ""]); else rows.splice(remove, 1);
  Object.keys(next).filter(k => /^rightCondition(Type|Mode|Value)\d+$/.test(k)).forEach(k => delete next[k]); next.rightConditionCount = String(rows.length);
  rows.forEach(([type, mode, value], i) => { next[`rightConditionType${i}`] = type; next[`rightConditionMode${i}`] = mode; next[`rightConditionValue${i}`] = value; }); return next;
}
const input = (f: Record<string, string>, key: string, title: string, args = "") => `<label>${title}<input name="${key}" value="${attr(f[key] ?? "")}" ${args}></label>`;
const select = (f: Record<string, string>, key: string, title: string, options: readonly (readonly [string, string])[]) => `<label>${title}<select name="${key}">${options.map(([id, title]) => `<option value="${attr(id)}"${f[key] === id ? " selected" : ""}>${h(title)}</option>`).join("")}</select></label>`;
export function renderRightFields(values: Record<string, string>): string {
  const f = { ...rightFields(), ...values }, count = conditionCount(f);
  return `${select(f, "rightPartyType", "Tipo do beneficiário", partyTypes)}${input(f, "rightPartyRef", "UUID de Domínio/Actor ou ID da parte/grupo/notável", "required")}
    <details${["populationGroup", "operationalGroup", "notable"].includes(f.rightPartyType) ? " open" : ""}><summary>Origem de grupos e notáveis</summary>${input(f, "rightDomainUuid", "UUID do Domínio de origem")}</details>
    ${input(f, "rightType", "Tipo do direito com namespace (ex.: domain-manager:entry)", 'required list="dm-right-types"')}<datalist id="dm-right-types">${["entry", "trade", "transit", "build", "extract"].map(x => `<option value="domain-manager:${x}"></option>`).join("")}</datalist>
    ${select(f, "rightActive", "Estado declarado", [["true", "Ativo"], ["false", "Inativo"]])}${select(f, "rightInherited", "Propagação na hierarquia consultada", [["false", "Somente este território"], ["true", "Herdável pelos descendentes"]])}${select(f, "rightRevocable", "Revogabilidade", [["true", "Revogável"], ["false", "Não revogável"]])}
    <fieldset><legend>Condições declaradas</legend><input type="hidden" name="rightConditionCount" value="${attr(f.rightConditionCount)}">
    ${count === null ? '<p role="alert">Lista inválida. Limpe o rascunho antes de enviar.</p>' : Array.from({ length: count }, (_, i) => `<fieldset><legend>Condição ${i + 1}</legend>${input(f, `rightConditionType${i}`, "Tipo da referência", "required")}${select(f, `rightConditionMode${i}`, "Identificação", [["id", "ID"], ["uuid", "UUID"]])}${input(f, `rightConditionValue${i}`, "Valor da referência", "required")}<button type="button" data-dm-right-condition-remove="${i}">Remover condição ${i + 1}</button></fieldset>`).join("")}
    <button type="button" data-dm-right-condition-add="true"${count === null || count === 100 ? " disabled" : ""}>Adicionar condição</button><p>Até 100 condições nesta edição. A referência declara uma condição; sua confirmação depende do provedor da autoridade. Sem confirmação, o direito condicionado não é efetivo.</p></fieldset>
    <label>Capacidades declaradas (uma com namespace por linha; opcional)<textarea name="rightGrants" rows="3">${h(f.rightGrants)}</textarea></label><p>Direitos podem existir sem capacidades. Esta concessão não executa efeitos; os consumidores resolvem as capacidades de fontes efetivas.</p>
    <details><summary>Visibilidade e vigência</summary>${select(f, "rightVisibility", "Visibilidade", [["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]])}${input(f, "rightStarts", "Início inclusivo (em branco: tick da consulta)", 'type="number" min="0" step="1"')}${input(f, "rightExpires", "Fim exclusivo (em branco: sem limite)", 'type="number" min="0" step="1"')}</details>`;
}
export function renderRightRevocation(rights: readonly TerritoryRight[], f: Record<string, string>, fixedId?: string): string {
  const rows = rights.filter(r => r.active && r.revocable && (!fixedId || r.id === fixedId));
  return `<label>Direito local visível, ativo e revogável<select name="rightId" required><option value="">Selecione</option>${rows.map(r => `<option value="${attr(r.id)}"${(fixedId ?? f.rightId) === r.id ? " selected" : ""}>${h(r.id)} · ${h(label(r.beneficiaryRef))} · ${h(r.rightType)}</option>`).join("")}</select></label>
    ${!rows.length || f.rightId && !rows.some(r => r.id === f.rightId) ? '<p role="alert">Direito selecionado indisponível para revogação. Atualize ou limpe o rascunho.</p>' : ""}<p>Revogar conserva a fonte e o histórico e altera apenas seu estado ativo. Direitos herdados e de Agreements devem ser alterados na origem indicada pelo inspector.</p>`;
}
export function renderRightRequest(action: any, title = "Direito solicitado"): string {
  const r: TerritoryRight = action.value;
  return `<section><h3>${h(title)}</h3>${action.kind === "revoke-right" ? `<p>Revogar direito local: ${h(action.id)}</p>` : `<p>${h(r.id)} · ${h(label(r.beneficiaryRef))} · ${h(r.rightType)} · ${h(r.visibility)}</p><p>Estado: ${r.active ? "ativo" : "inativo"}; propagação: ${r.inherited ? "herdável" : "local"}; ${r.revocable ? "revogável" : "não revogável"}; início ${r.startsAtWorldTick}; fim exclusivo ${r.expiresAtWorldTick ?? "sem limite"}.</p><p>Condições: ${r.conditionRefs.map(ref => h(label(ref))).join(", ") || "nenhuma"}</p><p>Capacidades declaradas: ${r.grants.map(h).join(", ") || "nenhuma"}</p>`}</section>`;
}
export function renderTerritoryRightForms(d: any, isGm: boolean, draft: Record<string, string>, revokeDraft: Record<string, string>): string {
  const audit = (f: Record<string, string>) => `<input type="hidden" name="rightRevision" value="${attr(f.rightRevision ?? String(d.revision))}"><p>Revisão atual: ${d.revision}; rascunho: ${h(f.rightRevision ?? String(d.revision))}.</p>${input(f, "reason", "Motivo auditável", "required")}`;
  return `<section><h3>${isGm ? "Conceder direito territorial" : "Propor concessão de direito ao GM"}</h3><form data-dm-form="territory-right">${renderRightFields(draft)}${audit(draft)}<button>${isGm ? "Conceder direito" : "Enviar proposta ao GM"}</button><button type="button" data-dm-right-reset="true">Limpar rascunhos / usar revisão atual</button></form>
    <h4>${isGm ? "Revogar direito local" : "Propor revogação ao GM"}</h4><form data-dm-form="territory-right-revoke">${renderRightRevocation(d.rights ?? [], revokeDraft)}${audit(revokeDraft)}<button${(d.rights ?? []).some((r: TerritoryRight) => r.active && r.revocable) ? "" : " disabled"}>${isGm ? "Revogar direito" : "Enviar proposta ao GM"}</button><button type="button" data-dm-right-reset="true">Limpar rascunhos / usar revisão atual</button></form></section>`;
}
