import { ok, type Result } from "../../../core/contracts/result.js";
import { failure, isTimestamp, isText, isVisibility } from "../../../core/validation/value-validation.js";
import { validateRelationPartyRef } from "../../../relations/types/relation-validation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import { temporalSourceIsEffective, type ClaimRecognition, type TerritoryClaim } from "../../../territory/territory-state.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export const RECOGNITION_POSITIONS = [["positive", "Reconhece"], ["negative", "Não reconhece"], ["unknown", "Sem posição"]] as const;
const partyTypes = [["domain", "Domínio"], ["actor", "Actor"], ["narrative", "Parte narrativa"], ["populationGroup", "Grupo populacional"],
  ["operationalGroup", "Grupo operacional"], ["notable", "Notável"]] as const;
const partyLabel = (r: any) => r ? `${r.type}: ${r.uuid ?? r.id}${r.domainUuid ? ` (${r.domainUuid})` : ""}` : "—";
const positionLabel = (position: string) => RECOGNITION_POSITIONS.find(([key]) => key === position)?.[1] ?? position;
export function recognitionFields(r?: ClaimRecognition): Record<string, string> {
  return { recognitionClaimId: r?.claimId ?? "", recognitionPartyType: r?.recognizingRef.type ?? "domain", recognitionPartyRef: r?.recognizingRef.uuid ?? r?.recognizingRef.id ?? "",
    recognitionDomainUuid: r?.recognizingRef.domainUuid ?? "", recognitionPosition: r?.position ?? "unknown", recognitionVisibility: r?.visibility ?? "public",
    recognitionStarts: r ? String(r.startsAtWorldTick) : "", recognitionExpires: r?.expiresAtWorldTick == null ? "" : String(r.expiresAtWorldTick) };
}
/** claims must come from the authenticated detail projection, never a raw storage snapshot. */
export function parseRecognitionFields(f: Record<string, string>, claims: readonly TerritoryClaim[], worldTick: number,
  id: string, sourceRef: TypedRef): Result<{ readonly kind: "recognition"; readonly value: ClaimRecognition }> {
  const claimId = f.recognitionClaimId?.trim();
  if (!claimId || !claims.some(c => c.id === claimId)) return failure("DM_TERRITORY_RECOGNITION_UNAVAILABLE", "Selecione uma reivindicação visível.", "not-found");
  const type = f.recognitionPartyType, value = f.recognitionPartyRef?.trim(), domainUuid = f.recognitionDomainUuid?.trim();
  if (!partyTypes.some(([key]) => key === type) || !value) return failure("DM_TERRITORY_RECOGNITION_PARTY_INVALID", "Informe a parte que declara sua posição.");
  const embedded = ["populationGroup", "operationalGroup", "notable"].includes(type);
  if (!embedded && domainUuid) return failure("DM_TERRITORY_RECOGNITION_PARTY_INVALID", "O Domínio de origem é usado somente para grupos e notáveis.");
  const party = validateRelationPartyRef({ type, ...(type === "domain" || type === "actor" ? { uuid: value } : { id: value }), ...(embedded ? { domainUuid } : {}) });
  if (!party.ok) return party;
  const starts = f.recognitionStarts?.trim() ? Number(f.recognitionStarts) : worldTick,
    expires = f.recognitionExpires?.trim() ? Number(f.recognitionExpires) : null;
  if (!isTimestamp(starts) || expires !== null && (!isTimestamp(expires) || expires <= starts))
    return failure("DM_TERRITORY_RECOGNITION_TIME_INVALID", "Use ticks inteiros não negativos; o fim deve ser posterior ao início.");
  if (!RECOGNITION_POSITIONS.some(([key]) => key === f.recognitionPosition) || !isVisibility(f.recognitionVisibility) || !isText(id))
    return failure("DM_TERRITORY_RECOGNITION_INVALID", "Selecione uma posição e uma visibilidade válidas.");
  return ok({ kind: "recognition", value: { id, sourceRef, visibility: f.recognitionVisibility, startsAtWorldTick: starts, expiresAtWorldTick: expires,
    claimId, recognizingRef: party.value, position: f.recognitionPosition as ClaimRecognition["position"] } });
}
export function renderRecognitionFields(claims: readonly TerritoryClaim[], values: Record<string, string>): string {
  const f = { ...recognitionFields(), ...values }, selected = (a: string, b: string) => a === b ? " selected" : "";
  const input = (name: string, label: string, attrs = "") => `<label>${label}<input name="${name}" value="${escapeAttribute(f[name] ?? "")}" ${attrs}></label>`;
  return `<label>Reivindicação visível<select name="recognitionClaimId" required><option value="">Selecione</option>${claims.map(c => `<option value="${escapeAttribute(c.id)}"${selected(c.id, f.recognitionClaimId)}>${escapeHtml(`${c.id} · ${partyLabel(c.claimantRef)} · ${c.claimType} · ${c.lifecycle}`)}</option>`).join("")}</select></label>
    ${f.recognitionClaimId && !claims.some(c => c.id === f.recognitionClaimId) ? `<p role="alert">A seleção anterior está indisponível. Selecione uma reivindicação visível.</p>` : ""}
    <label>Tipo da parte que reconhece<select name="recognitionPartyType">${partyTypes.map(([key, label]) => `<option value="${key}"${selected(key, f.recognitionPartyType)}>${label}</option>`).join("")}</select></label>
    ${input("recognitionPartyRef", "UUID de Domínio/Actor ou ID da parte/grupo/notável", "required")}
    <details${["populationGroup", "operationalGroup", "notable"].includes(f.recognitionPartyType) ? " open" : ""}><summary>Domínio de origem para grupos e notáveis</summary>${input("recognitionDomainUuid", "UUID do Domínio de origem (somente grupos e notáveis)")}</details>
    <label>Posição<select name="recognitionPosition">${RECOGNITION_POSITIONS.map(([key, label]) => `<option value="${key}"${selected(key, f.recognitionPosition)}>${label}</option>`).join("")}</select></label>
    <details${f.recognitionStarts || f.recognitionExpires || f.recognitionVisibility !== "public" ? " open" : ""}><summary>Visibilidade e vigência</summary><p>Em branco: início no tick da consulta e sem limite de duração. A visibilidade padrão é pública.</p>
    <label>Visibilidade<select name="recognitionVisibility">${[["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]].map(([key, label]) => `<option value="${key}"${selected(key, f.recognitionVisibility)}>${label}</option>`).join("")}</select></label>
    ${input("recognitionStarts", "Início (ticks do mundo; em branco: tick da consulta)", 'type="number" min="0" step="1"')}
    ${input("recognitionExpires", "Fim exclusivo (ticks; em branco: sem limite)", 'type="number" min="0" step="1"')}</details>
    <p>A parte declara uma posição sobre esta reivindicação. Isso não transfere propriedade, concede direitos nem decide disputas. Reivindicações encerradas continuam disponíveis para registros históricos.</p>`;
}
export function renderRecognitionRequest(r: ClaimRecognition, title = "Reconhecimento solicitado"): string {
  return `<section><h3>${escapeHtml(title)}</h3><p>Reivindicação: ${escapeHtml(r.claimId)} · Parte: ${escapeHtml(partyLabel(r.recognizingRef))}</p>
    <p>Posição: ${escapeHtml(positionLabel(r.position))} · Visibilidade: ${escapeHtml(r.visibility)} · Início: ${r.startsAtWorldTick} · Fim exclusivo: ${r.expiresAtWorldTick ?? "sem limite"}</p></section>`;
}
export function renderTerritoryRecognitions(d: any, worldTick: number, isGm: boolean, f: Record<string, string>): string {
  const rows: readonly ClaimRecognition[] = d.recognitions ?? [], claims: readonly TerritoryClaim[] = d.claims ?? [],
    effective = rows.filter(r => temporalSourceIsEffective(r, worldTick));
  const count = (p: ClaimRecognition["position"]) => effective.filter(r => r.position === p).length;
  return `<section><h3>Reconhecimento contextual</h3><p>${rows.length} declarações visíveis. No tick ${worldTick}: ${count("positive")} reconhecem · ${count("negative")} não reconhecem · ${count("unknown")} sem posição. Contagens são declarações, sem votação ou legitimidade universal.</p>
    ${rows.length ? `<div class="dm-reputation-history-table"><table><thead><tr><th>Reivindicação</th><th>Parte/audiência</th><th>Posição</th><th>Vigência</th><th>Visibilidade</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.claimId)}</td><td>${escapeHtml(partyLabel(r.recognizingRef))}</td><td>${escapeHtml(positionLabel(r.position))}</td><td>${worldTick < r.startsAtWorldTick ? "Agendada" : temporalSourceIsEffective(r, worldTick) ? "Vigente" : "Expirada"} · ${r.startsAtWorldTick} → ${r.expiresAtWorldTick ?? "sem limite"}</td><td>${escapeHtml(r.visibility)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Nenhuma declaração de reconhecimento visível.</p>"}
    <h4>${isGm ? "Registrar reconhecimento" : "Propor reconhecimento ao GM"}</h4>
    ${claims.length ? `<form data-dm-form="territory-recognition"><input type="hidden" name="recognitionRevision" value="${escapeAttribute(f.recognitionRevision ?? String(d.revision))}">
      <p>Revisão atual: ${d.revision}. Rascunho vinculado à revisão ${escapeHtml(f.recognitionRevision ?? String(d.revision))}.</p>${renderRecognitionFields(claims, f)}
      <label>Motivo auditável<input name="reason" value="${escapeAttribute(f.reason ?? "")}" required></label><button>${isGm ? "Registrar" : "Enviar proposta ao GM"}</button>
      <button type="button" data-dm-recognition-reset="true">Limpar rascunho / usar revisão atual</button></form>` : "<p>Adicione uma reivindicação visível antes de registrar ou propor reconhecimento.</p>"}</section>`;
}
