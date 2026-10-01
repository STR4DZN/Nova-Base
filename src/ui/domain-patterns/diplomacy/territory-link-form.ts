import { ok, type Result } from "../../../core/contracts/result.js";
import { failure, isNamespaced, isTimestamp, isTypedRef, isVisibility } from "../../../core/validation/value-validation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import { temporalSourceIsEffective, type TerritoryLink } from "../../../territory/territory-state.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export interface LinkDestination { readonly id: string; readonly label: string; }
export const LINK_STATUSES = [["operational", "Operacional"], ["limited", "Limitada"], ["closed", "Fechada"], ["destroyed", "Destruída"]] as const;
const directions = [["both", "Ambas as direções"], ["outbound", "Saída deste território"], ["inbound", "Entrada neste território"]] as const;
const label = (s: string) => LINK_STATUSES.find(([k]) => k === s)?.[1] ?? s;
export function linkFields(l?: TerritoryLink): Record<string, string> {
  return { linkTarget: l?.targetTerritoryUuid ?? "", linkType: l?.linkType ?? "domain-manager:road", linkDirection: l?.direction ?? "both", linkStatus: l?.status ?? "operational",
    linkVisibility: l?.visibility ?? "public", linkStarts: l ? String(l.startsAtWorldTick) : "", linkExpires: l?.expiresAtWorldTick == null ? "" : String(l.expiresAtWorldTick),
    linkCost: l?.cost == null ? "" : String(l.cost), linkCapacity: l?.capacity == null ? "" : String(l.capacity), linkDependencies: l ? JSON.stringify(l.dependencyRefs) : "" };
}
/** Destinations/links must be the authenticated audience projection. */
export function parseLinkFields(f: Record<string, string>, sourceId: string, destinations: readonly LinkDestination[], worldTick: number,
  id: string, sourceRef: TypedRef): Result<{ readonly kind: "link"; readonly value: TerritoryLink }> {
  const target = f.linkTarget?.trim();
  if (!target || target === sourceId || !destinations.some(d => d.id === target)) return failure("DM_TERRITORY_LINK_UNAVAILABLE", "Selecione outro território visível.", "not-found");
  const starts = f.linkStarts?.trim() ? Number(f.linkStarts) : worldTick, expires = f.linkExpires?.trim() ? Number(f.linkExpires) : null,
    cost = f.linkCost?.trim() ? Number(f.linkCost) : null, capacity = f.linkCapacity?.trim() ? Number(f.linkCapacity) : null;
  if (!isTimestamp(starts) || expires !== null && (!isTimestamp(expires) || expires <= starts)) return failure("DM_TERRITORY_LINK_TIME_INVALID", "Use ticks inteiros não negativos e fim posterior ao início.");
  if ([cost, capacity].some(n => n !== null && !isTimestamp(n))) return failure("DM_TERRITORY_LINK_NUMBER_INVALID", "Custo e capacidade devem ser inteiros não negativos ou ficar em branco.");
  if (!isNamespaced(f.linkType?.trim()) || !directions.some(([k]) => k === f.linkDirection) || !LINK_STATUSES.some(([k]) => k === f.linkStatus) || !isVisibility(f.linkVisibility))
    return failure("DM_TERRITORY_LINK_INVALID", "Informe um tipo com namespace, direção, estado e visibilidade válidos.");
  let dependencies: unknown = [];
  try { if (f.linkDependencies?.trim()) dependencies = JSON.parse(f.linkDependencies); } catch { return failure("DM_TERRITORY_LINK_DEPENDENCY_INVALID", "Dependências devem ser uma lista JSON de referências tipadas."); }
  if (!Array.isArray(dependencies) || !dependencies.every(isTypedRef)) return failure("DM_TERRITORY_LINK_DEPENDENCY_INVALID", "Use referências com type e apenas id ou uuid.");
  return ok({ kind: "link", value: { id, sourceRef, targetTerritoryUuid: target, linkType: f.linkType.trim(), direction: f.linkDirection as TerritoryLink["direction"], status: f.linkStatus as TerritoryLink["status"],
    visibility: f.linkVisibility, startsAtWorldTick: starts, expiresAtWorldTick: expires, cost, capacity, dependencyRefs: dependencies } });
}
export function parseLinkStatus(f: Record<string, string>, links: readonly TerritoryLink[]): Result<{ readonly kind: "update-link"; readonly id: string; readonly status: TerritoryLink["status"] }> {
  if (!links.some(l => l.id === f.linkId)) return failure("DM_TERRITORY_LINK_UNAVAILABLE", "Selecione uma ligação visível.", "not-found");
  if (!LINK_STATUSES.some(([k]) => k === f.linkStatus)) return failure("DM_TERRITORY_LINK_INVALID", "Selecione um estado operacional válido.");
  return ok({ kind: "update-link", id: f.linkId, status: f.linkStatus as TerritoryLink["status"] });
}
const statusSelect = (value: string) => `<label>Estado operacional<select name="linkStatus">${LINK_STATUSES.map(([k, v]) => `<option value="${k}"${k === value ? " selected" : ""}>${v}</option>`).join("")}</select></label>`;
export function renderLinkFields(destinations: readonly LinkDestination[], values: Record<string, string>): string {
  const f = { ...linkFields(), ...values }, input = (n: string, l: string, attrs = "") => `<label>${l}<input name="${n}" value="${escapeAttribute(f[n] ?? "")}" ${attrs}></label>`;
  return `<label>Destino visível<select name="linkTarget" required><option value="">Selecione</option>${destinations.map(d => `<option value="${escapeAttribute(d.id)}"${f.linkTarget === d.id ? " selected" : ""}>${escapeHtml(d.label)} · ${escapeHtml(d.id)}</option>`).join("")}</select></label>
    ${f.linkTarget && !destinations.some(d => d.id === f.linkTarget) ? '<p role="alert">Destino anterior indisponível. Escolha outro destino visível.</p>' : ""}
    ${input("linkType", "Tipo (namespace:tipo)", "required")}<label>Direção<select name="linkDirection">${directions.map(([k, v]) => `<option value="${k}"${f.linkDirection === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>${statusSelect(f.linkStatus)}
    <details${f.linkCost || f.linkCapacity || f.linkDependencies || f.linkStarts || f.linkExpires || f.linkVisibility !== "public" ? " open" : ""}><summary>Custo, capacidade, dependências e vigência</summary>
    <p>Custo e capacidade são valores declarados; não movimentam recursos. Dependências são referências declarativas e não são executadas aqui.</p>
    ${input("linkCost", "Custo inteiro opcional", 'type="number" min="0" step="1"')}${input("linkCapacity", "Capacidade inteira opcional", 'type="number" min="0" step="1"')}
    <label>Dependências (lista JSON de type e id ou uuid)<textarea name="linkDependencies">${escapeHtml(f.linkDependencies)}</textarea></label>
    <label>Visibilidade<select name="linkVisibility">${[["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]].map(([k, v]) => `<option value="${k}"${f.linkVisibility === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    ${input("linkStarts", "Início (em branco: tick da consulta)", 'type="number" min="0" step="1"')}${input("linkExpires", "Fim exclusivo (em branco: sem limite)", 'type="number" min="0" step="1"')}</details>`;
}
export function renderLinkStatusFields(links: readonly TerritoryLink[], f: Record<string, string>): string {
  return `<label>Ligação visível<select name="linkId" required><option value="">Selecione</option>${links.map(l => `<option value="${escapeAttribute(l.id)}"${f.linkId === l.id ? " selected" : ""}>${escapeHtml(l.id)} · ${escapeHtml(l.targetTerritoryUuid)} · ${escapeHtml(label(l.status))}</option>`).join("")}</select></label>${statusSelect(f.linkStatus ?? "operational")}`;
}
export function renderLinkRequest(a: any, title = "Ligação solicitada"): string {
  const l = a.value;
  return `<section><h3>${escapeHtml(title)}</h3>${a.kind === "link" ? `<p>Destino: ${escapeHtml(l.targetTerritoryUuid)} · Tipo: ${escapeHtml(l.linkType)} · Direção: ${escapeHtml(l.direction)} · Estado: ${escapeHtml(label(l.status))}</p><p>Custo: ${l.cost ?? "não definido"} · Capacidade: ${l.capacity ?? "não definida"} · Início: ${l.startsAtWorldTick} · Fim exclusivo: ${l.expiresAtWorldTick ?? "sem limite"} · Visibilidade: ${escapeHtml(l.visibility)}</p>` : `<p>Ligação: ${escapeHtml(a.id)} · Novo estado: ${escapeHtml(label(a.status))}</p>`}</section>`;
}
export function renderTerritoryLinks(d: any, tick: number, isGm: boolean, destinations: readonly LinkDestination[], page: any, search: string,
  draft: Record<string, string>, statusDraft: Record<string, string>, destinationError: string): string {
  const links: readonly TerritoryLink[] = d.links ?? [], current = links.filter(l => temporalSourceIsEffective(l, tick));
  const reason = (f: Record<string, string>) => `<input type="hidden" name="linkRevision" value="${escapeAttribute(f.linkRevision ?? String(d.revision))}"><p>Revisão atual: ${d.revision}; rascunho: ${escapeHtml(f.linkRevision ?? String(d.revision))}.</p><label>Motivo auditável<input name="reason" required value="${escapeAttribute(f.reason ?? "")}"></label>`;
  return `<section><h3>Ligações territoriais</h3><p>${links.length} ligações visíveis. Vigentes no tick ${tick}: ${LINK_STATUSES.map(([k, v]) => `${current.filter(l => l.status === k).length} ${v.toLowerCase()}`).join(" · ")}.</p>
    ${links.length ? `<table><thead><tr><th>Destino / tipo / direção</th><th>Estado / vigência</th><th>Custo / capacidade / dependências</th></tr></thead><tbody>${links.map(l => `<tr><td>${escapeHtml(l.targetTerritoryUuid)} · ${escapeHtml(l.linkType)} · ${escapeHtml(l.direction)}</td><td>${escapeHtml(label(l.status))} · ${tick < l.startsAtWorldTick ? "Agendada" : temporalSourceIsEffective(l, tick) ? "Vigente" : "Expirada"} (${l.startsAtWorldTick} → ${l.expiresAtWorldTick ?? "sem limite"}) · ${escapeHtml(l.visibility)}</td><td>${l.cost ?? "—"} / ${l.capacity ?? "—"} / ${escapeHtml(JSON.stringify(l.dependencyRefs))}</td></tr>`).join("")}</tbody></table>` : "<p>Nenhuma ligação visível.</p>"}
    <h4>${isGm ? "Adicionar ligação" : "Propor ligação ao GM"}</h4>
    <form data-dm-form="link-destinations"><label>Buscar destinos<input name="destinationSearch" value="${escapeAttribute(search)}"></label><button>Buscar</button></form>
    <p>${page ? `Página de destinos: ${(page.items.length ? page.offset + 1 : 0)}–${page.offset + page.items.length} de ${page.total} (o próprio território é excluído da seleção).` : "Destinos indisponíveis."}</p>
    <button type="button" data-dm-link-page="-1" ${!page || page.offset === 0 ? "disabled" : ""}>Destinos anteriores</button><button type="button" data-dm-link-page="1" ${!page || page.offset + page.limit >= page.total ? "disabled" : ""}>Próximos destinos</button>
    ${destinationError ? `<p role="alert">${escapeHtml(destinationError)}</p>` : ""}
    ${page ? `<form data-dm-form="territory-link">${renderLinkFields(destinations, draft)}${reason(draft)}<button>${isGm ? "Registrar ligação" : "Enviar proposta ao GM"}</button><button type="button" data-dm-link-reset="true">Limpar rascunhos / usar revisão atual</button></form>` : ""}
    ${links.length ? `<h4>${isGm ? "Alterar estado operacional" : "Propor novo estado ao GM"}</h4><form data-dm-form="territory-link-status">${renderLinkStatusFields(links, statusDraft)}${reason(statusDraft)}<button>${isGm ? "Atualizar estado" : "Enviar proposta ao GM"}</button><button type="button" data-dm-link-reset="true">Limpar rascunhos / usar revisão atual</button></form>` : ""}
    <p>A direção é relativa a este território. A ligação não cria uma cópia no destino nem concede direito de trânsito.</p></section>`;
}
