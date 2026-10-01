import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
import type { AgreementDuration, AgreementTerm, AgreementProposalRound, AgreementProposal } from "../../../agreements/agreement-model.js";
import type { AgreementNegotiationDifference } from "../../../agreements/agreement-negotiation.js";
type Round = AgreementProposalRound & { readonly comparison?: AgreementNegotiationDifference | null };
type Proposal = Omit<AgreementProposal, "rounds"> & { readonly rounds: readonly Round[] };
const tick = (x: number | null) => x === null ? "Sem limite" : String(x);
function duration(d: AgreementDuration): string { return `Início: ${d.startsAtWorldTick === null ? "Na ativação" : d.startsAtWorldTick}; fim: ${tick(d.expiresAtWorldTick)}`; }
function term(t: AgreementTerm | null): string {
  if (!t) return "<p>Ausente neste snapshot.</p>";
  return `<p><strong>${escapeHtml(t.title)}</strong> · ${escapeHtml(t.id)} · ${escapeHtml(t.type)}</p>
    <p>${escapeHtml(t.text ?? "Sem descrição")}</p><p>Visibilidade: ${escapeHtml(t.visibility)}; partes: ${escapeHtml(t.partyIds.join(", ") || "Todas")}</p>
    <details><summary>Dados do termo</summary><pre>${escapeHtml(JSON.stringify(t.payload, null, 2))}</pre></details>`;
}
function difference(d: AgreementNegotiationDifference): string {
  const names = { added: "Adicionado", removed: "Removido", changed: "Alterado" };
  const fields: Record<string, string> = { type: "Tipo", title: "Título", text: "Descrição", visibility: "Visibilidade", partyIds: "Partes", payload: "Dados do termo" };
  return `<section><h5>Comparação com a rodada anterior</h5>${d.terms.length ? d.terms.map(x =>
    `<details><summary>${names[x.kind]}: ${escapeHtml((x.after ?? x.before)!.title)}</summary>
      <p>Campos: ${escapeHtml(x.changedFields.map(k => fields[k] ?? k).join(", ") || "Termo completo")}</p><h6>Antes</h6>${term(x.before)}<h6>Depois</h6>${term(x.after)}</details>`).join("")
    : "<p>Sem alterações nos termos visíveis.</p>"}
    ${d.orderChanged ? "<p>Ordem dos termos visíveis alterada.</p>" : ""}
    <p>Duração ${d.duration.changed ? "alterada" : "preservada"}: antes ${escapeHtml(duration(d.duration.before))}; depois ${escapeHtml(duration(d.duration.after))}.</p></section>`;
}
export function renderAgreementNegotiation(proposals: readonly Proposal[], parties: readonly { id: string; ref: any }[],
  worldTick: number, isGm: boolean, savedFields: Record<string, string> = {}): string {
  const party = (id: string) => { const p = parties.find(x => x.id === id); return p?.ref?.uuid ?? p?.ref?.id ?? id; };
  return `<section><h3>Negociação e rodadas</h3>${proposals.length ? proposals.map(p =>
    `<details><summary>${escapeHtml(p.id)} · ${escapeHtml(p.lifecycle)} · ${p.purpose === "amendment" ? "Emenda" : "Inicial"}</summary>
      <p>Revisão da proposta: ${p.revision}; prazo para aceitação: ${tick(p.expiresAtWorldTick)}; relógio atual: ${worldTick}.</p>
      ${["open", "accepted"].includes(p.lifecycle) && p.expiresAtWorldTick !== null ? `<form data-dm-form="agreement-expire-proposal">
        <input type="hidden" name="sourceId" value="${escapeAttribute(p.id)}"><input type="hidden" name="kind" value="expire-proposal">
        <label>Motivo auditável<input name="reason" required value="${escapeAttribute(savedFields.kind === "expire-proposal" && savedFields.sourceId === p.id ? savedFields.reason ?? "" : "")}"></label>
        <button ${worldTick < p.expiresAtWorldTick ? "disabled" : ""}>${isGm ? "Registrar expiração da proposta" : "Propor expiração ao GM"}</button>
        ${worldTick < p.expiresAtWorldTick ? "<p>O prazo da proposta ainda não foi atingido.</p>" : ""}</form>` : ""}
      ${p.rounds.map(r => `<details><summary>Rodada ${r.round} · ofertada por ${escapeHtml(party(r.offeredByPartyId))}</summary>
        <p>Momento: ${r.at}; ${escapeHtml(duration(r.duration))}.</p>
        <p>Aceitaram: ${escapeHtml(r.acceptedPartyIds.map(party).join(", ") || "Ninguém")}; rejeitaram: ${escapeHtml(r.rejectedPartyIds.map(party).join(", ") || "Ninguém")}.</p>
        <h4>Termos desta rodada</h4>${r.terms.length ? r.terms.map(term).join("") : "<p>Nenhum termo visível nesta rodada.</p>"}
        ${r.comparison ? difference(r.comparison) : "<p>Primeira oferta; sem rodada anterior.</p>"}</details>`).join("")}</details>`).join("") : "<p>Nenhuma proposta de termos.</p>"}</section>`;
}
