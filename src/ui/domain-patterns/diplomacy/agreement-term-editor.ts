import { ok, type Result } from "../../../core/contracts/result.js";
import { failure } from "../../../core/validation/value-validation.js";
import { validateAgreementTerms, type AgreementTerm } from "../../../agreements/agreement-model.js";
import { agreementTermRegistry } from "../../../agreements/agreement-owner.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export const AGREEMENT_TERM_TYPES = [
  ["domain-manager:narrative", "Narrativo"], ["domain-manager:capability", "Capacidade"], ["domain-manager:right", "Direito territorial"],
  ["domain-manager:obligation", "Obrigação"], ["domain-manager:owner-operation", "Operação de outro subsistema"]
] as const;
export type AgreementTermEditorKind = "propose" | "amend" | "counter";
export function newAgreementTerm(type: string, partyIds: readonly string[]): AgreementTerm {
  const payload = type === "domain-manager:capability" ? { beneficiaryPartyId: partyIds[0], capabilityIds: [], scopeRef: null, conditionRefs: [] }
    : type === "domain-manager:right" ? { beneficiaryPartyId: partyIds[0], territoryUuid: "", rightType: "domain-manager:entry", startsAtWorldTick: null,
      expiresAtWorldTick: null, inherited: false, revocable: true, conditionRefs: [], grants: [] }
    : type === "domain-manager:obligation" ? { kind: "domain-manager:payment", obligatedPartyId: partyIds[0], beneficiaryPartyId: partyIds[1] ?? null,
      dueAtWorldTick: null, graceTicks: 0, overduePolicy: "report", requirementRef: { type: "resource", id: "domain-manager:treasury" }, consequences: [] }
    : type === "domain-manager:owner-operation" ? { operations: [] } : {};
  return { id: crypto.randomUUID(), type, title: "", text: null, visibility: "public", partyIds: [...partyIds], payload };
}
export function agreementTermFields(term: AgreementTerm, parties: readonly string[]): Record<string, string> {
  return { id: term.id, type: term.type, title: term.title, text: term.text ?? "", noText: term.text === null ? "on" : "",
    visibility: term.visibility, payload: JSON.stringify(term.payload, null, 2),
    ...Object.fromEntries(parties.map((id, i) => [`party_${i}`, term.partyIds.includes(id) ? "on" : ""])) };
}
export function parseAgreementTermEditor(fields: Record<string, string>, count: number, parties: readonly string[],
  baseline: readonly AgreementTerm[], allowedTypes: readonly string[] = AGREEMENT_TERM_TYPES.map(x => x[0])): Result<readonly AgreementTerm[]> {
  if (!Number.isSafeInteger(count) || count < 0) return failure("DM_AGREEMENT_TERMS_INVALID", "Quantidade de termos inválida.");
  const terms: AgreementTerm[] = [];
  for (let i = 0; i < count; i++) {
    const get = (key: string) => fields[`term_${i}_${key}`] ?? "";
    let payload: unknown;
    try { payload = JSON.parse(get("payload")); }
    catch { return failure("DM_AGREEMENT_TERM_PAYLOAD_INVALID", `Os dados do termo ${i + 1} precisam ser um objeto JSON válido.`); }
    const original = baseline.find(t => t.id === get("id"));
    terms.push({ ...structuredClone(original), id: get("id"), type: get("type"), title: get("title"),
      text: get("text") === "" && get("noText") === "on" ? null : get("text"), visibility: get("visibility") as AgreementTerm["visibility"],
      partyIds: parties.filter((_, j) => get(`party_${j}`) === "on"), payload: payload as AgreementTerm["payload"] });
  }
  const valid = validateAgreementTerms(terms, { allowedTermTypes: allowedTypes }, parties, agreementTermRegistry());
  return valid.ok ? ok(structuredClone(valid.value)) : valid;
}
/** Rename rows without parsing their content, so invalid JSON and unsaved input survive. */
export function reorderAgreementTermFields(fields: Record<string, string>, indices: readonly number[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const row = /^term_(\d+)_(.+)$/.exec(key);
    if (!row) result[key] = value;
    else { const index = indices.indexOf(Number(row[1])); if (index >= 0) result[`term_${index}_${row[2]}`] = value; }
  }
  return result;
}
export function renderAgreementTermEditorRow(index: number, count: number, fields: Record<string, string>,
  parties: readonly { id: string; ref: { uuid?: string; id?: string } }[], allowedTypes: readonly string[]): string {
  const prefix = `term_${index}_`, get = (key: string) => fields[prefix + key] ?? "";
  const input = (key: string, label: string) => `<label>${label}<input name="${prefix + key}" value="${escapeAttribute(get(key))}" required></label>`;
  const typeChoices: [string, string][] = AGREEMENT_TERM_TYPES.filter(([type]) => allowedTypes.includes(type)).map(([a, b]) => [a, b]);
  if (get("type") && !typeChoices.some(([type]) => type === get("type"))) typeChoices.push([get("type"), get("type")]);
  return `<fieldset><legend>Termo ${index + 1}: ${escapeHtml(get("title") || "Novo termo")}</legend>
    <input type="hidden" name="${prefix}id" value="${escapeAttribute(get("id"))}">
    <label>Tipo<select name="${prefix}type" data-dm-term-type="${index}">${typeChoices.map(([type, label]) => `<option value="${escapeAttribute(type)}" ${type === get("type") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
    ${input("title", "Título")}<label>Descrição<textarea name="${prefix}text">${escapeHtml(get("text"))}</textarea></label>
    <label><input type="checkbox" name="${prefix}noText" ${get("noText") === "on" ? "checked" : ""}>Sem descrição quando o texto estiver vazio</label>
    <label>Visibilidade<select name="${prefix}visibility">${[["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]].map(([v, label]) => `<option value="${v}" ${v === get("visibility") ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <fieldset><legend>Partes deste termo</legend>${parties.map((p, j) => `<label><input type="checkbox" name="${prefix}party_${j}" ${get(`party_${j}`) === "on" ? "checked" : ""}>${escapeHtml(p.ref.uuid ?? p.ref.id ?? p.id)} (${escapeHtml(p.id)})</label>`).join("")}</fieldset>
    <details><summary>Dados avançados do termo</summary><p>Edite o objeto completo para configurar prazos, condições, direitos, capacidades, requisitos e operações. Alterar o tipo aplica um modelo novo de dados; os demais termos são preservados.</p>
      <label>Dados do termo (JSON)<textarea name="${prefix}payload" rows="10" spellcheck="false">${escapeHtml(get("payload"))}</textarea></label></details>
    <button type="button" data-dm-term-move="${index}" data-dm-term-direction="-1" ${index === 0 ? "disabled" : ""}>Subir</button>
    <button type="button" data-dm-term-move="${index}" data-dm-term-direction="1" ${index === count - 1 ? "disabled" : ""}>Descer</button>
    <button type="button" data-dm-term-remove="${index}">Remover este termo</button></fieldset>`;
}
