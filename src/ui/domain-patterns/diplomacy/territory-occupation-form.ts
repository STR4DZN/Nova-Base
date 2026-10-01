import { ok, type Result } from "../../../core/contracts/result.js";
import { failure, isTimestamp, isText, isVisibility } from "../../../core/validation/value-validation.js";
import { validateRelationPartyRef } from "../../../relations/types/relation-validation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import { temporalSourceIsEffective, type TerritoryOccupation, type TerritoryPresence, type TerritoryClaim } from "../../../territory/territory-state.js";
import { escapeHtml as h, escapeAttribute as attr } from "../facilities/facility-view.js";
export const OCCUPATION_ACTIONS = ["occupation", "end-occupation"] as const;
export const OCCUPATION_STATES = [["established", "Estabelecida"], ["contested", "Contestada"], ["stable", "Estável"], ["withdrawing", "Em retirada"], ["ended", "Encerrada"]] as const;
const partyTypes = [["domain", "Domínio"], ["actor", "Actor"], ["narrative", "Parte narrativa"], ["populationGroup", "Grupo populacional"], ["operationalGroup", "Grupo operacional"], ["notable", "Notável"]] as const;
const label = (r: any) => `${r.type}: ${r.uuid ?? r.id}${r.domainUuid ? ` (${r.domainUuid})` : ""}`;
const lifecycleLabel = (s: string) => OCCUPATION_STATES.find(([key]) => key === s)?.[1] ?? s;
export function occupationFields(o?: TerritoryOccupation): Record<string, string> {
  return { occupationPartyType: o?.occupierRef.type ?? "domain", occupationPartyRef: o?.occupierRef.uuid ?? o?.occupierRef.id ?? "", occupationDomainUuid: o?.occupierRef.domainUuid ?? "",
    occupationLifecycle: o?.lifecycle ?? "established", occupationVisibility: o?.visibility ?? "public", occupationStarts: o ? String(o.startsAtWorldTick) : "",
    occupationExpires: o?.expiresAtWorldTick == null ? "" : String(o.expiresAtWorldTick), occupationPresenceIds: JSON.stringify(o?.presenceIds ?? []), occupationControlIds: JSON.stringify(o?.controlClaimIds ?? []) };
}
export function occupationReferenceIds(raw: string | undefined): Result<readonly string[]> {
  try { const ids: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(ids) && ids.every(isText) && new Set(ids).size === ids.length) return ok(ids);
  } catch { /* invalid selections are reported uniformly */ }
  return failure("DM_TERRITORY_OCCUPATION_REFERENCES_INVALID", "Seleções precisam de listas válidas, sem referências repetidas.");
}
/** Reference lists must be authenticated projections of the selected territory. Historical references are retained explicitly. */
export function parseOccupationFields(f: Record<string, string>, presence: readonly TerritoryPresence[], claims: readonly TerritoryClaim[], tick: number,
  id: string, sourceRef: TypedRef): Result<{ kind: "occupation"; value: TerritoryOccupation }> {
  const ps = occupationReferenceIds(f.occupationPresenceIds), cs = occupationReferenceIds(f.occupationControlIds);
  if (!ps.ok) return ps; if (!cs.ok) return cs;
  if (f.occupationReferencesUnavailable === "on" || ps.value.some(id => !presence.some(p => p.id === id))
    || cs.value.some(id => !claims.some(c => c.id === id && c.claimType === "domain-manager:control")))
    return failure("DM_TERRITORY_OCCUPATION_UNAVAILABLE", "Use somente presenças e reivindicações de controle visíveis neste território.", "not-found");
  const type = f.occupationPartyType, value = f.occupationPartyRef?.trim(), domainUuid = f.occupationDomainUuid?.trim(), embedded = ["populationGroup", "operationalGroup", "notable"].includes(type);
  if (!partyTypes.some(([key]) => key === type) || !value || !embedded && domainUuid)
    return failure("DM_TERRITORY_OCCUPATION_PARTY_INVALID", "Informe uma parte válida; origem somente para grupos e notáveis.");
  const party = validateRelationPartyRef({ type, ...(type === "domain" || type === "actor" ? { uuid: value } : { id: value }), ...(embedded ? { domainUuid } : {}) }); if (!party.ok) return party;
  const start = f.occupationStarts?.trim() ? Number(f.occupationStarts) : tick, end = f.occupationExpires?.trim() ? Number(f.occupationExpires) : null;
  if (!isTimestamp(tick) || !isTimestamp(start) || end !== null && (!isTimestamp(end) || end <= start))
    return failure("DM_TERRITORY_OCCUPATION_TIME_INVALID", "Use ticks inteiros não negativos; o fim deve ser posterior ao início.");
  if (!isVisibility(f.occupationVisibility) || !OCCUPATION_STATES.some(([key]) => key === f.occupationLifecycle) || !isText(id))
    return failure("DM_TERRITORY_OCCUPATION_INVALID", "Selecione estado e visibilidade válidos.");
  return ok({ kind: "occupation", value: { id, sourceRef, visibility: f.occupationVisibility, startsAtWorldTick: start, expiresAtWorldTick: end,
    occupierRef: party.value, lifecycle: f.occupationLifecycle as TerritoryOccupation["lifecycle"], presenceIds: ps.value, controlClaimIds: cs.value } });
}
export function parseOccupationEnd(f: Record<string, string>, occupations: readonly TerritoryOccupation[]): Result<{ kind: "end-occupation"; id: string }> {
  if (!occupations.some(o => o.id === f.occupationId)) return failure("DM_TERRITORY_OCCUPATION_UNAVAILABLE", "Selecione uma ocupação visível.", "not-found");
  return ok({ kind: "end-occupation", id: f.occupationId });
}
const input = (f: Record<string, string>, key: string, title: string, args = "") => `<label>${title}<input name="${key}" value="${attr(f[key] ?? "")}" ${args}></label>`;
const select = (f: Record<string, string>, key: string, title: string, options: readonly (readonly [string, string])[]) => `<label>${title}<select name="${key}">${options.map(([id, title]) => `<option value="${attr(id)}"${f[key] === id ? " selected" : ""}>${h(title)}</option>`).join("")}</select></label>`;
export function renderOccupationFields(presence: readonly TerritoryPresence[], claims: readonly TerritoryClaim[], values: Record<string, string>): string {
  const f = { ...occupationFields(), ...values }, ps = occupationReferenceIds(f.occupationPresenceIds), cs = occupationReferenceIds(f.occupationControlIds), controls = claims.filter(c => c.claimType === "domain-manager:control");
  const missing = f.occupationReferencesUnavailable === "on" || !ps.ok || !cs.ok || ps.value.some(id => !presence.some(p => p.id === id)) || cs.value.some(id => !controls.some(c => c.id === id));
  const multi = (key: string, title: string, rows: readonly { id: string; title: string }[], ids: readonly string[]) => `<label>${title}<select name="${key}" multiple size="${Math.min(6, Math.max(2, rows.length))}">${rows.map(r => `<option value="${attr(r.id)}"${ids.includes(r.id) ? " selected" : ""}>${h(r.title)}</option>`).join("")}</select></label>${rows.length ? "" : "<p>Nenhuma referência visível disponível.</p>"}`;
  return `${select(f, "occupationPartyType", "Tipo do ocupante", partyTypes)}${input(f, "occupationPartyRef", "UUID de Domínio/Actor ou ID de parte/grupo/notável", "required")}
    <details${["populationGroup", "operationalGroup", "notable"].includes(f.occupationPartyType) ? " open" : ""}><summary>Origem de grupos e notáveis</summary>${input(f, "occupationDomainUuid", "UUID do Domínio de origem")}</details>
    ${select(f, "occupationLifecycle", "Estado declarado", OCCUPATION_STATES)}
    <fieldset><legend>Referências de presença e controle</legend>${multi("occupationPresenceIds", "Presenças visíveis (seleção múltipla)", presence.map(p => ({ id: p.id, title: `${p.id} · ${label(p.partyRef)} · ${p.active ? "ativa" : "encerrada"}` })), ps.ok ? ps.value : [])}
    ${multi("occupationControlIds", "Reivindicações de controle visíveis (seleção múltipla)", controls.map(c => ({ id: c.id, title: `${c.id} · ${label(c.claimantRef)} · ${c.lifecycle}${c.contested ? " · contestada" : ""}` })), cs.ok ? cs.value : [])}
    <p>Use Ctrl/Cmd para selecionar mais de uma referência. As referências são opcionais e não criam presença nem controle. Registros históricos podem ser vinculados sem reativá-los.</p></fieldset>
    ${missing ? '<input type="hidden" name="occupationReferencesUnavailable" value="on"><p role="alert">Uma seleção do rascunho não está disponível. Limpe o rascunho para escolher as referências atuais.</p>' : ""}
    <details><summary>Visibilidade e vigência</summary>${select(f, "occupationVisibility", "Visibilidade", [["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]])}${input(f, "occupationStarts", "Início (em branco: tick atual)", 'type="number" min="0" step="1"')}${input(f, "occupationExpires", "Fim exclusivo (em branco: sem limite)", 'type="number" min="0" step="1"')}</details>`;
}
export function renderOccupationEnd(occupations: readonly TerritoryOccupation[], f: Record<string, string>, fixedId?: string): string {
  const rows = occupations.filter(o => !fixedId || o.id === fixedId);
  return `<label>Ocupação visível<select name="occupationId" required><option value="">Selecione</option>${rows.map(o => `<option value="${attr(o.id)}"${(fixedId ?? f.occupationId) === o.id ? " selected" : ""}>${h(o.id)} · ${h(label(o.occupierRef))} · ${h(lifecycleLabel(o.lifecycle))}</option>`).join("")}</select></label><p>Encerrar conserva as referências e o histórico. Presenças, reivindicações e propriedade mantêm seus registros próprios.</p>`;
}
export function renderOccupationRequest(action: any, title = "Ocupação solicitada"): string {
  const o: TerritoryOccupation = action.value;
  return `<section><h3>${h(title)}</h3>${action.kind === "end-occupation" ? `<p>Encerrar ocupação: ${h(action.id)}</p>` : `<p>${h(o.id)} · ${h(label(o.occupierRef))} · ${h(lifecycleLabel(o.lifecycle))} · ${h(o.visibility)} · ${o.startsAtWorldTick} → ${o.expiresAtWorldTick ?? "sem limite"}</p><p>Presenças: ${o.presenceIds.map(h).join(", ") || "nenhuma"}</p><p>Controle: ${o.controlClaimIds.map(h).join(", ") || "nenhum"}</p>`}</section>`;
}
export function renderTerritoryOccupations(d: any, tick: number, isGm: boolean, draft: Record<string, string>, endDraft: Record<string, string>): string {
  const occupations: readonly TerritoryOccupation[] = d.occupations ?? [], effective = occupations.filter(o => o.lifecycle !== "ended" && temporalSourceIsEffective(o, tick));
  const audit = (f: Record<string, string>) => `<input type="hidden" name="occupationRevision" value="${attr(f.occupationRevision ?? String(d.revision))}"><p>Revisão atual: ${d.revision}; rascunho: ${h(f.occupationRevision ?? String(d.revision))}.</p>${input(f, "reason", "Motivo auditável", "required")}`;
  return `<section><h3>Ocupação territorial</h3><p>${occupations.length} registros visíveis; ${effective.length} não encerrados e vigentes no tick ${tick}. Ocupação não concede propriedade, cria presença ou escolhe um vencedor.</p>
    <p>${OCCUPATION_STATES.map(([key, title]) => `${occupations.filter(o => o.lifecycle === key).length} ${h(title)}`).join(" · ")}</p>
    ${occupations.map(o => `<details><summary>${h(o.id)} · ${h(label(o.occupierRef))} · ${h(lifecycleLabel(o.lifecycle))} · ${tick < o.startsAtWorldTick ? "Agendada" : temporalSourceIsEffective(o, tick) ? "Vigente" : "Expirada"}</summary>${renderOccupationRequest({ kind: "occupation", value: o }, "Declaração de ocupação")}</details>`).join("")}
    <h4>${isGm ? "Registrar ocupação" : "Propor ocupação ao GM"}</h4><form data-dm-form="territory-occupation">${renderOccupationFields(d.presence ?? [], d.claims ?? [], draft)}${audit(draft)}<button>${isGm ? "Registrar" : "Enviar proposta ao GM"}</button><button type="button" data-dm-occupation-reset="true">Limpar rascunhos / usar revisão atual</button></form>
    ${occupations.length ? `<h4>${isGm ? "Encerrar ocupação" : "Propor encerramento ao GM"}</h4><form data-dm-form="territory-occupation-end">${renderOccupationEnd(occupations, endDraft)}${audit(endDraft)}<button>${isGm ? "Encerrar" : "Enviar proposta ao GM"}</button><button type="button" data-dm-occupation-reset="true">Limpar rascunhos / usar revisão atual</button></form>` : ""}</section>`;
}
